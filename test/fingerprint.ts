/**
 * contract/fingerprint.ts — pure: hashes maps, identity, the same-bytes verdict.
 */
import { Manifest } from '../src/contract/shapes.js';
import { FINGERPRINT, algorithmsOf, compareAlgorithm, compareManifests, hashesOf, identityOf, needsFingerprint, sizeOf } from '../src/contract/fingerprint.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const X = 'xxh3:' + 'ab'.repeat(8), X2 = 'xxh3:' + 'cd'.repeat(8), M = 'md5:' + '11'.repeat(16);

console.log('\nFP1. The hashes map');
check('the fingerprint is xxh3, fixed', FINGERPRINT === 'xxh3');
check('an older single `hash` reads as one entry of the map', JSON.stringify(hashesOf({ hash: M })) === JSON.stringify({ md5: M }));
check('…and the map wins beside it, both kept', JSON.stringify(hashesOf({ hash: M, hashes: { xxh3: X } })) === JSON.stringify({ md5: M, xxh3: X }));
const ok = Manifest.safeParse({ kind: 'file', size: 10, hashes: { xxh3: X, md5: M } });
check('a file manifest accepts a hashes map', ok.success, JSON.stringify(ok.error?.issues[0]));
check('…whose keys must be algorithm names and values hashes', !Manifest.safeParse({ kind: 'file', size: 10, hashes: { 'x y': X } }).success && !Manifest.safeParse({ kind: 'file', size: 10, hashes: { xxh3: 'nope' } }).success);
check('members take one too', Manifest.safeParse({ kind: 'channel_set', members: [{ path: 'L.wav', channel: 'L', hashes: { xxh3: X } }] }).success);

console.log('\nFP2. Identity');
const file = (hashes: Record<string, string> | undefined, size = 1000): Manifest => ({ kind: 'file', size, ...(hashes ? { hashes } : {}) });
const set = (hs: Array<Record<string, string> | undefined>): Manifest => ({ kind: 'channel_set', members: hs.map((h, i) => ({ path: `m${i}.wav`, channel: `c${i}`, size: 100, ...(h ? { hashes: h } : {}) })) });
check('a file\'s identity under an algorithm is its hash', identityOf(file({ xxh3: X }), 'xxh3') === X && identityOf(file({ xxh3: X }), 'md5') === null);
check('a set\'s identity is every member\'s path and hash — null unless EVERY member has one', identityOf(set([{ xxh3: X }, { xxh3: X2 }]), 'xxh3') === `m0.wav=${X}\nm1.wav=${X2}` && identityOf(set([{ xxh3: X }, undefined]), 'xxh3') === null);
check('a sequence has none', identityOf({ kind: 'sequence', pattern: 'p.%04d.exr', first: 1, last: 2, count: 2, gaps: [] }, 'xxh3') === null);
check('algorithmsOf: the fingerprint first, then the rest, only those EVERY member has', JSON.stringify(algorithmsOf(file({ md5: M, xxh3: X }))) === '["xxh3","md5"]' && JSON.stringify(algorithmsOf(set([{ xxh3: X, md5: M }, { xxh3: X2 }]))) === '["xxh3"]');
check('needsFingerprint: no xxh3 yet → yes; a sequence → never; an md5 alone does not count', needsFingerprint(file(undefined)) && needsFingerprint(file({ md5: M })) && !needsFingerprint(file({ xxh3: X })) && !needsFingerprint({ kind: 'sequence', pattern: 'p', first: 1, last: 1, count: 1, gaps: [] }) && needsFingerprint(set([{ xxh3: X }, undefined])));
check('sizeOf: a file\'s size, a set\'s total, null when a member has none', sizeOf(file(undefined, 7)) === 7 && sizeOf(set([{}, {}])) === 200 && sizeOf({ kind: 'channel_set', members: [{ path: 'a', channel: 'L' }] }) === null);

console.log('\nFP3. The verdict');
check('a record with no hash cannot be compared: null (the caller asks)', compareAlgorithm(file(undefined)) === null && compareManifests(file(undefined), file({ xxh3: X })) === null);
check('a different SIZE is a different file before any hash is read', JSON.stringify(compareManifests(file({ xxh3: X }, 10), file(undefined, 11))) === '{"same":false,"by":"size"}');
check('same size, same fingerprint → same, by xxh3', JSON.stringify(compareManifests(file({ xxh3: X }), file({ xxh3: X }))) === '{"same":true,"by":"xxh3"}');
check('same size, different fingerprint → differs, by xxh3', JSON.stringify(compareManifests(file({ xxh3: X }), file({ xxh3: X2 }))) === '{"same":false,"by":"xxh3"}');
check('an older record with only an md5 is compared on the md5 (compareAlgorithm says which to run)', compareAlgorithm(file({ md5: M })) === 'md5' && compareManifests(file({ md5: M }), file({ md5: M }))?.same === true);
check('the dropped thing not hashed under that algorithm → null', compareManifests(file({ xxh3: X }), file(undefined)) === null);
check('a set against a set: per member', compareManifests(set([{ xxh3: X }, { xxh3: X2 }]), set([{ xxh3: X }, { xxh3: X2 }]))?.same === true && compareManifests(set([{ xxh3: X }, { xxh3: X2 }]), set([{ xxh3: X }, { xxh3: X }]))?.same === false);
check('different kinds never compare', compareManifests(file({ xxh3: X }), set([{ xxh3: X }])) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
