/**
 * ============================================================================
 *  A STACK on a canvas — a saved view, placed.
 * ============================================================================
 *
 *  "All the deliverables of Episode 101, here, in a column — and when one is added
 *  next week, it appears." A stack is a TABLE plus a FILTER (and a sort), drawn as a
 *  labelled well on the canvas with the matching records' cards inside it, in
 *  order. It is the grid's own filter contract (views.ts), so there is no second
 *  query language: a stack can say anything a view can, and a typo is a filter
 *  line you can read, not a search you cannot.
 *
 *  THE RULES, each one pinned by test/stacks.ts:
 *
 *  - ONE PLACEMENT PER RECORD, still. A card is on a canvas once (001_schema.sql),
 *    either by hand or inside a stack — its placement's `style.stack` names which.
 *    So a stack never duplicates a card you placed yourself; it BADGES it ("2
 *    placed elsewhere") and offers to gather them. Nothing moves until you say so:
 *    a card you put somewhere on purpose does not jump into a column because a
 *    filter happened to match it.
 *  - NEW TO THE CANVAS → IN. A matching record with no card here at all is placed
 *    into the stack, by the client, without an undo step (undoing it would only
 *    have it placed again). That is the point of the thing.
 *  - STOPS MATCHING → STAYS, DIMMED. Un-assign a deliverable and its card is not
 *    thrown off the canvas (you may have notes on it, arrows to it): it goes to
 *    the bottom of the stack marked "no longer matches", until cleared or dragged
 *    out — where it becomes a card placed by hand.
 *  - DRAG OUT = placed by hand (the stack badges it again). DRAG IN = the record
 *    is given what the filter asks for, when the filter is something a drop can
 *    satisfy: every line an `is` on a link field. Anything else is refused with a
 *    flash — a stack cannot make a record's status "QC Rejected" by being dropped
 *    on, and should not pretend to.
 *  - A CAP. A stack over an unfiltered Files table would place 5,000 cards; it
 *    stops at STACK_MAX and says so. Narrow the filter.
 *  - PREVIEW BEFORE COMMIT. The editor shows what the filter matches NOW — how many
 *    are new to the canvas, how many are already placed — before the stack exists.
 *
 *  Stacks live in the canvas's config (canvasConfig.ts `stacks`), beside its card
 *  fields and defaults: a property of the board, shared, replaced whole on update.
 *  No migration — every saved config predates them, and `optional` reads as none.
 */

import { z } from 'zod';
import { applyView, FilterEntry, SortEntry, type LinkIds, type LinkLabels, type ViewField, type ViewRecord } from './views.js';

const uuid = z.guid();

export const STACK_MAX = 200;
export const STACK_MIN_W = 256;
export const STACK_MAX_W = 2000;

export const StackDef = z.strictObject({
  id: uuid,
  tableId: uuid,
  /** A name of the person's own. Absent: the stack is labelled by what it filters for (`describeStack`). */
  name: z.string().max(80).optional(),
  filters: z.array(FilterEntry).max(32).default([]),
  sort: z.array(SortEntry).max(8).default([]),
  x: z.number(),
  y: z.number(),
  /** Null = as wide as its widest card wants (cardLayout `defaultCardWidth`); a number is a hand resize. */
  w: z.number().min(STACK_MIN_W).max(STACK_MAX_W).nullable().default(null),
  collapsed: z.boolean().default(false),
});
export type StackDef = z.infer<typeof StackDef>;

/* ── geometry ──────────────────────────────────────────────────────────────── */

export const STACK_HEAD_H = 40;   // the label bar: name, then what it filters for
export const STACK_PAD = 8;       // around the column of cards
export const STACK_GAP = 8;       // between cards
export const STACK_EMPTY_H = 36;  // the "nothing matches" line, when there are no cards

export interface StackCard { recordId: string; /** The card's height at the stack's card width. */ h: number; /** Its own default width — what the stack is as wide as, with no `w` of its own. */ w: number }
export interface StackLayout { rect: { x: number; y: number; w: number; h: number }; /** The stack's card width. */ cardW: number; cards: Map<string, { x: number; y: number; w: number }> }

/**
 * Where everything in a stack is. Cards sit in a column under the label bar, in
 * the order given (`stackCensus` decides it: matching first in sort order, then the
 * stale), all at the stack's card width. Pure arithmetic over the cards' heights,
 * like cardLayout.ts: arrows and selection work from these numbers.
 */
export function stackLayout(stack: Pick<StackDef, 'x' | 'y' | 'w' | 'collapsed'>, cards: StackCard[]): StackLayout {
  const w = Math.max(STACK_MIN_W, stack.w ?? Math.max(STACK_MIN_W, ...cards.map((c) => c.w + 2 * STACK_PAD)));
  const cardW = w - 2 * STACK_PAD;
  const out = new Map<string, { x: number; y: number; w: number }>();
  let y = stack.y + STACK_HEAD_H;
  if (stack.collapsed) return { rect: { x: stack.x, y: stack.y, w, h: STACK_HEAD_H }, cardW, cards: out };
  if (!cards.length) return { rect: { x: stack.x, y: stack.y, w, h: STACK_HEAD_H + STACK_EMPTY_H }, cardW, cards: out };
  y += STACK_PAD;
  for (const c of cards) {
    out.set(c.recordId, { x: stack.x + STACK_PAD, y, w: cardW });
    y += c.h + STACK_GAP;
  }
  return { rect: { x: stack.x, y: stack.y, w, h: y - STACK_GAP + STACK_PAD - stack.y }, cardW, cards: out };
}

/* ── who belongs ───────────────────────────────────────────────────────────── */

export interface StackCensus {
  /** Every record the filter matches, in the stack's order — capped at STACK_MAX. */
  matching: string[];
  /** How many the filter matched before the cap. */
  total: number;
  /** Matching, placed in THIS stack. */
  inStack: string[];
  /** Matching, placed on the canvas by hand (or in another stack): badged, gatherable. */
  elsewhere: string[];
  /** Matching, not on the canvas at all: what the client places into the stack. */
  missing: string[];
  /** In this stack, but no longer matching: shown dimmed at the bottom. */
  stale: string[];
  /** The order the stack draws: `inStack` then `stale`. */
  order: string[];
}

/**
 * The stack's view of the world, from the table's records and the canvas's
 * placements. `placedIn` says where a record's card is: this stack's id, another
 * stack's, '' for by hand, undefined for not on the canvas.
 */
export function stackCensus<R extends ViewRecord>(
  stack: Pick<StackDef, 'id' | 'filters' | 'sort'>, records: R[], fields: ViewField[],
  placedIn: (recordId: string) => string | undefined,
  links: LinkLabels = () => [], linkIds?: LinkIds,
): StackCensus {
  const all = applyView(records, fields, { sort: stack.sort, filters: stack.filters, hidden: [] }, links, linkIds);
  const matching = all.slice(0, STACK_MAX).map((r) => r.id);
  const matched = new Set(matching);
  const inStack: string[] = [], elsewhere: string[] = [], missing: string[] = [];
  for (const id of matching) {
    const at = placedIn(id);
    if (at === stack.id) inStack.push(id); else if (at === undefined) missing.push(id); else elsewhere.push(id);
  }
  const stale = records.filter((r) => !matched.has(r.id) && placedIn(r.id) === stack.id).map((r) => r.id);
  return { matching, total: all.length, inStack, elsewhere, missing, stale, order: [...inStack, ...stale] };
}

/* ── what a drop into the stack can do ─────────────────────────────────────── */

/**
 * A card dropped into the stack: the links its filter asks for, IF every line of
 * the filter is "<link> is <record>" (and the card is of the stack's table). Null
 * otherwise — the drop is refused, because a stack cannot give a record a status
 * or a date by being dropped on, and must not look as if it could.
 */
export function stackDropLinks(stack: Pick<StackDef, 'tableId' | 'filters'>, fields: ViewField[], droppedTable: string): Array<{ fieldId: string; recordId: string }> | null {
  if (droppedTable !== stack.tableId || !stack.filters.length) return null;
  const out: Array<{ fieldId: string; recordId: string }> = [];
  for (const f of stack.filters) {
    const field = fields.find((x) => x.id === f.fieldId);
    if (!field || field.type !== 'link' || f.op !== 'is' || typeof f.value !== 'string') return null;
    out.push({ fieldId: f.fieldId, recordId: f.value });
  }
  return out;
}

/* ── the label ─────────────────────────────────────────────────────────────── */

const OP_TEXT: Record<string, string> = {
  contains: 'contains', eq: 'is', neq: 'is not', gt: '>', gte: '≥', lt: '<', lte: '≤', has: 'has', is: 'is', empty: 'is empty', notEmpty: 'is not empty',
};

/**
 * "Work is Episode 101 · Status is not Done" — the filter, read aloud, for the
 * stack's label bar and the editor. With no filter: "every record" (and the cap
 * will have something to say).
 */
export function describeFilters(
  filters: z.infer<typeof FilterEntry>[], fieldName: (id: string) => string | undefined, recordLabel: (id: string) => string,
): string {
  if (!filters.length) return 'every record';
  return filters.map((f) => {
    const name = fieldName(f.fieldId) ?? '?';
    const op = OP_TEXT[f.op] ?? f.op;
    if (f.op === 'empty' || f.op === 'notEmpty') return `${name} ${op}`;
    if (f.value === undefined) return `${name} ${op} …`;
    const v = f.op === 'is' && typeof f.value === 'string' ? recordLabel(f.value) : typeof f.value === 'boolean' ? (f.value ? 'ticked' : 'not ticked') : String(f.value);
    return `${name} ${op} ${v}`;
  }).join(' · ');
}
