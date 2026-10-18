/**
 * ============================================================================
 *  Colour rules — conditional colour, belonging to a VIEW, a CANVAS or a REPORT
 *  LEVEL. Never to the record (Oct 17, 2026).
 * ============================================================================
 *
 *  The colours the app already had are IDENTITY colours — what a thing is: a
 *  table's colour on its card headers, a link field's arrow colour on its pills
 *  and arrows, a section's colour. A rule here is a STATE colour — how a thing is
 *  doing: "Accepted → green", "no deliverable → red". The two never touch the
 *  same pixel: identity stays on the header, the pill and the arrow; state goes
 *  on a row's stripe-and-wash, a card's glow, a band's stripe. That is also why
 *  a rule's colour is one of six NAMED tints and not a hex: the eye can tell a
 *  rule's tint from a table's hex at a glance, and the text-on-tint contrast is
 *  solved once, in App.vue, for every surface.
 *
 *  One rule shape for all three homes:
 *
 *    when   the FilterEntry lines of a view's filter, ANDed — the same editor
 *    tint   green · amber · red · blue · violet · grey
 *    paint  the whole row / card / band, or ONE field (a cell, a card row)
 *    label  what the legend chip says; blank = no chip
 *
 *  Rules are ORDERED and the first match wins PER TARGET: the first matching row
 *  rule paints the row, and the first matching rule for each field paints that
 *  field. So "Accepted → green row" above "Sent and no deliverable → red cell"
 *  gives a record both when both apply — a row rule never shadows a cell rule.
 *
 *  Where they live: `views.config.rules`; `canvases.config.rules[tableId]` (a
 *  canvas mixes tables, and a Files rule means nothing on an Edit card); a report
 *  level's `rules`, whose `when` may also test the level's ROLLUPS ("Accepted ≥ 1"
 *  — what makes "satisfied" a colour on a deliverable's band rather than a column).
 */
import { z } from 'zod';
import { FilterEntry, passesFilters, type LinkIds, type LinkLabels, type ViewField, type ViewRecord } from './views.js';

const uuid = z.guid();

export const TINTS = ['green', 'amber', 'red', 'blue', 'violet', 'grey'] as const;
export type Tint = (typeof TINTS)[number];

export const MAX_RULES = 32;

/** A test on one of the level's rollups — reports only (contract/reports.ts `Rollup.where` has the same shape). */
export const RollupTest = z.strictObject({
  rollup: z.string().min(1).max(64),
  op: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']),
  value: z.number(),
});
export type RollupTest = z.infer<typeof RollupTest>;

export const Paint = z.union([z.literal('row'), z.strictObject({ field: uuid })]);
export type Paint = z.infer<typeof Paint>;

export const ColorRule = z.strictObject({
  id: z.string().min(1).max(64),
  // `z.lazy`: views.ts and this file import each other (see the note there).
  when: z.array(z.lazy(() => FilterEntry)).max(32).default([]),
  tint: z.enum(TINTS),
  paint: Paint.default('row'),
  label: z.string().max(60).optional(),
});
export type ColorRule = z.infer<typeof ColorRule>;

/** A report level's rule: its `when` may also name a rollup. */
export const ReportColorRule = ColorRule.extend({
  when: z.array(z.lazy(() => z.union([FilterEntry, RollupTest]))).max(32).default([]),
});
export type ReportColorRule = z.infer<typeof ReportColorRule>;
export type RuleTest = ReportColorRule['when'][number];

export const isRollupTest = (t: RuleTest): t is RollupTest => 'rollup' in t;

/** A rule as the evaluator needs it — what a parsed rule is, and what a raw one may be short of. */
export interface RuleLike { id: string; when?: readonly RuleTest[]; tint: Tint; paint?: Paint; label?: string }

/** What one record got: the rule that painted its row, and the rule that painted each field. */
export interface Painted { tint: Tint; ruleId: string; label?: string }
export interface Paints { row?: Painted; fields: Record<string, Painted> }

/**
 * Evaluate ordered rules over one record — first match wins per target. `rollup`
 * answers a rollup test (reports); without it such a test fails, so a rule that
 * needs one paints nothing rather than everything. A rule with NO conditions
 * matches every record: "everything else → grey" is a legitimate last rule.
 * Returns undefined when nothing painted, so callers can skip the work of
 * styling.
 */
export function paintsOf(
  rec: ViewRecord, rules: readonly RuleLike[], fields: ReadonlyMap<string, ViewField>,
  links: LinkLabels = () => [], linkIds?: LinkIds, rollup?: (t: RollupTest) => boolean,
): Paints | undefined {
  let out: Paints | undefined;
  for (const r of rules) {
    // A rule straight from a definition (a report's, unparsed) may lack the defaults.
    const paint = r.paint ?? 'row';
    const target = paint === 'row' ? 'row' : paint.field;
    if (target === 'row' ? out?.row : out?.fields[target]) continue;   // this target is painted already
    let ok = true;
    const plain: z.infer<typeof FilterEntry>[] = [];
    for (const t of r.when ?? []) {
      if (isRollupTest(t)) { if (!rollup || !rollup(t)) { ok = false; break; } } else plain.push(t);
    }
    if (!ok || !passesFilters(rec, fields, plain, links, linkIds)) continue;
    out ??= { fields: {} };
    const hit: Painted = { tint: r.tint, ruleId: r.id, ...(r.label ? { label: r.label } : {}) };
    if (target === 'row') out.row = hit; else out.fields[target] = hit;
  }
  return out;
}

/** Does this value pass this rollup test? The same arithmetic `Rollup.where` uses. */
export function rollupPasses(value: unknown, t: RollupTest): boolean {
  if (typeof value !== 'number') return false;
  return t.op === 'gt' ? value > t.value : t.op === 'gte' ? value >= t.value : t.op === 'lt' ? value < t.value : t.op === 'lte' ? value <= t.value : value === t.value;
}

/** The legend: one chip per rule that has a label, in rule order, each tint once per label. */
export function legendOf(rules: readonly { tint: Tint; label?: string }[]): Array<{ tint: Tint; label: string }> {
  const seen = new Set<string>();
  const out: Array<{ tint: Tint; label: string }> = [];
  for (const r of rules) {
    if (!r.label) continue;
    const key = `${r.tint}\u0000${r.label}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push({ tint: r.tint, label: r.label });
  }
  return out;
}

/** A fresh rule id that no rule in `existing` uses. */
export function newRuleId(existing: readonly { id: string }[]): string {
  let n = existing.length + 1;
  while (existing.some((r) => r.id === `r${n}`)) n++;
  return `r${n}`;
}
