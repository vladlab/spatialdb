/**
 * ============================================================================
 *  The junction contract — a relationship that has attributes.
 * ============================================================================
 *
 *  A table of kind 'junction' (sql/016) connects two tables: each of its rows IS
 *  one pair — this file, that deliverable — and carries what the pair carries: a
 *  status ("Uploaded", "Rejected", "Accepted"), notes, whatever fields are added.
 *  "Satisfied" is never stored; it is "any row Accepted", a report's business.
 *
 *      tables.junction: {
 *        a:      <link field id>        endpoint A — on this table, single
 *        b:      <link field id>        endpoint B — on this table, single
 *        status: <select field id>      optional: the row's verb
 *        match:  [[<field on A's table>, <field on B's table>], …]
 *                optional: link fields that SHOULD agree (a file's Work, a
 *                deliverable's Work). The picker offers agreeing records first
 *                and keeps "show all" — a filter, never a constraint.
 *      }
 *
 *  Same arrangement as tools.ts: `junctionProblem` is the configuration rule,
 *  run by the server on `table.update { junction }` and by the table settings
 *  form; the helpers below are what the client needs to draw a row from either
 *  end. Nothing here touches the database — the invariants a junction row must
 *  satisfy (exactly one link per endpoint, one row per pair, rows die with their
 *  endpoints) are enforced in apply.ts, where the rows are.
 */

import { z } from 'zod';

const uuid = z.guid();

export const JunctionConfig = z.strictObject({
  a: uuid,
  b: uuid,
  status: uuid.optional(),
  match: z.array(z.tuple([uuid, uuid])).max(8).optional(),
});
export type JunctionConfig = z.infer<typeof JunctionConfig>;

export interface JunctionFieldLike {
  id: string; table_id: string; type: string;
  options?: Record<string, unknown> | null;
}

/** The parsed config of a table, or null when it has none (or an unparseable one). */
export function junctionOf(t: { kind?: string | null; junction?: unknown } | undefined | null): JunctionConfig | null {
  if (!t || t.kind !== 'junction') return null;
  const p = JunctionConfig.safeParse(t.junction);
  return p.success ? p.data : null;
}

/**
 * Why this configuration is not acceptable, or null. `fields` must include the
 * junction table's own fields AND the fields of both endpoint tables (the match
 * pairs live there).
 */
export function junctionProblem(
  tableId: string, junction: unknown, fields: Iterable<JunctionFieldLike>,
): string | null {
  const parsed = JunctionConfig.safeParse(junction);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return i ? `${i.path.join('.') || 'junction'}: ${i.message}` : 'not a junction config';
  }
  const cfg = parsed.data;
  const byId = new Map<string, JunctionFieldLike>();
  for (const f of fields) byId.set(f.id, f);

  const endpoint = (which: 'a' | 'b'): string | { target: string } => {
    const f = byId.get(cfg[which]);
    if (!f) return `endpoint ${which}: that field does not exist`;
    if (f.table_id !== tableId) return `endpoint ${which}: the field must be on the junction table itself`;
    if (f.type !== 'link') return `endpoint ${which}: must be a link field`;
    if (f.options?.single !== true) return `endpoint ${which}: the link must be "single" — a junction row is ONE pair`;
    const target = f.options?.target_table_id;
    if (typeof target !== 'string' || !target) return `endpoint ${which}: the link must point at a table`;
    return { target };
  };
  const ea = endpoint('a'); if (typeof ea === 'string') return ea;
  const eb = endpoint('b'); if (typeof eb === 'string') return eb;
  if (cfg.a === cfg.b) return 'the two endpoints must be different fields';

  if (cfg.status !== undefined) {
    const s = byId.get(cfg.status);
    if (!s) return 'status: that field does not exist';
    if (s.table_id !== tableId) return 'status: must be a field on the junction table itself';
    if (s.type !== 'select') return 'status: must be a select field (its choices are the verbs)';
  }

  for (const [i, [fa, fb]] of (cfg.match ?? []).entries()) {
    const A = byId.get(fa), B = byId.get(fb);
    if (!A || !B) return `match ${i + 1}: a field does not exist`;
    if (A.table_id !== ea.target) return `match ${i + 1}: the first field must be on the table endpoint a points at`;
    if (B.table_id !== eb.target) return `match ${i + 1}: the second field must be on the table endpoint b points at`;
    if (A.type !== 'link' || B.type !== 'link') return `match ${i + 1}: both must be link fields`;
    if (A.options?.target_table_id !== B.options?.target_table_id) return `match ${i + 1}: both must link to the same table, or they can never agree`;
  }
  return null;
}

/**
 * Which end of `cfg` a backlink field on an endpoint table mirrors: the backlink's
 * source is the junction's `a` or `b` field. Null for any other backlink.
 */
export function endpointOfBacklink(
  backlink: { options?: Record<string, unknown> | null },
  cfg: JunctionConfig,
): 'a' | 'b' | null {
  const src = backlink.options?.source_field_id;
  return src === cfg.a ? 'a' : src === cfg.b ? 'b' : null;
}

export const otherEnd = (side: 'a' | 'b'): 'a' | 'b' => (side === 'a' ? 'b' : 'a');

/**
 * The picker rule for `match`: a candidate agrees when, for EVERY match pair, the
 * two sides share at least one linked record — non-empty intersection, because
 * a deliverable may belong to several Works (every episode of a show) and a file
 * to one of them. A pair on which the STARTING record links to nothing is skipped:
 * an empty side means "no opinion", not "nothing qualifies".
 */
export function matches(
  cfg: JunctionConfig, side: 'a' | 'b',
  from: string, candidate: string,
  linksFrom: (recordId: string, fieldId: string) => readonly string[],
): boolean {
  for (const pair of cfg.match ?? []) {
    const [mine, theirs] = side === 'a' ? pair : [pair[1], pair[0]];
    const have = linksFrom(from, mine);
    if (!have.length) continue;
    const want = linksFrom(candidate, theirs);
    if (!want.some((id) => have.includes(id))) return false;
  }
  return true;
}

/** True when the junction has at least one match pair the starting record can use. */
export function hasMatch(cfg: JunctionConfig, side: 'a' | 'b', from: string,
  linksFrom: (recordId: string, fieldId: string) => readonly string[]): boolean {
  return (cfg.match ?? []).some((pair) => linksFrom(from, side === 'a' ? pair[0] : pair[1]).length > 0);
}

/**
 * The label of a junction row. The OTHER END is the intent and comes first; the
 * status follows it:
 *     from the file          "Texted Master › Uploaded"
 *     from the deliverable   "reel_10.mov › Uploaded"
 * and seen from nowhere in particular, both ends then the status:
 *     "reel_10.mov → Texted Master › Uploaded"
 * `status` is the row's status value (or empty), `a`/`b` the endpoint labels.
 */
export function junctionLabel(status: string, a: string, b: string, from?: 'a' | 'b'): string {
  const verb = status ? ` › ${status}` : '';
  if (from === 'a') return `${b}${verb}`;
  if (from === 'b') return `${a}${verb}`;
  return `${a} → ${b}${verb}`;
}

/**
 * The table at the OTHER end of a junction column — the backlink on Files that mirrors
 * the junction's `a`: Deliverables. This is what a comparison through that column
 * compares against (contract/compare.ts): pairs of Files fields (found) and
 * Deliverables fields (expected), evaluated per pair row. Null for any other field.
 */
export function junctionColumnTarget(
  field: { type: string; options?: Record<string, unknown> | null },
  getField: (id: string) => JunctionFieldLike | undefined,
  junctions: Iterable<{ kind?: string | null; junction?: unknown }>,
): string | null {
  if (field.type !== 'backlink') return null;
  const src = field.options?.source_field_id;
  if (typeof src !== 'string') return null;
  for (const t of junctions) {
    const cfg = junctionOf(t);
    if (!cfg) continue;
    const side = src === cfg.a ? 'a' : src === cfg.b ? 'b' : null;
    if (!side) continue;
    const far = getField(side === 'a' ? cfg.b : cfg.a)?.options?.target_table_id;
    return typeof far === 'string' ? far : null;
  }
  return null;
}
