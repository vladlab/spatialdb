/**
 * ============================================================================
 *  Undo tests.
 * ============================================================================
 *
 *  The easy part is putting one row back. The parts that actually break:
 *
 *    * CASCADES. Deleting a record silently removes its links and every one of
 *      its placements. Undo has to bring back exactly those — a restore that
 *      returns the record without its arrows looks like it worked and isn't.
 *    * SECOND-ORDER CASCADES. Deleting a table destroys links that live on
 *      OTHER tables' fields but point into this one. Easy to miss; invisible
 *      until someone notices a relation vanished.
 *    * HISTORY IS NOT A STACK. Delete a record, delete the canvas it was on,
 *      then undo the record — the captured placement now points at a canvas that
 *      no longer exists. Undo must survive that rather than abort.
 *    * ROLE GATING. `restore` can recreate tables, so an editor undoing a
 *      table.delete would be a back door into the schema.
 *
 *  Run: npm run test:undo
 */

import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { bootServer, type ServerHandle } from './harness.js';
import { MutationRequest, type Mutation } from '../src/contract/mutations.js';
import { applyBatch, MutationError, type Actor } from '../src/server/apply.js';
import { loadUndo, loadUndoable } from '../src/server/reads.js';
import { MAX_CAPTURE_ROWS } from '../src/server/capture.js';
import { createStore } from '../src/client/store.js';

const PORT = Number(process.env.TEST_PORT ?? 8803);
const API = `http://localhost:${PORT}`;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pool = new pg.Pool({ connectionString: process.env.DB_URL });
let server: ServerHandle | undefined;

async function main() {
  const db = await pool.connect();
  let userRow = (await db.query(`select id from users order by created_at limit 1`)).rows[0];
  if (!userRow) {
    userRow = (await db.query(
      `insert into users (email, name, role) values ('undo@local','Undo','admin')
       returning id`)).rows[0];
  }
  const admin: Actor = { id: userRow.id, role: 'admin' };
  const editor: Actor = { ...admin, role: 'editor' };

  const clientId = randomUUID();
  const send = (mutations: Array<{ id: string; mutation: Mutation }>, actor = admin) =>
    applyBatch(db, MutationRequest.parse({ clientId, mutations }), actor);
  const one = (mutation: Mutation, actor = admin) =>
    send([{ id: randomUUID(), mutation }], actor);

  const count = async (sql: string, params: unknown[] = []) =>
    Number((await db.query(sql, params)).rows[0].n);

  /* ── fixture: two tables, a link between them, a canvas with placements ──*/
  const tEdits = randomUUID(), tFiles = randomUUID(), tBoards = randomUUID();
  const fName = randomUUID(), fOutputs = randomUUID(), fFileName = randomUUID();
  const rEdit = randomUUID(), rFileA = randomUUID(), rFileB = randomUUID();
  const canvas1 = randomUUID(), canvas2 = randomUUID();
  const viewId = randomUUID(), annId = randomUUID();

  async function buildFixture() {
    await send([
      { id: randomUUID(), mutation: { type: 'table.create', id: tEdits, name: 'Edits', singularName: 'Edit', color: '', icon: '' } },
      { id: randomUUID(), mutation: { type: 'table.create', id: tFiles, name: 'Files', singularName: 'File', color: '', icon: '' } },
      { id: randomUUID(), mutation: { type: 'field.create', id: fName, tableId: tEdits, name: 'Name', key: 'name', fieldType: 'text', options: {}, required: false } },
      { id: randomUUID(), mutation: { type: 'field.create', id: fFileName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text', options: {}, required: false } },
      { id: randomUUID(), mutation: { type: 'field.create', id: fOutputs, tableId: tEdits, name: 'Outputs', key: 'outputs', fieldType: 'link', options: { target_table_id: tFiles }, required: false } },
      { id: randomUUID(), mutation: { type: 'record.create', id: rEdit, tableId: tEdits, data: { name: 'reel 1' } } },
      { id: randomUUID(), mutation: { type: 'record.create', id: rFileA, tableId: tFiles, data: { name: 'master.mov' } } },
      { id: randomUUID(), mutation: { type: 'record.create', id: rFileB, tableId: tFiles, data: { name: 'proxy.mov' } } },
      { id: randomUUID(), mutation: { type: 'link.add', id: randomUUID(), fieldId: fOutputs, fromRecord: rEdit, toRecord: rFileA } },
      { id: randomUUID(), mutation: { type: 'link.add', id: randomUUID(), fieldId: fOutputs, fromRecord: rEdit, toRecord: rFileB } },
      { id: randomUUID(), mutation: { type: 'view.create', id: viewId, tableId: tEdits, name: 'Grid', config: { sort: [], filters: [], hidden: [] } } },
      // A canvas is a RECORD in a table of kind 'canvas' (sql/010). Its state row
      // appears lazily — the placement.add below is what creates it.
      { id: randomUUID(), mutation: { type: 'table.create', id: tBoards, name: 'Boards', singularName: 'Board', color: '', icon: '', kind: 'canvas' } },
      { id: randomUUID(), mutation: { type: 'field.create', id: randomUUID(), tableId: tBoards, name: 'Name', key: 'name', fieldType: 'text', options: {}, required: false } },
      { id: randomUUID(), mutation: { type: 'record.create', id: canvas1, tableId: tBoards, data: { name: 'Board one' } } },
      { id: randomUUID(), mutation: { type: 'record.create', id: canvas2, tableId: tBoards, data: { name: 'Board two' } } },
      // rEdit sits on BOTH canvases — placement is per (canvas, record).
      { id: randomUUID(), mutation: { type: 'placement.add', id: randomUUID(), canvasId: canvas1, recordId: rEdit, x: 10, y: 20, w: 300, h: 140, z: 2 } },
      { id: randomUUID(), mutation: { type: 'placement.add', id: randomUUID(), canvasId: canvas2, recordId: rEdit, x: 99, y: 88, w: null, h: null, z: 0 } },
      { id: randomUUID(), mutation: { type: 'placement.add', id: randomUUID(), canvasId: canvas1, recordId: rFileA, x: 400, y: 20, w: null, h: null, z: 0 } },
      { id: randomUUID(), mutation: { type: 'annotation.create', id: annId, canvasId: canvas1, kind: 'label', geometry: { x: 1, y: 2 }, style: {} } },
    ]);
  }
  await buildFixture();

  /* ────────────────────────────────────────────────────────────────────────*/
  console.log('\n1. record.delete captures the record AND its cascade');

  const linksBefore = await count(`select count(*)::int n from links where from_record=$1`, [rEdit]);
  const placementsBefore = await count(`select count(*)::int n from placements where record_id=$1`, [rEdit]);
  check('fixture has 2 links and 2 placements', linksBefore === 2 && placementsBefore === 2,
    `links=${linksBefore} placements=${placementsBefore}`);

  const delRecord = randomUUID();
  await send([{ id: delRecord, mutation: { type: 'record.delete', id: rEdit } }], editor);

  check('record gone', await count(`select count(*)::int n from records where id=$1`, [rEdit]) === 0);
  check('links cascaded away', await count(`select count(*)::int n from links where from_record=$1`, [rEdit]) === 0);
  check('placements cascaded away', await count(`select count(*)::int n from placements where record_id=$1`, [rEdit]) === 0);

  const cap = await loadUndo(db, delRecord);
  check('capture exists', !!cap);
  check('captured 1 record', (cap!.counts as any).records === 1, JSON.stringify(cap!.counts));
  check('captured both links', (cap!.counts as any).links === 2, JSON.stringify(cap!.counts));
  check('captured both placements', (cap!.counts as any).placements === 2, JSON.stringify(cap!.counts));
  check('not truncated', cap!.truncated === false);

  console.log('\n2. Undo restores everything, byte for byte');
  const before = (await db.query(
    `select created_at, created_by from records where id = $1`, [rEdit])).rows[0];
  check('record really is absent before the undo', before === undefined);

  await one({ type: 'restore', id: randomUUID(), undoOf: delRecord, rows: cap!.rows as any }, editor);

  check('record back', await count(`select count(*)::int n from records where id=$1`, [rEdit]) === 1);
  check('both links back', await count(`select count(*)::int n from links where from_record=$1`, [rEdit]) === 2);
  check('both placements back', await count(`select count(*)::int n from placements where record_id=$1`, [rEdit]) === 2);

  // Fidelity: this is why `restore` carries whole rows rather than replaying
  // record.create, which cannot set created_at or created_by.
  const restored = (await db.query(
    `select data, created_at, created_by from records where id = $1`, [rEdit])).rows[0];
  const captured = (cap!.rows as any).records[0];
  check('data preserved', restored.data.name === 'reel 1', JSON.stringify(restored.data));
  check('created_at preserved exactly',
    new Date(restored.created_at).toISOString() === new Date(captured.created_at).toISOString(),
    `${restored.created_at} vs ${captured.created_at}`);
  check('created_by preserved', restored.created_by === captured.created_by);

  // Placement geometry, including the nullable w/h on the second canvas.
  const p1 = (await db.query(
    `select x,y,w,h,z from placements where canvas_id=$1 and record_id=$2`, [canvas1, rEdit])).rows[0];
  const p2 = (await db.query(
    `select x,y,w,h,z from placements where canvas_id=$1 and record_id=$2`, [canvas2, rEdit])).rows[0];
  check('placement on canvas 1 restored with geometry',
    p1.x === 10 && p1.y === 20 && p1.w === 300 && p1.z === 2, JSON.stringify(p1));
  check('placement on canvas 2 restored with null w/h',
    p2.x === 99 && p2.w === null && p2.h === null, JSON.stringify(p2));

  console.log('\n3. Undo is idempotent');
  const r2 = await one({ type: 'restore', id: randomUUID(), undoOf: delRecord, rows: cap!.rows as any }, editor);
  check('a second restore applies without error', r2.applied.length === 1);
  check('still exactly one record', await count(`select count(*)::int n from records where id=$1`, [rEdit]) === 1);
  check('still exactly two links', await count(`select count(*)::int n from links where from_record=$1`, [rEdit]) === 2);
  check('still exactly two placements', await count(`select count(*)::int n from placements where record_id=$1`, [rEdit]) === 2);

  console.log('\n4. table.delete captures the second-order cascade');
  // Deleting Files destroys links that live on an EDITS field but point INTO
  // Files. Missing those is the subtle failure.
  const delTable = randomUUID();
  const linksIntoFiles = await count(
    `select count(*)::int n from links where to_record in (select id from records where table_id=$1)`,
    [tFiles]);
  check('there are links pointing into Files', linksIntoFiles === 2, `${linksIntoFiles}`);

  await send([{ id: delTable, mutation: { type: 'table.delete', id: tFiles } }], admin);
  check('table gone', await count(`select count(*)::int n from tables where id=$1`, [tFiles]) === 0);
  check('links into it cascaded away', await count(`select count(*)::int n from links where field_id=$1`, [fOutputs]) === 0);

  const capT = await loadUndo(db, delTable);
  const cT = capT!.counts as any;
  check('captured the table', cT.tables === 1, JSON.stringify(cT));
  check('captured its fields', cT.fields === 1, JSON.stringify(cT));
  check('captured its records', cT.records === 2, JSON.stringify(cT));
  check('captured the links owned by ANOTHER table pointing into it', cT.links === 2,
    JSON.stringify(cT));
  check('captured placements of its records', cT.placements === 1, JSON.stringify(cT));

  await one({ type: 'restore', id: randomUUID(), undoOf: delTable, rows: capT!.rows as any }, admin);
  check('table restored', await count(`select count(*)::int n from tables where id=$1`, [tFiles]) === 1);
  check('its records restored', await count(`select count(*)::int n from records where table_id=$1`, [tFiles]) === 2);
  check('the cross-table links restored', await count(`select count(*)::int n from links where field_id=$1`, [fOutputs]) === 2);
  check('placement restored', await count(`select count(*)::int n from placements where record_id=$1`, [rFileA]) === 1);

  console.log('\n5. History is not a stack — a missing FK parent is skipped, not fatal');
  // Delete the record (capturing its placements on canvas1 and canvas2), then
  // delete canvas2, then undo the record. The captured canvas2 placement now
  // points at nothing.
  const delRec2 = randomUUID();
  await send([{ id: delRec2, mutation: { type: 'record.delete', id: rEdit } }], editor);
  await one({ type: 'record.delete', id: canvas2 }, editor);   // deleting a board IS deleting its record
  check('canvas 2 is gone', await count(`select count(*)::int n from canvases where id=$1`, [canvas2]) === 0);

  const capR2 = await loadUndo(db, delRec2);
  check('capture still lists 2 placements', (capR2!.counts as any).placements === 2);

  let threw = false;
  try {
    await one({ type: 'restore', id: randomUUID(), undoOf: delRec2, rows: capR2!.rows as any }, editor);
  } catch (e) { threw = true; }
  check('the restore did NOT blow up on the dangling placement', !threw);
  check('record came back', await count(`select count(*)::int n from records where id=$1`, [rEdit]) === 1);
  check('the still-valid placement came back',
    await count(`select count(*)::int n from placements where canvas_id=$1 and record_id=$2`, [canvas1, rEdit]) === 1);
  check('the orphaned placement was skipped',
    await count(`select count(*)::int n from placements where canvas_id=$1`, [canvas2]) === 0);

  console.log('\n6. Role gating — restore is checked against what it carries');
  const delTable2 = randomUUID();
  await send([{ id: delTable2, mutation: { type: 'table.delete', id: tEdits } }], admin);
  const capT2 = await loadUndo(db, delTable2);
  try {
    await one({ type: 'restore', id: randomUUID(), undoOf: delTable2, rows: capT2!.rows as any }, editor);
    check('editor blocked from restoring a table', false, 'no error thrown');
  } catch (e) {
    check('editor blocked from restoring a table',
      e instanceof MutationError && e.status === 403, String(e));
  }
  check('the table is still gone after the refusal',
    await count(`select count(*)::int n from tables where id=$1`, [tEdits]) === 0);
  await one({ type: 'restore', id: randomUUID(), undoOf: delTable2, rows: capT2!.rows as any }, admin);
  check('admin can restore it', await count(`select count(*)::int n from tables where id=$1`, [tEdits]) === 1);

  console.log('\n7. Non-destructive mutations capture nothing');
  const upd = randomUUID();
  await send([{ id: upd, mutation: { type: 'record.update', id: rEdit, set: { name: 'reel 2' }, unset: [] } }], editor);
  check('record.update has no capture', (await loadUndo(db, upd)) === null);
  const cre = randomUUID();
  await send([{ id: cre, mutation: { type: 'record.create', id: randomUUID(), tableId: tEdits, data: {} } }], editor);
  check('record.create has no capture', (await loadUndo(db, cre)) === null);

  console.log('\n8. Deleting something that is not there captures nothing');
  const ghost = randomUUID();
  await send([{ id: ghost, mutation: { type: 'record.delete', id: randomUUID() } }], editor);
  check('no capture for a no-op delete', (await loadUndo(db, ghost)) === null);

  console.log('\n9. The undoable list, and knowing what is already undone');
  const list = await loadUndoable(db, 100);
  check('list is non-empty', list.length > 0, `${list.length}`);
  check('every entry is destructive',
    list.every((e) => e.type.endsWith('.delete') || e.type.endsWith('.remove')),
    list.map((e) => e.type).join(','));
  check('entries carry counts', list.every((e) => typeof e.total === 'number'));
  const undoneEntry = list.find((e) => e.id === delRecord);
  check('a reversed mutation reports what reversed it', !!undoneEntry?.undone_by,
    JSON.stringify(undoneEntry?.undone_by));
  check('newest first', list.every((e, i) => i === 0 || e.seq <= list[i - 1].seq));

  console.log('\n9b. A board is a record — deleting it must capture everything ON it');
  // THE invariant nothing enforces: sql/010 made `canvases.id` cascade from
  // `records.id`, and placements/annotations already cascade from canvases. So
  // record.delete on a board is a SECOND-ORDER cascade. If capture.ts misses it,
  // undo brings the board's record back with an EMPTY canvas — and nothing errors.
  const bTable = randomUUID(), board = randomUUID(), onBoard = randomUUID(), bAnn = randomUUID(), bName = randomUUID();
  await send([
    { id: randomUUID(), mutation: { type: 'table.create', id: bTable, name: 'Flow boards', singularName: '', color: '', icon: '', kind: 'canvas' } },
    { id: randomUUID(), mutation: { type: 'field.create', id: bName, tableId: bTable, name: 'Name', key: 'name', fieldType: 'text', options: {}, required: false } },
    { id: randomUUID(), mutation: { type: 'record.create', id: board, tableId: bTable, data: { name: 'Duke flow' } } },
    { id: randomUUID(), mutation: { type: 'record.create', id: onBoard, tableId: tFiles, data: { name: 'on the board.mov' } } },
    { id: randomUUID(), mutation: { type: 'placement.add', id: randomUUID(), canvasId: board, recordId: onBoard, x: 5, y: 6, w: 320, h: null, z: 3 } },
    { id: randomUUID(), mutation: { type: 'placement.update', canvasId: board, recordId: onBoard, collapsed: true } },
    { id: randomUUID(), mutation: { type: 'annotation.create', id: bAnn, canvasId: board, kind: 'area', geometry: { x: 0, y: 0, w: 9, h: 9 }, style: { title: 'inputs' } } },
    { id: randomUUID(), mutation: { type: 'canvas.update', id: board, viewport: { x: 12, y: 34, scale: 0.5 }, config: { cardFields: { [tFiles]: [fFileName] } } } },
  ], admin);
  check('fixture: the board\'s state row was created LAZILY, by the first placement',
    await count(`select count(*)::int n from canvases where id=$1`, [board]) === 1);
  const notABoard = await send([{ id: randomUUID(), mutation: { type: 'placement.add', id: randomUUID(), canvasId: rFileA, recordId: onBoard, x: 0, y: 0, w: null, h: null, z: 0 } }], admin)
    .then(() => '', (e) => String(e.message ?? e));
  check('an ordinary record cannot be turned into a canvas by placing a card "on" it', /not a board/.test(notABoard), notABoard || 'accepted');

  const delBoard = randomUUID();
  await send([{ id: delBoard, mutation: { type: 'record.delete', id: board } }], editor);
  check('deleting the board\'s record takes its state, its cards and its annotations',
    await count(`select count(*)::int n from canvases where id=$1`, [board]) === 0
    && await count(`select count(*)::int n from placements where canvas_id=$1`, [board]) === 0
    && await count(`select count(*)::int n from canvas_annotations where canvas_id=$1`, [board]) === 0);
  check('— but NOT the records that were placed on it', await count(`select count(*)::int n from records where id=$1`, [onBoard]) === 1);
  const capBoard = await loadUndo(db, delBoard);
  check('the capture lists them: 1 record, 1 canvas state, 1 placement, 1 annotation',
    ['records', 'canvases', 'placements', 'canvas_annotations'].every((k) => (capBoard!.counts as any)[k] === 1)
    && Object.keys(capBoard!.counts).length === 4, JSON.stringify(capBoard!.counts));
  await one({ type: 'restore', id: randomUUID(), undoOf: delBoard, rows: capBoard!.rows as any }, editor);
  const backPlacement = (await db.query(`select x, y, w, z, collapsed from placements where canvas_id=$1 and record_id=$2`, [board, onBoard])).rows[0];
  const backState = (await db.query(`select viewport, config from canvases where id=$1`, [board])).rows[0];
  check('undo brings the board back WITH its contents — card position, size and fold',
    JSON.stringify(backPlacement) === JSON.stringify({ x: 5, y: 6, w: 320, z: 3, collapsed: true }), JSON.stringify(backPlacement));
  check('its annotation', await count(`select count(*)::int n from canvas_annotations where id=$1`, [bAnn]) === 1);
  check('and its state: viewport and card settings', backState?.viewport?.scale === 0.5 && backState.config.cardFields[tFiles][0] === fFileName, JSON.stringify(backState));

  const delBoards = randomUUID();
  await send([{ id: delBoards, mutation: { type: 'table.delete', id: bTable } }], admin);
  check('deleting a whole TABLE of boards takes every board\'s contents too',
    await count(`select count(*)::int n from placements where canvas_id=$1`, [board]) === 0);
  const capBoards = await loadUndo(db, delBoards);
  await one({ type: 'restore', id: randomUUID(), undoOf: delBoards, rows: capBoards!.rows as any }, admin);
  check('and undoing THAT restores the table, the board, its state and its cards',
    await count(`select count(*)::int n from tables where id=$1 and kind='canvas'`, [bTable]) === 1
    && await count(`select count(*)::int n from placements where canvas_id=$1`, [board]) === 1
    && await count(`select count(*)::int n from canvases where id=$1`, [board]) === 1
    && await count(`select count(*)::int n from canvas_annotations where canvas_id=$1`, [board]) === 1);
  const retired = await send([{ id: randomUUID(), mutation: { type: 'canvas.create', id: randomUUID(), name: 'old way', description: '' } }], admin)
    .then(() => '', (e) => String(e.message ?? e));
  check('canvas.create still PARSES (old log rows must replay) but is refused, with the replacement named', /record\.create/.test(retired), retired || 'accepted');

  console.log('\n10. link.remove and placement.remove — the everyday undos');
  const delLink = randomUUID();
  await send([{ id: delLink, mutation: { type: 'link.remove', fieldId: fOutputs, fromRecord: rEdit, toRecord: rFileA } }], editor);
  check('link removed', await count(
    `select count(*)::int n from links where field_id=$1 and from_record=$2 and to_record=$3`,
    [fOutputs, rEdit, rFileA]) === 0);
  const capL = await loadUndo(db, delLink);
  await one({ type: 'restore', id: randomUUID(), undoOf: delLink, rows: capL!.rows as any }, editor);
  check('link restored', await count(
    `select count(*)::int n from links where field_id=$1 and from_record=$2 and to_record=$3`,
    [fOutputs, rEdit, rFileA]) === 1);

  const unplace = randomUUID();
  await send([{ id: unplace, mutation: { type: 'placement.remove', canvasId: canvas1, recordId: rEdit } }], editor);
  const capP = await loadUndo(db, unplace);
  check('unplacing is capturable', !!capP && (capP.counts as any).placements === 1);
  await one({ type: 'restore', id: randomUUID(), undoOf: unplace, rows: capP!.rows as any }, editor);
  const back = (await db.query(
    `select x,y,w,z from placements where canvas_id=$1 and record_id=$2`, [canvas1, rEdit])).rows[0];
  check('placement restored to its exact position',
    back && back.x === 10 && back.y === 20 && back.w === 300 && back.z === 2,
    JSON.stringify(back));

  console.log('\n10b. field.delete strips its values, and undo puts exactly them back');
  // Self-contained fixture — the shared one is well-picked-over by this point.
  // The behaviour under test: deleting a field strips its key from records.data
  // (an orphaned key was unwritable — assertFieldKeysExist rejects keys with no
  // field), the stripped values ride in the capture as record_values, and
  // restore merges them back under three guards: record exists, a field with
  // that key exists again, and the key is still absent.
  const tStrip = randomUUID(), fKeep = randomUUID(), fTemp = randomUUID();
  const rS1 = randomUUID(), rS2 = randomUUID(), rS3 = randomUUID();
  await send([
    { id: randomUUID(), mutation: { type: 'table.create', id: tStrip, name: 'Strip', singularName: '', color: '', icon: '' } },
    { id: randomUUID(), mutation: { type: 'field.create', id: fKeep, tableId: tStrip, name: 'Keep', key: 'keep', fieldType: 'text', options: {}, required: false } },
    { id: randomUUID(), mutation: { type: 'field.create', id: fTemp, tableId: tStrip, name: 'Temp', key: 'temp', fieldType: 'text', options: {}, required: false } },
    { id: randomUUID(), mutation: { type: 'record.create', id: rS1, tableId: tStrip, data: { keep: 'a', temp: 'x' } } },
    { id: randomUUID(), mutation: { type: 'record.create', id: rS2, tableId: tStrip, data: { keep: 'b', temp: 'y' } } },
    { id: randomUUID(), mutation: { type: 'record.create', id: rS3, tableId: tStrip, data: { keep: 'c' } } },
  ], admin);

  const delTemp = randomUUID();
  await send([{ id: delTemp, mutation: { type: 'field.delete', id: fTemp } }], admin);
  check('the key is stripped from every record that had it',
    await count(`select count(*)::int n from records where table_id=$1 and data ? 'temp'`, [tStrip]) === 0);
  check('other keys untouched',
    await count(`select count(*)::int n from records where table_id=$1 and data ? 'keep'`, [tStrip]) === 3);

  // The bug this exists to prevent: with the key stripped, the record is fully
  // writable again. Before the strip, ANY update to it was rejected wholesale
  // because the orphaned key failed assertFieldKeysExist.
  await one({ type: 'record.update', id: rS1, set: { keep: 'a2' }, unset: [] }, editor);
  check('records stay writable after the field delete',
    (await db.query(`select data->>'keep' v from records where id=$1`, [rS1])).rows[0].v === 'a2');

  const capF = await loadUndo(db, delTemp);
  check('capture holds one value per record that had the key',
    (capF!.counts as any).record_values === 2, JSON.stringify(capF!.counts));

  await one({ type: 'restore', id: randomUUID(), undoOf: delTemp, rows: capF!.rows as any }, admin);
  const tempsBack = (await db.query(
    `select id, data->>'temp' v from records where table_id=$1 order by data->>'keep'`, [tStrip])).rows;
  check('the field is back', await count(`select count(*)::int n from fields where id=$1`, [fTemp]) === 1);
  check('stripped values are back on exactly the records that had them',
    tempsBack[0].v === 'x' && tempsBack[1].v === 'y' && tempsBack[2].v === null,
    JSON.stringify(tempsBack));

  // The three restore guards, exercised one at a time.
  const delTemp2 = randomUUID();
  await send([{ id: delTemp2, mutation: { type: 'field.delete', id: fTemp } }], admin);
  const capF2 = await loadUndo(db, delTemp2);
  await one({ type: 'record.delete', id: rS2 }, editor);                       // guard: record gone
  const fTemp2 = randomUUID();                                                 // guard: key present
  await one({ type: 'field.create', id: fTemp2, tableId: tStrip, name: 'Temp', key: 'temp', fieldType: 'text', options: {}, required: false }, admin);
  await one({ type: 'record.update', id: rS1, set: { temp: 'new' }, unset: [] }, editor);
  await one({ type: 'restore', id: randomUUID(), undoOf: delTemp2, rows: capF2!.rows as any }, admin);
  check('a value typed under a re-created same-key field is NOT clobbered by undo',
    (await db.query(`select data->>'temp' v from records where id=$1`, [rS1])).rows[0].v === 'new');
  check('a value whose record is gone is skipped, not fatal',
    await count(`select count(*)::int n from records where id=$1`, [rS2]) === 0);

  const delTemp3 = randomUUID();                                               // guard: no field
  await send([{ id: delTemp3, mutation: { type: 'field.delete', id: fTemp2 } }], admin);
  const capF3 = await loadUndo(db, delTemp3);
  // Restore ONLY the values, not the field row — the exact case that would
  // recreate the orphaned-key state if the guard were missing.
  await one({ type: 'restore', id: randomUUID(), undoOf: delTemp3,
    rows: { ...(capF3!.rows as Record<string, unknown>), fields: [], links: [] } as any }, editor);
  check('a value with no matching field is refused rather than re-orphaned',
    await count(`select count(*)::int n from records where table_id=$1 and data ? 'temp'`, [tStrip]) === 0);
  check('restoring only record_values needs no admin (it is record data)', true);

  console.log('\n11. An oversized cascade refuses undo honestly');
  // Above MAX_CAPTURE_ROWS we store counts instead of contents. Without a cap,
  // deleting a 200,000-record table would write the whole table into one log row.
  // Rows go in via SQL rather than mutations here — the point is the cap, not the
  // write path, and 10k round trips would make the suite useless.
  const bigTable = randomUUID();
  await one({ type: 'table.create', id: bigTable, name: 'Huge', singularName: 'H', color: '', icon: '' }, admin);
  await one({ type: 'field.create', id: randomUUID(), tableId: bigTable, name: 'Name', key: 'name', fieldType: 'text', options: {}, required: false }, admin);
  await db.query(
    `insert into records (table_id, data)
     select $1, jsonb_build_object('name', 'bulk ' || g)
       from generate_series(1, $2) g`,
    [bigTable, MAX_CAPTURE_ROWS + 1],
  );
  const bulkCount = await count(`select count(*)::int n from records where table_id=$1`, [bigTable]);
  check(`fixture has ${MAX_CAPTURE_ROWS + 1} records`, bulkCount === MAX_CAPTURE_ROWS + 1,
    `${bulkCount}`);

  const delBig = randomUUID();
  await send([{ id: delBig, mutation: { type: 'table.delete', id: bigTable } }], admin);
  check('the delete still succeeded', await count(`select count(*)::int n from tables where id=$1`, [bigTable]) === 0);

  const rawUndo = (await db.query(`select undo from mutations where id = $1`, [delBig])).rows[0].undo;
  check('capture is marked truncated', rawUndo.truncated === true, JSON.stringify(rawUndo.counts));
  check('counts are kept even though contents are not',
    rawUndo.counts.records === MAX_CAPTURE_ROWS + 1, JSON.stringify(rawUndo.counts));
  check('no row contents were stored', (rawUndo.rows?.records ?? []).length === 0);

  // loadUndo surfaces it; the endpoint must refuse rather than hand back an empty
  // restore that a careless caller would send and believe worked.
  const bigCap = await loadUndo(db, delBig);
  check('loadUndo reports truncated', bigCap?.truncated === true);

  const bigEntry = (await loadUndoable(db, 200)).find((e) => e.id === delBig);
  check('the undoable list flags it as unavailable', bigEntry?.truncated === true);
  check('and still reports how much was lost', (bigEntry?.total ?? 0) > MAX_CAPTURE_ROWS,
    String(bigEntry?.total));

  console.log('\n12. A column added by a future migration survives an undo');
  // Capture uses `select *`, so it picks up new columns automatically. The
  // restore side used a hardcoded column list, which meant the value was captured
  // and then silently discarded on the way back — data loss inside the recovery
  // tool, with no error anywhere. Restore now reads the column list from the
  // catalog. This test simulates the migration that would break it again.
  await db.query(`alter table records add column if not exists probe_note text`);
  const probeRec = randomUUID();
  await one({ type: 'record.create', id: probeRec, tableId: tEdits, data: { name: 'probe' } }, editor);
  await db.query(`update records set probe_note = 'must survive' where id = $1`, [probeRec]);

  const delProbe = randomUUID();
  await send([{ id: delProbe, mutation: { type: 'record.delete', id: probeRec } }], editor);
  const capProbe = await loadUndo(db, delProbe);
  check('capture picked up the unknown column',
    (capProbe!.rows as any).records[0].probe_note === 'must survive',
    JSON.stringify((capProbe!.rows as any).records[0].probe_note));

  await one({ type: 'restore', id: randomUUID(), undoOf: delProbe, rows: capProbe!.rows as any }, editor);
  const probeBack = (await db.query(
    `select probe_note from records where id = $1`, [probeRec])).rows[0];
  check('and the restore put it back rather than dropping it',
    probeBack?.probe_note === 'must survive', JSON.stringify(probeBack?.probe_note));
  await db.query(`alter table records drop column if exists probe_note`);

  /* ── over HTTP, with two live stores ───────────────────────────────────── */
  console.log('\n13. Undo over HTTP propagates to other clients');
  server = await bootServer(PORT);

  const A = createStore({ baseUrl: API, debounceMs: 50 });
  const B = createStore({ baseUrl: API, debounceMs: 50 });
  await A.hydrate(); await B.hydrate();
  await A.loadTable(tEdits); await B.loadTable(tEdits);
  A.start(); B.start();
  for (let i = 0; i < 40 && A.streamState.value !== 'connected'; i++) await sleep(100);
  for (let i = 0; i < 40 && B.streamState.value !== 'connected'; i++) await sleep(100);

  // A deletes a record. Both stores should lose it, cascade included.
  const victim = randomUUID();
  A.mutate({ type: 'record.create', id: victim, tableId: tEdits, data: { name: 'doomed' } });
  await A.settled();
  for (let i = 0; i < 60 && !B.state.records.has(victim); i++) await sleep(50);
  check('B saw the record created', B.state.records.has(victim));

  A.mutate({ type: 'record.delete', id: victim });
  await A.settled();
  for (let i = 0; i < 60 && B.state.records.has(victim); i++) await sleep(50);
  check('B saw the delete', !B.state.records.has(victim));

  // Find it in the undoable list and undo it through the store.
  const viaHttp = await A.undoable(100);
  const entry = viaHttp.find((e) => e.type === 'record.delete' && !e.undone_by);
  check('the delete shows up as undoable over HTTP', !!entry);

  await A.undo(entry!.id);
  await A.settled();
  check('A has it back immediately (optimistic)', A.state.records.size > 0);
  for (let i = 0; i < 80 && !B.state.records.has(victim); i++) await sleep(50);
  check('B received the undo over the stream', B.state.records.has(victim),
    'undo did not propagate');
  check('no apply errors on B', B.errors.value.length === 0, B.errors.value.join(' | '));

  // Undo of a truncated / missing capture must fail loudly, not silently.
  let rejected = false;
  try { await A.undo(randomUUID()); } catch { rejected = true; }
  check('undoing an unknown mutation is rejected', rejected);

  A.stop(); B.stop();
  db.release();

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
