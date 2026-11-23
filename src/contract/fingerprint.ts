/**
 * ============================================================================
 *  The fingerprint: how the app decides whether a file is the one a record
 *  describes. SIZE AND MODIFIED DATE — a stat, never a read.
 * ============================================================================
 *
 *  The owner, Nov 23 (superseding Oct 18's "an xxh3 of every file, run
 *  automatically"): hashing a large ProRes off the NAS takes ten minutes and
 *  more, and that is the storage reading the whole file — no faster algorithm
 *  fixes it. So NOTHING IS HASHED BY DEFAULT, and identity is what viznotes
 *  used: how big the file is and when it was last modified, shown before and
 *  after in a dialog the person confirms.
 *
 *  What is compared (`Stat`, contract/shapes.ts — written by the desktop's
 *  classifier into the manifest): the number of files, the total bytes, and the
 *  newest modification time. For one file that is its size and date; for a
 *  sequence, an IMF/DCP folder or a channel set it is count + total + newest —
 *  good enough, by the owner's word.
 *
 *  It is EVIDENCE, not proof, and the code treats it so:
 *   - nothing is ever updated silently on the strength of it — the drop rules
 *     (client/tools/fileDrop.ts) always ask, with both sides on screen;
 *   - the modified time gets 2 seconds of tolerance, because filesystems round
 *     it differently (FAT to 2 s, some NAS exports to 1 s);
 *   - a record made before the date was kept compares on size alone and says so.
 *
 *  Hashes (md5, xxh3, sha256) are a different thing now: checksums run by hand
 *  from the record, kept in the manifest, never read to decide anything. One
 *  rule ties them to the fingerprint: a hash is only stored while the file at
 *  the path still has the fingerprint the record holds, and a Replace clears
 *  them — so a stored hash always describes the file the record describes.
 *
 *  Pure, so the server, the web app and the tests share one definition.
 */

import type { Manifest } from './shapes.js';

type HashedThing = { hash?: string; hashes?: Record<string, string> };

/** Every hash a file carries, keyed by algorithm — the `hashes` map plus the older single `hash`. */
export function hashesOf(x: HashedThing | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!x) return out;
  if (typeof x.hash === 'string') { const algo = x.hash.split(':')[0]; if (algo) out[algo] = x.hash; }
  if (x.hashes) Object.assign(out, x.hashes);
  return out;
}

/** Seconds two modification times may differ by and still be the same moment. */
export const MODIFIED_TOLERANCE = 2;

/** What a manifest says its files measure; `null` where it does not say. */
export interface Fingerprint { kind: Manifest['kind']; files: number | null; bytes: number | null; modified: number | null }

/**
 * A manifest's fingerprint: its `stat` when the desktop wrote one, else what the
 * older shape still tells — a file's size, a set's member count and (when every
 * member has a size) their total, a sequence's frame count. Never a date: only
 * the stat has one.
 */
export function fingerprintOf(m: Manifest | undefined | null): Fingerprint | null {
  if (!m) return null;
  if (m.stat) return { kind: m.kind, files: m.stat.files, bytes: m.stat.bytes, modified: m.stat.modified ?? null };
  if (m.kind === 'file') return { kind: m.kind, files: 1, bytes: m.size, modified: null };
  if (m.kind === 'sequence') return { kind: m.kind, files: m.count, bytes: null, modified: null };
  let bytes: number | null = 0;
  for (const x of m.members) { if (typeof x.size !== 'number') { bytes = null; break; } bytes += x.size; }
  return { kind: m.kind, files: m.members.length, bytes, modified: null };
}

export type Difference = 'kind' | 'files' | 'size' | 'modified';

/**
 *   same       size and date agree (and the count, and the kind)
 *   same-size  the sizes agree and nothing known differs, but one side has no date
 *   differs    something known differs — `differs` names what
 *   unknown    there is no size on one side to compare (no manifest; an old sequence)
 */
export interface Comparison { verdict: 'same' | 'same-size' | 'differs' | 'unknown'; differs: Difference[] }

/** The recorded manifest against a fresh one of the dropped thing. Reads nothing. */
export function compareFingerprints(recorded: Manifest | undefined | null, dropped: Manifest | undefined | null): Comparison {
  const a = fingerprintOf(recorded), b = fingerprintOf(dropped);
  if (!a || !b) return { verdict: 'unknown', differs: [] };
  const differs: Difference[] = [];
  if (a.kind !== b.kind) differs.push('kind');
  if (a.files !== null && b.files !== null && a.files !== b.files) differs.push('files');
  if (a.bytes !== null && b.bytes !== null && a.bytes !== b.bytes) differs.push('size');
  if (a.modified !== null && b.modified !== null && Math.abs(a.modified - b.modified) > MODIFIED_TOLERANCE) differs.push('modified');
  if (differs.length) return { verdict: 'differs', differs };
  if (a.bytes === null || b.bytes === null) return { verdict: 'unknown', differs };
  return { verdict: a.modified !== null && b.modified !== null ? 'same' : 'same-size', differs };
}

/** The two verdicts that read as "the same file": a move or a rename, not a replacement. */
export const looksSame = (c: Comparison): boolean => c.verdict === 'same' || c.verdict === 'same-size';

const two = (n: number) => String(n).padStart(2, '0');
/** A modification time as the person's own clock shows it: "2026-11-23 13:20:05". */
export function formatModified(secs: number): string {
  const d = new Date(secs * 1000);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}
