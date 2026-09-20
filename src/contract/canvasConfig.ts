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

const uuid = z.guid();

export const CanvasConfig = z.strictObject({
  cardFields: z.record(uuid, z.array(uuid).max(40)).default({}),
});
export type CanvasConfig = z.infer<typeof CanvasConfig>;

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
