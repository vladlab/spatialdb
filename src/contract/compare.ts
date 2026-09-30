/**
 * ============================================================================
 *  The comparison engine (COMPARE-BRIEF.md) — the eleventh shared contract file.
 * ============================================================================
 *
 *  A "comparing link" is an ordinary LINK FIELD with `options.compare` set (roles
 *  are link fields — as membership, arrow style and single are). Its target is what
 *  is EXPECTED; its owner is what was FOUND. The rules are PAIRS of fields, one on
 *  each side, each with a rule chosen from a small closed set typed by the two
 *  field types. The result is DERIVED — computed live, never stored.
 *
 *  Shared three ways: the server validates `options.compare` on write; the web app
 *  computes results for badges, side-by-side and seeding; a script gets the same
 *  verdict through POST /api/compare.
 */

import { z } from 'zod';
import { diffLayouts, AudioLayout } from './shapes.js';
import { choicesOf } from './values.js';

/* ── the rule set ─────────────────────────────────────────────────────────── */

export const RULES = ['equals', 'onOrBefore', 'onOrAfter', 'within', 'atLeast', 'atMost', 'sameRecord', 'sameSet', 'layout'] as const;
export type Rule = (typeof RULES)[number];

export const RULE_LABELS: Record<Rule, string> = {
  equals: 'equals', onOrBefore: 'on or before', onOrAfter: 'on or after', within: 'within ± of', atLeast: 'at least', atMost: 'at most',
  sameRecord: 'same record', sameSet: 'same records', layout: 'same layout',
};

interface FieldLike { id: string; key: string; name: string; type: string; table_id: string; options?: Record<string, unknown> | null }

/** Which rules are legal for this (owner field, target field) pair. Empty = the pair cannot be compared. */
export function rulesFor(owner: FieldLike, target: FieldLike): Rule[] {
  const o = owner.type, t = target.type;
  if ((o === 'text' || o === 'select') && (t === 'text' || t === 'select')) return ['equals'];
  if (o === 'checkbox' && t === 'checkbox') return ['equals'];
  if (o === 'date' && t === 'date') return ['equals', 'onOrBefore', 'onOrAfter'];
  if (o === 'number' && t === 'number') return ['equals', 'within', 'atLeast', 'atMost'];
  if (o === 'link' && t === 'link' && owner.options?.target_table_id === target.options?.target_table_id) return ['sameRecord', 'sameSet'];
  if (o === 'structured' && t === 'structured' && owner.options?.shape === 'audio_layout' && target.options?.shape === 'audio_layout') return ['layout'];
  return [];
}

export const ComparePair = z.strictObject({
  from: z.string().uuid(),          // a field of the link's OWNER table (what was found)
  to: z.string().uuid(),            // a field of the link's TARGET table (what is expected)
  rule: z.enum(RULES),
  params: z.strictObject({ caseInsensitive: z.boolean().optional(), tolerance: z.number().nonnegative().optional() }).optional(),
});
export const CompareConfig = z.strictObject({ pairs: z.array(ComparePair).max(200) });
export type ComparePair = z.infer<typeof ComparePair>;
export type CompareConfig = z.infer<typeof CompareConfig>;

export const compareOf = (f: { options?: Record<string, unknown> | null }): CompareConfig | null => {
  const r = CompareConfig.safeParse(f.options?.compare);
  return r.success ? r.data : null;
};

/**
 * Why `options.compare` on a link field is unacceptable, or null. `fields` is every
 * field the validator can see (server: the table's and the target's; client: all).
 */
export function compareConfigError(
  link: { table_id: string; options?: Record<string, unknown> | null }, fields: Iterable<FieldLike>,
  /** The expected side's table. A link's is its target; a JUNCTION column's (sql/016) is the other end's table, which the caller resolves. */
  targetTable?: string,
): string | null {
  if (link.options?.compare === undefined) return null;
  const r = CompareConfig.safeParse(link.options.compare);
  if (!r.success) { const i = r.error.issues[0]; return `compare: ${i.path.join('.')}${i.path.length ? ': ' : ''}${i.message}`; }
  const target = targetTable ?? String(link.options?.target_table_id ?? '');
  const byId = new Map<string, FieldLike>(); for (const f of fields) byId.set(f.id, f);
  for (const p of r.data.pairs) {
    const from = byId.get(p.from), to = byId.get(p.to);
    if (!from || from.table_id !== link.table_id) return `compare: 'from' ${p.from} is not a field of this table`;
    if (!to || to.table_id !== target) return `compare: 'to' ${p.to} is not a field of the target table`;
    if (!rulesFor(from, to).includes(p.rule)) return `compare: rule '${p.rule}' is not valid for ${from.type} ↔ ${to.type} (${from.name} ↔ ${to.name})`;
    if (p.rule === 'within' && p.params?.tolerance === undefined) return `compare: 'within' needs params.tolerance (${from.name} ↔ ${to.name})`;
  }
  return null;
}

/**
 * The DEFAULT pairs when "compare" is first ticked: every same-name (case-insensitive)
 * pair with a legal rule, given the obvious rule. A convenience for the editor, not the
 * rule — what is saved is the explicit list.
 */
export function suggestPairs(ownerFields: FieldLike[], targetFields: FieldLike[], skipOwner: Iterable<string> = []): ComparePair[] {
  const skip = new Set(skipOwner);          // the owner's PRIMARY field: a file's name is never the spec's name
  const out: ComparePair[] = [];
  for (const o of ownerFields) {
    if (skip.has(o.id)) continue;
    const t = targetFields.find((x) => x.name.trim().toLowerCase() === o.name.trim().toLowerCase());
    if (!t) continue;
    const rules = rulesFor(o, t);
    if (rules.length) out.push({ from: o.id, to: t.id, rule: rules[0] });
  }
  return out;
}

/* ── evaluation ───────────────────────────────────────────────────────────── */

export type Status = 'match' | 'differ' | 'missing' | 'unspecified';
export interface PairResult { pair: ComparePair; status: Status; detail: string; expected: string; found: string }
export interface CompareResult { same: boolean; results: PairResult[] }

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const show = (v: unknown): string => (isEmpty(v) ? '—' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * Compare one owner record against one target record through a comparing link.
 * `linksFrom` supplies link values (they are not in `record.data`); `labelOf` names a
 * linked record for the detail text. Pure: no store, no writes.
 */
export function compareRecords(
  pairs: ComparePair[], fieldsById: Map<string, FieldLike>,
  owner: { id: string; data: Record<string, unknown> }, target: { id: string; data: Record<string, unknown> },
  linksFrom: (recordId: string, fieldId: string) => string[], labelOf: (recordId: string) => string = (id) => id,
): CompareResult {
  const results: PairResult[] = [];
  for (const pair of pairs) {
    const from = fieldsById.get(pair.from), to = fieldsById.get(pair.to);
    if (!from || !to) continue;                                 // a deleted field: the pair silently no longer applies
    const fv = from.type === 'link' ? linksFrom(owner.id, from.id) : owner.data[from.key];
    const tv = to.type === 'link' ? linksFrom(target.id, to.id) : target.data[to.key];
    const found = from.type === 'link' ? (fv as string[]).map(labelOf).join(', ') || '—' : show(fv);
    const expected = to.type === 'link' ? (tv as string[]).map(labelOf).join(', ') || '—' : show(tv);
    const push = (status: Status, detail: string) => results.push({ pair, status, detail, expected, found });

    if (isEmpty(tv)) { push('unspecified', `${to.name}: not specified`); continue; }
    if (isEmpty(fv)) { push('missing', `${from.name} is empty; expected ${expected}`); continue; }

    let ok = false, why = '';
    switch (pair.rule) {
      case 'equals': {
        if (typeof fv === 'boolean' || typeof tv === 'boolean') ok = fv === tv;
        else if (typeof fv === 'number' && typeof tv === 'number') ok = fv === tv;
        else { const a = String(fv), b = String(tv); ok = pair.params?.caseInsensitive ? a.trim().toLowerCase() === b.trim().toLowerCase() : a === b; }
        why = ok ? 'equal' : `${found} ≠ ${expected}`; break;
      }
      case 'onOrBefore': ok = String(fv) <= String(tv); why = ok ? 'on time' : `${found} is after ${expected}`; break;
      case 'onOrAfter':  ok = String(fv) >= String(tv); why = ok ? 'ok' : `${found} is before ${expected}`; break;
      case 'within':     { const tol = pair.params?.tolerance ?? 0; ok = Math.abs(Number(fv) - Number(tv)) <= tol; why = ok ? `within ±${tol}` : `${found} is not within ±${tol} of ${expected}`; break; }
      case 'atLeast':    ok = Number(fv) >= Number(tv); why = ok ? 'ok' : `${found} is below the minimum ${expected}`; break;
      case 'atMost':     ok = Number(fv) <= Number(tv); why = ok ? 'ok' : `${found} is above the maximum ${expected}`; break;
      case 'sameRecord': ok = (fv as string[])[0] === (tv as string[])[0]; why = ok ? 'same' : `${found} ≠ ${expected}`; break;
      case 'sameSet':    { const a = [...(fv as string[])].sort().join(), b = [...(tv as string[])].sort().join(); ok = a === b; why = ok ? 'same' : `${found} ≠ ${expected}`; break; }
      case 'layout': {
        const a = AudioLayout.safeParse(tv), b = AudioLayout.safeParse(fv);
        if (!a.success || !b.success) { ok = false; why = 'not a valid layout'; break; }
        const d = diffLayouts(a.data, b.data);
        ok = d.same; why = ok ? 'same layout' : d.issues.map((i) => i.detail).join('; ');
        break;
      }
    }
    push(ok ? 'match' : 'differ', why);
  }
  return { same: results.every((r) => r.status === 'match' || r.status === 'unspecified'), results };
}

/**
 * SEED: the pair list run the other way, once. Returns the owner values to write —
 * for every pair whose target has a value and (by default) whose owner is empty.
 * Link pairs are returned as records to link. Nothing is written here.
 */
export function seedValues(
  pairs: ComparePair[], fieldsById: Map<string, FieldLike>,
  owner: { id: string; data: Record<string, unknown> }, target: { id: string; data: Record<string, unknown> },
  linksFrom: (recordId: string, fieldId: string) => string[], overwrite = false,
): { set: Record<string, unknown>; links: Array<{ fieldId: string; toRecords: string[] }>; skipped: string[] } {
  const set: Record<string, unknown> = {}; const links: Array<{ fieldId: string; toRecords: string[] }> = []; const skipped: string[] = [];
  const seen = new Set<string>();
  for (const pair of pairs) {
    const from = fieldsById.get(pair.from), to = fieldsById.get(pair.to);
    if (!from || !to || seen.has(from.id)) continue;
    seen.add(from.id);
    // Only like-typed pairs can seed: a number cannot become a select. (rulesFor already
    // restricts pairs to like types, except text ↔ select, which seeds as text.)
    if (from.type === 'link') {
      const tv = linksFrom(target.id, to.id); if (!tv.length) continue;
      if (!overwrite && linksFrom(owner.id, from.id).length) { skipped.push(from.name); continue; }
      links.push({ fieldId: from.id, toRecords: from.options?.single ? tv.slice(0, 1) : tv });
    } else {
      const tv = target.data[to.key]; if (isEmpty(tv)) continue;
      if (!overwrite && !isEmpty(owner.data[from.key])) { skipped.push(from.name); continue; }
      if (from.type === 'select') { const choices = choicesOf(from.options) ?? []; if (!choices.includes(String(tv))) { skipped.push(`${from.name} (“${String(tv)}” is not one of its choices)`); continue; } }
      set[from.key] = tv;
    }
  }
  return { set, links, skipped };
}
