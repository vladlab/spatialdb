/**
 * ============================================================================
 *  The match contract — which records a link's picker offers FIRST.
 * ============================================================================
 *
 *  A file is made for a Work; a deliverable is asked of one or more Works. When
 *  you pick a file's deliverable, the ones asked of that file's Work are almost
 *  always what you want — and the other four hundred are noise. A MATCH says so:
 *
 *      field.options.match = [[<field on this table>, <field on the target table>], …]
 *
 *  on a LINK field (roles are link fields — as membership, single, compare and
 *  arrow style are). Each pair names two fields that SHOULD agree: "this file's
 *  Work, that deliverable's Works". The picker then offers the agreeing records
 *  alone, with "show all" a tick away.
 *
 *  It is a FILTER, never a constraint. Nothing here stops a link from being made
 *  to a record that does not agree — the server does not look at a match when a
 *  link is added, and a link made before the match was set is left alone. Reusing
 *  a file across Works is a legitimate thing to do; the match only decides what
 *  the picker shows before you ask for more.
 *
 *  A side of a pair is LINK-LIKE: a link field, or a backlink. That matters
 *  because one fact has one home — "Works.Deliverables → Deliverables" lives on
 *  the Work, and on Deliverables it is a backlink ("Works"). Both name the same
 *  Works, so either may stand in a pair. What must agree is the table the two
 *  sides LEAD TO.
 *
 *  A junction's `match` (contract/junction.ts) is the same rule between its two
 *  endpoint tables; `agrees` and `hasOpinion` below are what it runs.
 *
 *  Shared two ways: the server runs `linkMatchError` when the option is written,
 *  the field's ⚙ runs it before sending. Like a lookup, a match can BREAK later —
 *  one of its fields is deleted — and that is tolerated at read time: a pair with
 *  a missing field is inert (`usablePairs` drops it) and shown as such.
 */

import { z } from 'zod';
import { leadsTo } from './backlinks.js';

const uuid = z.guid();

export const MatchPairs = z.array(z.tuple([uuid, uuid])).max(8);
export type MatchPair = [string, string];

export interface MatchFieldLike {
  id: string; table_id: string; type: string;
  name?: string;
  options?: Record<string, unknown> | null;
}
type GetField = (id: string) => MatchFieldLike | undefined;

// The table a link-like field LEADS TO: contract/backlinks.ts. Re-exported — it is half of this rule.
export { leadsTo };

/** The pairs stored on a link field; empty when there are none (or they do not parse). */
export function linkMatchOf(f: { options?: Record<string, unknown> | null } | undefined): MatchPair[] {
  const p = MatchPairs.safeParse(f?.options?.match);
  return p.success ? p.data : [];
}

/** Why ONE pair is not acceptable on this link, or null. */
export function matchPairProblem(link: MatchFieldLike, pair: MatchPair, getField: GetField): string | null {
  const [mine, theirs] = pair;
  const A = getField(mine), B = getField(theirs);
  if (!A || !B) return 'a field does not exist';
  if (A.id === link.id) return 'a link cannot be matched on itself';
  if (A.table_id !== link.table_id) return `the first field must be on the link's own table`;
  if (B.table_id !== link.options?.target_table_id) return 'the second field must be on the table the link points at';
  const a = leadsTo(A, getField), b = leadsTo(B, getField);
  if (!a || !b) return 'both must be link or backlink fields';
  if (a !== b) return 'both must lead to the same table, or they can never agree';
  return null;
}

/**
 * Why `options.match` is not acceptable on this field, or null. Absent is fine.
 *
 * `stored` is what the field holds already (an update). Pairs that were there
 * before are NOT re-examined: a match can break later — one of its fields is
 * deleted — and is then merely inert. Holding every later edit of the field (its
 * colour, its "single" tick, removing the dead pair itself) hostage to a pair that
 * was fine when it was written would turn a tolerated state into a trap. What is
 * NEW must be right.
 */
export function linkMatchError(link: MatchFieldLike, getField: GetField, stored?: unknown): string | null {
  if (link.options?.match === undefined) return null;
  if (link.type !== 'link') return 'match: only a link field narrows its picker';
  const parsed = MatchPairs.safeParse(link.options.match);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return `match: ${i?.path.length ? `${i.path.join('.')}: ` : ''}${i?.message ?? 'not a list of field pairs'}`;
  }
  const was = MatchPairs.safeParse(stored);
  const known = new Set((was.success ? was.data : []).map((p) => p.join('=')));
  const seen = new Set<string>();
  for (const [i, pair] of parsed.data.entries()) {
    const key = pair.join('=');
    if (seen.has(key)) return `match ${i + 1}: that pair is already there`;
    seen.add(key);
    if (known.has(key)) continue;
    const err = matchPairProblem(link, pair, getField);
    if (err) return `match ${i + 1}: ${err}`;
  }
  return null;
}

/** The pairs that can actually be evaluated today: both fields still exist and still lead to the same table. */
export function usablePairs(link: MatchFieldLike, getField: GetField): MatchPair[] {
  return linkMatchOf(link).filter((pair) => matchPairProblem(link, pair, getField) === null);
}

/**
 * Every pair this link COULD be matched on: a link-like field of its own table
 * and one of its target table that lead to the same table. What the ⚙ offers.
 */
export function possiblePairs(link: MatchFieldLike, fields: Iterable<MatchFieldLike>, getField: GetField): MatchPair[] {
  const target = link.options?.target_table_id;
  if (link.type !== 'link' || typeof target !== 'string') return [];
  const mine: MatchFieldLike[] = [], theirs: MatchFieldLike[] = [];
  for (const f of fields) {
    if (f.table_id === link.table_id && f.id !== link.id) mine.push(f);
    if (f.table_id === target) theirs.push(f);
  }
  const out: MatchPair[] = [];
  for (const a of mine) {
    const to = leadsTo(a, getField);
    if (!to) continue;
    for (const b of theirs) if (leadsTo(b, getField) === to) out.push([a.id, b.id]);
  }
  return out;
}

/**
 * THE RULE. A candidate agrees when, for EVERY pair, the two sides share at least
 * one record — non-empty intersection, because a deliverable may belong to several
 * Works (every episode of a show) and a file to one of them. A pair on which the
 * STARTING record holds nothing is skipped: an empty side means "no opinion", not
 * "nothing qualifies".
 *
 * `held(recordId, fieldId)` is what a record holds through a link-like field.
 */
export function agrees(
  pairs: readonly MatchPair[], from: string, candidate: string,
  held: (recordId: string, fieldId: string) => readonly string[],
): boolean {
  for (const [mine, theirs] of pairs) {
    const have = held(from, mine);
    if (!have.length) continue;
    const want = held(candidate, theirs);
    if (!want.some((id) => have.includes(id))) return false;
  }
  return true;
}

/** True when at least one pair has something to go on for the starting record. */
export function hasOpinion(
  pairs: readonly MatchPair[], from: string,
  held: (recordId: string, fieldId: string) => readonly string[],
): boolean {
  return pairs.some(([mine]) => held(from, mine).length > 0);
}
