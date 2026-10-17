/**
 * ============================================================================
 *  Copying and pasting a CELL — one field's value, between records.
 * ============================================================================
 *
 *  Ctrl+C on a cell (grid) or a field (tray) copies its value; Ctrl+V on another
 *  pastes it, when the two fields hold LIKE data. EVERY field type copies — the
 *  inventory, and what each may be pasted into (`test/clipboard.ts` walks the
 *  whole of FIELD_TYPES and every structured shape so a new type cannot slip
 *  through un-copyable, as video layout did between Sept 30 and Oct 17):
 *
 *      text ↔ long_text ↔ file_path      number      date      checkbox
      dimensions                        "1920×1080"; plain text parsed ("1920x1080")
 *      select ↔ select                   only if the target select HAS that choice
 *      multi_select ↔ multi_select       only if it has every choice
 *      link ↔ link ↔ backlink            a SET OF RECORDS of one table: both faces
 *                                        of a relation copy the records they name
 *                                        and paste when the far table is the same;
 *                                        REPLACES what the target names, a "single"
 *                                        face takes the first; records since
 *                                        deleted are skipped (client/links.ts does
 *                                        the writing, from either face)
 *      structured ↔ structured           only of the same SHAPE (audio layout to
 *                                        audio layout, video layout to video layout)
 *      rich_text, attachment             copied whole, by reference to the same
 *                                        assets — no re-upload
 *      lookup, created_at, created_by    copy as TEXT (for a spreadsheet, a message);
 *                                        computed or system, nothing pastes into them
 *      a junction's column               pairs with a status: neither — the
 *                                        JunctionEditor is the way
 *
 *  A refused paste says why (a notice), never a half-paste. The value itself is
 *  never changed on the way: a select choice is not added to the target's
 *  vocabulary, a name is not resolved to a link.
 *
 *  ONE TO MANY (Oct 17): a grid range (Shift+arrows, Shift+click) pastes the one
 *  copied value into every cell of the range — one synchronous run, so one batch
 *  and one Ctrl+Z — and the cells that refuse are counted, not fatal: filling six
 *  deliverables with the same codec should not stop at the one whose select lacks
 *  it. `pasteCells` is that; `pasteCell` one cell.
 *
 *  The clipboard is the SYSTEM clipboard, so a copied cell pastes into a
 *  spreadsheet as its text — and plain text copied elsewhere pastes into a text,
 *  number, date or checkbox cell (parsed; anything unparseable is refused). What
 *  cannot be plain text (a link's records) rides in memory alongside: on paste,
 *  if the clipboard still holds the text we wrote, the in-app value is what is
 *  pasted. Only text is read from the outside world.
 *
 *  Both go through the browser's `copy` / `paste` EVENTS on the focused element,
 *  never the async clipboard API: reading it asks for permission, which Firefox
 *  turns into a "Paste" button that pops up on every Ctrl+V.
 */

import { shallowRef } from 'vue';
import type { Store } from './store';
import type { FieldRow } from './state';
import { choicesOf } from '../contract/values';
import { shapeOf, summarise } from '../contract/shapes';
import { richTextToPlain } from '../contract/richtext';
import { junctionOf } from '../contract/junction';
import { backlinkRecords } from '../contract/backlinks';
import { formatCreated } from '../contract/systemFields';
import { addLinkThrough, removeLinkThrough } from './links';
import { canonicalDimensions } from '../contract/dimensions';

export interface CellClip {
  /** The source field's type, and what it pointed at (links) or was shaped as (structured). */
  type: string;
  /** Links and backlinks: the table the named records belong to. */
  targetTable?: string;
  shape?: string | null;
  /** The value as stored — for a link or a backlink, the record ids it names. */
  value: unknown;
  /** What went to the system clipboard. */
  text: string;
}
export type Clip = CellClip | { type: 'external'; text: string };

/** What was last copied in this tab — the editors' copy/paste buttons read it, so a button and Ctrl+C share one clipboard. */
export const heldClip = shallowRef<CellClip | null>(null);
let held: CellClip | null = null;

const TEXTUAL = new Set(['text', 'long_text', 'file_path']);
const RELATION = new Set(['link', 'backlink']);
/** Types a value can be pasted INTO. */
const PASTABLE = new Set([...TEXTUAL, 'number', 'date', 'checkbox', 'dimensions', 'select', 'multi_select', ...RELATION, 'structured', 'rich_text', 'attachment']);
/** Types that copy but take nothing: computed, or the system's. */
const COPY_ONLY = new Set(['lookup', 'created_at', 'created_by']);

/** The far table of a relation field — a link's target, a backlink's source table. */
function farTable(store: Store, field: FieldRow): string {
  if (field.type === 'link') return String(field.options?.target_table_id ?? '');
  const src = store.state.fields.get(String(field.options?.source_field_id ?? ''));
  return src?.table_id ?? '';
}
/** A backlink that is a junction's column: pairs, not links. */
function isJunctionColumn(store: Store, field: FieldRow): boolean {
  if (field.type !== 'backlink') return false;
  const src = store.state.fields.get(String(field.options?.source_field_id ?? ''));
  return !!src && junctionOf(store.state.tables.get(src.table_id)) !== null;
}
/** The records a relation field names on `recordId`, from either face. */
function named(store: Store, recordId: string, field: FieldRow): string[] {
  if (field.type === 'link') return [...store.state.links.values()].filter((l) => l.from_record === recordId && l.field_id === field.id).map((l) => l.to_record);
  const linkedTo = (to: string, fieldId: string) => [...store.state.links.values()].filter((l) => l.field_id === fieldId && l.to_record === to).map((l) => l.from_record);
  return backlinkRecords(field, recordId, (id) => store.state.fields.get(id), linkedTo) ?? [];
}

/** Text for the outside world — the cell as it reads. */
function textOf(clip: Omit<CellClip, 'text'>, labelOf: (id: string) => string): string {
  const v = clip.value;
  if (RELATION.has(clip.type)) return (v as string[]).map(labelOf).join(', ');
  if (clip.type === 'structured') return v === null ? '' : summarise((clip.shape as never) ?? null, v);
  if (clip.type === 'rich_text') return richTextToPlain(v);
  if (clip.type === 'attachment') return Array.isArray(v) ? `${v.length} file${v.length === 1 ? '' : 's'}` : '';
  if (clip.type === 'created_at') return typeof v === 'string' ? formatCreated(v) : '';
  if (clip.type === 'created_by') return typeof v === 'string' ? labelOf(v) : '';
  if (Array.isArray(v)) return v.map(String).join(', ');
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

/** Why `field` cannot be copied at all, or null. */
export function uncopyable(store: Store, field: FieldRow): string | null {
  if (isJunctionColumn(store, field)) return 'a junction\'s pairs carry a status — open the record to work with them';
  if (!PASTABLE.has(field.type) && !COPY_ONLY.has(field.type)) return `a ${field.type.replace('_', ' ')} field cannot be copied`;
  return null;
}

/**
 * What `recordId`'s `field` would copy, or null when the field is not copyable
 * (`uncopyable` says why). Handed to `copyCell` on a `copy` event. `lookupText`
 * is the computed value of a lookup, which only the view knows.
 */
export function clipOf(store: Store, recordId: string, field: FieldRow, labelOf: (id: string) => string, lookupText?: string): CellClip | null {
  if (uncopyable(store, field)) return null;
  const rec = store.state.records.get(recordId);
  if (!rec) return null;
  const value = RELATION.has(field.type) ? named(store, recordId, field)
    : field.type === 'lookup' ? (lookupText ?? '')
    : rec.data[field.key];
  // JSON, not structuredClone: store values are Vue proxies, which structuredClone refuses.
  const clip: Omit<CellClip, 'text'> = {
    type: field.type, value: JSON.parse(JSON.stringify(value ?? null)),
    targetTable: RELATION.has(field.type) ? farTable(store, field) : undefined,
    shape: field.type === 'structured' ? shapeOf(field) : undefined,
  };
  return { ...clip, text: textOf(clip, labelOf) };
}

/**
 * Copy, on a `copy` EVENT (Ctrl+C on the focused grid or tray field): the text goes
 * to the system clipboard through the event — no permission, no prompt — and the
 * whole value is held here. Returns what was copied, or null.
 */
export function copyCell(e: ClipboardEvent | null, clip: CellClip | null): CellClip | null {
  if (!clip) return null;
  held = clip; heldClip.value = clip;
  if (e) { e.preventDefault(); try { e.clipboardData?.setData('text/plain', clip.text); } catch { /* no clipboardData: in-app only */ } }
  return clip;
}

/**
 * What a paste would use, from a `paste` EVENT's text: the in-app clip if that is
 * still what the clipboard holds (or there is no clipboard text at all), else the
 * outside text. Never `navigator.clipboard.readText()` — that asks the browser for
 * permission, and Firefox answers with a "Paste" button the person has to click.
 */
export function clipFromPaste(e: ClipboardEvent | null): Clip | null {
  let text: string | null = null;
  try { text = e?.clipboardData?.getData('text/plain') ?? null; } catch { text = null; }
  if (held && (text === null || text === '' || text === held.text)) return held;
  if (text !== null && text !== '') return { type: 'external', text };
  return held;
}

/** The type group a value must come from to land in `field`; the human name is for the refusal. */
function groupOf(type: string): string | null {
  if (TEXTUAL.has(type)) return 'text';
  if (RELATION.has(type)) return 'link';
  if (PASTABLE.has(type)) return type;
  return null;
}
const human = (g: string) => (g === 'link' ? 'link' : g.replace('_', ' '));

/**
 * Paste into `recordId`'s `field`. Returns null on success, or the reason it was
 * refused — nothing is written when refused.
 */
export function pasteCell(store: Store, recordId: string, field: FieldRow, clip: Clip): string | null {
  const rec = store.state.records.get(recordId);
  if (!rec) return 'no record';
  const group = groupOf(field.type);
  if (!group) return `${field.name} cannot be pasted into (${COPY_ONLY.has(field.type) ? (field.type === 'lookup' ? 'looked up' : 'set by the system') : field.type.replace('_', ' ')})`;
  if (isJunctionColumn(store, field)) return `${field.name} holds a junction's pairs — open the record to add one`;

  // Plain text from outside: text, number and date cells take it; nothing else does.
  if (!('value' in clip)) {
    const t = clip.text.trim();
    if (group === 'text') return set(store, rec.id, field.key, clip.text);
    if (group === 'number') { const n = Number(t); return Number.isFinite(n) && t !== '' ? set(store, rec.id, field.key, n) : `"${t}" is not a number`; }
    if (group === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(t) ? set(store, rec.id, field.key, t) : `"${t}" is not a date (YYYY-MM-DD)`;
    if (group === 'checkbox') { if (/^(true|yes|1)$/i.test(t)) return set(store, rec.id, field.key, true); if (/^(false|no|0)$/i.test(t)) return set(store, rec.id, field.key, false); return `"${t}" is not true or false`; }
    if (group === 'dimensions') { const d = canonicalDimensions(t); return d ? set(store, rec.id, field.key, d) : `"${t}" is not a frame size (width × height)`; }
    return `plain text cannot be pasted into a ${human(group)} field`;
  }

  const from = groupOf(clip.type);
  if (from !== group) return `a ${from ? human(from) : clip.type.replace('_', ' ')} value cannot be pasted into a ${human(group)} field`;
  const c: CellClip = clip;

  if (group === 'select') {
    const v = c.value;
    if (v === null || v === undefined || v === '') return set(store, rec.id, field.key, null);
    const choices = choicesOf(field.options) ?? [];
    return choices.includes(String(v)) ? set(store, rec.id, field.key, v) : `"${v}" is not one of ${field.name}'s choices`;
  }
  if (group === 'multi_select') {
    const v = Array.isArray(c.value) ? (c.value as string[]) : [];
    const choices = new Set(choicesOf(field.options) ?? []);
    const missing = v.filter((c) => !choices.has(c));
    return missing.length ? `${field.name} has no choice "${missing[0]}"` : set(store, rec.id, field.key, v.length ? v : null);
  }
  if (group === 'structured') {
    // Same SHAPE or nothing: an audio layout is not a manifest. The value is validated
    // by the server as any write is; a copied value was valid where it came from.
    const shape = shapeOf(field);
    if (c.shape !== shape) return `${field.name} is a ${shape ?? 'structured'} field, the copied value is ${c.shape ?? 'unshaped'}`;
    return set(store, rec.id, field.key, c.value);
  }
  if (group === 'link') {
    const target = farTable(store, field);
    if (!target || c.targetTable !== target) return `${field.name} names records of a different table than the copied field`;
    const wanted = (c.value as string[]).filter((id) => id !== recordId && store.state.records.has(id));
    const single = field.type === 'link' ? field.options?.single === true
      : store.state.fields.get(String(field.options?.source_field_id ?? ''))?.options?.single_target === true;
    const keep = single ? wanted.slice(0, 1) : wanted;
    const have = named(store, recordId, field);
    // REPLACE: what is not wanted goes, what is wanted and missing comes — one batch,
    // through links.ts, which knows which face holds the row.
    for (const id of have) if (!keep.includes(id)) removeLinkThrough(store, field, recordId, id);
    for (const id of keep) if (!have.includes(id)) addLinkThrough(store, field, recordId, id);
    return null;
  }
  return set(store, rec.id, field.key, c.value);
}

/**
 * One value into MANY cells — a grid range. Every cell is tried; the result counts
 * what was written and groups what was refused by reason, for one notice. All in
 * this synchronous run: one batch, one Ctrl+Z.
 */
export function pasteCells(store: Store, cells: ReadonlyArray<{ recordId: string; field: FieldRow }>, clip: Clip): { pasted: number; refused: Map<string, number> } {
  let pasted = 0; const refused = new Map<string, number>();
  for (const { recordId, field } of cells) {
    const err = pasteCell(store, recordId, field, clip);
    if (err === null) pasted++; else refused.set(err, (refused.get(err) ?? 0) + 1);
  }
  return { pasted, refused };
}

/** One line about a many-cell paste: "pasted into 6 cells · 2 skipped: …". */
export function describePaste(r: { pasted: number; refused: Map<string, number> }): string {
  const skipped = [...r.refused.values()].reduce((a, b) => a + b, 0);
  const cells = (n: number) => `${n} cell${n === 1 ? '' : 's'}`;
  if (!skipped) return `Pasted into ${cells(r.pasted)}`;
  const why = [...r.refused.entries()].map(([reason, n]) => (r.refused.size > 1 ? `${n} × ${reason}` : reason)).join('; ');
  return r.pasted ? `Pasted into ${cells(r.pasted)} · ${cells(skipped)} skipped: ${why}` : `Not pasted: ${why}`;
}

function set(store: Store, recordId: string, key: string, value: unknown): null {
  if (value === null || value === undefined || value === '') store.mutate({ type: 'record.update', id: recordId, set: {}, unset: [key] });
  else store.mutate({ type: 'record.update', id: recordId, set: { [key]: value }, unset: [] });
  return null;
}
