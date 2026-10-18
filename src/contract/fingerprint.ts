/**
 * ============================================================================
 *  The fingerprint: how the app decides whether two files are the same bytes.
 * ============================================================================
 *
 *  FIXED, not a setting (the owner, Oct 18): the fingerprint is an xxh3 of every
 *  file, run automatically — at the drop, and later for any record that has a
 *  path and no fingerprint yet. md5 and sha256 are a different thing: a checksum
 *  a client asked for, run by hand from the record; the app never reads them to
 *  decide anything. One fallback keeps older records usable: when a record has
 *  no xxh3 but does have another hash, that algorithm is compared instead, since
 *  the same algorithm on both sides is all a comparison needs.
 *
 *  Where it lives: in the record's MANIFEST, beside the size — `hashes.xxh3` on a
 *  single file, on each member of a bundle or channel set. Never on a sequence
 *  (its manifest lists a range, not files). A column may carry a copy, through a
 *  recipe step; the manifest is what is read.
 *
 *  Pure, so the server, the web app and the tests share one definition.
 */

import type { Manifest } from './shapes.js';

export const FINGERPRINT = 'xxh3';

type HashedThing = { hash?: string; hashes?: Record<string, string> };

/** Every hash a file carries, keyed by algorithm — the `hashes` map plus the older single `hash`. */
export function hashesOf(x: HashedThing | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!x) return out;
  if (typeof x.hash === 'string') { const algo = x.hash.split(':')[0]; if (algo) out[algo] = x.hash; }
  if (x.hashes) Object.assign(out, x.hashes);
  return out;
}

/**
 * What a manifest says about its bytes under one algorithm, as one string that
 * is equal exactly when the files are: a single file's hash; for a set, every
 * member's path and hash, in path order — null unless EVERY member has one, since
 * half a fingerprint proves nothing. A sequence has none.
 */
export function identityOf(m: Manifest | undefined | null, algo: string): string | null {
  if (!m) return null;
  if (m.kind === 'file') return hashesOf(m)[algo] ?? null;
  if (m.kind === 'sequence') return null;
  const parts: string[] = [];
  for (const x of m.members) { const h = hashesOf(x)[algo]; if (!h) return null; parts.push(`${x.path}=${h}`); }
  return parts.sort().join('\n');
}

/** The algorithms a manifest is fully hashed under, fingerprint first, then the rest. */
export function algorithmsOf(m: Manifest | undefined | null): string[] {
  if (!m || m.kind === 'sequence') return [];
  const things: HashedThing[] = m.kind === 'file' ? [m] : m.members;
  if (!things.length) return [];
  let algos: string[] | null = null;
  for (const t of things) {
    const here = new Set(Object.keys(hashesOf(t)));
    algos = algos === null ? [...here] : algos.filter((a) => here.has(a));
  }
  return (algos ?? []).sort((a, b) => (a === FINGERPRINT ? -1 : b === FINGERPRINT ? 1 : a.localeCompare(b)));
}

/** Does this manifest still want its fingerprint? (A sequence never does.) */
export const needsFingerprint = (m: Manifest | undefined | null): boolean => !!m && m.kind !== 'sequence' && identityOf(m, FINGERPRINT) === null;

/** The total bytes a manifest describes, when it says. */
export function sizeOf(m: Manifest | undefined | null): number | null {
  if (!m) return null;
  if (m.kind === 'file') return m.size;
  if (m.kind === 'sequence') return null;
  let n = 0;
  for (const x of m.members) { if (typeof x.size !== 'number') return null; n += x.size; }
  return n;
}

/**
 * The algorithm a dropped file must be hashed under to be compared with a
 * record: the fastest the record is fully hashed with — the fingerprint when it
 * has one — or null when the record carries no hash to compare against.
 */
export const compareAlgorithm = (recorded: Manifest | undefined | null): string | null => algorithmsOf(recorded)[0] ?? null;

export type Verdict = { same: true; by: string } | { same: false; by: string };

/**
 * Same bytes or not — the recorded manifest against a fresh one of the dropped
 * thing, hashed under `compareAlgorithm(recorded)`. Sizes first: a different size
 * is a different file without reading a byte. Then the hash. `null` means it
 * cannot say — the record has no hash, the drop was not hashed, or the shapes
 * differ in kind — and the caller treats that as "differs", because a replace
 * that was not proven safe asks first.
 */
export function compareManifests(recorded: Manifest | undefined | null, dropped: Manifest | undefined | null): Verdict | null {
  if (!recorded || !dropped || recorded.kind !== dropped.kind || recorded.kind === 'sequence') return null;
  const a = sizeOf(recorded), b = sizeOf(dropped);
  if (a !== null && b !== null && a !== b) return { same: false, by: 'size' };
  const algo = compareAlgorithm(recorded);
  if (!algo) return null;
  const x = identityOf(recorded, algo), y = identityOf(dropped, algo);
  if (x === null || y === null) return null;
  return x === y ? { same: true, by: algo } : { same: false, by: algo };
}
