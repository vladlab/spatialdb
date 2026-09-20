import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { boardsTableMutations } from './harness.js';
import { MutationRequest } from '../src/contract/mutations.js';
import { applyBatch, MutationError, type Actor } from '../src/server/apply.js';
import { loadScene, loadUnplaced } from '../src/server/reads.js';

if (!process.env.DB_URL) {
  console.error('DB_URL is not set. Inside `nix develop` it is exported for you;');
  console.error('otherwise: export DB_URL="$(./scripts/db.sh url)"');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.DB_URL });
const clientId = randomUUID();

let pass = 0;
/** The table of boards this suite's canvases live in — see harness.boardsTableMutations. */
const BOARDS = randomUUID();

let fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
}

async function main() {
  const db = await pool.connect();

  // The suite must run on a bare migrated database. Don't assume `db.sh seed`
  // has been run — bootstrap whatever we need.
  let userRow = (await db.query(`select id from users order by created_at limit 1`)).rows[0];
  if (!userRow) {
    userRow = (await db.query(
      `insert into users (email, name, role)
       values ('e2e@local', 'E2E', 'admin') returning id`)).rows[0];
  }
  const admin: Actor = { id: userRow.id, role: 'admin' };
  const viewer: Actor = { ...admin, role: 'viewer' };
  const editor: Actor = { ...admin, role: 'editor' };

  const tableId = randomUUID();
  const nameFieldId = randomUUID();
  const recordId = randomUUID();
  const canvasId = randomUUID();

  console.log('\n1. A batch is one transaction — schema, data and placement together');
  const batch = MutationRequest.parse({
    clientId,
    mutations: [
      ...boardsTableMutations(BOARDS).map((mutation) => ({ id: randomUUID(), mutation })),
      { id: randomUUID(), mutation: { type: 'table.create', id: tableId, name: 'Specs', singularName: 'Spec' } },
      { id: randomUUID(), mutation: { type: 'field.create', id: nameFieldId, tableId, name: 'Name', key: 'name', fieldType: 'text' } },
      { id: randomUUID(), mutation: { type: 'record.create', id: recordId, tableId, data: { name: 'Delivery spec' } } },
      { id: randomUUID(), mutation: { type: 'record.create', id: canvasId, tableId: BOARDS, data: { name: 'Spec canvas' } } },
      { id: randomUUID(), mutation: { type: 'placement.add', id: randomUUID(), canvasId, recordId, x: 100, y: 200 } },
    ],
  });
  const r1 = await applyBatch(db, batch, admin);
  // Seven now: the boards table and its name field joined the batch (sql/010).
  check('all seven mutations applied', r1.applied.length === 7, `${r1.applied.length}`);
  check('server returned a sequence number', r1.seq > 0);

  console.log('\n2. Idempotency — replaying the identical batch is a no-op');
  const r2 = await applyBatch(db, batch, admin);
  check('all seven skipped, none re-applied', r2.skipped.length === 7 && r2.applied.length === 0);
  const dupes = await db.query(`select count(*)::int as n from records where id = $1`, [recordId]);
  check('record was not duplicated', dupes.rows[0].n === 1);

  console.log('\n3. Field-level merge — concurrent edits to different fields coexist');
  await applyBatch(db, MutationRequest.parse({
    clientId,
    mutations: [{ id: randomUUID(), mutation: { type: 'field.create', id: randomUUID(), tableId, name: 'Codec', key: 'codec', fieldType: 'text' } }],
  }), admin);
  await applyBatch(db, MutationRequest.parse({
    clientId,
    mutations: [{ id: randomUUID(), mutation: { type: 'record.update', id: recordId, set: { codec: 'h264' } } }],
  }), editor);
  const merged = await db.query(`select data from records where id = $1`, [recordId]);
  check('new field written without clobbering the old one',
    merged.rows[0].data.name === 'Delivery spec' && merged.rows[0].data.codec === 'h264',
    JSON.stringify(merged.rows[0].data));

  console.log('\n4. Unknown field keys are rejected');
  try {
    await applyBatch(db, MutationRequest.parse({
      clientId,
      mutations: [{ id: randomUUID(), mutation: { type: 'record.update', id: recordId, set: { nonsense: 1 } } }],
    }), editor);
    check('rejected unknown key', false, 'no error thrown');
  } catch (e) {
    check('rejected unknown key', e instanceof MutationError);
  }

  console.log('\n5. Role gating');
  try {
    await applyBatch(db, MutationRequest.parse({
      clientId,
      mutations: [{ id: randomUUID(), mutation: { type: 'table.create', id: randomUUID(), name: 'Sneaky' } }],
    }), editor);
    check('editor blocked from schema change', false, 'no error thrown');
  } catch (e) {
    check('editor blocked from schema change', e instanceof MutationError && e.status === 403);
  }
  try {
    await applyBatch(db, MutationRequest.parse({
      clientId,
      mutations: [{ id: randomUUID(), mutation: { type: 'record.update', id: recordId, set: { codec: 'x' } } }],
    }), viewer);
    check('viewer blocked from writing', false, 'no error thrown');
  } catch (e) {
    check('viewer blocked from writing', e instanceof MutationError && e.status === 403);
  }

  console.log('\n6. Link endpoints must match the field\'s configured target table');
  // Isolated target table, so this needs no seed data.
  const targetTableId = randomUUID();
  const targetRecordId = randomUUID();
  const linkFieldId = randomUUID();
  await applyBatch(db, MutationRequest.parse({
    clientId,
    mutations: [
      { id: randomUUID(), mutation: { type: 'table.create', id: targetTableId, name: 'LinkTargets', singularName: 'LinkTarget' } },
      { id: randomUUID(), mutation: { type: 'field.create', id: randomUUID(), tableId: targetTableId, name: 'Name', key: 'name', fieldType: 'text' } },
      { id: randomUUID(), mutation: { type: 'record.create', id: targetRecordId, tableId: targetTableId, data: { name: 'legit target' } } },
      { id: randomUUID(), mutation: { type: 'field.create', id: linkFieldId, tableId, name: 'Target', key: 'target', fieldType: 'link', options: { target_table_id: targetTableId } } },
    ],
  }), admin);

  // correct table -> accepted
  let accepted = true;
  try {
    await applyBatch(db, MutationRequest.parse({
      clientId,
      mutations: [{ id: randomUUID(), mutation: { type: 'link.add', id: randomUUID(), fieldId: linkFieldId, fromRecord: recordId, toRecord: targetRecordId } }],
    }), editor);
  } catch { accepted = false; }
  check('accepted correct-table link target', accepted);

  // wrong table (a record from the Specs table) -> rejected
  try {
    await applyBatch(db, MutationRequest.parse({
      clientId,
      mutations: [{ id: randomUUID(), mutation: { type: 'link.add', id: randomUUID(), fieldId: linkFieldId, fromRecord: recordId, toRecord: recordId } }],
    }), editor);
    check('rejected wrong-table link target', false, 'no error thrown');
  } catch (e) {
    check('rejected wrong-table link target', e instanceof MutationError, String(e));
  }

  // The from-side. A link's field belongs to exactly one table, so the SOURCE
  // record must live in that table too. Only the target used to be checked,
  // which let a LinkTargets record own a link on a Specs-owned field — loadScene
  // would return it and the canvas would draw an arrow from nowhere.
  try {
    await applyBatch(db, MutationRequest.parse({
      clientId,
      mutations: [{ id: randomUUID(), mutation: { type: 'link.add', id: randomUUID(), fieldId: linkFieldId, fromRecord: targetRecordId, toRecord: targetRecordId } }],
    }), editor);
    check('rejected wrong-table link SOURCE', false, 'no error thrown');
  } catch (e) {
    check('rejected wrong-table link SOURCE', e instanceof MutationError, String(e));
  }

  console.log('\n6b. Unknown field keys are rejected on CREATE, not just UPDATE');
  // This used to pass an empty key list to the validator with a comment saying
  // the record doesn't exist yet, so creates validated nothing at all — while
  // the identical key was rejected on update.
  const badCreate = randomUUID();
  try {
    await applyBatch(db, MutationRequest.parse({
      clientId,
      mutations: [{ id: randomUUID(), mutation: { type: 'record.create', id: badCreate, tableId, data: { name: 'ok', not_a_field: 'x' } } }],
    }), editor);
    check('rejected unknown key on create', false, 'no error thrown');
  } catch (e) {
    check('rejected unknown key on create', e instanceof MutationError, String(e));
  }
  const notCreated = await db.query(`select count(*)::int as n from records where id = $1`, [badCreate]);
  check('the bad record was not stored', notCreated.rows[0].n === 0);
  // The valid case still works.
  const goodCreate = randomUUID();
  await applyBatch(db, MutationRequest.parse({
    clientId,
    mutations: [{ id: randomUUID(), mutation: { type: 'record.create', id: goodCreate, tableId, data: { name: 'fine', codec: 'prores' } } }],
  }), editor);
  const created = await db.query(`select count(*)::int as n from records where id = $1`, [goodCreate]);
  check('valid keys on create still accepted', created.rows[0].n === 1);

  console.log('\n6c. Values are checked against their field type — on BOTH write paths');
  // Keys were validated, values were not: a `number` field accepted "banana".
  // The rule lives in contract/values.ts (shared with the client) and is
  // enforced in apply for create and update alike — 6b exists because a check
  // that covers only one of the two paths has already happened once.
  const vTable = randomUUID();
  const vRec = randomUUID();
  await applyBatch(db, MutationRequest.parse({ clientId, mutations: [
    { id: randomUUID(), mutation: { type: 'table.create', id: vTable, name: 'Typed' } },
    { id: randomUUID(), mutation: { type: 'field.create', id: randomUUID(), tableId: vTable, name: 'Frames', key: 'frames', fieldType: 'number' } },
    { id: randomUUID(), mutation: { type: 'field.create', id: randomUUID(), tableId: vTable, name: 'Due', key: 'due', fieldType: 'date' } },
    { id: randomUUID(), mutation: { type: 'field.create', id: randomUUID(), tableId: vTable, name: 'Status', key: 'status', fieldType: 'select', options: { choices: ['todo', 'doing', 'done'] } } },
    { id: randomUUID(), mutation: { type: 'record.create', id: vRec, tableId: vTable, data: { frames: 24, due: '2026-08-07', status: 'todo' } } },
  ] }), admin);
  check('legal values of every checked type are accepted',
    (await db.query(`select count(*)::int n from records where id=$1`, [vRec])).rows[0].n === 1);

  const rejects = async (data: Record<string, unknown>, onCreate: boolean) => {
    try {
      await applyBatch(db, MutationRequest.parse({ clientId, mutations: [
        onCreate
          ? { id: randomUUID(), mutation: { type: 'record.create', id: randomUUID(), tableId: vTable, data } }
          : { id: randomUUID(), mutation: { type: 'record.update', id: vRec, set: data, unset: [] } },
      ] }), admin);
      return false;
    } catch { return true; }
  };
  check('"banana" in a number field is rejected on create', await rejects({ frames: 'banana' }, true));
  check('and on update', await rejects({ frames: 'banana' }, false));
  check('a non-date string is rejected', await rejects({ due: 'next tuesday' }, false));
  check('an impossible date is rejected', await rejects({ due: '2026-02-31' }, false));
  check('a choice outside the list is rejected', await rejects({ status: 'blocked' }, false));
  check('null is rejected in favour of unset', await rejects({ frames: null }, false));
  const preserved = (await db.query(`select data from records where id=$1`, [vRec])).rows[0].data;
  check('the record is untouched by every rejected write',
    preserved.frames === 24 && preserved.due === '2026-08-07' && preserved.status === 'todo',
    JSON.stringify(preserved));
  check('unset still clears a value without tripping validation',
    await rejects({}, false) === false
    && (await (async () => {
      await applyBatch(db, MutationRequest.parse({ clientId, mutations: [
        { id: randomUUID(), mutation: { type: 'record.update', id: vRec, set: {}, unset: ['due'] } },
      ] }), admin);
      const d = (await db.query(`select data from records where id=$1`, [vRec])).rows[0].data;
      return !('due' in d) && d.frames === 24;
    })()));
  // A multi-select is a set stored as an array. This asserts on the MESSAGE, not
  // just "it threw": `rejects` above passes for any exception at all, so on its
  // own it could not tell this rule from a typo in the fixture.
  await applyBatch(db, MutationRequest.parse({ clientId, mutations: [
    { id: randomUUID(), mutation: { type: 'field.create', id: randomUUID(), tableId: vTable, name: 'Tags', key: 'tags', fieldType: 'multi_select', options: { choices: ['vfx', 'audio'] } } },
  ] }), admin);
  const dupErr = await applyBatch(db, MutationRequest.parse({ clientId, mutations: [
    { id: randomUUID(), mutation: { type: 'record.update', id: vRec, set: { tags: ['vfx', 'vfx'] }, unset: [] } },
  ] }), admin).then(() => '', (e) => String(e.message ?? e));
  check('a multi-select listing a choice twice is rejected, for that reason',
    /more than once/.test(dupErr), dupErr || 'accepted');
  check('the same choices listed once are fine',
    await rejects({ tags: ['vfx', 'audio'] }, false) === false);

  // Old rows are grandfathered: validation is write-time only. Plant a bad
  // value via SQL (as a pre-validation row would be) and show reads still work
  // and unrelated fields stay editable.
  await db.query(`update records set data = data || '{"frames":"legacy"}' where id=$1`, [vRec]);
  check('a pre-existing bad value does not block edits to OTHER fields',
    await rejects({ status: 'done' }, false) === false);

  console.log('\n7. A failed batch rolls back entirely');
  const orphanId = randomUUID();
  try {
    await applyBatch(db, MutationRequest.parse({
      clientId,
      mutations: [
        { id: randomUUID(), mutation: { type: 'record.create', id: orphanId, tableId, data: { name: 'should not survive' } } },
        { id: randomUUID(), mutation: { type: 'record.update', id: orphanId, set: { bogus_key: 1 } } },
      ],
    }), editor);
  } catch { /* expected */ }
  const orphan = await db.query(`select count(*)::int as n from records where id = $1`, [orphanId]);
  check('first mutation rolled back with the second', orphan.rows[0].n === 0);

  console.log('\n8. THE critical distinction — unplacing is not deleting');
  await applyBatch(db, MutationRequest.parse({
    clientId,
    mutations: [{ id: randomUUID(), mutation: { type: 'placement.remove', canvasId, recordId } }],
  }), editor);
  const after = await db.query(
    `select (select count(*)::int from placements where canvas_id=$1 and record_id=$2) as placements,
            (select count(*)::int from records    where id=$2)                        as records`,
    [canvasId, recordId],
  );
  check('placement gone', after.rows[0].placements === 0);
  check('record survives', after.rows[0].records === 1);

  console.log('\n9. Batched drag — ten cards move in one mutation');
  const ids: string[] = [];
  const adds = [];
  for (let i = 0; i < 10; i++) {
    const rid = randomUUID();
    ids.push(rid);
    adds.push({ id: randomUUID(), mutation: { type: 'record.create' as const, id: rid, tableId, data: { name: `card ${i}` } } });
    adds.push({ id: randomUUID(), mutation: { type: 'placement.add' as const, id: randomUUID(), canvasId, recordId: rid, x: 0, y: 0 } });
  }
  await applyBatch(db, MutationRequest.parse({ clientId, mutations: adds }), editor);
  const t0 = Date.now();
  await applyBatch(db, MutationRequest.parse({
    clientId,
    mutations: [{
      id: randomUUID(),
      mutation: { type: 'placement.move', canvasId, moves: ids.map((rid, i) => ({ recordId: rid, x: i * 50, y: i * 20 })) },
    }],
  }), editor);
  const ms = Date.now() - t0;
  // Verify every card landed on its own expected coordinate. The previous
  // version counted rows with `x > 0`, which silently excluded card 0 (it moves
  // to x=0) and so asserted 9 under a label claiming 10 — it would also have
  // passed if the statement had written the same x to every row.
  const landed = await db.query(
    `select count(*)::int as n
       from placements p
       join (select unnest($2::uuid[]) as record_id,
                    unnest($3::float8[]) as x,
                    unnest($4::float8[]) as y) v
         on v.record_id = p.record_id
      where p.canvas_id = $1 and p.x = v.x and p.y = v.y`,
    [canvasId, ids, ids.map((_, i) => i * 50), ids.map((_, i) => i * 20)],
  );
  check(`all 10 landed on their own coordinates in one statement (${ms}ms)`,
    landed.rows[0].n === 10, `matched=${landed.rows[0].n}`);

  console.log('\n10. Catch-up — a client reconnecting with a stale seq');
  const since = r1.seq;
  const behind = await db.query(
    `select type from mutations where seq > $1 order by seq`, [since]);
  check('server can replay everything after a given seq', behind.rowCount! > 0,
    `${behind.rowCount} mutations to replay`);

  console.log('\n11. A replayed batch never rewinds the client watermark');
  // API.md tells the client to store the response `seq` as its watermark. A
  // fully-skipped batch used to report seq 0, so an idempotent replay — the
  // exact thing idempotency exists to make safe — rewound the watermark to zero
  // and triggered a full replay of the entire log.
  const head = Number(
    (await db.query(`select coalesce(max(seq),0) as s from mutations`)).rows[0].s);
  const replayed = await applyBatch(db, batch, admin);
  check('all mutations skipped, as expected', replayed.applied.length === 0 && replayed.skipped.length === 7);
  check('reported seq is the current head, not 0', replayed.seq === head,
    `seq=${replayed.seq} head=${head}`);
  check('a skipped replay broadcasts nothing', replayed.events.length === 0,
    `${replayed.events.length} events`);

  console.log('\n12. Applied mutations yield one broadcastable event each');
  // The old handler built its own per-batch payload from whatever was in scope,
  // which is how it diverged from the catch-up shape. Events now come from the
  // insert's own `returning` clause, one per mutation.
  const three = [1, 2, 3].map((i) => ({
    id: randomUUID(),
    mutation: { type: 'record.create' as const, id: randomUUID(), tableId: BOARDS, data: { name: `evt ${i}` } },
  }));
  const evt = await applyBatch(db, MutationRequest.parse({ clientId, mutations: three }), editor);
  check('3 mutations produced 3 events', evt.events.length === 3, `${evt.events.length}`);
  check('each event carries its own ascending seq',
    evt.events.every((e, i) => i === 0 || e.seq > evt.events[i - 1].seq));
  check('every event is on-contract and non-replay',
    evt.events.every((e) => e.kind === 'mutation' && e.replay === false && typeof e.seq === 'number'));
  check('event seq matches the batch result seq',
    evt.events[evt.events.length - 1].seq === evt.seq);

  console.log('\n13. The unplaced tray is bounded');
  // No limit at all previously: on a fresh canvas this returned every record in
  // the database, serialised into one response, every time the tray opened.
  const trayCanvas = randomUUID();
  await applyBatch(db, MutationRequest.parse({
    clientId,
    mutations: [{ id: randomUUID(), mutation: { type: 'record.create', id: trayCanvas, tableId: BOARDS, data: { name: 'tray probe' } } }],
  }), editor);
  const bulk = [];
  for (let i = 0; i < 30; i++) {
    bulk.push({ id: randomUUID(), mutation: { type: 'record.create' as const, id: randomUUID(), tableId, data: { name: `tray ${i}` } } });
  }
  await applyBatch(db, MutationRequest.parse({ clientId, mutations: bulk }), editor);

  const page1 = await loadUnplaced(db, trayCanvas, undefined, { limit: 10 });
  check('respects the limit', page1.records.length === 10, `${page1.records.length}`);
  check('reports that more exist', page1.hasMore === true);

  // Paging must not skip or repeat. Records created in one batch share a
  // created_at, so ordering needs the id tie-break to be stable at all.
  const page2 = await loadUnplaced(db, trayCanvas, undefined, { limit: 10, offset: 10 });
  const ids1 = new Set((page1.records as any[]).map((r) => r.id));
  const overlap = (page2.records as any[]).filter((r) => ids1.has(r.id));
  check('consecutive pages do not overlap', overlap.length === 0, `${overlap.length} repeated`);

  // And an absurd limit is clamped rather than honoured.
  const huge = await loadUnplaced(db, trayCanvas, undefined, { limit: 99999 });
  check('an absurd limit is clamped', huge.records.length <= 500, `${huge.records.length}`);

  console.log('\n14. A scene is a consistent snapshot that reports its log position');
  const sceneCanvas = canvasId;
  const scene = await loadScene(db, sceneCanvas);
  check('scene returns a seq', !!scene && typeof scene.seq === 'number' && scene.seq > 0,
    `seq=${scene?.seq}`);
  const liveHead = Number(
    (await db.query(`select coalesce(max(seq),0) as s from mutations`)).rows[0].s);
  check('scene seq is a real log position', !!scene && scene.seq <= liveHead,
    `scene=${scene?.seq} head=${liveHead}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  db.release();
  await pool.end();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
