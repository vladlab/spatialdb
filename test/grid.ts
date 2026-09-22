/**
 * The grid suite: view semantics, keyset paging, whole-table loading, saved views.
 *
 * Four layers, because the grid's correctness lives in four places:
 *   G1  contract/views.ts   — pure sort/filter. No server.
 *   G2  GET …/records       — the cursor, over real HTTP against real Postgres.
 *   G3  store.loadTable     — the walk, and the two stale-page races it guards.
 *   G4  views on the wire   — they survive a refresh; bad configs are refused.
 *
 * Several checks here have a CONTROL: the same scenario through the path that is
 * expected to be wrong (offset paging; ingest without the guard). A test that
 * only shows the fix working cannot tell "the fix works" from "the scenario
 * never triggers the bug".
 */

import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { bootServer, type ServerHandle } from './harness.js';
import { applyView, quickSearch, ViewConfig, type ViewField, ancestorsOf, canMakeColumns, groupRows, kanbanColumns, type GroupHeader } from '../src/contract/views.js';
import { lookupConfigError, lookupText, lookupValues } from '../src/contract/lookups.js';
import { backlinkConfigError, backlinkRecords } from '../src/contract/backlinks.js';
import { fuzzyRank, fuzzyScore, parsePaletteQuery } from '../src/client/fuzzy.js';
import {
  AudioLayout, FILES_STANDARD_FIELDS, addPreset, diffLayouts, flattenChannels, formatBytes, formatNumberField, mergeTracks, moveTrack,
  shapeOptionError, splitTrack, structuredError, summarise, type AudioLayout as Layout,
} from '../src/contract/shapes.js';
import { FIELD_TYPES } from '../src/contract/mutations.js';
import { assetIdsIn, attachmentError, isEmptyRichText, richTextError, richTextToPlain } from '../src/contract/richtext.js';
import { compareFields, labelFrom, primaryKeyOf } from '../src/contract/labels.js';
import { emptyState, ingestPage, recordsOf, viewsOf } from '../src/client/state.js';
import { createStore } from '../src/client/store.js';

// The server this suite boots inherits the environment: give it a throwaway
// assets directory, or uploads made here would land in the real .pg/assets.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const GRID_ASSETS = mkdtempSync(join(tmpdir(), 'spatialdb-grid-assets-'));
process.env.SPATIALDB_ASSETS_DIR = GRID_ASSETS;
process.on('exit', () => rmSync(GRID_ASSETS, { recursive: true, force: true }));

const PORT = Number(process.env.TEST_PORT ?? 8803);
const API = `http://localhost:${PORT}`;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
/** Key-order-independent: jsonb does not preserve the order keys were written in. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);

const pool = new pg.Pool({ connectionString: process.env.DB_URL });
let server: ServerHandle | undefined;

async function mutate(mutations: unknown[]) {
  const res = await fetch(`${API}/api/mutate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: randomUUID(), mutations: mutations.map((mutation) => ({ id: randomUUID(), mutation })) }),
  });
  return { status: res.status, body: await res.json() };
}
const page = async (tableId: string, qs: string) =>
  (await fetch(`${API}/api/tables/${tableId}/records?${qs}`));

/* ────────────────────────────────────────────────────────────────────────────
 *  G1 — pure
 * ──────────────────────────────────────────────────────────────────────────*/

function pure() {
  console.log('\nG1. applyView — sort');
  const F = {
    name:   { id: randomUUID(), key: 'name',   type: 'text' },
    frames: { id: randomUUID(), key: 'frames', type: 'number' },
    due:    { id: randomUUID(), key: 'due',    type: 'date' },
    status: { id: randomUUID(), key: 'status', type: 'select', options: { choices: ['todo', 'doing', 'done'] } },
    ok:     { id: randomUUID(), key: 'ok',     type: 'checkbox' },
    tags:   { id: randomUUID(), key: 'tags',   type: 'multi_select' },
    src:    { id: randomUUID(), key: 'src',    type: 'link' },
  } satisfies Record<string, ViewField>;
  const fields: ViewField[] = Object.values(F);
  const rec = (id: string, data: Record<string, unknown>) => ({ id, data });
  const recs = [
    rec('a', { name: 'reel_10', frames: 100, due: '2026-03-01', status: 'done', ok: true, tags: ['vfx'] }),
    rec('b', { name: 'reel_2', frames: 9, due: '2026-01-15', status: 'todo', ok: false }),
    rec('c', { name: 'Reel_1', status: 'doing', tags: ['audio', 'vfx'] }),
    rec('d', {}),
  ];
  const cfg = (c: Partial<ViewConfig>) => ViewConfig.parse(c);
  const order = (c: Partial<ViewConfig>, links?: Parameters<typeof applyView>[3]) =>
    applyView(recs, fields, cfg(c), links).map((r) => r.id).join('');

  check('no sort, no filter: the incoming order, untouched', order({}) === 'abcd');
  check('text sorts NATURALLY — reel_2 before reel_10, case-insensitive',
    order({ sort: [{ fieldId: F.name.id, dir: 'asc' }] }) === 'cbad',
    order({ sort: [{ fieldId: F.name.id, dir: 'asc' }] }));
  check('numbers sort as numbers (9 < 100), empties last',
    order({ sort: [{ fieldId: F.frames.id, dir: 'asc' }] }) === 'bacd');
  check('descending reverses the VALUES but empties still sort last',
    order({ sort: [{ fieldId: F.frames.id, dir: 'desc' }] }) === 'abcd',
    order({ sort: [{ fieldId: F.frames.id, dir: 'desc' }] }));
  check('select sorts by choice order, not alphabetically (todo, doing, done)',
    order({ sort: [{ fieldId: F.status.id, dir: 'asc' }] }) === 'bcad');
  check('checkbox: unticked before ticked; never-answered last',
    order({ sort: [{ fieldId: F.ok.id, dir: 'asc' }] }) === 'bacd');
  check('ties fall through to the next sort key',
    applyView(
      [rec('x', { status: 'todo', frames: 5 }), rec('y', { status: 'todo', frames: 1 })],
      fields, cfg({ sort: [{ fieldId: F.status.id, dir: 'asc' }, { fieldId: F.frames.id, dir: 'asc' }] }),
    ).map((r) => r.id).join('') === 'yx');
  const before = JSON.stringify(recs);
  order({ sort: [{ fieldId: F.name.id, dir: 'desc' }] });
  check('the input array is not mutated', JSON.stringify(recs) === before);

  console.log('\nG1b. applyView — filter');
  const only = (f: ViewConfig['filters'][number], links?: Parameters<typeof applyView>[3]) =>
    order({ filters: [f] }, links);
  check('contains is a case-insensitive substring', only({ fieldId: F.name.id, op: 'contains', value: 'REEL_1' }) === 'ac');
  check('number gt compares numerically ("9" > "100" as strings)', only({ fieldId: F.frames.id, op: 'gt', value: 50 }) === 'a');
  check('date lte compares as calendar dates', only({ fieldId: F.due.id, op: 'lte', value: '2026-02-01' }) === 'b');
  check('select eq', only({ fieldId: F.status.id, op: 'eq', value: 'doing' }) === 'c');
  check('neq INCLUDES rows with no value — "not done" means the untouched ones too',
    only({ fieldId: F.status.id, op: 'neq', value: 'done' }) === 'bcd');
  check('checkbox "not ticked" matches false AND never-answered',
    only({ fieldId: F.ok.id, op: 'eq', value: false }) === 'bcd');
  check('multi_select has', only({ fieldId: F.tags.id, op: 'has', value: 'vfx' }) === 'ac');
  check('empty / notEmpty', only({ fieldId: F.tags.id, op: 'empty' }) === 'bd'
    && only({ fieldId: F.tags.id, op: 'notEmpty' }) === 'ac');
  check('a half-built filter (no value yet) hides nothing',
    only({ fieldId: F.frames.id, op: 'gt' }) === 'ab'
      // …except rows with no value at all, which no comparison can match.
      && only({ fieldId: F.name.id, op: 'contains' }) === 'abc');
  check('filters are ANDed',
    order({ filters: [{ fieldId: F.tags.id, op: 'has', value: 'vfx' }, { fieldId: F.status.id, op: 'eq', value: 'done' }] }) === 'a');

  const links = (id: string, fieldId: string) => (fieldId === F.src.id && id === 'b' ? ['master_graded.mov'] : []);
  check('link fields filter on the far label, which lives outside record.data',
    only({ fieldId: F.src.id, op: 'contains', value: 'graded' }, links) === 'b'
    && only({ fieldId: F.src.id, op: 'empty' }, links) === 'acd');

  check('an entry naming a deleted field is ignored, not an error',
    order({ sort: [{ fieldId: randomUUID(), dir: 'desc' }], filters: [{ fieldId: randomUUID(), op: 'eq', value: 'x' }] }) === 'abcd');
  check('quickSearch matches any shown value, and link labels',
    quickSearch(recs, fields, 'AUDIO').map((r) => r.id).join('') === 'c'
    && quickSearch(recs, fields, 'graded', links).map((r) => r.id).join('') === 'b'
    && quickSearch(recs, fields, '  ').length === 4);

  console.log('\nG1d. What a record is called (contract/labels.ts)');
  const lf = (key: string, type: string, position: number, name = key) => ({ key, type, position, name });
  check('the primary field is the first by position…',
    primaryKeyOf([lf('path', 'file_path', 2), lf('title', 'text', 1)]) === 'title');
  check('…that holds a plain value: links, checkboxes and sets are skipped',
    primaryKeyOf([lf('src', 'link', 0), lf('ok', 'checkbox', 1), lf('tags', 'multi_select', 2), lf('n', 'number', 3)]) === 'n');
  check('it does NOT favour a field called "name" — position is the whole rule',
    primaryKeyOf([lf('name', 'text', 5), lf('code', 'text', 1)]) === 'code');
  check('tied positions break by name, identically on server and client (code points, not locale)',
    primaryKeyOf([lf('b', 'text', 0, 'Zed'), lf('a', 'text', 0, 'alpha'), lf('c', 'text', 0, 'Beta')]) === 'c'
    && [lf('x', 'text', 0, 'a'), lf('y', 'text', 0, 'B')].sort(compareFields)[0].key === 'y');
  check('a table with no plain-valued field has no primary', primaryKeyOf([lf('src', 'link', 0)]) === undefined);
  check('the label is the primary value as text; an empty one falls back',
    labelFrom({ n: 42 }, 'n', 'fb') === '42' && labelFrom({}, 'n', 'fb') === 'fb'
    && labelFrom({ n: '' }, 'n', 'fb') === 'fb' && labelFrom({ n: 1 }, undefined, 'fb') === 'fb');
  // The bug this replaced: "first string in data" depended on KEY order, which
  // jsonb rewrites. The same record, keys in either order, must get one label.
  check('key order in the stored object is irrelevant',
    labelFrom({ zz: 'second', a: 'first' }, 'zz', '') === labelFrom({ a: 'first', zz: 'second' }, 'zz', ''));

  console.log('\nG1e. Lookups (contract/lookups.ts)');
  const T1 = 'table-files', T2 = 'table-specs';
  const fld = (id: string, table_id: string, type: string, options: Record<string, unknown> = {}) => ({ id, table_id, key: id, type, options });
  const all = [
    fld('spec', T1, 'link', { target_table_id: T2 }), fld('title', T1, 'text'),
    fld('codec', T2, 'text'), fld('specs_files', T2, 'link', { target_table_id: T1 }), fld('chain', T2, 'lookup'),
  ];
  const get = (id: string) => all.find((f) => f.id === id);
  const cfgErr = (via: string, target: string) => lookupConfigError(T1, { via_field_id: via, target_field_id: target }, get);
  check('a sound lookup is accepted', cfgErr('spec', 'codec') === null, String(cfgErr('spec', 'codec')));
  check('it must follow a LINK field', /LINK/.test(cfgErr('title', 'codec') ?? ''));
  check('…on its OWN table', /same table/.test(cfgErr('specs_files', 'codec') ?? ''));
  check('and show a field of the table that link points AT', /points at/.test(cfgErr('spec', 'title') ?? ''));
  check('not another lookup, and not a link (no chains, no second hop)',
    /cannot show a lookup/.test(cfgErr('spec', 'chain') ?? '') && /cannot show a link/.test(cfgErr('spec', 'specs_files') ?? ''));
  check('missing or dangling ids are errors, not crashes',
    !!lookupConfigError(T1, {}, get) && !!cfgErr('nope', 'codec') && !!cfgErr('spec', 'nope'));

  const lk = { ...fld('lk', T1, 'lookup', { via_field_id: 'spec', target_field_id: 'codec' }) };
  const linked = (rec: string, via: string) => (rec === 'f1' && via === 'spec' ? ['s1', 's2', 's3', 'unloaded'] : []);
  const farData: Record<string, Record<string, unknown>> = { s1: { codec: 'prores' }, s2: {}, s3: { codec: 'dnxhr' } };
  const vals = lookupValues(lk, 'f1', get, linked, (id) => farData[id]);
  check('values come back in link order; empty far cells and unloaded far records are skipped',
    JSON.stringify(vals) === '["prores","dnxhr"]', JSON.stringify(vals));
  check('nothing linked is an EMPTY list', JSON.stringify(lookupValues(lk, 'f2', get, linked, (id) => farData[id])) === '[]');
  check('a lookup whose link field or far field is gone is NULL — broken, not empty',
    lookupValues({ ...lk, options: { via_field_id: 'gone', target_field_id: 'codec' } }, 'f1', get, linked, () => ({})) === null
    && lookupValues({ ...lk, options: { via_field_id: 'spec', target_field_id: 'gone' } }, 'f1', get, linked, () => ({})) === null);
  check('a far multi_select is flattened; booleans read as words',
    JSON.stringify(lookupValues(lk, 'f1', get, () => ['m'], () => ({ codec: ['a', 'b'] }))) === '["a","b"]'
    && lookupText([true, false, 5]).join() === 'yes,no,5');
  // Through applyView: a lookup sorts and filters by its text, like a link does.
  const lkField: ViewField = { id: randomUUID(), key: 'lk', type: 'lookup' };
  const derived = (id: string) => (id === 'a' ? ['1920'] : id === 'b' ? ['3840'] : []);
  const viaView = (c: Partial<ViewConfig>) => applyView([{ id: 'c', data: {} }, { id: 'b', data: {} }, { id: 'a', data: {} }],
    [lkField], ViewConfig.parse(c), (rec) => derived(rec)).map((r) => r.id).join('');
  check('sorting by a lookup column orders by its value, empties last',
    viaView({ sort: [{ fieldId: lkField.id, dir: 'asc' }] }) === 'abc' && viaView({ sort: [{ fieldId: lkField.id, dir: 'desc' }] }) === 'bac');
  check('filtering by one works too', viaView({ filters: [{ fieldId: lkField.id, op: 'contains', value: '38' }] }) === 'b'
    && viaView({ filters: [{ fieldId: lkField.id, op: 'empty' }] }) === 'c');

  console.log('\nG1f. Backlinks (contract/backlinks.ts)');
  const bErr = (src: string, table = T2) => backlinkConfigError(table, { source_field_id: src }, get);
  check('a backlink on the table a link POINTS AT is accepted', bErr('spec') === null, String(bErr('spec')));
  check('it must mirror a LINK field', /LINK/.test(bErr('codec') ?? ''));
  check('…one that points at THIS table', /does not point at this table/.test(bErr('spec', T1) ?? ''));
  check('nothing chosen asks for a choice; a dangling id is an error', /needs the link field/.test(backlinkConfigError(T2, {}, get) ?? '') && !!bErr('nope'));
  const self = [fld('prev', 'edits', 'link', { target_table_id: 'edits' })];
  check('a link from a table to ITSELF can be mirrored (previous version ↔ next version)',
    backlinkConfigError('edits', { source_field_id: 'prev' }, (id) => self.find((f) => f.id === id)) === null);
  const bl = fld('used_by', T2, 'backlink', { source_field_id: 'spec' });
  const into = (rec: string, via: string) => (rec === 's1' && via === 'spec' ? ['f1', 'f2'] : []);
  check('it lists the records linking IN through that field',
    JSON.stringify(backlinkRecords(bl, 's1', get, into)) === '["f1","f2"]' && JSON.stringify(backlinkRecords(bl, 's9', get, into)) === '[]');
  check('and is NULL — broken, not empty — when the link field is gone',
    backlinkRecords({ options: { source_field_id: 'deleted' } }, 's1', get, into) === null);

  console.log('\nG1g. The palette\'s table matching (client/fuzzy.ts)');
  const names = ['Edits', "Elvis isn't dead yet", 'Deliverables', 'Files', 'Edit notes'];
  check('"edit" ranks the table that STARTS with it first, the shorter one ahead',
    fuzzyRank('edit', names, (x) => x).slice(0, 2).join() === 'Edits,Edit notes', fuzzyRank('edit', names, (x) => x).join());
  check('a subsequence still matches — just ranked below', fuzzyScore('edit', "Elvis isn't dead yet... it") > 0
    && fuzzyScore('edit', 'Edits') > fuzzyScore('edit', "Elvis isn't dead yet... it"));
  check('word starts count: "dn" finds "Edit notes"? no — but "en" does', fuzzyScore('dn', 'Files') === 0 && fuzzyRank('en', names, (x) => x)[0] === 'Edit notes',
    fuzzyRank('en', names, (x) => x).join());
  check('characters out of order do not match', fuzzyScore('tide', 'Edits') === 0);
  const pq = (q: string) => parsePaletteQuery(q, names, (x) => x);
  check('"edit:oev3" scopes to matching tables and searches for the rest',
    pq('edit:oev3').scoped && pq('edit:oev3').tables[0] === 'Edits' && pq('edit:oev3').text === 'oev3');
  check('"edit:" alone is a scope with no text (newest records of those tables)', pq('edit:').scoped && pq('edit:').text === '');
  check('a colon after something that matches NO table is just text', !pq('12:30 call').scoped && pq('12:30 call').text === '12:30 call');
  check('no colon: search everywhere', !pq('oev3').scoped && pq('oev3').text === 'oev3');

  console.log('\nG1h. Rich text and attachments (contract/richtext.ts)');
  const A1 = '11111111-1111-4111-8111-111111111111', A2 = '22222222-2222-4222-8222-222222222222';
  const para = (text: string, marks?: unknown[]) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });
  const docOf = (...content: unknown[]) => ({ type: 'doc', content });
  const img = (attrs: Record<string, unknown>) => ({ type: 'image', attrs });
  check('a document with an asset-backed image is fine', richTextError('n', docOf(para('see below'), img({ assetId: A1, width: 800, height: 600 }))) === null);
  check('anything that is not a document is refused', !!richTextError('n', 'just a string') && !!richTextError('n', { type: 'paragraph' }) && !!richTextError('n', []));
  check('an image may NOT carry a src — the file must be an asset', /asset by id/.test(richTextError('n', docOf(img({ assetId: A1, src: '/x.png' }))) ?? ''));
  check('nor smuggle bytes in as a data: URI, in any attribute',
    /asset/.test(richTextError('n', docOf(img({ src: 'data:image/png;base64,AAAA' }))) ?? '')
    && /embedded data/.test(richTextError('n', docOf({ type: 'paragraph', attrs: { bg: 'data:image/png;base64,AAAA' }, content: [] })) ?? ''));
  check('an image with no (or a malformed) asset id is refused', !!richTextError('n', docOf(img({}))) && !!richTextError('n', docOf(img({ assetId: 'nope' }))));
  check('links: http(s)/mailto pass, javascript: does not',
    richTextError('n', docOf(para('x', [{ type: 'link', attrs: { href: 'https://example.com' } }]))) === null
    && /not allowed/.test(richTextError('n', docOf(para('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))) ?? ''));
  check('a document over the size bound is refused, with the reason', /larger than/.test(richTextError('n', docOf(para('x'.repeat(1_100_000)))) ?? ''));
  check('an unknown node type is NOT an error (the editor drops it; the server need not track the schema)',
    richTextError('n', docOf({ type: 'someFutureNode', content: [] })) === null);

  const table = { type: 'table', content: [{ type: 'tableRow', content: [
    { type: 'tableCell', content: [para('codec')] }, { type: 'tableCell', content: [para('ProRes 4444')] }] }] };
  const plain = richTextToPlain(docOf({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Delivery notes' }] },
    para('Per the email from QC:'), table, img({ assetId: A1 }), para('')));
  check('as plain text: blocks are lines, table cells are separated, an image is visible',
    plain.startsWith('Delivery notes\nPer the email from QC:') && /codec\s+ProRes 4444/.test(plain) && plain.includes('[image]'), JSON.stringify(plain));
  check('a note that is ONLY a screenshot is not "empty"; an opened-and-abandoned editor is',
    !isEmptyRichText(docOf(img({ assetId: A1 }))) && isEmptyRichText(docOf({ type: 'paragraph' })) && isEmptyRichText(undefined));
  check('assetIdsIn finds every image, at any depth', assetIdsIn('rich_text', docOf(img({ assetId: A1 }), { type: 'blockquote', content: [img({ assetId: A2 })] })).join() === `${A1},${A2}`);

  check('an attachment value is a list of asset ids', attachmentError('f', [A1, A2]) === null && assetIdsIn('attachment', [A1, A2]).length === 2);
  check('— unique, and nothing but ids', /more than once/.test(attachmentError('f', [A1, A1]) ?? '') && !!attachmentError('f', ['x']) && !!attachmentError('f', A1));

  const rt: ViewField = { id: randomUUID(), key: 'notes', type: 'rich_text' };
  const noted = [{ id: 'x', data: { notes: docOf(para('zebra crossing')) } }, { id: 'y', data: { notes: docOf(para('apple')) } }, { id: 'z', data: {} }];
  check('a rich text column sorts and filters by its TEXT, empties last',
    applyView(noted, [rt], ViewConfig.parse({ sort: [{ fieldId: rt.id, dir: 'asc' }] })).map((r) => r.id).join('') === 'yxz'
    && applyView(noted, [rt], ViewConfig.parse({ filters: [{ fieldId: rt.id, op: 'contains', value: 'ZEBRA' }] })).map((r) => r.id).join('') === 'x'
    && quickSearch(noted, [rt], 'apple').map((r) => r.id).join('') === 'y');

  console.log('\nG1i. Grouping (contract/views.ts: groupRows)');
  const gStatus: ViewField = { id: randomUUID(), key: 'status', type: 'select' };
  const gWork: ViewField = { id: randomUUID(), key: 'work', type: 'link' };
  const gOk: ViewField = { id: randomUUID(), key: 'ok', type: 'checkbox' };
  const gTags: ViewField = { id: randomUUID(), key: 'tags', type: 'multi_select' };
  const gFields = [gStatus, gWork, gOk, gTags];
  const gRecs = [
    { id: 'a', data: { status: 'online', tags: ['x', 'y'] } }, { id: 'b', data: { status: 'offline', ok: true, tags: ['y', 'x'] } },
    { id: 'c', data: { status: 'online', ok: true } }, { id: 'd', data: {} }, { id: 'e', data: { status: 'online' } },
  ];
  // links: a→ep2 · b→ep10 · c→ep2+ep10 · e→ep10+ep2 (other order) · d→nothing
  const gLinks: Record<string, string[]> = { a: ['ep2'], b: ['ep10'], c: ['ep2', 'ep10'], e: ['ep10', 'ep2'] };
  const gIds = (rec: string) => gLinks[rec] ?? [];
  const gLabels = (rec: string) => gIds(rec).map((id) => (id === 'ep2' ? 'Ep 2' : 'Ep 10'));
  const shape = (its: ReturnType<typeof groupRows>) => its.map((it) => (it.kind === 'group' ? `${'>'.repeat(it.level + 1)}${it.label}(${it.count})` : (it.record as { id: string }).id)).join(' ');

  check('ungrouped, it is just the rows, in the order given', shape(groupRows(gRecs, gFields, [])) === 'a b c d e');
  check('grouped by a select: a header per value with its COUNT, rows keep their order, the empty group is LAST',
    shape(groupRows(gRecs, gFields, [gStatus.id])) === '>offline(1) b >online(3) a c e >(empty)(1) d', shape(groupRows(gRecs, gFields, [gStatus.id])));
  const byWork = groupRows(gRecs, gFields, [gWork.id], gLabels, gIds);
  check('grouped by a LINK: natural order ("Ep 2" before "Ep 10"), and a record linked to two works is ONE group — the combination — not two rows',
    shape(byWork) === '>Ep 2(1) a >Ep 2, Ep 10(2) c e >Ep 10(1) b >(empty)(1) d', shape(byWork));
  check('…the combination is keyed by the target IDS, so link order does not split it (c and e are together)',
    byWork.filter((it) => it.kind === 'row').length === 5 && new Set(byWork.filter((it) => it.kind === 'row').map((it) => (it as any).record.id)).size === 5);
  const combo = byWork.find((it): it is GroupHeader => it.kind === 'group' && it.count === 2)!;
  check('a link group knows WHICH records it stands for — what a record added there is linked to', combo.value.kind === 'links' && combo.value.ids.join() === 'ep10,ep2', JSON.stringify(combo.value));
  check('a multi-select groups by its SET, whatever order it was ticked in', shape(groupRows(gRecs, gFields, [gTags.id])) === '>x, y(2) a b >(empty)(3) c d e', shape(groupRows(gRecs, gFields, [gTags.id])));
  check('a checkbox has exactly two groups — unticked is a value, not "empty"', shape(groupRows(gRecs, gFields, [gOk.id])) === '>checked(2) b c >unchecked(3) a d e', shape(groupRows(gRecs, gFields, [gOk.id])));

  const two = groupRows(gRecs, gFields, [gStatus.id, gOk.id]);
  check('two levels nest, and each header counts everything beneath it',
    shape(two) === '>offline(1) >>checked(1) b >online(3) >>checked(1) c >>unchecked(2) a e >(empty)(1) >>unchecked(1) d', shape(two));
  const inner = two.find((it): it is GroupHeader => it.kind === 'group' && it.level === 1 && it.label === 'unchecked' && it.count === 2)!;
  const anc = ancestorsOf(two, inner.path);
  check('a record added under an inner header inherits EVERY level above it', anc.map((h) => `${h.level}:${h.label}`).join() === '0:online,1:unchecked', anc.map((h) => h.label).join());
  const folded = groupRows(gRecs, gFields, [gStatus.id], undefined, undefined, new Set([two.find((it) => it.kind === 'group' && it.label === 'online')!.path]));
  check('a collapsed group keeps its header and count and drops its rows', shape(folded) === '>offline(1) b >online(3) >(empty)(1) d', shape(folded));
  check('a group field that no longer exists is skipped, not an error', shape(groupRows(gRecs, gFields, [randomUUID()])) === 'a b c d e');
  check('a view saved BEFORE grouping existed still parses, and means "not grouped"', ViewConfig.safeParse({ sort: [], filters: [], hidden: [] }).success
    && (ViewConfig.parse({}).groupBy ?? []).length === 0 && ViewConfig.safeParse({ groupBy: [randomUUID(), randomUUID(), randomUUID()] }).success === false);

  console.log('\nG1j. Structured fields (contract/shapes.ts)');
  check('a field must name a KNOWN shape — a typo is an error, not "generic JSON"',
    shapeOptionError({ shape: 'manifest' }) === null && shapeOptionError({ shape: 'json' }) === null
    && /unknown shape 'audio_layuot'/.test(shapeOptionError({ shape: 'audio_layuot' }) ?? '') && /needs a shape/.test(shapeOptionError({}) ?? ''));

  const H = 'sha256:' + 'ab'.repeat(32);
  const okManifests: unknown[] = [
    { kind: 'file', size: 1024, hash: H },
    { kind: 'bundle', members: [{ path: 'ASSETMAP.xml', size: 900 }, { path: 'video/reel1.mxf', size: 5e10, hash: 'xxh64:0123456789abcdef' }], source: 'ASSETMAP.xml' },
    { kind: 'sequence', pattern: 'shot_010.%07d.exr', first: 1001, last: 87400, count: 86395, gaps: [[2000, 2004]] },
    { kind: 'channel_set', members: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'].map((c) => ({ path: `mix_${c}.wav`, channel: c })) },
  ];
  check('the four manifest kinds are accepted', okManifests.every((m) => structuredError('m', 'manifest', m) === null), okManifests.map((m) => structuredError('m', 'manifest', m)).filter(Boolean).join(' | '));
  check('an unknown KEY is refused — a typo in a tool must fail loudly, not be stored forever', /manifest/.test(structuredError('m', 'manifest', { kind: 'file', size: 1, sise: 2 }) ?? ''));
  check('an unknown kind, and a non-object, are refused', !!structuredError('m', 'manifest', { kind: 'folder' }) && !!structuredError('m', 'manifest', 'x') && !!structuredError('m', 'manifest', [1]));
  check('a hash must say which ALGORITHM — the choice is still open, and must stay changeable', /hash looks like/.test(structuredError('m', 'manifest', { kind: 'file', size: 1, hash: 'ab'.repeat(32) }) ?? ''));
  check('member paths are RELATIVE to the record\'s path — no "/", no "..", no drive letters',
    [['/abs/reel.mxf'], ['../up.mxf'], ['C:\\x.mxf']].every(([p]) => /relative/.test(structuredError('m', 'manifest', { kind: 'bundle', members: [{ path: p, size: 1 }] }) ?? '')));
  check('a sequence that ends before it starts is refused', /before first/.test(structuredError('m', 'manifest', { kind: 'sequence', pattern: 'a.%04d.dpx', first: 10, last: 5, count: 0, gaps: [] }) ?? ''));
  check('a manifest may not become an inventory: 2,001 members is too many', !!structuredError('m', 'manifest', { kind: 'bundle', members: Array.from({ length: 2001 }, (_, i) => ({ path: `f${i}`, size: 1 })) }));
  check('…and any structured value over 256 KB is refused, with the reason', /larger than 256 KB/.test(structuredError('j', 'json', { blob: 'x'.repeat(300_000) }) ?? ''));
  check('shape "json" takes any object', structuredError('j', 'json', { anything: [1, { goes: true }] }) === null && !!structuredError('j', 'json', 7));

  check('summaries: one line a grid cell can show',
    summarise('manifest', okManifests[0]) === '1 file, 1.00 KB'
    && summarise('manifest', okManifests[1]) === '2 files, 46.6 GB (ASSETMAP.xml)'
    && summarise('manifest', okManifests[2]) === '86,395 frames 1001–87400, 5 missing in 1 gap'
    && summarise('manifest', okManifests[3]) === '6 mono files (L R C LFE Ls Rs)', okManifests.map((m) => summarise('manifest', m)).join(' | '));
  check('bytes read like sizes', formatBytes(512) === '512 B' && formatBytes(128849018880) === '120 GB' && formatNumberField({ type: 'number', options: { format: 'bytes' } }, 1536) === '1.50 KB'
    && formatNumberField({ type: 'number', options: {} }, 1536) === null);

  console.log('\nG1k. Audio layouts: tracks are containers');
  let spec: Layout = { tracks: [] };
  spec = addPreset(spec, '5.1', 'Full mix'); spec = addPreset(spec, '2.0', 'Stereo'); spec = addPreset(spec, '2.0', 'M&E'); spec = addPreset(spec, '2.0', 'Dialog');
  check('5.1 + 3× stereo is 4 tracks and 12 channels, and says so', AudioLayout.safeParse(spec).success && flattenChannels(spec).length === 12
    && summarise('audio_layout', spec) === '4 tracks / 12 ch (5.1, 2.0, 2.0, 2.0)', summarise('audio_layout', spec));
  let asMonos = spec;
  for (let i = 0; i < asMonos.tracks.length;) { if (asMonos.tracks[i].channels.length > 1) asMonos = splitTrack(asMonos, i); else i++; }
  check('split every track: the SAME 12 channels in the SAME order, as 12 mono tracks', asMonos.tracks.length === 12 && flattenChannels(asMonos).join() === flattenChannels(spec).join()
    && asMonos.tracks[3].name === 'Full mix LFE', asMonos.tracks.map((t) => t.name).join(' | '));
  const remerged = mergeTracks(asMonos, [0, 1, 2, 3, 4, 5], 'Full mix');
  check('merge six monos back into one 5.1 track, in place', remerged.tracks.length === 7 && remerged.tracks[0].channels.join(' ') === 'L R C LFE Ls Rs' && summarise('audio_layout', remerged).includes('(5.1, mono'));
  check('move swaps neighbours and refuses to fall off either end', moveTrack(spec, 0, 1).tracks[1].name === 'Full mix' && moveTrack(spec, 0, -1) === spec && moveTrack(spec, 3, 1) === spec);
  check('an empty channel list, or an unknown key on a track, is refused', !!structuredError('a', 'audio_layout', { tracks: [{ name: 'x', channels: [] }] })
    && !!structuredError('a', 'audio_layout', { tracks: [{ name: 'x', channels: ['L'], lang: 'en' }] }));

  console.log('\nG1l. Comparing layouts — the first QC primitive');
  check('identical layouts match', diffLayouts(spec, JSON.parse(JSON.stringify(spec))).same);
  const grouping = diffLayouts(spec, asMonos);
  check('12 monos against "5.1 + 3× stereo": same channels, same order — a GROUPING problem, and only that',
    !grouping.same && grouping.issues.length === 1 && grouping.issues[0].kind === 'grouping' && /5\.1, 2\.0, 2\.0, 2\.0/.test(grouping.issues[0].detail), JSON.stringify(grouping.issues));
  const swapped: Layout = { tracks: [{ ...spec.tracks[0], channels: ['L', 'C', 'R', 'LFE', 'Ls', 'Rs'] }, ...spec.tracks.slice(1)] };
  const orderDiff = diffLayouts(spec, swapped);
  check('L C R instead of L R C is an ORDER problem (and grouping is not also reported)', orderDiff.issues.length === 1 && orderDiff.issues[0].kind === 'order' && /same channels, different order/.test(orderDiff.issues[0].detail), JSON.stringify(orderDiff.issues));
  const short = diffLayouts(spec, { tracks: spec.tracks.slice(0, 3) });
  check('a missing stereo pair is a COUNT problem, and nothing else is said', short.issues.length === 1 && short.issues[0].kind === 'count' && short.channelCount.join() === '12,10', JSON.stringify(short));
  const renamed: Layout = { tracks: spec.tracks.map((t, i) => (i === 2 ? { ...t, name: 'Music and effects', language: 'es' } : t)) };
  const nameDiff = diffLayouts(spec, renamed);
  check('matching structure, different labels: NAME and LANGUAGE are reported per track', nameDiff.issues.map((x) => `${x.kind}:${x.track}`).join() === 'name:2,language:2', JSON.stringify(nameDiff.issues));
  check('channel labels compare case-insensitively ("lfe" is LFE)', diffLayouts(spec, { tracks: spec.tracks.map((t) => ({ ...t, channels: t.channels.map((c) => c.toLowerCase()) })) }).same);

  check('the Files convention names real field types, and its link is to the table itself', FILES_STANDARD_FIELDS.every((f) => (FIELD_TYPES as readonly string[]).includes(f.type))
    && FILES_STANDARD_FIELDS.filter((f) => f.self).map((f) => f.key).join() === 'parent' && FILES_STANDARD_FIELDS.find((f) => f.key === 'path')?.type === 'file_path');

  console.log('\nG1m. Kanban columns (contract/views.ts: kanbanColumns)');
  const kSel: ViewField = { id: randomUUID(), key: 'status', type: 'select', options: { choices: ['todo', 'doing', 'done'] } };
  const kLink: ViewField = { id: randomUUID(), key: 'work', type: 'link', options: { target_table_id: randomUUID(), single: true } };
  const kRecs = [{ id: 'a', data: { status: 'todo' } }, { id: 'b', data: { status: 'done' } }, { id: 'c', data: {} }, { id: 'd', data: { status: 'gone' } }];
  const cols = kanbanColumns(kRecs, kSel, () => []);
  const shapeK = (cs: ReturnType<typeof kanbanColumns>) => cs.map((c) => `${c.label}[${c.records.map((r) => (r as { id: string }).id).join('')}]`).join(' ');
  check('a select: one column per CHOICE in choice order (empty ones too — a column is a place to drop things), "(none)" last, and a value that is no longer a choice keeps a column so nothing disappears',
    shapeK(cols) === 'todo[a] doing[] done[b] gone[d] (none)[c]', shapeK(cols));
  const kL = { a: ['w1'], b: ['w1', 'w2'], c: [] as string[], d: ['w2'] };
  const lcols = kanbanColumns(kRecs, kLink, (id) => kL[id as keyof typeof kL] ?? [], [{ id: 'w1', label: 'Ep 101' }, { id: 'w2', label: 'Ep 102' }, { id: 'w3', label: 'Ep 103' }]);
  check('a single link: a column per TARGET record in the given order; every card in exactly ONE column (a leftover second link is ignored — first wins)', shapeK(lcols) === 'Ep 101[ab] Ep 102[d] Ep 103[] (none)[c]', shapeK(lcols));
  check('a column knows how to put a record IN it', lcols[0].value.kind === 'links' && (lcols[0].value as any).ids[0] === 'w1' && cols[0].value.kind === 'value' && (cols[0].value as any).value === 'todo' && cols[4].value.kind === 'empty');
  check('only single-valued fields may make columns: a select, a link ticked "single" — not a plain link, not a multi-select',
    canMakeColumns(kSel) && canMakeColumns(kLink) && !canMakeColumns({ ...kLink, options: { target_table_id: 'x' } }) && !canMakeColumns({ id: 'm', key: 'm', type: 'multi_select' }));
  check('a view config with `kanban` parses; a stray key does not', ViewConfig.safeParse({ kanban: { fieldId: randomUUID() } }).success && !ViewConfig.safeParse({ kanban: { fieldId: randomUUID(), mode: 'add' } }).success);

  console.log('\nG1c. applyView — cost at the size whole-table loading commits us to');
  const big = Array.from({ length: 50_000 }, (_, i) =>
    rec(String(i), { name: `shot_${(i * 7919) % 50_000}_v${i % 12}`, frames: (i * 31) % 5000, status: ['todo', 'doing', 'done'][i % 3] }));
  const t0 = performance.now();
  const out = applyView(big, fields, cfg({
    filters: [{ fieldId: F.status.id, op: 'neq', value: 'done' }],
    sort: [{ fieldId: F.name.id, dir: 'asc' }, { fieldId: F.frames.id, dir: 'desc' }],
  }));
  const ms = performance.now() - t0;
  console.log(`        50,000 rows, 1 filter + 2-key natural sort: ${ms.toFixed(0)}ms -> ${out.length} rows`);
  // A generous bound: this runs on every edit to the table, so it is a budget,
  // and the point of asserting it is to notice an accidental O(n²).
  check('filter + sort of 50k rows stays well under a second', ms < 1000, `${ms.toFixed(0)}ms`);
}

/* ────────────────────────────────────────────────────────────────────────────
 *  G2–G4 — against a real server
 * ──────────────────────────────────────────────────────────────────────────*/

async function main() {
  pure();

  // The pool itself, not a checked-out client: a client held across the whole
  // suite is never released if a check THROWS, and pool.end() in the catch below
  // then waits for it forever. The first red-run of this file hung for that reason.
  const db = pool;
  if (!(await db.query(`select 1 from users limit 1`)).rowCount) {
    await db.query(`insert into users (email, name, role) values ('grid@local','Grid','admin')`);
  }
  server = await bootServer(PORT);

  const tableId = randomUUID(), fName = randomUUID(), fN = randomUUID();
  await mutate([
    { type: 'table.create', id: tableId, name: `Grid ${Date.now()}` },
    { type: 'field.create', id: fName, tableId, name: 'Name', key: 'name', fieldType: 'text' },
    { type: 'field.create', id: fN, tableId, name: 'N', key: 'n', fieldType: 'number' },
  ]);

  console.log('\nG2. Keyset paging serves every row exactly once');
  // 25 rows sharing ONE created_at to the microsecond, so the walk is carried
  // entirely by the id tie-break. Planted by SQL: a batch used to produce this
  // by accident (now() is per-transaction) until 004_record_order.sql, and the
  // tie-break still has to hold for the rows that predate it.
  const ids = Array.from({ length: 25 }, () => randomUUID());
  for (const [i, id] of ids.entries()) {
    await db.query(`insert into records (id, table_id, data, created_at) values ($1,$2,$3,'2026-02-02 12:00:00+00')`,
      [id, tableId, JSON.stringify({ name: `r${i}`, n: i })]);
  }
  const stamps = await db.query(`select count(distinct created_at)::int n from records where table_id=$1`, [tableId]);
  check('fixture: all 25 rows really do share one created_at', stamps.rows[0].n === 1, `${stamps.rows[0].n} distinct`);

  async function walk(limit: number, between?: (pageNo: number) => Promise<void>) {
    const seen: string[] = [];
    let after: string | null = null, pages = 0;
    do {
      const p: any = await (await page(tableId, `limit=${limit}` + (after ? `&after=${encodeURIComponent(after)}` : ''))).json();
      seen.push(...p.records.map((r: any) => r.id));
      after = p.nextCursor;
      pages++;
      if (after) await between?.(pages);
    } while (after);
    return { seen, pages };
  }
  const w = await walk(10);
  check('25 rows at 10 per page is 3 pages', w.pages === 3, `${w.pages}`);
  check('every row served exactly once across identical timestamps',
    w.seen.length === 25 && new Set(w.seen).size === 25 && ids.every((id) => w.seen.includes(id)),
    `${w.seen.length} served, ${new Set(w.seen).size} distinct`);

  const first: any = await (await page(tableId, 'limit=10')).json();
  const head = (await (await fetch(`${API}/api/head`)).json()).seq;
  check('a page dates itself with the log position it was read at', first.seq === head, `${first.seq} vs ${head}`);
  const lastPage: any = await (await page(tableId, `limit=500`)).json();
  check('the last page has no cursor', lastPage.nextCursor === null && lastPage.hasMore === false);

  // Rows 1µs apart inside ONE millisecond. A cursor that had been through a JS
  // Date would carry ".123" for all three and re-serve or skip them.
  const micro = randomUUID();
  await mutate([{ type: 'table.create', id: micro, name: `Micro ${Date.now()}` }]);
  const mids = [randomUUID(), randomUUID(), randomUUID()];
  for (let i = 0; i < 3; i++) {
    await db.query(`insert into records (id, table_id, created_at) values ($1,$2, '2026-01-01 00:00:00.123450+00'::timestamptz + ($3 || ' microseconds')::interval)`,
      [mids[i], micro, String(i + 1)]);
  }
  const seenMicro: string[] = [];
  let cur: string | null = null;
  do {
    const p: any = await (await page(micro, 'limit=1' + (cur ? `&after=${encodeURIComponent(cur)}` : ''))).json();
    seenMicro.push(...p.records.map((r: any) => r.id));
    cur = p.nextCursor;
  } while (cur && seenMicro.length < 10);
  check('rows differing only below the millisecond are each served once, in order',
    seenMicro.join() === mids.join(), `${seenMicro.length} served`);

  check('an unreadable cursor is a 400, not a silent restart from page one',
    (await page(tableId, 'limit=10&after=not-a-cursor')).status === 400);

  console.log('\nG2b. A delete mid-walk: keyset survives it, offset does not');
  // Delete a row from page 1 after page 1 has been served.
  const victimA = ids.find((id) => id === w.seen[0])!;
  const k = await walk(10, async (n) => { if (n === 1) await mutate([{ type: 'record.delete', id: victimA }]); });
  const expected = ids.filter((id) => id !== victimA);
  check('KEYSET: every surviving row is served',
    expected.every((id) => k.seen.includes(id)), `${expected.filter((id) => !k.seen.includes(id)).length} missing`);

  // The control — same scenario through offset. If this ever starts passing,
  // the scenario has stopped exercising the bug and the check above means nothing.
  const victimB = k.seen.find((id) => id !== victimA)!;
  const viaOffset: string[] = [];
  for (let off = 0; ; off += 10) {
    const p: any = await (await page(tableId, `limit=10&offset=${off}`)).json();
    viaOffset.push(...p.records.map((r: any) => r.id));
    if (off === 0) await mutate([{ type: 'record.delete', id: victimB }]);
    if (!p.hasMore) break;
  }
  const survivors = expected.filter((id) => id !== victimB);
  const skipped = survivors.filter((id) => !viaOffset.includes(id));
  check('OFFSET (control): the same delete makes it skip a row that was never touched',
    skipped.length === 1, `skipped ${skipped.length}`);

  console.log('\nG3. store.loadTable walks the whole table');
  const bulk = Array.from({ length: 40 }, (_, i) => ({ type: 'record.create', id: randomUUID(), tableId, data: { name: `bulk${i}`, n: 1000 + i } }));
  await mutate(bulk);
  const serverCount = (await db.query(`select count(*)::int n from records where table_id=$1`, [tableId])).rows[0].n;

  const A = createStore({ baseUrl: API, debounceMs: 30 });
  await A.hydrate();
  await A.loadTable(tableId, { pageSize: 7 });
  check('every row is in the store, across many small pages',
    recordsOf(A.state, tableId).length === serverCount, `${recordsOf(A.state, tableId).length} of ${serverCount}`);
  check('and the table is marked loaded, with the row count',
    A.tableLoads.get(tableId)?.state === 'loaded' && A.tableLoads.get(tableId)?.rows === serverCount);
  // One batch of 40. Before 004 these shared a timestamp and came back in uuid
  // order — this check is what found that.
  check('store order is creation order, even within one batch',
    recordsOf(A.state, tableId).slice(-40).map((r) => r.data.name).join() === bulk.map((b) => b.data.name).join());

  console.log('\nG3b. A page must not overwrite what the client knows better');
  // Pure first, so the rule is pinned down independent of timing.
  const s = emptyState();
  s.records.set('kept', { id: 'kept', table_id: 't', data: { v: 'new' } });
  const stale = { seq: 100, records: [
    { id: 'kept', table_id: 't', data: { v: 'old' } },
    { id: 'gone', table_id: 't', data: { v: 'deleted at 101' } },
    { id: 'plain', table_id: 't', data: { v: 'fine' } },
    { id: 'older', table_id: 't', data: { v: 'page wins' } },
  ] };
  s.records.set('older', { id: 'older', table_id: 't', data: { v: 'client had this at 90' } });
  const touched = new Map([['r:kept', Infinity], ['r:gone', 101], ['r:older', 90]]);
  const taken = ingestPage(s, stale, touched);
  check('a row with an unsent local edit is not reverted', (s.records.get('kept')!.data as any).v === 'new');
  check('a row deleted AFTER the page was read is not resurrected', !s.records.has('gone'));
  check('a row touched BEFORE the page was read takes the page (it is newer)',
    (s.records.get('older')!.data as any).v === 'page wins');
  check('untouched rows ingest normally, and the count excludes the skipped', s.records.has('plain') && taken === 2, `${taken}`);
  // Control: with no guard, both failures happen. This is what ingestRecords did.
  const c = emptyState();
  c.records.set('kept', { id: 'kept', table_id: 't', data: { v: 'new' } });
  ingestPage(c, stale, new Map());
  check('(control) without the guard the edit IS reverted and the row IS resurrected',
    (c.records.get('kept')!.data as any).v === 'old' && c.records.has('gone'));

  // Then for real: an edit the server has not seen, and a walk on top of it.
  const slow = createStore({ baseUrl: API, debounceMs: 60_000 });   // never flushes by itself
  await slow.hydrate();
  await slow.loadTable(tableId);
  const target = recordsOf(slow.state, tableId)[3];
  slow.mutate({ type: 'record.update', id: target.id, set: { name: 'typed during load' }, unset: [] });
  check('fixture: the edit is still queued, so the server has the OLD value',
    slow.pending.value.length === 1
    && (await db.query(`select data->>'name' n from records where id=$1`, [target.id])).rows[0].n !== 'typed during load');
  await slow.loadTable(tableId, { force: true, pageSize: 5 });
  check('re-walking the table does not revert a queued edit',
    slow.state.records.get(target.id)!.data.name === 'typed during load',
    String(slow.state.records.get(target.id)!.data.name));

  console.log('\nG3c. A resync unloads every table');
  await A.resync();
  check('tableLoads is cleared, which is what tells the grid to walk again', A.tableLoads.size === 0);

  console.log('\nG4. Saved views');
  const viewId = randomUUID();
  const config = { sort: [{ fieldId: fN, dir: 'desc' }], filters: [{ fieldId: fName, op: 'contains', value: 'bulk' }], hidden: [] };
  const made = await mutate([{ type: 'view.create', id: viewId, tableId, name: 'Bulk only', config }]);
  check('a view with a real config is accepted', made.status === 200, JSON.stringify(made.body).slice(0, 200));

  // THE regression: views were writable and never readable. A second, fresh
  // store is "the same user after pressing refresh".
  const fresh = createStore({ baseUrl: API });
  await fresh.hydrate();
  const got = viewsOf(fresh.state, tableId).find((v) => v.id === viewId);
  check('a saved view survives a refresh', !!got, 'not returned by /api/schema');
  check('with its config intact', canon(got?.config) === canon(config), JSON.stringify(got?.config));

  await fresh.loadTable(tableId);
  const shown = applyView(recordsOf(fresh.state, tableId), [...fresh.state.fields.values()].filter((f) => f.table_id === tableId), ViewConfig.parse(got!.config));
  check('and applying it to the loaded table gives the 40 bulk rows, highest n first',
    shown.length === 40 && shown[0].data.n === 1039 && shown[39].data.n === 1000, `${shown.length} rows, first n=${shown[0]?.data.n}`);

  const bad = await mutate([{ type: 'view.update', id: viewId, config: { sorts: [] } }]);
  check('a config in the wrong shape is a 400', bad.status === 400, `${bad.status}`);
  const badOp = await mutate([{ type: 'view.update', id: viewId, config: { sort: [], hidden: [], filters: [{ fieldId: fN, op: 'between', value: 1 }] } }]);
  check('as is a filter op outside the closed set', badOp.status === 400, `${badOp.status}`);
  const still = (await db.query(`select config from views where id=$1`, [viewId])).rows[0].config;
  check('and neither touched the stored view', canon(still) === canon(config));

  // field.delete leaves the config alone on purpose — the entry goes inert, and
  // undoing the delete brings it back to life.
  await mutate([{ type: 'field.delete', id: fN }]);
  const after = createStore({ baseUrl: API });
  await after.hydrate(); await after.loadTable(tableId);
  const inert = applyView(recordsOf(after.state, tableId), [...after.state.fields.values()].filter((f) => f.table_id === tableId), ViewConfig.parse(viewsOf(after.state, tableId)[0].config));
  check('a view sorting by a since-deleted field still renders (filter applies, sort is inert)',
    inert.length === 40 && inert[0].data.name === 'bulk0', `${inert.length} rows, first ${inert[0]?.data.name}`);

  console.log('\nG5. The server refuses a lookup that points at nothing sensible');
  const farT = randomUUID(), farF = randomUUID(), linkF = randomUUID(), lookF = randomUUID();
  const okBatch = await mutate([
    { type: 'table.create', id: farT, name: `Far ${Date.now()}` },
    { type: 'field.create', id: farF, tableId: farT, name: 'Codec', key: 'codec', fieldType: 'text' },
    { type: 'field.create', id: linkF, tableId, name: 'Spec', key: 'spec', fieldType: 'link', options: { target_table_id: farT } },
    // In the SAME batch as the link field it follows: one transaction, so the
    // check has to see rows written a statement earlier.
    { type: 'field.create', id: lookF, tableId, name: 'Spec codec', key: 'spec_codec', fieldType: 'lookup', options: { via_field_id: linkF, target_field_id: farF } },
  ]);
  check('a sound lookup is accepted, even in the same batch as its link field', okBatch.status === 200, JSON.stringify(okBatch.body).slice(0, 200));
  const bad1 = await mutate([{ type: 'field.create', id: randomUUID(), tableId, name: 'Bad', key: 'bad1', fieldType: 'lookup', options: { via_field_id: fName, target_field_id: farF } }]);
  check('following a non-link field is a 400 that says why', bad1.status === 400 && /LINK/.test(JSON.stringify(bad1.body)), JSON.stringify(bad1.body).slice(0, 160));
  const bad2 = await mutate([{ type: 'field.create', id: randomUUID(), tableId, name: 'Bad', key: 'bad2', fieldType: 'lookup', options: {} }]);
  check('no configuration at all is a 400', bad2.status === 400, `${bad2.status}`);
  const bad3 = await mutate([{ type: 'field.create', id: randomUUID(), tableId, name: 'Bad', key: 'bad3', fieldType: 'lookup', options: { via_field_id: 'not-a-uuid', target_field_id: farF } }]);
  check('garbage ids are a 400, not a 500 from Postgres', bad3.status === 400, `${bad3.status}`);
  const bad4 = await mutate([{ type: 'field.update', id: lookF, options: { via_field_id: linkF, target_field_id: fName } }]);
  check('re-pointing an existing lookup at the wrong table is refused too', bad4.status === 400, `${bad4.status}`);
  check('and none of them created a field',
    (await pool.query(`select count(*)::int n from fields where key like 'bad%'`)).rows[0].n === 0);
  const writeTo = await mutate([{ type: 'record.create', id: randomUUID(), tableId, data: { spec_codec: 'x' } }]);
  check('a lookup cannot be WRITTEN — it is computed', writeTo.status === 400, `${writeTo.status}`);

  console.log('\nG6. Backlinks on the server');
  const backF = randomUUID();
  const okBack = await mutate([{ type: 'field.create', id: backF, tableId: farT, name: 'Used by', key: 'used_by', fieldType: 'backlink', options: { source_field_id: linkF } }]);
  check('a backlink mirroring a link that points at its table is accepted', okBack.status === 200, JSON.stringify(okBack.body).slice(0, 160));
  const wrongWay = await mutate([{ type: 'field.create', id: randomUUID(), tableId, name: 'Bad', key: 'badback', fieldType: 'backlink', options: { source_field_id: linkF } }]);
  check('on the WRONG table (the link does not point there) it is a 400', wrongWay.status === 400 && /does not point at this table/.test(JSON.stringify(wrongWay.body)), JSON.stringify(wrongWay.body).slice(0, 160));
  const writeBack = await mutate([{ type: 'record.create', id: randomUUID(), tableId: farT, data: { used_by: 'x' } }]);
  check('a backlink cannot be written — the link is made on the other record', writeBack.status === 400 && /backlink/.test(JSON.stringify(writeBack.body)));

  console.log('\nG7. Search across tables (GET /api/search)');
  const sA = randomUUID(), sB = randomUUID(), sC = randomUUID();
  // (No `n` here: G4 deleted that field, and a batch naming an unknown key is
  // rejected WHOLE — which is how the first draft of this fixture created nothing
  // and every check below failed for the wrong reason. Hence the status check.)
  const seeded = await mutate([
    { type: 'record.create', id: sA, tableId, data: { name: 'zebra master texted' } },
    { type: 'record.create', id: sB, tableId, data: { name: 'unrelated 100x' } },
    { type: 'record.create', id: sC, tableId: farT, data: { codec: 'prores zebra 100%' } },
  ]);
  check('fixture: the records to search for were created', seeded.status === 200, JSON.stringify(seeded.body).slice(0, 160));
  const search = async (q: string, tables: string[] = []) =>
    (await (await fetch(`${API}/api/search?q=${encodeURIComponent(q)}&tables=${tables.join(',')}`)).json()) as { results: Array<{ record: { id: string }; label: string }>; fuzzy: boolean };
  const idsOf = (r: Awaited<ReturnType<typeof search>>) => r.results.map((x) => x.record.id);
  const z = await search('zebra');
  check('one query finds records in DIFFERENT tables', idsOf(z).includes(sA) && idsOf(z).includes(sC), idsOf(z).join());
  check('results carry the record\'s label', z.results.find((x) => x.record.id === sA)?.label === 'zebra master texted');
  check('every term must match, in any order', idsOf(await search('texted zebra')).join() === sA && idsOf(await search('zebra nosuchword')).length === 0);
  check('scoped to a table, only that table answers', idsOf(await search('zebra', [farT])).join() === sC);
  check('a table with no text lists its newest records', idsOf(await search('', [farT])).includes(sC));
  check('no text and no table is an empty result, not "everything"', (await search('')).results.length === 0);
  // Every Far record has a KEY called "codec"; none has it as a value. Searching
  // data::text would match them all; searching values must match none exactly.
  const byKey = await search('codec', [farT]);
  check('it searches VALUES, not field names', byKey.results.length === 0 || byKey.fuzzy === true, JSON.stringify(byKey).slice(0, 140));
  // Assert `fuzzy === false`, not just "found it": the typo fallback will happily
  // find "100%" for a query the EXACT pass mishandled, and a check that only looks
  // at the ids cannot tell the two apart.
  const pct = await search('100%');
  check('% is a literal character, matched exactly — not a wildcard', idsOf(pct).join() === sC && pct.fuzzy === false, JSON.stringify(pct).slice(0, 120));
  // "100x" exists. An UNESCAPED `_` is a one-character wildcard and would match it
  // in the exact pass; escaped, it can only be reached by the fuzzy one.
  const wild = await search('100_');
  check('_ is literal: "100_" does not EXACTLY match "100x"', wild.fuzzy === true || wild.results.length === 0, JSON.stringify(wild).slice(0, 120));
  const und = await search('10_%');
  check('and so is _ ("10_%" must not match "100%" exactly)', und.fuzzy === true || idsOf(und).length === 0, JSON.stringify(und).slice(0, 120));
  const dot = await search('zebra.master');
  check('regex characters in a query do not break ranking', Array.isArray(dot.results));
  const typo = await search('zebrra');
  check('a typo falls back to similar spellings, and says so', typo.fuzzy === true && idsOf(typo).includes(sA), JSON.stringify(typo).slice(0, 160));
  check('an exact hit is not labelled fuzzy', z.fuzzy === false);
  check('a label that STARTS with the term outranks one that merely contains it',
    idsOf(await search('zebra'))[0] === sA, idsOf(await search('zebra')).join());
  check('garbage table ids are ignored, not a 500', (await fetch(`${API}/api/search?q=zebra&tables=nope,`)).status === 200);

  console.log('\nG8. Rich text and attachments on the server');
  const notesF = randomUUID(), filesF = randomUUID(), noteRec = randomUUID();
  await mutate([
    { type: 'field.create', id: notesF, tableId, name: 'Notes', key: 'notes', fieldType: 'rich_text' },
    { type: 'field.create', id: filesF, tableId, name: 'Files', key: 'files', fieldType: 'attachment' },
    { type: 'record.create', id: noteRec, tableId, data: { name: 'noted' } },
  ]);
  const pngBytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'),
    Buffer.from([0, 0, 3, 32, 0, 0, 2, 88, 8, 6, 0, 0, 0]), Buffer.from(`grid-${Date.now()}`)]);
  const asset: any = await (await fetch(`${API}/api/assets?name=shot.png`, { method: 'POST', body: pngBytes })).json();
  check('fixture: an image was uploaded', typeof asset.id === 'string' && asset.width === 800, JSON.stringify(asset).slice(0, 120));

  const theDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'QC said: fix the slate' }] },
    { type: 'image', attrs: { assetId: asset.id, width: 800, height: 600, alt: 'shot.png' } }] };
  const logBytesBefore = Number((await pool.query(`select coalesce(sum(length(payload::text)),0)::bigint n from mutations`)).rows[0].n);
  const saved = await mutate([{ type: 'record.update', id: noteRec, set: { notes: theDoc, files: [asset.id] }, unset: [] }]);
  check('a document with an uploaded image, and an attachment list, are accepted', saved.status === 200, JSON.stringify(saved.body).slice(0, 200));
  const stored = (await pool.query(`select data from records where id = $1`, [noteRec])).rows[0].data;
  check('stored as a document OBJECT, not a string', stored.notes?.type === 'doc' && stored.notes.content[1].attrs.assetId === asset.id && stored.files[0] === asset.id);
  const logGrew = Number((await pool.query(`select coalesce(sum(length(payload::text)),0)::bigint n from mutations`)).rows[0].n) - logBytesBefore;
  check('the mutation log grew by a few hundred bytes — the image is NOT in it', logGrew > 0 && logGrew < 2000, `${logGrew} bytes`);

  const ghostId = randomUUID();
  const ghost = await mutate([{ type: 'record.update', id: noteRec, set: { files: [ghostId] }, unset: [] }]);
  check('an attachment naming an asset that does not exist is a 400 that says which', ghost.status === 400 && JSON.stringify(ghost.body).includes(ghostId), JSON.stringify(ghost.body).slice(0, 200));
  const ghostImg = await mutate([{ type: 'record.update', id: noteRec, set: { notes: { type: 'doc', content: [{ type: 'image', attrs: { assetId: ghostId } }] } }, unset: [] }]);
  check('and so is an image in a note', ghostImg.status === 400 && /unknown asset/.test(JSON.stringify(ghostImg.body)));
  const inline = await mutate([{ type: 'record.update', id: noteRec, set: { notes: { type: 'doc', content: [{ type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=' } }] } }, unset: [] }]);
  check('an image pasted in as a data: URI is refused — bytes never reach the log', inline.status === 400, `${inline.status}`);
  check('none of those changed the record', JSON.stringify((await pool.query(`select data from records where id = $1`, [noteRec])).rows[0].data.notes) === JSON.stringify(stored.notes));
  const found = await search('slate');
  check('text inside a note is found by the palette\'s search', idsOf(found).includes(noteRec), JSON.stringify(found).slice(0, 160));

  console.log('\nG9. Structured fields on the server');
  const fMan = randomUUID(), fLay = randomUUID(), sRec = randomUUID();
  const badShape = await mutate([{ type: 'field.create', id: randomUUID(), tableId, name: 'Oops', key: 'oops', fieldType: 'structured', options: { shape: 'manifets' } }]);
  check('a structured field with a misspelt shape is refused at creation', badShape.status === 400 && /unknown shape/.test(JSON.stringify(badShape.body)), JSON.stringify(badShape.body).slice(0, 160));
  check('…and so is one with no shape at all', (await mutate([{ type: 'field.create', id: randomUUID(), tableId, name: 'Oops', key: 'oops2', fieldType: 'structured', options: {} }])).status === 400);
  const madeS = await mutate([
    { type: 'field.create', id: fMan, tableId, name: 'Manifest', key: 'manifest', fieldType: 'structured', options: { shape: 'manifest' } },
    { type: 'field.create', id: fLay, tableId, name: 'Audio layout', key: 'audio_layout', fieldType: 'structured', options: { shape: 'audio_layout' } },
    { type: 'record.create', id: sRec, tableId, data: { name: 'ep101_5.1', manifest: { kind: 'channel_set', members: [{ path: 'ep101_L.wav', channel: 'L' }, { path: 'ep101_R.wav', channel: 'R' }] } } },
  ]);
  check('fields with known shapes, and a record carrying a valid manifest, are accepted', madeS.status === 200, JSON.stringify(madeS.body).slice(0, 200));
  const storedS = (await pool.query(`select data from records where id = $1`, [sRec])).rows[0].data;
  check('stored as an OBJECT in the record — no new tables, no new columns', storedS.manifest?.kind === 'channel_set' && storedS.manifest.members.length === 2);
  const badVal = await mutate([{ type: 'record.update', id: sRec, set: { manifest: { kind: 'bundle', members: [{ path: '/etc/passwd', size: 1 }] } }, unset: [] }]);
  check('the SERVER refuses what the contract refuses (an absolute member path) — a tool cannot bypass the editor\'s rules', badVal.status === 400 && /relative/.test(JSON.stringify(badVal.body)), JSON.stringify(badVal.body).slice(0, 200));
  check('a manifest in an audio_layout field is refused: each field validates against ITS shape', (await mutate([{ type: 'record.update', id: sRec, set: { audio_layout: { kind: 'file', size: 1 } }, unset: [] }])).status === 400);
  const reshape = await mutate([{ type: 'field.update', id: fMan, options: { shape: 'json' } }]);
  check('a field\'s shape cannot be changed afterwards — its stored values were validated against it', reshape.status === 400 && /cannot be changed/.test(JSON.stringify(reshape.body)));
  check('…but other options of the same field can be (the shape re-sent unchanged)', (await mutate([{ type: 'field.update', id: fMan, name: 'File manifest', options: { shape: 'manifest' } }])).status === 200);

  const posT = randomUUID(), pA = randomUUID(), pB = randomUUID(), pC = randomUUID();
  await mutate([{ type: 'table.create', id: posT, name: 'Positions' },
    { type: 'field.create', id: pA, tableId: posT, name: 'Name', key: 'name', fieldType: 'text' },
    { type: 'field.create', id: pB, tableId: posT, name: 'Alt work', key: 'alt_work', fieldType: 'text' },
    { type: 'field.create', id: pC, tableId: posT, name: 'Aardvark', key: 'aardvark', fieldType: 'text' }]);
  const posRows = (await pool.query(`select name, position from fields where table_id = $1 order by position, name`, [posT])).rows;
  check('fields created through the API with NO position are APPENDED — the first stays first, so a script cannot hijack the primary field by naming a field "Aardvark"',
    posRows.map((r) => r.name).join() === 'Name,Alt work,Aardvark' && posRows.map((r) => r.position).join() === '0,1,2', JSON.stringify(posRows));

  console.log('\nG10. "single" link fields on the server');
  const sT = randomUUID(), sTarget = randomUUID(), sF = randomUUID(), sglA = randomUUID(), sX = randomUUID(), sY = randomUUID();
  await mutate([{ type: 'table.create', id: sT, name: 'Singles' }, { type: 'table.create', id: sTarget, name: 'Targets' },
    { type: 'field.create', id: sF, tableId: sT, name: 'One', key: 'one', fieldType: 'link', options: { target_table_id: sTarget, single: true } },
    { type: 'record.create', id: sglA, tableId: sT, data: {} }, { type: 'record.create', id: sX, tableId: sTarget, data: {} }, { type: 'record.create', id: sY, tableId: sTarget, data: {} },
    { type: 'link.add', id: randomUUID(), fieldId: sF, fromRecord: sglA, toRecord: sX }]);
  const second = await mutate([{ type: 'link.add', id: randomUUID(), fieldId: sF, fromRecord: sglA, toRecord: sY }]);
  check('a SECOND link through a "single" field is refused, and the reason names the field as single', second.status === 400 && /single/.test(JSON.stringify(second.body)), JSON.stringify(second.body).slice(0, 160));
  check('re-adding the SAME link is fine (idempotent, as ever)', (await mutate([{ type: 'link.add', id: randomUUID(), fieldId: sF, fromRecord: sglA, toRecord: sX }])).status === 200);
  check('a REPLACEMENT — remove + add in one batch — is accepted', (await mutate([{ type: 'link.remove', fieldId: sF, fromRecord: sglA, toRecord: sX }, { type: 'link.add', id: randomUUID(), fieldId: sF, fromRecord: sglA, toRecord: sY }])).status === 200
    && (await pool.query(`select to_record from links where field_id = $1 and from_record = $2`, [sF, sglA])).rows.map((r) => r.to_record).join() === sY);

  const five1 = { tracks: [{ name: 'Full mix', channels: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'] }] };
  const sixMono = { tracks: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'].map((c) => ({ name: `Full mix ${c}`, channels: [c] })) };
  const viaApi: any = await (await fetch(`${API}/api/qc/audio-layout-diff`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: five1, b: sixMono }) })).json();
  check('POST /api/qc/audio-layout-diff gives a script the same verdict the app computes', viaApi.same === false && viaApi.issues?.[0]?.kind === 'grouping' && JSON.stringify(viaApi) === JSON.stringify(diffLayouts(five1, sixMono)), JSON.stringify(viaApi));
  const viaApiBad = await fetch(`${API}/api/qc/audio-layout-diff`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: five1, b: { tracks: 'six' } }) });
  check('…and says which side is not a layout', viaApiBad.status === 400 && /'b' is not an audio layout/.test(await viaApiBad.text()));
  check('a structured value is found by search through the record\'s other text, and the mutation log holds the value once',
    (await pool.query(`select count(*)::int n from mutations where payload::text like '%ep101_L.wav%'`)).rows[0].n === 1);

  A.stop(); slow.stop(); fresh.stop(); after.stop();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await server?.stop();
  await pool.end();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await server?.stop();
  await pool.end().catch(() => {});
  process.exit(1);
});
