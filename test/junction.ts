/**
 * ============================================================================
 *  Junctions (sql/016, contract/junction.ts) — the rules the server keeps.
 * ============================================================================
 *
 *  Straight against applyBatch, like test/undo.ts: no server process, the
 *  database is the only thing in the loop. What is checked:
 *
 *    1. the config: what a junction may and may not point at
 *    2. a row is WHOLE or it is not: create with both links in one batch, or the
 *       batch fails; an end cannot be unlinked; one row per pair
 *    3. deleting an endpoint record takes its junction rows — and undo brings
 *       them back, links and all; the same through table.delete
 *    4. an endpoint field cannot be deleted
 *    5. the client-side match rule (contract/junction.ts) — pure, no database
 */

import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { MutationRequest, type Mutation } from '../src/contract/mutations.js';
import { applyBatch, MutationError, type Actor } from '../src/server/apply.js';
import { loadUndo } from '../src/server/reads.js';
import { junctionLabel, junctionProblem, matches } from '../src/contract/junction.js';

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const pool = new pg.Pool({ connectionString: process.env.DB_URL });

async function main() {
  const db = await pool.connect();
  let userRow = (await db.query(`select id from users order by created_at limit 1`)).rows[0];
  if (!userRow) {
    userRow = (await db.query(`insert into users (email, name, role) values ('junction@local','Junction','admin') returning id`)).rows[0];
  }
  const admin: Actor = { id: userRow.id, role: 'admin' };
  const clientId = randomUUID();
  const send = (mutations: Mutation[]) =>
    applyBatch(db, MutationRequest.parse({ clientId, mutations: mutations.map((mutation) => ({ id: randomUUID(), mutation })) }), admin);
  const one = (m: Mutation) => send([m]);
  const rejects = async (label: string, ms: Mutation[], needle: string) => {
    try { await send(ms); check(label, false, 'was accepted'); }
    catch (e) { check(label, e instanceof MutationError && e.message.includes(needle), String((e as Error).message)); }
  };
  const count = async (sql: string, params: unknown[] = []) => Number((await db.query(sql, params)).rows[0].n);

  /* ── fixture: Works, Files (→ Work), Deliverables (→ Works), a Delivery junction ── */
  const tWorks = randomUUID(), tFiles = randomUUID(), tDeliv = randomUUID(), tJ = randomUUID();
  const fWorkName = randomUUID(), fFileName = randomUUID(), fFileWork = randomUUID();
  const fDelName = randomUUID(), fDelWorks = randomUUID();
  const jStatus = randomUUID(), jFile = randomUUID(), jDel = randomUUID(), jNotes = randomUUID();
  const blFiles = randomUUID(), blDeliv = randomUUID();
  const ep101 = randomUUID(), ep102 = randomUUID();
  const fileA = randomUUID(), fileB = randomUUID();
  const texted = randomUUID(), textless = randomUUID(), trailer = randomUUID();

  console.log('\n0. Fixture');
  await send([
    { type: 'table.create', id: tWorks, name: 'Works', singularName: 'Work', color: '', icon: '' },
    { type: 'table.create', id: tFiles, name: 'Files', singularName: 'File', color: '', icon: '' },
    { type: 'table.create', id: tDeliv, name: 'Deliverables', singularName: 'Deliverable', color: '', icon: '' },
    { type: 'field.create', id: fWorkName, tableId: tWorks, name: 'Name', key: 'name', fieldType: 'text', options: {}, required: false },
    { type: 'field.create', id: fFileName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text', options: {}, required: false },
    { type: 'field.create', id: fFileWork, tableId: tFiles, name: 'Work', key: 'work', fieldType: 'link', options: { target_table_id: tWorks }, required: false },
    { type: 'field.create', id: fDelName, tableId: tDeliv, name: 'Name', key: 'name', fieldType: 'text', options: {}, required: false },
    { type: 'field.create', id: fDelWorks, tableId: tDeliv, name: 'Works', key: 'works', fieldType: 'link', options: { target_table_id: tWorks }, required: false },
    { type: 'record.create', id: ep101, tableId: tWorks, data: { name: 'Ep 101' } },
    { type: 'record.create', id: ep102, tableId: tWorks, data: { name: 'Ep 102' } },
    { type: 'record.create', id: fileA, tableId: tFiles, data: { name: 'ep101_texted.mov' } },
    { type: 'record.create', id: fileB, tableId: tFiles, data: { name: 'ep102_texted.mov' } },
    { type: 'record.create', id: texted, tableId: tDeliv, data: { name: 'Texted Master' } },
    { type: 'record.create', id: textless, tableId: tDeliv, data: { name: 'Textless Master' } },
    { type: 'record.create', id: trailer, tableId: tDeliv, data: { name: 'Trailer' } },
    { type: 'link.add', id: randomUUID(), fieldId: fFileWork, fromRecord: fileA, toRecord: ep101 },
    { type: 'link.add', id: randomUUID(), fieldId: fFileWork, fromRecord: fileB, toRecord: ep102 },
    // Texted and Textless belong to BOTH episodes; the trailer to neither.
    { type: 'link.add', id: randomUUID(), fieldId: fDelWorks, fromRecord: texted, toRecord: ep101 },
    { type: 'link.add', id: randomUUID(), fieldId: fDelWorks, fromRecord: texted, toRecord: ep102 },
    { type: 'link.add', id: randomUUID(), fieldId: fDelWorks, fromRecord: textless, toRecord: ep101 },
    { type: 'link.add', id: randomUUID(), fieldId: fDelWorks, fromRecord: textless, toRecord: ep102 },
  ]);
  // The junction, wired the way schemaActions.createJunction does it.
  await send([
    { type: 'table.create', id: tJ, name: 'Delivery', singularName: 'Delivery', color: '', icon: '', kind: 'junction' },
    { type: 'field.create', id: jStatus, tableId: tJ, name: 'Status', key: 'status', fieldType: 'select', options: { choices: ['Uploaded', 'Rejected', 'Accepted'] }, required: false },
    { type: 'field.create', id: jFile, tableId: tJ, name: 'File', key: 'file', fieldType: 'link', options: { target_table_id: tFiles, single: true }, required: false },
    { type: 'field.create', id: jDel, tableId: tJ, name: 'Deliverable', key: 'deliverable', fieldType: 'link', options: { target_table_id: tDeliv, single: true }, required: false },
    { type: 'field.create', id: jNotes, tableId: tJ, name: 'Notes', key: 'notes', fieldType: 'long_text', options: {}, required: false },
    { type: 'table.update', id: tJ, junction: { a: jFile, b: jDel, status: jStatus, match: [[fFileWork, fDelWorks]] } },
    { type: 'field.create', id: blFiles, tableId: tFiles, name: 'Delivery', key: 'delivery', fieldType: 'backlink', options: { source_field_id: jFile }, required: false },
    { type: 'field.create', id: blDeliv, tableId: tDeliv, name: 'Delivery', key: 'delivery', fieldType: 'backlink', options: { source_field_id: jDel }, required: false },
  ]);
  const stored = (await db.query(`select kind, junction from tables where id = $1`, [tJ])).rows[0];
  check('kind is junction', stored.kind === 'junction');
  check('config stored', stored.junction.a === jFile && stored.junction.match[0][1] === fDelWorks);

  console.log('\n1. Configuration');
  await rejects('junction config on an ordinary table', [{ type: 'table.update', id: tFiles, junction: { a: jFile, b: jDel } }], "kind 'junction'");
  await rejects('endpoint must be on the junction table', [{ type: 'table.update', id: tJ, junction: { a: fFileWork, b: jDel } }], 'on the junction table');
  await rejects('endpoints must differ', [{ type: 'table.update', id: tJ, junction: { a: jFile, b: jFile } }], 'different');
  await rejects('status must be a select', [{ type: 'table.update', id: tJ, junction: { a: jFile, b: jDel, status: jNotes } }], 'select');
  await rejects('match must be on the right tables', [{ type: 'table.update', id: tJ, junction: { a: jFile, b: jDel, match: [[fDelWorks, fFileWork]] } }], 'match 1');
  {
    const fNotSingle = randomUUID();
    await one({ type: 'field.create', id: fNotSingle, tableId: tJ, name: 'Many', key: 'many', fieldType: 'link', options: { target_table_id: tFiles }, required: false });
    await rejects('endpoint must be single', [{ type: 'table.update', id: tJ, junction: { a: fNotSingle, b: jDel } }], 'single');
    await one({ type: 'field.delete', id: fNotSingle });
  }
  // The same rule, run the way the settings form runs it.
  const fields = (await db.query(`select id, table_id, type, options from fields`)).rows;
  check('contract agrees: good config', junctionProblem(tJ, { a: jFile, b: jDel, status: jStatus, match: [[fFileWork, fDelWorks]] }, fields) === null);
  check('contract agrees: bad status', (junctionProblem(tJ, { a: jFile, b: jDel, status: jNotes }, fields) ?? '').includes('select'));

  console.log('\n2. A row is whole, or it is not');
  const row1 = randomUUID();
  await rejects('create without links', [{ type: 'record.create', id: row1, tableId: tJ, data: { status: 'Uploaded' } }], 'exactly one record through each endpoint');
  check('nothing committed', await count(`select count(*)::int n from records where id=$1`, [row1]) === 0);
  await rejects('create with one link', [
    { type: 'record.create', id: row1, tableId: tJ, data: { status: 'Uploaded' } },
    { type: 'link.add', id: randomUUID(), fieldId: jFile, fromRecord: row1, toRecord: fileA },
  ], 'has 1 and 0');
  await send([
    { type: 'record.create', id: row1, tableId: tJ, data: { status: 'Uploaded' } },
    { type: 'link.add', id: randomUUID(), fieldId: jFile, fromRecord: row1, toRecord: fileA },
    { type: 'link.add', id: randomUUID(), fieldId: jDel, fromRecord: row1, toRecord: texted },
  ]);
  check('created with both links in one batch', await count(`select count(*)::int n from links where from_record=$1`, [row1]) === 2);
  // Order within the batch does not matter: links first, then the record, is fine too.
  const row2 = randomUUID();
  await rejects('links before the record exists is still checked per mutation', [
    { type: 'link.add', id: randomUUID(), fieldId: jFile, fromRecord: row2, toRecord: fileB },
    { type: 'record.create', id: row2, tableId: tJ, data: {} },
  ], 'source record does not exist');
  await rejects('unlinking an end', [{ type: 'link.remove', fieldId: jDel, fromRecord: row1, toRecord: texted }], 'delete the row rather than unlinking');
  check('the link is still there', await count(`select count(*)::int n from links where from_record=$1 and field_id=$2`, [row1, jDel]) === 1);
  await rejects('a second row for the same pair', [
    { type: 'record.create', id: row2, tableId: tJ, data: { status: 'Rejected' } },
    { type: 'link.add', id: randomUUID(), fieldId: jFile, fromRecord: row2, toRecord: fileA },
    { type: 'link.add', id: randomUUID(), fieldId: jDel, fromRecord: row2, toRecord: texted },
  ], 'already has a row for that pair');
  check('duplicate not committed', await count(`select count(*)::int n from records where id=$1`, [row2]) === 0);
  await one({ type: 'record.update', id: row1, set: { status: 'Rejected', notes: 'wrong slate' }, unset: [] });
  check('status changes in place', (await db.query(`select data->>'status' s from records where id=$1`, [row1])).rows[0].s === 'Rejected');
  // A different pair on the same file is fine — a file can target several deliverables.
  await send([
    { type: 'record.create', id: row2, tableId: tJ, data: { status: 'Uploaded' } },
    { type: 'link.add', id: randomUUID(), fieldId: jFile, fromRecord: row2, toRecord: fileA },
    { type: 'link.add', id: randomUUID(), fieldId: jDel, fromRecord: row2, toRecord: textless },
  ]);
  check('same file, other deliverable', await count(`select count(*)::int n from records where table_id=$1`, [tJ]) === 2);

  console.log('\n3. Rows die with their endpoints — and come back with undo');
  const delFile = randomUUID();
  await applyBatch(db, MutationRequest.parse({ clientId, mutations: [{ id: delFile, mutation: { type: 'record.delete', id: fileA } }] }), admin);
  check('file gone', await count(`select count(*)::int n from records where id=$1`, [fileA]) === 0);
  check('both junction rows gone', await count(`select count(*)::int n from records where table_id=$1`, [tJ]) === 0);
  check('their links gone', await count(`select count(*)::int n from links where from_record in ($1,$2)`, [row1, row2]) === 0);
  const cap = await loadUndo(db, delFile);
  check('capture holds the file and its 2 junction rows', (cap!.counts as any).records === 3, JSON.stringify(cap!.counts));
  check('capture holds the junction rows\' 4 links + the file\'s 1', (cap!.counts as any).links === 5, JSON.stringify(cap!.counts));
  await one({ type: 'restore', id: randomUUID(), undoOf: delFile, rows: cap!.rows as any });
  check('file back', await count(`select count(*)::int n from records where id=$1`, [fileA]) === 1);
  check('junction rows back', await count(`select count(*)::int n from records where table_id=$1`, [tJ]) === 2);
  check('status survived the round trip', (await db.query(`select data->>'status' s from records where id=$1`, [row1])).rows[0].s === 'Rejected');
  check('links back', await count(`select count(*)::int n from links where from_record in ($1,$2)`, [row1, row2]) === 4);
  // Restore itself touches nothing the whole-row check would see; rows are whole again.

  // From the OTHER end, through table.delete of Deliverables.
  const delTable = randomUUID();
  await applyBatch(db, MutationRequest.parse({ clientId, mutations: [{ id: delTable, mutation: { type: 'table.delete', id: tDeliv } }] }), admin);
  check('junction rows gone with the deliverables table', await count(`select count(*)::int n from records where table_id=$1`, [tJ]) === 0);
  const capT = await loadUndo(db, delTable);
  check('table capture includes the junction rows', (capT!.counts as any).records === 5, JSON.stringify(capT!.counts));
  await one({ type: 'restore', id: randomUUID(), undoOf: delTable, rows: capT!.rows as any });
  check('deliverables and junction rows back', await count(`select count(*)::int n from records where table_id in ($1,$2)`, [tDeliv, tJ]) === 5);
  check('the junction\'s links back', await count(`select count(*)::int n from links where from_record in ($1,$2)`, [row1, row2]) === 4);

  console.log('\n3b. A junction column can COMPARE (contract/compare.ts) — against the other end\'s table');
  const fFileCodec = randomUUID(), fDelCodec = randomUUID();
  await send([
    { type: 'field.create', id: fFileCodec, tableId: tFiles, name: 'Codec', key: 'codec', fieldType: 'text', options: {}, required: false },
    { type: 'field.create', id: fDelCodec, tableId: tDeliv, name: 'Codec', key: 'codec', fieldType: 'text', options: {}, required: false },
  ]);
  await one({ type: 'field.update', id: blFiles, options: { source_field_id: jFile, compare: { pairs: [{ from: fFileCodec, to: fDelCodec, rule: 'equals' }] } } });
  check('pairs of Files fields ↔ Deliverables fields are accepted on the Delivery column',
    (await db.query(`select options->'compare'->'pairs' p from fields where id = $1`, [blFiles])).rows[0].p?.length === 1);
  await rejects('a pair whose "to" is not on the other end\'s table', [{ type: 'field.update', id: blFiles, options: { source_field_id: jFile, compare: { pairs: [{ from: fFileCodec, to: fFileName, rule: 'equals' }] } } }], 'target table');
  {
    const plain = randomUUID();
    await rejects('an ordinary backlink cannot compare', [
      { type: 'field.create', id: plain, tableId: tWorks, name: 'Files', key: 'files', fieldType: 'backlink', options: { source_field_id: fFileWork, compare: { pairs: [] } }, required: false },
    ], 'only a link, or the column of a junction');
  }
  await one({ type: 'field.update', id: blFiles, options: { source_field_id: jFile } });

  console.log('\n4. Endpoints are not deletable; the junction table is');
  await rejects('deleting an endpoint field', [{ type: 'field.delete', id: jFile }], 'endpoint of the junction');
  await one({ type: 'field.delete', id: jNotes });
  check('an ordinary field on the junction can go', await count(`select count(*)::int n from fields where id=$1`, [jNotes]) === 0);
  await one({ type: 'table.delete', id: tJ });
  check('junction table deleted', await count(`select count(*)::int n from tables where id=$1`, [tJ]) === 0);
  check('endpoint records untouched', await count(`select count(*)::int n from records where table_id in ($1,$2)`, [tFiles, tDeliv]) === 5);

  console.log('\n5. The match rule (contract/junction.ts)');
  const cfg = { a: jFile, b: jDel, match: [[fFileWork, fDelWorks]] as [string, string][] };
  const links: Record<string, string[]> = {
    [fileA + fFileWork]: [ep101], [fileB + fFileWork]: [ep102],
    [texted + fDelWorks]: [ep101, ep102], [textless + fDelWorks]: [ep101, ep102], [trailer + fDelWorks]: [],
  };
  const linksFrom = (r: string, f: string) => links[r + f] ?? [];
  check('file 101 matches Texted (shared episode)', matches(cfg, 'a', fileA, texted, linksFrom));
  check('file 102 matches Texted too (intersection, not equality)', matches(cfg, 'a', fileB, texted, linksFrom));
  check('the trailer belongs to no episode: no match', !matches(cfg, 'a', fileA, trailer, linksFrom));
  check('from the deliverable side', matches(cfg, 'b', texted, fileB, linksFrom));
  check('a file with no Work has no opinion', matches(cfg, 'a', 'orphan', trailer, linksFrom));
  check('label from the file', junctionLabel('Uploaded', 'ep101_texted.mov', 'Texted Master', 'a') === 'Texted Master › Uploaded');
  check('label from the deliverable', junctionLabel('Uploaded', 'ep101_texted.mov', 'Texted Master', 'b') === 'ep101_texted.mov › Uploaded');
  check('label from nowhere', junctionLabel('', 'a', 'b') === 'a → b' && junctionLabel('Accepted', 'a', 'b') === 'a → b › Accepted');

  db.release();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
