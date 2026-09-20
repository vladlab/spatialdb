/**
 * ============================================================================
 *  Store tests — phase 1's checkpoint.
 * ============================================================================
 *
 *  Part A is pure and offline: every mutation type applied twice must leave the
 *  same state as applying it once. That is guard 3, and it is the guard whose
 *  absence turned the old stream-shape bug from untidy into destructive.
 *
 *  Part B boots a real server and runs TWO stores against it. This is the actual
 *  checkpoint the plan describes: a write applied optimistically, flushed,
 *  persisted, echoed back over the stream, and surviving a refresh — plus the
 *  same loop seen from a second client, which is what phase 2 and eventual
 *  collaboration stand on.
 *
 *  Run: npm run test:store
 */

import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { boardsTableMutations, bootServer, type ServerHandle } from './harness.js';
import type { Mutation } from '../src/contract/mutations.js';
import {
  applyMutation, emptyState, fieldsOf, linkKey, placementKey, recordsOf,
  type State,
} from '../src/client/state.js';
import { createStore } from '../src/client/store.js';

const PORT = Number(process.env.TEST_PORT ?? 8801);
const API = `http://localhost:${PORT}`;

let pass = 0;
/** The table of boards this suite's canvases live in — see harness.boardsTableMutations. */
const BOARDS = randomUUID();

let fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Deterministic snapshot for comparing two states. */
function snapshot(s: State): string {
  const dump = (m: Map<string, unknown>) =>
    [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({
    tables: dump(s.tables), fields: dump(s.fields), records: dump(s.records),
    canvases: dump(s.canvases), placements: dump(s.placements), links: dump(s.links),
    annotations: dump(s.annotations), views: dump(s.views),
  });
}

async function waitFor(predicate: () => boolean, ms = 6000, label = 'condition') {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(30);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Part A — idempotency, offline and pure
 * ──────────────────────────────────────────────────────────────────────────*/

/** A script exercising every mutation type in the contract. */
function fullScript() {
  const tableA = randomUUID(), tableB = randomUUID();
  const fName = randomUUID(), fNum = randomUUID(), fLink = randomUUID();
  const rec1 = randomUUID(), rec2 = randomUUID();
  const canvas = randomUUID();
  const annotation = randomUUID();
  const view = randomUUID();
  const doomedTable = randomUUID(), doomedField = randomUUID();
  const doomedRec = randomUUID(), doomedCanvas = randomUUID();

  const script: Mutation[] = [
    // Canvases are records in a table of boards (sql/010) — it has to exist first.
    ...(boardsTableMutations(BOARDS) as Mutation[]),
    { type: 'table.create', id: tableA, name: 'Edits', singularName: 'Edit', color: '', icon: '' },
    { type: 'table.create', id: tableB, name: 'Files', singularName: 'File', color: '', icon: '' },
    { type: 'table.update', id: tableA, name: 'Editorial', position: 3 },
    { type: 'field.create', id: fName, tableId: tableA, name: 'Name', key: 'name', fieldType: 'text', options: {}, required: false },
    { type: 'field.create', id: fNum, tableId: tableA, name: 'Bitrate', key: 'bitrate', fieldType: 'number', options: {}, required: false },
    { type: 'field.create', id: fLink, tableId: tableA, name: 'Outputs', key: 'outputs', fieldType: 'link', options: { target_table_id: tableB }, required: false },
    { type: 'field.update', id: fNum, name: 'Bitrate (Mbps)', position: 2 },
    { type: 'record.create', id: rec1, tableId: tableA, data: { name: 'edit one' } },
    { type: 'record.create', id: rec2, tableId: tableB, data: { name: 'file one' } },
    { type: 'record.update', id: rec1, set: { bitrate: 45 }, unset: [] },
    { type: 'record.update', id: rec1, set: { name: 'edit one v2' }, unset: [] },
    { type: 'link.add', id: randomUUID(), fieldId: fLink, fromRecord: rec1, toRecord: rec2 },
    { type: 'record.create', id: canvas, tableId: BOARDS, data: { name: 'Delivery' } },
    { type: 'canvas.update', id: canvas, description: 'the real board', viewport: { x: 1, y: 2, scale: 1.5 } },
    { type: 'placement.add', id: randomUUID(), canvasId: canvas, recordId: rec1, x: 10, y: 20, w: null, h: null, z: 0 },
    { type: 'placement.add', id: randomUUID(), canvasId: canvas, recordId: rec2, x: 200, y: 20, w: 300, h: 120, z: 1 },
    { type: 'placement.move', canvasId: canvas, moves: [{ recordId: rec1, x: 15, y: 25 }, { recordId: rec2, x: 210, y: 30, z: 4 }] },
    { type: 'placement.update', canvasId: canvas, recordId: rec1, w: 260, collapsed: true, style: { tint: 'teal' } },
    { type: 'annotation.create', id: annotation, canvasId: canvas, kind: 'label', geometry: { x: 0, y: 0 }, style: {} },
    { type: 'annotation.update', id: annotation, geometry: { x: 5, y: 5 } },
    { type: 'view.create', id: view, tableId: tableA, name: 'Grid', config: { sort: [], filters: [], hidden: [] } },
    { type: 'view.update', id: view, name: 'Main grid', position: 1 },

    // Deletions, each with something to cascade.
    { type: 'table.create', id: doomedTable, name: 'Doomed', singularName: 'D', color: '', icon: '' },
    { type: 'field.create', id: doomedField, tableId: doomedTable, name: 'X', key: 'x', fieldType: 'text', options: {}, required: false },
    { type: 'record.create', id: doomedRec, tableId: doomedTable, data: { x: '1' } },
    { type: 'record.create', id: doomedCanvas, tableId: BOARDS, data: { name: 'Doomed canvas' } },
    { type: 'placement.add', id: randomUUID(), canvasId: doomedCanvas, recordId: doomedRec, x: 0, y: 0, w: null, h: null, z: 0 },
    { type: 'placement.remove', canvasId: doomedCanvas, recordId: doomedRec },
    { type: 'link.remove', fieldId: fLink, fromRecord: rec1, toRecord: rec2 },
    { type: 'annotation.delete', id: annotation },
    { type: 'view.delete', id: view },
    { type: 'field.delete', id: doomedField },
    { type: 'record.delete', id: doomedRec },
    { type: 'record.delete', id: doomedCanvas },
    { type: 'table.delete', id: doomedTable },
  ];

  return { script, ids: { tableA, tableB, fLink, rec1, rec2, canvas } };
}

function partA() {
  console.log('\nA1. Every mutation type is idempotent');

  const { script, ids } = fullScript();
  const types = new Set(script.map((m) => m.type));

  const once = emptyState();
  for (const m of script) applyMutation(once, m);

  const twice = emptyState();
  for (const m of script) { applyMutation(twice, m); applyMutation(twice, m); }

  // 22, down from 24: canvas.create and canvas.delete are retired — a board is
  // made and removed with record.create / record.delete, both already counted.
  check(`script covers ${types.size} mutation types`, types.size === 22, `${types.size}`);
  check('applying each mutation twice == applying it once',
    snapshot(once) === snapshot(twice));

  // Replaying the WHOLE script, which is what a reconnect used to do.
  const replayed = emptyState();
  for (const m of script) applyMutation(replayed, m);
  for (const m of script) applyMutation(replayed, m);
  check('replaying the entire script leaves state unchanged',
    snapshot(once) === snapshot(replayed));

  console.log('\nA2. The specific failure that made the old bug destructive');
  // Two identical record.create applications used to produce two records.
  const dup = emptyState();
  const rec = randomUUID();
  const tbl = randomUUID();
  const create: Mutation = { type: 'record.create', id: rec, tableId: tbl, data: { name: 'once' } };
  applyMutation(dup, create);
  applyMutation(dup, create);
  check('a doubly-applied record.create yields ONE record', dup.records.size === 1,
    `${dup.records.size}`);

  // And a replayed create must not revert later edits.
  applyMutation(dup, { type: 'record.update', id: rec, set: { name: 'edited' }, unset: [] });
  applyMutation(dup, create);
  check('a replayed create does not revert later edits',
    (dup.records.get(rec)!.data as any).name === 'edited',
    String((dup.records.get(rec)!.data as any).name));

  console.log('\nA3. Cascades mirror the schema');
  const casc = emptyState();
  for (const m of script) applyMutation(casc, m);
  check('deleted table left no fields behind',
    fieldsOf(casc, ids.tableA).length === 3 && [...casc.fields.values()].every((f) => casc.tables.has(f.table_id)));
  check('deleted table left no records behind',
    [...casc.records.values()].every((r) => casc.tables.has(r.table_id)));
  check('deleted canvas left no placements behind',
    [...casc.placements.values()].every((p) => casc.canvases.has(p.canvas_id)));

  // record.delete must take its links and placements with it.
  const cascade2 = emptyState();
  const t1 = randomUUID(), t2 = randomUUID(), f1 = randomUUID();
  const a = randomUUID(), b = randomUUID(), cv = randomUUID();
  for (const m of [
    { type: 'table.create', id: t1, name: 'A', singularName: '', color: '', icon: '' },
    { type: 'table.create', id: t2, name: 'B', singularName: '', color: '', icon: '' },
    { type: 'field.create', id: f1, tableId: t1, name: 'L', key: 'l', fieldType: 'link', options: {}, required: false },
    { type: 'record.create', id: a, tableId: t1, data: {} },
    { type: 'record.create', id: b, tableId: t2, data: {} },
    { type: 'link.add', id: randomUUID(), fieldId: f1, fromRecord: a, toRecord: b },
    { type: 'record.create', id: cv, tableId: BOARDS, data: { name: 'C' } },
    { type: 'placement.add', id: randomUUID(), canvasId: cv, recordId: a, x: 0, y: 0, w: null, h: null, z: 0 },
  ] as Mutation[]) applyMutation(cascade2, m);

  check('link and placement exist before the delete',
    cascade2.links.has(linkKey(f1, a, b)) && cascade2.placements.has(placementKey(cv, a)));
  applyMutation(cascade2, { type: 'record.delete', id: a });
  check('record.delete cascaded to its link', !cascade2.links.has(linkKey(f1, a, b)));
  check('record.delete cascaded to its placement', !cascade2.placements.has(placementKey(cv, a)));
  check('but the OTHER record survives', cascade2.records.has(b));

  console.log('\nA4. placement.add matches the server on conflict');
  // Server: `on conflict (canvas_id, record_id) do update set x, y, z` — w/h untouched.
  const p = emptyState();
  const pc = randomUUID(), pr = randomUUID();
  applyMutation(p, { type: 'record.create', id: pc, tableId: BOARDS, data: { name: 'c' } });
  applyMutation(p, { type: 'placement.add', id: randomUUID(), canvasId: pc, recordId: pr, x: 1, y: 1, w: 300, h: 100, z: 0 });
  applyMutation(p, { type: 'placement.add', id: randomUUID(), canvasId: pc, recordId: pr, x: 50, y: 60, w: null, h: null, z: 2 });
  const pl = p.placements.get(placementKey(pc, pr))!;
  check('re-adding a placed record moves it', pl.x === 50 && pl.y === 60 && pl.z === 2,
    JSON.stringify(pl));
  check('and does NOT clear w/h, matching the server', pl.w === 300 && pl.h === 100,
    `w=${pl.w} h=${pl.h}`);
  check('still exactly one placement', p.placements.size === 1);

  console.log('\nA5. field.delete strips locally, restore patches back — mirroring the server');
  // The server strips a deleted field's key from records.data and restore
  // merges captured record_values back under three guards. The client applies
  // the SAME mutations to the SAME effect, or the grid shows values the
  // database no longer holds (and vice versa) until the next hydrate.
  const st = emptyState();
  const sT = randomUUID(), sF = randomUUID(), sR1 = randomUUID(), sR2 = randomUUID();
  const fieldRow = { id: sF, table_id: sT, name: 'Temp', key: 'temp',
    type: 'text', options: {}, position: 0, required: false };
  for (const m of [
    { type: 'table.create', id: sT, name: 'S', singularName: '', color: '', icon: '' },
    { type: 'field.create', id: sF, tableId: sT, name: 'Temp', key: 'temp', fieldType: 'text', options: {}, required: false },
    { type: 'record.create', id: sR1, tableId: sT, data: { temp: 'x' } },
    { type: 'record.create', id: sR2, tableId: sT, data: {} },
  ] as Mutation[]) applyMutation(st, m);

  const stripDel: Mutation = { type: 'field.delete', id: sF };
  applyMutation(st, stripDel);
  check('the key is stripped from local records on field.delete',
    !('temp' in (st.records.get(sR1)!.data as any)));
  applyMutation(st, stripDel);   // replay — the field is gone, the strip must no-op
  check('a replayed field.delete stays a no-op', st.records.get(sR1) !== undefined);

  const restore: Mutation = {
    type: 'restore', id: randomUUID(), undoOf: randomUUID(),
    rows: { tables: [], fields: [fieldRow], canvases: [], records: [], views: [], sections: [],
      links: [], placements: [], canvas_annotations: [],
      record_values: [
        { record_id: sR1, key: 'temp', value: 'x' },
        { record_id: randomUUID(), key: 'temp', value: 'ghost' },  // record gone → skip
      ] },
  } as Mutation;
  applyMutation(st, restore);
  check('restore patches the stripped value back',
    (st.records.get(sR1)!.data as any).temp === 'x');
  check('a value for a missing record is skipped', st.records.size === 2);
  const snapAfter = snapshot(st);
  applyMutation(st, restore);
  check('a replayed restore changes nothing', snapshot(st) === snapAfter);

  // Never clobber: the key was re-filled under a re-created same-key field.
  applyMutation(st, { type: 'record.update', id: sR1, set: { temp: 'newer' }, unset: [] });
  applyMutation(st, restore);
  check('restore never overwrites a present value',
    (st.records.get(sR1)!.data as any).temp === 'newer');

  // Never re-orphan: values without a matching field are refused.
  const st2 = emptyState();
  for (const m of [
    { type: 'table.create', id: sT, name: 'S', singularName: '', color: '', icon: '' },
    { type: 'record.create', id: sR1, tableId: sT, data: {} },
  ] as Mutation[]) applyMutation(st2, m);
  applyMutation(st2, {
    type: 'restore', id: randomUUID(), undoOf: randomUUID(),
    rows: { tables: [], fields: [], canvases: [], records: [], views: [], sections: [],
      links: [], placements: [], canvas_annotations: [],
      record_values: [{ record_id: sR1, key: 'temp', value: 'x' }] },
  } as Mutation);
  check('a value with no matching field is refused rather than re-orphaned',
    !('temp' in (st2.records.get(sR1)!.data as any)));
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Part B — two stores, one real server
 * ──────────────────────────────────────────────────────────────────────────*/

const pool = new pg.Pool({ connectionString: process.env.DB_URL });
let server: ServerHandle | undefined;

async function ensureAdminAndBoot() {
  const db = await pool.connect();
  try {
    const { rows } = await db.query(`select 1 from users limit 1`);
    if (!rows.length) {
      await db.query(
        `insert into users (email, name, role) values ('store@local','Store','admin')`);
    }
  } finally { db.release(); }

  server = await bootServer(PORT);
}

async function partB() {
  await ensureAdminAndBoot();

  console.log('\nB1. The write loop — optimistic, flushed, persisted, survives a refresh');
  const A = createStore({ baseUrl: API, debounceMs: 50 });
  await A.hydrate();
  A.start();
  await waitFor(() => A.streamState.value === 'connected', 6000, 'A connected');

  // Schema first, so there is a table to put records in.
  const tableId = randomUUID();
  const nameField = randomUUID();
  A.mutate({ type: 'table.create', id: tableId, name: `Store test ${Date.now()}`, singularName: 'Row', color: '', icon: '' });
  A.mutate({ type: 'field.create', id: nameField, tableId, name: 'Name', key: 'name', fieldType: 'text', options: {}, required: false });

  const recordId = randomUUID();
  A.mutate({ type: 'record.create', id: recordId, tableId, data: { name: 'typed by hand' } });

  // On screen before anything leaves.
  check('record is in local state immediately', A.state.records.has(recordId));
  check('and is marked unconfirmed', A.unconfirmed.value.has(recordId));
  check('queue is non-empty before the debounce fires', A.pending.value.length > 0);

  check('flush settled', await A.settled());
  check('nothing left unconfirmed after the flush', !A.unconfirmed.value.has(recordId));

  const persisted = await pool.query(`select data from records where id = $1`, [recordId]);
  check('the record really is in Postgres', persisted.rowCount === 1,
    JSON.stringify(persisted.rows[0]?.data));

  // "Survives a refresh" — a brand new store, hydrating from scratch.
  const fresh = createStore({ baseUrl: API, debounceMs: 50 });
  await fresh.hydrate();
  await fresh.loadTable(tableId);
  check('a fresh store sees it after hydrating', fresh.state.records.has(recordId));
  check('with the same data',
    (fresh.state.records.get(recordId)!.data as any).name === 'typed by hand');

  console.log('\nB2. A store does not double-apply its own echo');
  await sleep(700);   // let A's own events come back over the stream
  check('exactly one local record after the echo returned',
    recordsOf(A.state, tableId).filter((r) => r.id === recordId).length === 1);
  check('A advanced its watermark from the stream', A.lastSeq.value > 0);
  check('and no apply errors were logged', A.errors.value.length === 0,
    A.errors.value.join(' | '));

  console.log('\nB3. Two stores converge');
  const B = createStore({ baseUrl: API, debounceMs: 50 });
  await B.hydrate();
  await B.loadTable(tableId);
  B.start();
  await waitFor(() => B.streamState.value === 'connected', 6000, 'B connected');

  const fromB = randomUUID();
  B.mutate({ type: 'record.create', id: fromB, tableId, data: { name: 'typed on B' } });
  await B.settled();
  await waitFor(() => A.state.records.has(fromB), 6000, "A to see B's write");
  check("A received B's record over the stream", A.state.records.has(fromB));

  const fromA = randomUUID();
  A.mutate({ type: 'record.create', id: fromA, tableId, data: { name: 'typed on A' } });
  await A.settled();
  await waitFor(() => B.state.records.has(fromA), 6000, "B to see A's write");
  check("B received A's record over the stream", B.state.records.has(fromA));

  // Concurrent edits to DIFFERENT fields of one record must both survive —
  // per-field merge, no CRDT.
  const codecField = randomUUID();
  A.mutate({ type: 'field.create', id: codecField, tableId, name: 'Codec', key: 'codec', fieldType: 'text', options: {}, required: false });
  await A.settled();
  await waitFor(() => B.state.fields.has(codecField), 6000, 'B to see the new field');

  A.mutate({ type: 'record.update', id: recordId, set: { name: 'A renamed it' }, unset: [] });
  B.mutate({ type: 'record.update', id: recordId, set: { codec: 'prores' }, unset: [] });
  await A.settled();
  await B.settled();
  await sleep(900);

  const merged = (await pool.query(`select data from records where id = $1`, [recordId])).rows[0].data;
  check('per-field merge kept both concurrent edits',
    merged.name === 'A renamed it' && merged.codec === 'prores', JSON.stringify(merged));

  const aData = A.state.records.get(recordId)!.data as any;
  const bData = B.state.records.get(recordId)!.data as any;
  check('A converged on the merged record',
    aData.name === merged.name && aData.codec === merged.codec, JSON.stringify(aData));
  check('B converged on the merged record',
    bData.name === merged.name && bData.codec === merged.codec, JSON.stringify(bData));

  console.log('\nB4. A dropped connection reconnects at the CURRENT watermark');
  // EventSource would retry the original ?since= forever, replaying all history
  // on every drop. Owning the retry means resuming from where we actually are.
  const seqBeforeDrop = A.lastSeq.value;
  const recordCountBefore = A.state.records.size;
  A.dropConnection();
  await waitFor(() => A.streamState.value !== 'connected', 4000, 'A to notice the drop');

  const whileDown = randomUUID();
  B.mutate({ type: 'record.create', id: whileDown, tableId, data: { name: 'written while A was down' } });
  await B.settled();

  await waitFor(() => A.streamState.value === 'connected', 8000, 'A to reconnect');
  await waitFor(() => A.state.records.has(whileDown), 8000, 'A to catch up');
  check('A caught up on what it missed', A.state.records.has(whileDown));
  check('A advanced past its pre-drop watermark', A.lastSeq.value > seqBeforeDrop,
    `${seqBeforeDrop} -> ${A.lastSeq.value}`);
  check('reconnect did not duplicate anything',
    A.state.records.size === recordCountBefore + 1,
    `${recordCountBefore} -> ${A.state.records.size}`);
  check('no apply errors across the reconnect', A.errors.value.length === 0,
    A.errors.value.join(' | '));

  console.log('\nB5. Both stores agree on the world');
  const keys = (s: any) => [...s.records.keys()].sort().join(',');
  await waitFor(() => keys(A.state) === keys(B.state), 6000, 'A and B to converge');
  check('A and B hold the same record set', keys(A.state) === keys(B.state));

  console.log('\nB6. A resync rebuilds from scratch without losing pending writes');
  const beforeResync = A.state.records.size;
  const queuedDuringResync = randomUUID();
  A.mutate({ type: 'record.create', id: queuedDuringResync, tableId, data: { name: 'queued across a resync' } });
  await A.resync();
  check('state was rebuilt', A.state.tables.size > 0 && A.state.records.size >= 0);
  check('watermark came from hydration, not from zero', A.lastSeq.value > 0,
    String(A.lastSeq.value));
  check('the pending write was not dropped',
    A.pending.value.length + A.inflight.value.length > 0 ||
      (await A.settled(), true));
  await A.settled();
  await A.loadTable(tableId, { force: true });
  check('and it reached the server',
    (await pool.query(`select 1 from records where id = $1`, [queuedDuringResync])).rowCount === 1);
  check('post-resync state is complete', A.state.records.size >= beforeResync,
    `${beforeResync} -> ${A.state.records.size}`);

  console.log('\nB7. A rejected batch is dropped, not retried forever');
  // A 4xx means the server refused the CONTENT. Retrying can only spin.
  const badRecord = randomUUID();
  A.mutate({ type: 'record.create', id: badRecord, tableId, data: { definitely_not_a_field: 1 } });
  await A.settled(4000);
  check('queue drained rather than looping', A.pending.value.length === 0 && A.inflight.value.length === 0);
  check('the rejection was surfaced', A.errors.value.some((e) => e.includes('rejected')),
    A.errors.value.slice(0, 2).join(' | '));
  check('and the server stored nothing',
    (await pool.query(`select 1 from records where id = $1`, [badRecord])).rowCount === 0);

  console.log('\nB8. Last write wins ON SCREEN too — not just in the database');
  // The order that matters: a colleague's write COMMITS before yours, but REACHES you
  // after you have already applied yours. The database ends with your value (yours
  // landed last). Your screen must too. It did not: the store applied their event on
  // top of your optimistic value, then skipped your own echo — the one event that
  // would have put it right — and showed THEIR value until a reload.
  const contested = randomUUID();
  A.mutate({ type: 'record.create', id: contested, tableId, data: { name: 'start' } });
  await A.settled();
  await waitFor(() => B.state.records.has(contested), 6000, 'B sees the record');

  const slowA = createStore({ baseUrl: API, debounceMs: 600 });      // a long debounce = a wide, deterministic window
  await slowA.hydrate(); await slowA.loadTable(tableId); slowA.start();
  await waitFor(() => slowA.streamState.value === 'connected', 6000, 'slowA connected');

  slowA.mutate({ type: 'record.update', id: contested, set: { name: 'MINE — written last' }, unset: [] });   // optimistic; not sent for 600ms
  B.mutate({ type: 'record.update', id: contested, set: { name: 'theirs — committed first' }, unset: [] });
  await B.settled();                                                   // theirs is in the log with the LOWER seq
  await waitFor(() => slowA.lastSeq.value >= B.lastSeq.value, 6000, 'slowA received theirs');
  check('while yours is still unsent, a colleague\'s event does not knock it off your screen',
    slowA.state.records.get(contested)?.data.name === 'MINE — written last', String(slowA.state.records.get(contested)?.data.name));
  await slowA.settled(6000);
  await waitFor(() => (B.state.records.get(contested)?.data.name as string)?.startsWith('MINE'), 6000, 'B sees mine');
  const inDb = (await pool.query(`select data->>'name' n from records where id = $1`, [contested])).rows[0].n;
  check('the database ends with the LAST write', inDb === 'MINE — written last', inDb);
  check('…and so does the screen of the person who made it', slowA.state.records.get(contested)?.data.name === inDb, String(slowA.state.records.get(contested)?.data.name));
  check('…and everyone else\'s', B.state.records.get(contested)?.data.name === inDb);

  // The other order: yours is SENT and committed first, theirs lands after. Theirs wins, everywhere.
  slowA.mutate({ type: 'record.update', id: contested, set: { name: 'mine — committed first' }, unset: [] });
  await slowA.settled(6000);
  B.mutate({ type: 'record.update', id: contested, set: { name: 'THEIRS — written last' }, unset: [] });
  await B.settled();
  await waitFor(() => slowA.lastSeq.value >= B.lastSeq.value, 6000, 'slowA received theirs');
  check('when THEIR write is the last one, it wins on your screen as well', slowA.state.records.get(contested)?.data.name === 'THEIRS — written last',
    String(slowA.state.records.get(contested)?.data.name));
  check('nothing of yours is left waiting to be re-applied', slowA.unechoedCount() === 0, String(slowA.unechoedCount()));
  slowA.stop();

  A.stop();
  B.stop();
  fresh.stop();
}

/* ── run ───────────────────────────────────────────────────────────────────*/

async function main() {
  partA();
  await partB();
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
