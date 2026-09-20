/**
 * ============================================================================
 *  The rich text contract — and the attachment one, which shares its one rule.
 * ============================================================================
 *
 *  THE RULE: a value may REFER to a file; it may never CONTAIN one.
 *
 *  Every write in this app is a mutation — kept in the log forever and broadcast
 *  to every connected client. A rich text document is sent WHOLE on each save. So
 *  a pasted screenshot embedded as a data: URI would put megabytes into the log
 *  per keystroke-pause and push them to everyone looking at the database. Files
 *  go to the asset store (server/assets.ts); what a value holds is an asset ID.
 *
 *    rich_text    { type: 'doc', content: [...] }       TipTap / ProseMirror JSON.
 *                 An image is a node { type: 'image', attrs: { assetId, width?,
 *                 height?, alt? } } — NO `src`. The renderer builds the URL from
 *                 the id, so the same document works in the browser and, later,
 *                 in the Tauri client, whatever the server's address is.
 *    attachment   ['<asset id>', …]                      unique, ordered.
 *
 *  Shared, as ever, so the editor refuses what the server would refuse. The
 *  server additionally checks that every asset id EXISTS (apply.ts) — that needs
 *  the database, so it is not here; `assetIdsIn` is what it feeds on.
 *
 *  The node SCHEMA is deliberately not validated here. ProseMirror's schema lives
 *  in the editor, a server-side copy would have to be kept in step with every
 *  extension added, and an unknown node type does no harm — the editor drops it
 *  on load. What IS checked is everything that could hurt: size, embedded data,
 *  script-bearing URLs.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A document is re-sent whole on every save; this bounds what one save can cost. */
export const RICH_TEXT_MAX_BYTES = 1024 * 1024;
export const ATTACHMENT_MAX = 100;

export interface RichNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  content?: RichNode[];
}

function* walk(node: RichNode): Generator<RichNode> {
  yield node;
  if (Array.isArray(node.content)) for (const c of node.content) if (c && typeof c === 'object') yield* walk(c);
}

const isDoc = (v: unknown): v is RichNode =>
  !!v && typeof v === 'object' && !Array.isArray(v) && (v as RichNode).type === 'doc';

/** `javascript:` and friends. Links are the one place a document carries a URL. */
const SAFE_HREF = /^(https?:|mailto:|tel:|\/|#)/i;

export function richTextError(key: string, value: unknown): string | null {
  if (!isDoc(value)) return `'${key}' must be a rich text document`;
  if (JSON.stringify(value).length > RICH_TEXT_MAX_BYTES) {
    return `'${key}' is larger than ${RICH_TEXT_MAX_BYTES / 1024} KB — images belong in the asset store, not in the text`;
  }
  for (const n of walk(value)) {
    if (n.type === 'image') {
      const a = n.attrs ?? {};
      if ('src' in a && a.src != null) return `'${key}': an image must refer to an asset by id, not carry a src`;
      if (typeof a.assetId !== 'string' || !UUID.test(a.assetId)) return `'${key}': an image has no valid asset id`;
    }
    for (const m of n.marks ?? []) {
      const href = m.type === 'link' ? m.attrs?.href : undefined;
      if (typeof href === 'string' && !SAFE_HREF.test(href.trim())) return `'${key}': link target not allowed (${href.slice(0, 40)})`;
    }
    // Belt and braces: no attribute anywhere may smuggle a data: URI in.
    for (const v of Object.values(n.attrs ?? {})) {
      if (typeof v === 'string' && /^data:/i.test(v.trim())) return `'${key}': embedded data is not allowed — upload it as an asset`;
    }
  }
  return null;
}

export function attachmentError(key: string, value: unknown): string | null {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !UUID.test(v))) {
    return `'${key}' must be a list of asset ids`;
  }
  if (new Set(value).size !== value.length) return `'${key}' lists a file more than once`;
  if (value.length > ATTACHMENT_MAX) return `'${key}' holds at most ${ATTACHMENT_MAX} files`;
  return null;
}

/** Every asset a value refers to — what the server checks for existence. */
export function assetIdsIn(type: string, value: unknown): string[] {
  if (type === 'attachment') return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  if (type !== 'rich_text' || !isDoc(value)) return [];
  const out: string[] = [];
  for (const n of walk(value)) if (n.type === 'image' && typeof n.attrs?.assetId === 'string') out.push(n.attrs.assetId);
  return out;
}

/**
 * The document as plain text: for the grid cell, the card row, sorting, filtering
 * and quick search. Blocks become lines; an image becomes a visible marker so a
 * note that is ONLY a screenshot does not read as empty.
 */
const BLOCKS = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem', 'taskItem', 'tableRow', 'horizontalRule']);
export function richTextToPlain(value: unknown): string {
  if (!isDoc(value)) return '';
  let out = '';
  const visit = (n: RichNode) => {
    if (typeof n.text === 'string') out += n.text;
    if (n.type === 'image') out += '[image]';
    if (n.type === 'hardBreak') out += '\n';
    for (const c of n.content ?? []) visit(c);
    if (n.type === 'tableCell' || n.type === 'tableHeader') out += '\t';
    if (n.type && BLOCKS.has(n.type) && !out.endsWith('\n')) out += '\n';
  };
  visit(value);
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** An editor that has been opened and left blank produces a doc with one empty paragraph. */
export const isEmptyRichText = (value: unknown) => richTextToPlain(value) === '';
