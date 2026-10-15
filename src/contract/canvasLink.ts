/**
 * ============================================================================
 *  Linking from the canvas with ONE handle per card — the rule.
 * ============================================================================
 *
 *  A card has a single ⊕ to drag from; WHICH relationship the drag makes is worked
 *  out when it lands. That is "context-aware", and context-aware behaviour is where
 *  edge cases hide — so the whole of it is here, as pure functions, and it is built
 *  on one promise:
 *
 *      what a drag CAN do depends only on the two TABLES involved.
 *
 *  Never on which fields a card happens to show, on whether it is folded, or on
 *  what the canvas hides. A person can therefore learn it ("an Edit onto a File
 *  always asks: input or output?") and `test/canvaslink.ts` can walk every case.
 *
 *  A WAY is one relationship a record of the starting table can make:
 *
 *      link      one of that table's own LINK fields — written on the record the
 *                drag starts from, pointing at where it lands. OR one of its BACKLINK
 *                fields (`back`): the same relation from the other end — a File
 *                dragged onto the Edit it is an input of writes the Edit's "Inputs"
 *                link, pointing at the File. One relation, two faces; which face the
 *                drag started from decides which record the link row is written on.
 *      junction  a junction table (sql/016) the starting table is an end of. A pair
 *                is the same row whichever end it is made from, so this works from
 *                both ends — as its column does in the grid.
 *
 *  `dropVerdict` then says what letting go on a card does:
 *
 *      no way between the two tables      refuse (the card flashes red)
 *      every way already made             say so (nothing to do)
 *      exactly ONE way                    make it — a link at once, a pair after
 *                                         its status is picked
 *      SEVERAL ways                       ask which, always — even when all but one
 *                                         are made already (those are shown ticked).
 *                                         The count comes from the tables, so the
 *                                         same two cards never auto-link one day
 *                                         and ask the next.
 *
 *  Nothing here touches the store; the canvas feeds it fields, tables and an
 *  "is this already linked" test, and acts on the answer.
 */

import { junctionOf, type JunctionConfig } from './junction.js';
import { compareFields } from './labels.js';

export interface WayField {
  id: string; table_id: string; name: string; key: string; type: string; position: number;
  options?: Record<string, unknown> | null;
}
export interface WayTable {
  id: string; name: string; singular_name?: string | null; kind?: string | null; junction?: unknown;
}

interface WayBase {
  /** What the way is keyed by everywhere arrows are: the link field's id, or the junction TABLE's. */
  key: string;
  /** What to call it: the link field's name; a junction's column on the starting table, else the junction's own name. */
  name: string;
  /** The table at the far end — what a card must be a record of to take this way. */
  toTable: string;
  /** The field on the STARTING table that shows this way (the link field; a junction's column, if it has one). */
  column?: string;
}
export interface LinkFieldWay extends WayBase {
  kind: 'link'; fieldId: string;
  /** A "single" link holds one record: making it REPLACES what is there. */
  single: boolean;
  /** Through a BACKLINK: the link field is on the far table — the row is written on the record the drag LANDS on, pointing back at the starter. */
  back?: boolean;
}
/** The ends of a link row for this way: on which record it is held, and which it points at. */
export const linkEnds = (way: LinkFieldWay, from: string, to: string): { holder: string; target: string } =>
  (way.back ? { holder: to, target: from } : { holder: from, target: to });
export interface JunctionWay extends WayBase {
  kind: 'junction'; table: string; cfg: JunctionConfig;
  /** Which end of the junction the STARTING record is. */
  side: 'a' | 'b';
}
export type LinkWay = LinkFieldWay | JunctionWay;

const targetOf = (f: WayField | undefined): string | null => {
  const t = f?.options?.target_table_id;
  return typeof t === 'string' && t ? t : null;
};

/**
 * Every way a record of `fromTable` can be linked, in the table's own field order
 * (a junction sits where its column does; one with no column goes last).
 *
 * Left out, on purpose:
 *   - a link whose target table is gone (a broken field makes nothing);
 *   - a junction table's own two ENDPOINT links: a pair row has exactly one of each
 *     and is made whole or not at all (apply.ts) — dragging one end elsewhere would
 *     be taking a pair apart by hand.
 */
export function linkWays(fields: Iterable<WayField>, tables: Iterable<WayTable>, fromTable: string): LinkWay[] {
  const all = [...fields];
  const byId = new Map(all.map((f) => [f.id, f]));
  const tableList = [...tables];
  const tableIds = new Set(tableList.map((t) => t.id));
  const own = all.filter((f) => f.table_id === fromTable);
  const ownCfg = junctionOf(tableList.find((t) => t.id === fromTable));

  const out: Array<{ way: LinkWay; at?: WayField }> = [];
  const junctionEnds = new Set<string>();
  for (const t of tableList) { const cfg = junctionOf(t); if (cfg) { junctionEnds.add(cfg.a); junctionEnds.add(cfg.b); } }
  for (const f of own) {
    if (f.type === 'link') {
      const to = targetOf(f);
      if (!to || !tableIds.has(to)) continue;
      if (ownCfg && (f.id === ownCfg.a || f.id === ownCfg.b)) continue;
      out.push({ way: { kind: 'link', key: f.id, fieldId: f.id, name: f.name, toTable: to, column: f.id, single: f.options?.single === true }, at: f });
    } else if (f.type === 'backlink') {
      // The other face of a link held on the far table. A junction's column is not one
      // (that way is the junction's, below); a backlink whose link is gone is nothing.
      const srcId = f.options?.source_field_id;
      const src = typeof srcId === 'string' ? byId.get(srcId) : undefined;
      if (!src || src.type !== 'link' || targetOf(src) !== fromTable || junctionEnds.has(src.id) || !tableIds.has(src.table_id)) continue;
      out.push({ way: { kind: 'link', key: src.id, fieldId: src.id, name: f.name, toTable: src.table_id, column: f.id, single: src.options?.single === true, back: true }, at: f });
    }
  }
  for (const t of tableList) {
    const cfg = junctionOf(t);
    if (!cfg) continue;
    const ta = targetOf(byId.get(cfg.a)), tb = targetOf(byId.get(cfg.b));
    if (!ta || !tb || !tableIds.has(ta) || !tableIds.has(tb)) continue;
    for (const side of ['a', 'b'] as const) {
      if ((side === 'a' ? ta : tb) !== fromTable) continue;
      // Its column here: the backlink that mirrors this end of the junction.
      const column = own.find((f) => f.type === 'backlink' && f.options?.source_field_id === cfg[side]);
      out.push({
        way: { kind: 'junction', key: t.id, table: t.id, cfg, side, name: column?.name ?? t.singular_name ?? t.name, toTable: side === 'a' ? tb : ta, column: column?.id },
        at: column,
      });
    }
  }
  return out
    .sort((x, y) => (x.at && y.at ? compareFields(x.at, y.at) : x.at ? -1 : y.at ? 1 : x.way.name < y.way.name ? -1 : x.way.name > y.way.name ? 1 : 0))
    .map((x) => x.way);
}

/** The ways that end at a record of `toTable`. */
export const waysBetween = (ways: readonly LinkWay[], toTable: string): LinkWay[] => ways.filter((w) => w.toTable === toTable);

export type DropVerdict =
  /** Onto the card the drag started from. */
  | { kind: 'self' }
  /** No relationship runs from the one table to the other. */
  | { kind: 'none' }
  /** Every way there is, is made already. */
  | { kind: 'linked'; ways: LinkWay[] }
  /** One way, a link field: make it. */
  | { kind: 'link'; way: LinkFieldWay }
  /** One way, a junction: a pair — its status is asked for. */
  | { kind: 'pair'; way: JunctionWay }
  /** Several ways: ask. `linked` ones are shown, ticked, and cannot be chosen again. */
  | { kind: 'choose'; options: Array<{ way: LinkWay; linked: boolean }> };

/**
 * What letting go on a card does. `between` is `waysBetween(…)` for the two cards'
 * tables; `isLinked` says whether a way is already made between these two RECORDS.
 */
export function dropVerdict(between: readonly LinkWay[], sameRecord: boolean, isLinked: (way: LinkWay) => boolean): DropVerdict {
  if (sameRecord) return { kind: 'self' };
  if (!between.length) return { kind: 'none' };
  const options = between.map((way) => ({ way, linked: isLinked(way) }));
  if (options.every((o) => o.linked)) return { kind: 'linked', ways: [...between] };
  if (options.length > 1) return { kind: 'choose', options };
  const way = between[0];
  return way.kind === 'link' ? { kind: 'link', way } : { kind: 'pair', way };
}

/**
 * The one line that says, WHILE the drag is still held, what letting go here would
 * do — so nobody has to release to find out. `replaces` is the label of what a
 * single link holds now (it would be swapped out), when there is one.
 */
export function verdictHint(v: DropVerdict, names: { from: string; to: string }, replaces?: string): string {
  switch (v.kind) {
    case 'self': return '';
    case 'none': return `no link from ${names.from} to ${names.to}`;
    case 'linked': return `already linked · ${v.ways.map((w) => w.name).join(', ')}`;
    case 'link': return replaces ? `${v.way.name} · replaces ${replaces}` : v.way.name;
    case 'pair': return `${v.way.name}…`;
    case 'choose': return v.options.length <= 2 ? `${v.options.map((o) => o.way.name).join(' or ')}…` : `${v.options.length} choices…`;
  }
}
