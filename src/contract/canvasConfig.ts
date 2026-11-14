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
  /**
   * OWN LOOK (CANVAS-BRIEF.md Part A): this canvas keeps its own card settings — the
   * LOOK_KEYS above, as they are in this config. Absent or false: the canvas ignores
   * those keys and wears its HOME TABLE's shared look (`tables.canvas_look`), so every
   * Work's canvas reads the same and is set up once. See `lookOf`.
   */
  ownLook: z.boolean().optional(),
});
export type CanvasConfig = z.infer<typeof CanvasConfig>;

/* ── THE LOOK: card settings, shared by every canvas of a table ─────────────────
   CANVAS-BRIEF.md Part A (Nov 14, 2026). A canvas's id is a record's id (sql/010,
   022); its HOME TABLE is that record's table — a boards table, or an ordinary
   table with `record_canvases` (Works). The part of a config about how cards READ
   is its LOOK, and by default a canvas takes it from its home table rather than
   carrying its own:

     the look        cardFields, hideEmpty, pinnedFields, rules, glow
     never shared    defaults, stacks — they are about THIS canvas ("new records
                     here go to Ep 101", "this column of deliverables")

   A canvas that ticks `ownLook` keeps its own look, all of it (not table by table).
   Nothing about rendering changes: `lookOf` returns an object of the same shape as
   a config, and every reader above (`cardFieldsFor`, `hidesEmpty`, `pinnedFieldsFor`,
   `rulesFor`, `glowOf`) is handed THAT instead of the raw config. */

export const LOOK_KEYS = ['cardFields', 'hideEmpty', 'pinnedFields', 'rules', 'glow'] as const;
export type LookKey = (typeof LOOK_KEYS)[number];

/** A table's shared look, as `tables.canvas_look` stores it. Validated on write (table.update). */
export const CanvasLook = CanvasConfig.pick({ cardFields: true, hideEmpty: true, pinnedFields: true, rules: true, glow: true })
  .extend({ cardFields: z.record(uuid, z.array(uuid).max(40)).optional() });
export type CanvasLook = z.infer<typeof CanvasLook>;

const isBlank = (v: unknown) => v === undefined || v === null || v === false
  || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

/** Just the look keys of a config (or of a look), the empty ones left out. */
export function lookPart(config: unknown): CanvasLook {
  const src = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of LOOK_KEYS) if (!isBlank(src[k])) out[k] = src[k];
  const parsed = CanvasLook.safeParse(out);
  return parsed.success ? parsed.data : {};
}

/** Does this config set anything about how cards look? (sql/023 ticks `ownLook` on those.) */
export const hasLook = (config: unknown): boolean => Object.keys(lookPart(config)).length > 0;

/** Does this canvas keep its own look? */
export function ownsLook(config: unknown): boolean {
  const parsed = CanvasConfig.safeParse(config ?? {});
  return parsed.success && parsed.data.ownLook === true;
}

/**
 * THE look a canvas's cards wear: its own when it ticks `ownLook`, else its home
 * table's (`tables.canvas_look`, null when none is set), else nothing — today's
 * defaults. Hand the result to the readers above in place of the config.
 */
export function lookOf(config: unknown, tableLook: unknown): CanvasLook {
  return ownsLook(config) ? lookPart(config) : lookPart(tableLook);
}

/**
 * Where a change to the look is WRITTEN. The canvas bar's chip says the same thing
 * in words ("Cards: shared · Works" / "Cards: this canvas only").
 */
export const lookTarget = (config: unknown): 'canvas' | 'table' => (ownsLook(config) ? 'canvas' : 'table');

/** The config without any look keys — what is left of a canvas once it stops keeping its own. */
export function withoutLook(config: unknown): CanvasConfig {
  const parsed = CanvasConfig.safeParse(config ?? {});
  const c: Record<string, unknown> = parsed.success ? { ...parsed.data } : { cardFields: {} };
  for (const k of LOOK_KEYS) delete c[k];
  delete c.ownLook;
  for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
  return { ...c, cardFields: {} } as CanvasConfig;
}

/** The config with `look` as its own look, `ownLook` ticked — everything else kept. */
export function withOwnLook(config: unknown, look: CanvasLook): CanvasConfig {
  return { ...withoutLook(config), ...lookPart(look), cardFields: look.cardFields ?? {}, ownLook: true } as CanvasConfig;
}

/**
 * The mutations for a change to the look, wherever it lives. `edit` gets the look as
 * it is now and returns the look as it should be — the canvas view's toggles (a
 * field, a pin, hide-empty, a rule, the glow) are all written this way, so none of
 * them needs to know which of the two places it is changing.
 */
export function lookEdit(
  canvasId: string, config: unknown, homeTableId: string | null, tableLook: unknown,
  edit: (look: CanvasLook) => CanvasLook,
): Array<{ type: 'canvas.update'; id: string; config: CanvasConfig } | { type: 'table.update'; id: string; canvasLook: CanvasLook | null }> {
  const next = lookPart(edit(lookOf(config, tableLook)));
  if (lookTarget(config) === 'canvas' || !homeTableId) return [{ type: 'canvas.update', id: canvasId, config: withOwnLook(config, next) }];
  return [{ type: 'table.update', id: homeTableId, canvasLook: Object.keys(next).length ? next : null }];
}

/** "Use only on this canvas": copy the shared look into the canvas and tick `ownLook`. */
export function detachLook(canvasId: string, config: unknown, tableLook: unknown) {
  return [{ type: 'canvas.update' as const, id: canvasId, config: withOwnLook(config, lookPart(tableLook)) }];
}

/** "Use the shared settings": the canvas's own look is dropped (the menu confirms first). */
export function attachLook(canvasId: string, config: unknown) {
  return [{ type: 'canvas.update' as const, id: canvasId, config: withoutLook(config) }];
}

/**
 * "Make these the shared settings": this canvas's own look becomes its table's, and
 * the canvas goes back to the shared one — it looks exactly as it did, and so do now
 * all its siblings that share. ONE batch, so ONE Ctrl+Z puts both back.
 */
export function promoteLook(canvasId: string, config: unknown, homeTableId: string) {
  const look = lookPart(config);
  return [
    { type: 'table.update' as const, id: homeTableId, canvasLook: Object.keys(look).length ? look : null },
    { type: 'canvas.update' as const, id: canvasId, config: withoutLook(config) },
  ];
}

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
