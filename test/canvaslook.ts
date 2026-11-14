/**
 * The SHARED LOOK of a table's canvases (CANVAS-BRIEF.md Part A) — the contract,
 * pure: no server, no database. contract/canvasConfig.ts `lookOf` and friends.
 *
 *   L1  which look a canvas wears: its own (ownLook), its table's, or none
 *   L2  the readers (cardFieldsFor, hidesEmpty, …) work unchanged on a resolved look
 *   L3  where an edit is written, and that it leaves defaults and stacks alone
 *   L4  detach, attach, promote
 *   L5  the migration's test (hasLook) and the mutation's validation
 */
import { randomUUID } from 'node:crypto';
import {
  CanvasConfig, CanvasLook, lookOf, lookPart, hasLook, ownsLook, lookTarget, lookEdit, detachLook, attachLook, promoteLook,
  withoutLook, cardFieldsFor, hidesEmpty, pinnedFieldsFor, glowOf, rulesFor,
} from '../src/contract/canvasConfig.js';
import { Mutation } from '../src/contract/mutations.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const files = randomUUID(), works = randomUUID(), canvasId = randomUUID();
const fName = randomUUID(), fCodec = randomUUID(), fSize = randomUUID(), fStatus = randomUUID();
const fileFields = [{ id: fName }, { id: fCodec }, { id: fSize }, { id: fStatus }];
const def = { tableId: works, recordId: randomUUID() };
const stack = undefined;   // stacks ride along exactly like defaults; one is enough to test

const shared: CanvasLook = { cardFields: { [files]: [fCodec, fStatus] }, hideEmpty: true, pinnedFields: { [files]: [fStatus] }, glow: 'ring' };
const own = { cardFields: { [files]: [fSize] }, ownLook: true, defaults: [def] };
const sharing = { cardFields: { [files]: [fSize] }, defaults: [def] };   // old keys left behind, ownLook absent

console.log('\nL1. Which look a canvas wears');
check('ownLook → its own look', same(lookOf(own, shared), { cardFields: { [files]: [fSize] } }));
check('no ownLook → its table\'s look, whatever its own keys say', same(lookOf(sharing, shared), shared));
check('no ownLook, table has none (null) → nothing: today\'s defaults', same(lookOf(sharing, null), {}));
check('an empty config and no table look → nothing', same(lookOf(undefined, undefined), {}));
check('defaults and stacks are never part of a look', !('defaults' in lookOf(own, shared)) && !('defaults' in lookOf(sharing, shared)));
check('a broken table look reads as none, never throws', same(lookOf({}, { glow: 'neon' }), {}));
check('ownsLook / lookTarget', ownsLook(own) && !ownsLook(sharing) && lookTarget(own) === 'canvas' && lookTarget(sharing) === 'table');

console.log('\nL2. The readers work on a resolved look, unchanged');
const look = lookOf(sharing, shared);
check('cardFieldsFor: the shared choice', same(cardFieldsFor(look, files, fileFields, fName).map((f) => f.id), [fCodec, fStatus]));
check('cardFieldsFor: no choice → first fields minus the title', same(cardFieldsFor(lookOf({}, null), files, fileFields, fName).map((f) => f.id), [fCodec, fSize, fStatus]));
check('hidesEmpty / pinnedFieldsFor / glowOf read the shared values', hidesEmpty(look) && pinnedFieldsFor(look, files).has(fStatus) && glowOf(look) === 'ring');
check('rulesFor: none → []', rulesFor(look, files).length === 0);

console.log('\nL3. Where an edit goes');
const addSize = (l: CanvasLook): CanvasLook => ({ ...l, cardFields: { ...(l.cardFields ?? {}), [files]: [...(l.cardFields?.[files] ?? []), fSize] } });
const m1 = lookEdit(canvasId, sharing, works, shared, addSize);
check('sharing canvas → ONE table.update on its home table', m1.length === 1 && m1[0].type === 'table.update' && m1[0].id === works);
check('…carrying the whole shared look with the change', m1[0].type === 'table.update' && same(m1[0].canvasLook?.cardFields?.[files], [fCodec, fStatus, fSize]) && m1[0].canvasLook?.hideEmpty === true);
const m2 = lookEdit(canvasId, own, works, shared, addSize);
check('own-look canvas → ONE canvas.update on itself', m2.length === 1 && m2[0].type === 'canvas.update' && m2[0].id === canvasId);
check('…keeping ownLook, its defaults, and taking nothing from the table', m2[0].type === 'canvas.update' && m2[0].config.ownLook === true && same(m2[0].config.defaults, [def])
  && same(m2[0].config.cardFields[files], [fSize, fSize]) && m2[0].config.hideEmpty === undefined);
const m3 = lookEdit(canvasId, sharing, works, shared, () => ({}));
check('an edit that empties the shared look clears it (null), not {}', m3[0].type === 'table.update' && m3[0].canvasLook === null);
const m4 = lookEdit(canvasId, sharing, null, null, addSize);
check('no home table known → written on the canvas, which then keeps it', m4[0].type === 'canvas.update' && m4[0].config.ownLook === true);
check('every config produced still validates', [m2, m4].every((m) => m[0].type !== 'canvas.update' || CanvasConfig.safeParse(m[0].config).success));

console.log('\nL4. Detach, attach, promote');
const d = detachLook(canvasId, sharing, shared)[0];
check('detach: the shared look is copied in, ownLook ticked, defaults kept', d.config.ownLook === true && same(lookOf(d.config, null), shared) && same(d.config.defaults, [def]));
check('detach: what the cards wear does not change', same(lookOf(d.config, shared), lookOf(sharing, shared)));
const a = attachLook(canvasId, own)[0];
check('attach: own look gone, ownLook gone, defaults kept', !ownsLook(a.config) && !hasLook(a.config) && same(a.config.defaults, [def]));
check('attach: the canvas now wears the shared look', same(lookOf(a.config, shared), shared));
const p = promoteLook(canvasId, own, works);
check('promote: TWO mutations, table first (one batch, one Ctrl+Z)', p.length === 2 && p[0].type === 'table.update' && p[1].type === 'canvas.update');
check('promote: the table gets the canvas\'s look', p[0].type === 'table.update' && same(p[0].canvasLook, { cardFields: { [files]: [fSize] } }));
check('promote: the canvas looks exactly as before', p[1].type === 'canvas.update' && same(lookOf(p[1].config, p[0].canvasLook), lookOf(own, shared)));
check('promote: a canvas with an empty own look clears the shared one', promoteLook(canvasId, { ownLook: true }, works)[0].canvasLook === null);
check('withoutLook keeps defaults and stacks only', same(Object.keys(withoutLook({ ...own, glow: 'ring', stacks: stack })).sort(), ['cardFields', 'defaults']));

console.log('\nL5. The migration\'s test, and validation');
check('hasLook: cardFields with an entry', hasLook({ cardFields: { [files]: [fSize] } }));
check('hasLook: hideEmpty / glow / pins / rules each count', hasLook({ hideEmpty: true }) && hasLook({ glow: 'ring' }) && hasLook({ pinnedFields: { [files]: [fSize] } }));
check('hasLook: empty cardFields, hideEmpty false, defaults only → no', !hasLook({ cardFields: {} }) && !hasLook({ hideEmpty: false }) && !hasLook({ defaults: [def], cardFields: {} }));
check('lookPart drops the blank keys', same(lookPart({ cardFields: {}, hideEmpty: false, glow: 'ring', defaults: [def] }), { glow: 'ring' }));
const ok = Mutation.safeParse({ type: 'table.update', id: works, canvasLook: shared });
check('table.update { canvasLook } validates', ok.success, ok.success ? '' : ok.error.message);
check('table.update { canvasLook: null } validates (clear)', Mutation.safeParse({ type: 'table.update', id: works, canvasLook: null }).success);
check('a look may not carry defaults (they are per canvas)', !Mutation.safeParse({ type: 'table.update', id: works, canvasLook: { defaults: [def] } }).success);
check('a look\'s glow is checked', !Mutation.safeParse({ type: 'table.update', id: works, canvasLook: { glow: 'neon' } }).success);
check('canvas.update { config: { ownLook } } validates', Mutation.safeParse({ type: 'canvas.update', id: canvasId, config: { cardFields: {}, ownLook: true } }).success);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
