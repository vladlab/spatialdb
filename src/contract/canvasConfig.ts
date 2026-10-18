/**
 * What a canvas says about how its cards look. Shared so the server validates on
 * write with the schema the client builds from — same arrangement as views.ts.
 *
 *   cardFields: { <tableId>: [<fieldId>, …] }
 *
 * The fields a card of that table shows on THIS canvas, in this order, under its
 * title. A table with no entry gets the default (`defaultCardFields`). Replaced
 * whole on update, like a view's config. Ids that no longer resolve are skipped
 * at render time rather than rejected, so a field delete — and its undo — needs
 * no fix-up here.
 *
 * Deliberately NOT here: arrow visibility. That is how one person is looking at
 * the board right now ("only arrows touching my selection"), not a property of
 * the board, so it is kept per-browser and never sent anywhere.
 */
import { z } from 'zod';
import { StackDef } from './canvasStack.js';
import { ColorRule, MAX_RULES } from './colorRules.js';

const uuid = z.guid();

export const CanvasConfig = z.strictObject({
  cardFields: z.record(uuid, z.array(uuid).max(40)).default({}),
  /**
   * DEFAULTS: records that everything created on this canvas gets linked to.
   * "This board is about Episode 101" — so a file, an edit or a deliverable made here
   * starts out linked to Ep 101, IF its table has a link to Works (see
   * `defaultLinkField` for which field). Shown in a bar at the top of the canvas, where
   * it can be switched off; set with "+ add" there, or by right-clicking a card.
   *
   * It REPLACED "a board inherits from its own record's membership links" (built two
   * days earlier): that needed a link field added to the boards table, ticked as
   * membership, and filled in on the board's record — schema work, invisible on the
   * canvas, for something a person doing data entry should be able to set by pointing.
   *
   * No foreign keys, like everything in this config: a default whose record has been
   * deleted is simply skipped (and shown as such in the bar, to be removed).
   * OPTIONAL, not defaulted — every canvas config already saved predates it.
   */
  defaults: z.array(z.strictObject({ tableId: uuid, recordId: uuid })).max(20).optional(),
  /**
   * STACKS: saved views placed on the canvas — "the deliverables of Episode 101, in a
   * column, kept current" (contract/canvasStack.ts has the rules). Which cards are IN
   * a stack is on the placements (`style.stack`), not here: a placement is the card.
   * OPTIONAL, not defaulted, like `defaults`.
   */
  stacks: z.array(StackDef).max(40).optional(),
  /**
   * HIDE EMPTY: a card leaves out the rows that have nothing in them. A Files table
   * carries thirty attribute fields and a given file fills ten; the other twenty were
   * twenty lines of "—". The card keeps its chosen fields (`cardFields`) — what it
   * COULD show — and drops, per record, the ones with no value. Per canvas, saved
   * with it: the board reads the same for everyone, like `cardFields`.
   *
   * PINNED: fields shown even when empty — because the gap is the information
   * ("no deliverable yet", "QC: —"). Per table, like `cardFields`, and only meaningful
   * with `hideEmpty` on; kept when it is off, so switching it back on needs no re-ticking.
   * OPTIONAL, not defaulted, like `defaults`: every saved config predates them.
   */
  hideEmpty: z.boolean().optional(),
  pinnedFields: z.record(uuid, z.array(uuid).max(40)).optional(),
  /**
   * COLOUR RULES (contract/colorRules.ts), PER TABLE — a canvas mixes tables, and a
   * Files rule means nothing on an Edit card. A card whose rule matches wears a
   * GLOW in the rule's tint around its edge (its header keeps the table's colour,
   * its pills the arrow's: identity stays where it was); a rule painting one field
   * tints that row's value instead. Cards in a stack follow the canvas's rules.
   * `glow` is how strong: 'ring' is the tinted border alone, for a dense board;
   * 'glow' (the default) adds the halo. Both OPTIONAL, not defaulted, like `defaults`.
   */
  rules: z.record(uuid, z.array(ColorRule).max(MAX_RULES)).optional(),
  glow: z.enum(['ring', 'glow']).optional(),
});
export type CanvasConfig = z.infer<typeof CanvasConfig>;

/** The colour rules of `tableId` on this canvas, in order; [] when it has none. */
export function rulesFor(config: unknown, tableId: string): ColorRule[] {
  const parsed = CanvasConfig.safeParse(config ?? {});
  return parsed.success ? parsed.data.rules?.[tableId] ?? [] : [];
}
/** How strongly a matched card is marked on this canvas. */
export function glowOf(config: unknown): 'ring' | 'glow' {
  const parsed = CanvasConfig.safeParse(config ?? {});
  return parsed.success && parsed.data.glow === 'ring' ? 'ring' : 'glow';
}

/** Whether this canvas's cards leave out their empty rows (`hideEmpty`). */
export function hidesEmpty(config: unknown): boolean {
  const parsed = CanvasConfig.safeParse(config ?? {});
  return parsed.success && parsed.data.hideEmpty === true;
}
/** The fields of `tableId` pinned on this canvas — shown on its cards even when empty. */
export function pinnedFieldsFor(config: unknown, tableId: string): Set<string> {
  const parsed = CanvasConfig.safeParse(config ?? {});
  return new Set(parsed.success ? parsed.data.pinnedFields?.[tableId] ?? [] : []);
}

/** Cards show at most this many fields by default; a 40-field table is not a card. */
export const DEFAULT_CARD_FIELDS = 5;

/**
 * Which fields a card shows: the canvas's choice for that table if it made one,
 * else the first few fields — minus the primary field, which is the card's TITLE
 * and would otherwise appear twice.
 */
export function cardFieldsFor<F extends { id: string }>(
  config: unknown, tableId: string, tableFields: F[], primaryFieldId: string | undefined,
): F[] {
  const parsed = CanvasConfig.safeParse(config ?? {});
  const chosen = parsed.success ? parsed.data.cardFields[tableId] : undefined;
  if (chosen) {
    const byId = new Map(tableFields.map((f) => [f.id, f]));
    return chosen.map((id) => byId.get(id)).filter((f): f is F => !!f);
  }
  return tableFields.filter((f) => f.id !== primaryFieldId).slice(0, DEFAULT_CARD_FIELDS);
}

interface LinkFieldLike { id: string; name: string; table_id: string; type: string; options?: Record<string, unknown> | null }

/**
 * Through WHICH field does a new record of `tableId` get linked to a default record
 * of `targetTableId`? The person entering data must never have to answer that, so:
 *
 *   no link field to that table     → null: this table is simply not affected.
 *   exactly one                     → that one.
 *   several, one ticked membership  → that one (the same explicit flag scope uses).
 *   several, none or many ticked    → AMBIGUOUS: skipped, and the canvas bar says
 *                                     which table and which fields, so an admin can
 *                                     tick "membership" on the right one.
 */
export function defaultLinkField<F extends LinkFieldLike>(
  fields: Iterable<F>, tableId: string, targetTableId: string,
): { field: F } | { ambiguous: F[] } | null {
  const links = [...fields].filter((f) => f.table_id === tableId && f.type === 'link' && f.options?.target_table_id === targetTableId);
  if (!links.length) return null;
  if (links.length === 1) return { field: links[0] };
  const flagged = links.filter((f) => f.options?.membership === true);
  return flagged.length === 1 ? { field: flagged[0] } : { ambiguous: links };
}
