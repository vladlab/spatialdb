/**
 * ============================================================================
 *  The BACK of a card (CANVAS-BRIEF.md C2) — what you see when an examined card
 *  is flipped
 * ============================================================================
 *
 *  Read-only, and defined once per TABLE so two cards of a kind always match
 *  (sql/025, `tables.card_back`): an ordered list of field ids.
 *
 *    unset   every field of the table but the title (the primary, which heads the
 *            back already), in schema order, under the table's field SECTION names
 *            (contract/fieldSections.ts) — so it works with no setup at all
 *    a list  those fields, in that order, no headings — the person chose the order
 *
 *  Ids that no longer resolve are skipped, like every other list of field ids here.
 */
import { z } from 'zod';
import { groupFields, type FieldSection } from './fieldSections.js';

export const CardBack = z.array(z.string().uuid()).max(80);
export type CardBack = z.infer<typeof CardBack>;

export type BackLine<F> = { kind: 'head'; name: string } | { kind: 'field'; field: F };

/**
 * The lines a card's back draws. `fields` are the table's own fields in schema
 * order, system fields already left out; `primaryId` is the title's field.
 */
export function backLines<F extends { id: string }>(
  fields: readonly F[], cardBack: unknown, sections: readonly FieldSection[], primaryId?: string,
): BackLine<F>[] {
  const chosen = CardBack.safeParse(cardBack);
  if (chosen.success && cardBack !== null && cardBack !== undefined) {
    const byId = new Map(fields.map((f) => [f.id, f]));
    return chosen.data.flatMap((id) => { const f = byId.get(id); return f ? [{ kind: 'field' as const, field: f }] : []; });
  }
  const out: BackLine<F>[] = [];
  for (const g of groupFields(fields.filter((f) => f.id !== primaryId), sections)) {
    if (!g.fields.length) continue;
    if (g.section) out.push({ kind: 'head', name: g.section.name });
    for (const f of g.fields) out.push({ kind: 'field', field: f });
  }
  return out;
}
