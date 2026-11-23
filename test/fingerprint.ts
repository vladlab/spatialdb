/**
 * contract/fingerprint.ts — pure: the hashes map, and the fingerprint a file
 * dropped onto a record is compared by: size + modified date (Nov 23), never a hash.
 */
import { Manifest } from '../src/contract/shapes.js';
import { MODIFIED_TOLERANCE, compareFingerprints, fingerprintOf, formatModified, hashesOf, looksSame } from '../src/contract/fingerprint.js';
import { CHECKSUMS, toolsProblem } from '../src/contract/tools.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const j = (x: unknown) => JSON.stringify(x);

const X = 'xxh3:' + 'ab'.repeat(8), M = 'md5:' + '11'.repeat(16);
const T = 1_795_000_000;

console.log('\nFP1. The hashes map: checksums, run by hand, read by nothing');
check('the checksums a record offers: md5 first (what clients ask for), then xxh3, then sha256', CHECKSUMS.join() === 'md5,xxh3,sha256');
check('an older single `hash` reads as one entry of the map', j(hashesOf({ hash: M })) === j({ md5: M }));
check('…and the map wins beside it, both kept', j(hashesOf({ hash: M, hashes: { xxh3: X } })) === j({ md5: M, xxh3: X }));
check('a file manifest accepts a hashes map', Manifest.safeParse({ kind: 'file', size: 10, hashes: { xxh3: X, md5: M } }).success);
check('…whose keys must be algorithm names and values hashes', !Manifest.safeParse({ kind: 'file', size: 10, hashes: { 'x y': X } }).success && !Manifest.safeParse({ kind: 'file', size: 10, hashes: { xxh3: 'nope' } }).success);
check('members take one too', Manifest.safeParse({ kind: 'channel_set', members: [{ path: 'L.wav', channel: 'L', hashes: { xxh3: X } }] }).success);
check('a hash is still not a recipe step — the refusal no longer speaks of an automatic fingerprint', /a hash is not a recipe step — md5, xxh3 and sha256 run by hand/.test(String(toolsProblem({ file_drop: { steps: [{ analyzer: 'filesystem', map: {} }, { analyzer: 'hash-xxh3', map: {} }] } }, []))));

console.log('\nFP2. The stat in the manifest');
const stat = (bytes: number, modified?: number, files = 1) => ({ files, bytes, ...(modified === undefined ? {} : { modified }) });
const file = (size = 1000, modified?: number, hashes?: Record<string, string>): Manifest => ({ kind: 'file', size, ...(hashes ? { hashes } : {}), ...(modified === undefined ? {} : { stat: stat(size, modified) }) });
const seq = (count: number, st?: ReturnType<typeof stat>): Manifest => ({ kind: 'sequence', pattern: 'p.%04d.exr', first: 1, last: count, count, gaps: [], ...(st ? { stat: st } : {}) });
const set = (sizes: Array<number | undefined>, st?: ReturnType<typeof stat>): Manifest => ({ kind: 'channel_set', members: sizes.map((size, i) => ({ path: `m${i}.wav`, channel: `c${i}`, ...(size === undefined ? {} : { size }) })), ...(st ? { stat: st } : {}) });
check('every kind of manifest accepts a stat: files, bytes, and the newest modified time', [file(10, T), seq(3, stat(30, T, 3)), set([1, 2], stat(3, T, 2)), { kind: 'bundle', members: [{ path: 'a.mxf', size: 5 }], stat: stat(5, T) }].every((m) => Manifest.safeParse(m).success));
check('…`modified` may be absent (a filesystem that will not say); anything else in it is refused', Manifest.safeParse({ kind: 'file', size: 10, stat: { files: 1, bytes: 10 } }).success && !Manifest.safeParse({ kind: 'file', size: 10, stat: { files: 1, bytes: 10, created: T } }).success && !Manifest.safeParse({ kind: 'file', size: 10, stat: { files: 1, bytes: -1 } }).success);
check('a manifest with no stat (made before Nov 23) is still valid', Manifest.safeParse({ kind: 'file', size: 10 }).success);

console.log('\nFP3. The fingerprint: what a manifest says its files measure');
check('from the stat when there is one', j(fingerprintOf(file(1000, T))) === j({ kind: 'file', files: 1, bytes: 1000, modified: T }));
check('an older file manifest still gives its size — and no date', j(fingerprintOf(file(7))) === j({ kind: 'file', files: 1, bytes: 7, modified: null }));
check('an older set: its member count, and the total only when EVERY member has a size', j(fingerprintOf(set([100, 100]))) === j({ kind: 'channel_set', files: 2, bytes: 200, modified: null }) && fingerprintOf(set([100, undefined]))?.bytes === null);
check('an older sequence: its frame count, no size (its manifest never had one) — the stat is where a sequence gets it', j(fingerprintOf(seq(8))) === j({ kind: 'sequence', files: 8, bytes: null, modified: null }) && fingerprintOf(seq(8, stat(8000, T, 8)))?.bytes === 8000);
check('no manifest, no fingerprint', fingerprintOf(null) === null && fingerprintOf(undefined) === null);

console.log('\nFP4. The verdict — evidence, not proof, and it reads nothing');
check('same size, same date → same', j(compareFingerprints(file(1000, T), file(1000, T))) === j({ verdict: 'same', differs: [] }));
check(`the date gets ${MODIFIED_TOLERANCE} s of tolerance (filesystems round it differently) — and no more`, compareFingerprints(file(1000, T), file(1000, T + 2)).verdict === 'same' && compareFingerprints(file(1000, T + 2), file(1000, T)).verdict === 'same' && j(compareFingerprints(file(1000, T), file(1000, T + 3))) === j({ verdict: 'differs', differs: ['modified'] }));
check('another size → differs, by size', j(compareFingerprints(file(1000, T), file(1001, T))) === j({ verdict: 'differs', differs: ['size'] }));
check('size AND date → both named, in that order', j(compareFingerprints(file(1000, T), file(2000, T + 60)).differs) === j(['size', 'modified']));
check('the hashes a manifest carries play NO part: same size and date with different md5s is still "same"', compareFingerprints(file(1000, T, { md5: M }), file(1000, T, { md5: 'md5:' + '22'.repeat(16) })).verdict === 'same');
check('a record from before dates were kept: the same size is "same-size" — by size alone, and it says so', j(compareFingerprints(file(1000), file(1000, T))) === j({ verdict: 'same-size', differs: [] }) && compareFingerprints(file(1000, T), file(1000)).verdict === 'same-size');
check('…and another size still differs', compareFingerprints(file(1000), file(999, T)).verdict === 'differs');
check('looksSame: same and same-size read as a move; differs and unknown do not', looksSame(compareFingerprints(file(1, T), file(1, T))) && looksSame(compareFingerprints(file(1), file(1, T))) && !looksSame(compareFingerprints(file(1, T), file(2, T))) && !looksSame(compareFingerprints(null, file(1, T))));
check('a set: count + total + newest date', compareFingerprints(set([1, 2], stat(3, T, 2)), set([1, 2], stat(3, T, 2))).verdict === 'same' && j(compareFingerprints(seq(8, stat(8000, T, 8)), seq(9, stat(9000, T, 9))).differs) === j(['files', 'size']));
check('a sequence recorded before the stat has no size: a matching count is NOT enough — unknown, so the drop asks to replace', j(compareFingerprints(seq(8), seq(8, stat(8000, T, 8)))) === j({ verdict: 'unknown', differs: [] }) && compareFingerprints(seq(8), seq(9, stat(9000, T, 9))).verdict === 'differs');
check('different kinds differ', compareFingerprints(file(6, T), set([1, 2, 3], stat(6, T, 3))).differs.includes('kind'));
check('no manifest on either side → unknown', compareFingerprints(null, file(1, T)).verdict === 'unknown' && compareFingerprints(file(1, T), undefined).verdict === 'unknown');

console.log('\nFP5. A date the person can read');
check('formatModified: local date and time to the second', /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(formatModified(T)) && formatModified(T) !== formatModified(T + 1));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
