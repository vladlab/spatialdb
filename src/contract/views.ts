/**
 * ============================================================================
 *  The view contract — what a saved grid view IS, and what it does to rows.
 * ============================================================================
 *
 *  The fourth shared contract file, and shared for the usual reason: the server
 *  validates a view's config on write with the same schema the client builds it
 *  from, so a config the grid cannot interpret can never be stored.
 *
 *  It also holds `applyView`, the pure function that turns (rows, config) into
 *  the rows a grid shows. That lives here rather than in a component because:
 *
 *  - SORTING AND FILTERING HAPPEN ON THE CLIENT, over the whole table held in
 *    the local store. The alternative — a query per view, server-side — was the
 *    first recommendation and was wrong for this codebase. The grid renders
 *    from the same store the stream and optimistic writes feed; that is why an
 *    edit shows instantly and a peer's new row simply appears. A server-side
 *    query result is a second source of truth: it needs a filter language on
 *    the wire and a "refetch on any event for this table" rule, and the client
 *    would STILL have to evaluate the filter locally to decide whether an
 *    optimistic edit keeps a row visible. One evaluator, in one place.
 *  - A pure function over plain data is testable in Node without a browser,
 *    and sort order is exactly the kind of thing that looks right and is not
 *    ("reel_10" before "reel_2"; empty cells floating to the top on descending).
 *
 *  The ceiling: whole-table loading is fine to the tens of thousands of rows
 *  (~25 MB of JSON at 50k) and not to the millions. If a table ever outgrows
 *  that, this function's semantics are the spec a server-side version must
 *  match — which is another reason they are written down and tested here.
 */

import { z } from 'zod';
import { richTextToPlain } from './richtext.js';
import { shapeOf, summarise } from './shapes.js';

const uuid = z.guid();

/**
 * Entries name fields by ID, never by key or name. A rename must not break a
 * view, and a key is only unique within a table while an id is unique, full
 * stop — so a config can be checked without knowing which table it is for.
 */
const SortEntry = z.strictObject({
  fieldId: uuid,
  dir: z.enum(['asc', 'desc']),
});

/**
 * A closed set, deliberately small. Every op here has an obvious meaning for
 * every type it applies to; "is within the last N days" and friends can be
 * added when something needs them, and each addition is one case in `matches`.
 */
export const FILTER_OPS = [
  'contains',   // text-ish: case-insensitive substring. link: on the far label.
  'eq', 'neq',  // text, number, date, select, checkbox
  'gt', 'gte', 'lt', 'lte',   // number, date
  'has',        // multi_select: includes this choice
  'empty', 'notEmpty',        // everything, links included
] as const;
export type FilterOp = typeof FILTER_OPS[number];

const FilterEntry = z.strictObject({
  fieldId: uuid,
  op: z.enum(FILTER_OPS),
  /** Absent for empty/notEmpty. Scalars only — a filter compares to one thing. */
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

/**
 * Filters are ANDed. No OR, no groups: that is a tree, a tree needs a tree
 * editor, and the honest use of this grid is "status is X and reel is 3".
 * If OR is ever needed, `filters` becoming a tree is a config migration, which
 * is why this is versionless today and should grow a `v` the day it changes.
 */
export const ViewConfig = z.strictObject({
  sort: z.array(SortEntry).max(8).default([]),
  filters: z.array(FilterEntry).max(32).default([]),
  /** Hidden rather than "shown": a field added later appears by default. */
  hidden: z.array(uuid).max(500).default([]),
  /**
   * Group rows by these fields, outermost first. Two levels at most: a third is
   * where a grid stops being readable and a REPORT is what is wanted.
   * OPTIONAL, not defaulted: every view already saved, and every config literal in
   * the code, predates it — absent must keep meaning "not grouped". Read it with
   * `config.groupBy ?? []`.
   */
  groupBy: z.array(uuid).max(2).optional(),
});
export type ViewConfig = z.infer<typeof ViewConfig>;

export const EMPTY_VIEW: ViewConfig = { sort: [], filters: [], hidden: [] };

/* ────────────────────────────────────────────────────────────────────────────
 *  applyView
 * ──────────────────────────────────────────────────────────────────────────*/

export interface ViewField {
  id: string; key: string; type: string;
  options?: Record<string, unknown> | null;
}
export interface ViewRecord { id: string; data: Record<string, unknown> }

/**
 * Link AND lookup fields hold nothing in `record.data` — a link is rows in
 * `links`, a lookup is computed from them (contract/lookups.ts). The caller
 * supplies their text — far-end labels for a link, looked-up values for a lookup
 * — so this file needs no knowledge of the store. Returning [] for everything is
 * legal and just makes them "empty".
 */
export type LinkLabels = (recordId: string, fieldId: string) => string[];

/** Which ops make sense for which type — the filter builder reads this too. */
export function opsFor(type: string): FilterOp[] {
  switch (type) {
    case 'number':
    case 'date':         return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'empty', 'notEmpty'];
    case 'checkbox':     return ['eq'];
    case 'select':       return ['eq', 'neq', 'empty', 'notEmpty'];
    case 'multi_select': return ['has', 'empty', 'notEmpty'];
    case 'link':
    case 'lookup':
    case 'backlink':
    case 'rich_text':    return ['contains', 'empty', 'notEmpty'];
    case 'attachment':   return ['empty', 'notEmpty'];
    // Matched on its one-line SUMMARY ("4 tracks / 12 ch (5.1, 2.0…)"): "contains 5.1" works.
    case 'structured':   return ['contains', 'empty', 'notEmpty'];
    default:             return ['contains', 'eq', 'neq', 'empty', 'notEmpty'];
  }
}

/** Value comes from the `links` callback rather than from record.data. */
const isDerived = (f: ViewField) => f.type === 'link' || f.type === 'lookup' || f.type === 'backlink';

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === ''
    || (Array.isArray(v) && v.length === 0);
}

const lower = (v: unknown) => String(v).toLowerCase();

function matches(
  rec: ViewRecord, field: ViewField,
  f: z.infer<typeof FilterEntry>, links: LinkLabels,
): boolean {
  if (isDerived(field)) {
    const labels = links(rec.id, field.id);
    if (f.op === 'empty') return labels.length === 0;
    if (f.op === 'notEmpty') return labels.length > 0;
    if (f.op === 'contains') {
      const needle = lower(f.value ?? '');
      return labels.some((l) => lower(l).includes(needle));
    }
    return true;   // an op that means nothing for links filters nothing
  }

  // A rich text value is a document; everything below compares its TEXT.
  const v = field.type === 'rich_text' ? richTextToPlain(rec.data[field.key])
    : field.type === 'structured' ? summarise(shapeOf(field), rec.data[field.key])
    : rec.data[field.key];

  // A checkbox never holds "empty" as a distinct visible state in the grid — an
  // unset checkbox renders unticked — so `eq false` matches unset too.
  // Otherwise "show me everything not approved" would hide every row nobody has
  // touched, which is precisely the rows that question is about.
  if (field.type === 'checkbox') {
    return f.op === 'eq' ? (v === true) === (f.value === true) : true;
  }

  if (f.op === 'empty') return isEmpty(v);
  if (f.op === 'notEmpty') return !isEmpty(v);

  // Every remaining op compares against a value. An empty cell has none, so it
  // fails all of them EXCEPT neq — "status is not done" should include rows
  // with no status, for the same reason as the checkbox rule above.
  if (isEmpty(v)) return f.op === 'neq';
  if (f.value === undefined) return true;   // half-built filter: inert, not "hide all"

  switch (f.op) {
    case 'contains': return lower(v).includes(lower(f.value));
    case 'has':      return Array.isArray(v) && v.includes(f.value);
    case 'eq':
    case 'neq': {
      const same = field.type === 'number'
        ? Number(v) === Number(f.value)
        : lower(v) === lower(f.value);
      return f.op === 'eq' ? same : !same;
    }
    default: {
      // gt/gte/lt/lte. Dates are YYYY-MM-DD strings (see values.ts), which sort
      // correctly AS strings — no Date parsing, so no timezone can shift a day.
      const [a, b] = field.type === 'number'
        ? [Number(v), Number(f.value)]
        : [String(v), String(f.value)];
      if (f.op === 'gt') return a > b;
      if (f.op === 'gte') return a >= b;
      if (f.op === 'lt') return a < b;
      return a <= b;
    }
  }
}

/**
 * `numeric: true` is the point: it is natural sort, so "reel_2" < "reel_10" and
 * "v9" < "v10". For a database whose rows are largely filenames and versions,
 * plain lexicographic order is wrong on nearly every table.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compare(a: unknown, b: unknown, field: ViewField): number {
  switch (field.type) {
    case 'number':   return Number(a) - Number(b);
    case 'checkbox': return Number(a === true) - Number(b === true);
    case 'select': {
      // By position in the configured choices, not alphabetically: a status
      // column sorts todo → doing → done, the order its owner wrote them in.
      const choices = Array.isArray(field.options?.choices) ? field.options!.choices as unknown[] : [];
      const ia = choices.indexOf(a), ib = choices.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== ib) return ia === -1 ? 1 : -1;   // off-list values after listed ones
      return collator.compare(String(a), String(b));
    }
    case 'attachment':
      return (a as unknown[]).length - (b as unknown[]).length;
    case 'multi_select':
      return collator.compare((a as unknown[]).join(', '), (b as unknown[]).join(', '));
    default:
      return collator.compare(String(a), String(b));
  }
}

/**
 * Filter, then sort. Pure: same inputs, same output, inputs untouched.
 *
 * Three behaviours worth knowing, each deliberate:
 *
 * - **Entries naming a field that no longer exists are ignored**, not errors.
 *   `field.delete` does not rewrite view configs, which means undoing the delete
 *   brings the sort/filter back to life for free — and means a view can never be
 *   bricked by a schema change.
 * - **Empty cells sort LAST in both directions.** Descending is not "reverse
 *   everything": nobody sorting by due date wants the undated rows first. It is
 *   also what keeps a freshly added blank row at the bottom of a sorted grid
 *   instead of teleporting to the top mid-typing.
 * - **The sort is stable over the incoming order**, which the store keeps as
 *   creation order. Ties — and the no-sort case — read oldest first.
 */
export function applyView<R extends ViewRecord>(
  records: R[], fields: ViewField[], config: ViewConfig,
  links: LinkLabels = () => [],
): R[] {
  const byId = new Map(fields.map((f) => [f.id, f]));

  const filters = config.filters
    .map((f) => ({ f, field: byId.get(f.fieldId) }))
    .filter((x): x is { f: typeof x.f; field: ViewField } => !!x.field);
  const sorts = config.sort
    .map((s) => ({ s, field: byId.get(s.fieldId) }))
    .filter((x): x is { s: typeof x.s; field: ViewField } => !!x.field);

  let out = filters.length
    ? records.filter((r) => filters.every(({ f, field }) => matches(r, field, f, links)))
    : records.slice();

  if (sorts.length) {
    const valueOf = (r: R, field: ViewField): unknown =>
      isDerived(field) ? links(r.id, field.id).join(', ')
        : field.type === 'rich_text' ? richTextToPlain(r.data[field.key])
        : field.type === 'structured' ? summarise(shapeOf(field), r.data[field.key])
        : r.data[field.key];

    // Decorate with the original index so ties are broken explicitly rather than
    // by trusting the engine's sort stability.
    out = out
      .map((r, i) => ({ r, i }))
      .sort((x, y) => {
        for (const { s, field } of sorts) {
          const a = valueOf(x.r, field), b = valueOf(y.r, field);
          const ea = isEmpty(a), eb = isEmpty(b);
          if (ea || eb) {
            if (ea && eb) continue;
            return ea ? 1 : -1;               // empties last, regardless of dir
          }
          // Derived values are already text; natural collation orders "1920" before
          // "3840" and "v9" before "v10", which covers looked-up numbers well enough.
          const f = isDerived(field) ? { ...field, type: 'text' } : field;
          const c = compare(a, b, f);
          if (c !== 0) return s.dir === 'asc' ? c : -c;
        }
        return x.i - y.i;
      })
      .map((x) => x.r);
  }
  return out;
}

/**
 * The quick-search box: ephemeral, never stored in a view. Matches any visible
 * scalar value or link label. Separate from `filters` because it is a different
 * gesture — "find that file" rather than "this view shows only QC failures".
 */
export function quickSearch<R extends ViewRecord>(
  records: R[], fields: ViewField[], query: string,
  links: LinkLabels = () => [],
): R[] {
  const q = query.trim().toLowerCase();
  if (!q) return records;
  return records.filter((r) => fields.some((f) => {
    if (isDerived(f)) return links(r.id, f.id).some((l) => l.toLowerCase().includes(q));
    const raw = r.data[f.key];
    const v = f.type === 'rich_text' ? richTextToPlain(raw) : f.type === 'attachment' ? ''
      : f.type === 'structured' ? summarise(shapeOf(f), raw) : raw;
    if (isEmpty(v) || typeof v === 'boolean') return false;
    return (Array.isArray(v) ? v.join(' ') : String(v)).toLowerCase().includes(q);
  }));
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Grouping
 *
 *  `groupRows` turns an already-filtered, already-sorted list into the flat list a
 *  grid draws: group HEADERS interleaved with ROWS. Shared, like applyView, so
 *  anything else that needs "these records, grouped" (a report, the desktop
 *  client) groups exactly as the grid does.
 *
 *  A record is in ONE group per level. For a field that can hold several values
 *  (a link to two works, a multi-select), the group is the COMBINATION — "Ep 101,
 *  Ep 102" — not one group per value. That is Airtable's rule, and it is the one
 *  that keeps a record from appearing twice in one grid (which would break
 *  selection, numbering and "N records"). It also gives "add a record to this
 *  group" an exact meaning: the new record gets that combination.
 *
 *  Groups are ordered by their label, naturally ("Ep 2" before "Ep 10"); the empty
 *  group — records with no value — is always last, as empty cells are in a sort.
 *  Within a group, rows keep the order they arrived in: the view's sort.
 * ──────────────────────────────────────────────────────────────────────────*/

/** What a group stands for, so a record added inside it can be given the same value. */
export type GroupValue =
  | { kind: 'empty' }
  | { kind: 'links'; ids: string[] }          // a link field: link the new record to these
  | { kind: 'value'; value: unknown }         // a stored value: set it on the new record
  | { kind: 'derived' };                      // lookup / backlink: read-only, nothing to set

export interface GroupHeader {
  kind: 'group';
  /** 0 = outermost. */
  level: number;
  fieldId: string;
  /** Unique within the list: the path of group keys from the outermost level. */
  path: string;
  label: string;
  value: GroupValue;
  /** Records under this header, at any depth. */
  count: number;
}
export interface GroupedRow<R> { kind: 'row'; record: R; /** Headers this row sits under, outermost first. */ path: string }
export type GridItem<R> = GroupHeader | GroupedRow<R>;

/** For a link / backlink field: the ids behind the labels (grouping needs both). */
export type LinkIds = (recordId: string, fieldId: string) => string[];

const EMPTY_LABEL = '(empty)';

function groupKeyOf<R extends ViewRecord>(
  r: R, f: ViewField, links: LinkLabels, linkIds: LinkIds,
): { key: string; label: string; value: GroupValue } {
  if (f.type === 'link' || f.type === 'backlink' || f.type === 'lookup') {
    const labels = links(r.id, f.id);
    if (!labels.length) return { key: '\u0000', label: EMPTY_LABEL, value: { kind: 'empty' } };
    if (f.type !== 'link') return { key: 'd:' + labels.join('\u0001'), label: labels.join(', '), value: { kind: 'derived' } };
    // Keyed by the target IDS (sorted), so two records linked to the same works in a
    // different order are one group, and a renamed work does not split it.
    const ids = [...linkIds(r.id, f.id)].sort();
    return { key: 'l:' + ids.join(','), label: [...labels].sort(collator.compare).join(', '), value: { kind: 'links', ids } };
  }
  const v = r.data[f.key];
  if (f.type === 'checkbox') return { key: v === true ? 'b:1' : 'b:0', label: v === true ? 'checked' : 'unchecked', value: { kind: 'value', value: v === true } };
  if (isEmpty(v)) return { key: '\u0000', label: EMPTY_LABEL, value: { kind: 'empty' } };
  if (f.type === 'rich_text') { const t = richTextToPlain(v).split('\n', 1)[0]; return { key: 'd:' + t, label: t || EMPTY_LABEL, value: { kind: 'derived' } }; }
  if (Array.isArray(v)) {
    const list = [...(v as unknown[])].map(String).sort(collator.compare);
    return { key: 'm:' + list.join('\u0001'), label: list.join(', '), value: { kind: 'value', value: list } };
  }
  return { key: 'v:' + String(v), label: String(v), value: { kind: 'value', value: v } };
}

export function groupRows<R extends ViewRecord>(
  records: R[], fields: ViewField[], groupBy: string[],
  links: LinkLabels = () => [], linkIds: LinkIds = () => [],
  /** Paths of collapsed groups: their headers stay, their contents go. */
  collapsed: ReadonlySet<string> = new Set(),
): GridItem<R>[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const levels = groupBy.map((id) => byId.get(id)).filter((f): f is ViewField => !!f);   // a deleted field is skipped
  if (!levels.length) return records.map((record) => ({ kind: 'row' as const, record, path: '' }));

  const out: GridItem<R>[] = [];
  const walk = (recs: R[], level: number, parentPath: string) => {
    if (level === levels.length) { for (const record of recs) out.push({ kind: 'row', record, path: parentPath }); return; }
    const f = levels[level];
    const buckets = new Map<string, { label: string; value: GroupValue; recs: R[] }>();
    for (const r of recs) {
      const g = groupKeyOf(r, f, links, linkIds);
      const b = buckets.get(g.key);
      if (b) b.recs.push(r); else buckets.set(g.key, { label: g.label, value: g.value, recs: [r] });
    }
    const ordered = [...buckets.entries()].sort(([ka, a], [kb, b]) =>
      (ka === '\u0000' ? 1 : 0) - (kb === '\u0000' ? 1 : 0) || collator.compare(a.label, b.label));
    for (const [key, b] of ordered) {
      const path = parentPath ? `${parentPath}\u0002${key}` : key;
      out.push({ kind: 'group', level, fieldId: f.id, path, label: b.label, value: b.value, count: b.recs.length });
      if (!collapsed.has(path)) walk(b.recs, level + 1, path);
    }
  };
  walk(records, 0, '');
  return out;
}

/** Every header above a row (or header) at `path`, outermost first — what a record added there inherits. */
export function ancestorsOf<R>(items: GridItem<R>[], path: string): GroupHeader[] {
  const want = new Set<string>();
  const parts = path.split('\u0002');
  for (let i = 1; i <= parts.length; i++) want.add(parts.slice(0, i).join('\u0002'));
  return items.filter((it): it is GroupHeader => it.kind === 'group' && want.has(it.path)).sort((a, b) => a.level - b.level);
}
