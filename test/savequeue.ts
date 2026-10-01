/**
 * ============================================================================
 *  The save queue: what happens to your work when the server says no.
 * ============================================================================
 *
 *  Every change is applied on screen at once and sent a moment later. This suite
 *  is about the moment the server does not accept it — which used to end one of
 *  two ways, both bad:
 *
 *    500  the batch was retried forever. Ordinary two-person races answered 500
 *         (a card placed for a record a colleague had just deleted), so the queue
 *         wedged behind one doomed change and every later edit sat in memory
 *         under "queued, not lost" until the tab was reloaded — and lost.
 *    4xx  the WHOLE batch was dropped, the unrelated changes beside the bad one
 *         included, and all of it stayed on screen as if saved.
 *
 *  What must hold now:
 *
 *    A. the server's status is TRUE (4xx = never, 5xx = try again) and it names
 *       the one mutation the batch died on                (server/failures.ts)
 *    B. the client gives up that one ACTION, sends the rest, and reloads the
 *       screen from the server                            (store.ts `rejected`)
 *    C. a mutation that crashes the server three times running is given up too
 *    D. a resync keeps you where you were — same table, same canvas, same open
 *       record — and never passes through an empty state  (store.ts `resync`)
 *    E. leaving the page with unsent changes asks first   (App.vue)
 *
 *  Run: npm run test:savequeue
 */
import { randomUUID as u } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';
import { failureOf } from '../src/server/failures.js';
import { MutationError } from '../src/server/apply.js';
import { validateValue } from '../src/contract/values.js';
import type { Store } from '../src/client/store.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const BOARDS = u(), boardA = u(), boardB = u();
  const tAlpha = u(), fAlpha = u(), tFiles = u(), fName = u(), fTag = u();
  const placed = u(), other = u();
  const fld = (id: string, tableId: string, name: string, key: string, fieldType: string, options: unknown = {}) =>
    ({ type: 'field.create', id, tableId, name, key, fieldType, options, required: false });

  // Opened ON the second canvas with a record in the tray: where part D must leave us.
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8823), `#/all/canvas/${boardB}?r=${placed}`, {}, async (post) => {
    const r = await post([
      { type: 'table.create', id: BOARDS, name: 'Boards', singularName: 'Board', kind: 'canvas' }, fld(u(), BOARDS, 'Name', 'name', 'text'),
      { type: 'table.create', id: tAlpha, name: 'Alpha', singularName: 'Alpha' }, fld(fAlpha, tAlpha, 'Name', 'name', 'text'),
      { type: 'table.create', id: tFiles, name: 'Files', singularName: 'File' }, fld(fName, tFiles, 'Name', 'name', 'text'),
      fld(fTag, tFiles, 'Tag', 'tag', 'select'),          // no choices: any string passes the contract
      { type: 'record.create', id: boardA, tableId: BOARDS, data: { name: 'A first' } },
      { type: 'record.create', id: boardB, tableId: BOARDS, data: { name: 'B second' } },
      { type: 'record.create', id: placed, tableId: tFiles, data: { name: 'reel_10.mov' } },
      { type: 'record.create', id: other, tableId: tFiles, data: { name: 'reel_11.mov' } },
      { type: 'placement.add', id: u(), canvasId: boardB, recordId: placed, x: 40, y: 40 },
    ]);
    if (r.status !== 200) throw new Error(await r.text());
  });
  const { w, win, until, pool, API } = ui;
  // Anything that imports Vue is loaded AFTER the harness has made a DOM: Vue reads
  // `document` once, when it is first imported.
  const { watch } = await import('vue');
  const { createStore } = await import('../src/client/store.js');
  const { mappedData } = await import('../src/client/tools/fileDrop.js');
  const send = async (mutations: any[]) => {
    const body = { clientId: u(), mutations: mutations.map((mutation) => ({ id: u(), mutation })) };
    const res = await fetch(`${API}/api/mutate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, ids: body.mutations.map((m) => m.id), body: await res.json().catch(() => ({})) as any };
  };
  const onServer = async (id: string) => (await pool.query(`select 1 from records where id = $1`, [id])).rowCount === 1;
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));     // ends an action: a new run starts after it

  try {
    /* ── A ─────────────────────────────────────────────────────────────── */
    console.log('\nA. The server says which kind of failure it is, and which mutation');
    const goneRec = u();
    await send([{ type: 'record.create', id: goneRec, tableId: tFiles, data: { name: 'deleted by a colleague' } }]);
    await send([{ type: 'record.delete', id: goneRec }]);
    const a1 = await send([{ type: 'placement.add', id: u(), canvasId: boardA, recordId: goneRec, x: 0, y: 0 }]);
    check('a card for a record someone just deleted: 409, not 500', a1.status === 409, `${a1.status} ${JSON.stringify(a1.body).slice(0, 120)}`);
    check('…it names the mutation', a1.body.failed === a1.ids[0], String(a1.body.failed));
    check('…and says why in words', /no longer exists/.test(a1.body.error ?? ''), a1.body.error);

    const goneTable = u();
    await send([{ type: 'table.create', id: goneTable, name: 'Gone', singularName: 'Gone' }]);
    await send([{ type: 'table.delete', id: goneTable }]);
    const a2 = await send([{ type: 'record.create', id: u(), tableId: goneTable, data: {} }]);
    check('a row for a table an admin just deleted: 409', a2.status === 409 && a2.body.failed === a2.ids[0], `${a2.status}`);
    const a3 = await send([{ type: 'view.create', id: u(), tableId: goneTable, name: 'v', config: {} }]);
    check('a view saved on it: 409', a3.status === 409, `${a3.status}`);

    const a4 = await send([{ type: 'record.update', id: u(), set: {}, unset: [] }]);
    check('an update of a record that is gone, with nothing in it: 400 (it was a TypeError → 500)', a4.status === 400 && /does not exist/.test(a4.body.error), `${a4.status} ${a4.body.error}`);

    const a5 = await send([{ type: 'record.create', id: u(), tableId: tFiles, data: { tag: 'ProRes\u0000' } }]);
    check('a value Postgres cannot store (a NUL the contract did not catch): 400, said in words', a5.status === 400 && /NUL/.test(a5.body.error) && a5.body.failed === a5.ids[0], `${a5.status} ${a5.body.error}`);
    check('…and in a text field the contract catches it first', /NUL/.test(validateValue({ key: 'name', type: 'text', options: {} } as never, 'a\u0000b') ?? ''));
    const md = mappedData({ title: 'Reel 10\u0000\u0000', empty: '\u0000' }, new Map([['title', 'name'], ['empty', 'tag']]),
      [{ id: fName, table_id: tFiles, name: 'Name', key: 'name', type: 'text', options: {}, position: 0, required: false },
       { id: fTag, table_id: tFiles, name: 'Tag', key: 'tag', type: 'select', options: {}, position: 1, required: false }]);
    check('a file\'s tag with NUL padding is written without it (file drop); one that was ONLY padding is not written',
      md.data.name === 'Reel 10' && !('tag' in md.data) && md.skipped.length === 0, JSON.stringify(md));

    const good = u();
    const a6 = await send([
      { type: 'record.create', id: good, tableId: tFiles, data: { name: 'fine' } },
      { type: 'record.update', id: goneRec, set: { name: 'x' }, unset: [] },
    ]);
    check('in a batch of two it names the SECOND', a6.status === 400 && a6.body.failed === a6.ids[1], `${a6.status} ${a6.body.failed}`);
    check('…and applied neither (a batch is one transaction)', !(await onServer(good)));

    const bad = { clientId: u(), mutations: [
      { id: u(), mutation: { type: 'record.create', id: u(), tableId: tFiles, data: { name: 'ok' } } },
      { id: u(), mutation: { type: 'record.update', id: u(), data: { name: 'misspelt: data, not set' } } },
    ] };
    const a7 = await (await fetch(`${API}/api/mutate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bad) })).json() as any;
    check('a mutation that does not parse is named too', a7.failed === bad.mutations[1].id, JSON.stringify(a7).slice(0, 120));

    const named = (e: unknown) => { (e as { mutationId: string }).mutationId = 'm'; return e; };
    check('failureOf: our own refusal keeps its status', failureOf(named(new MutationError('no', 403))).status === 403);
    check('failureOf: a database that is shutting down is 503 and names NOTHING (retry everything)',
      failureOf(named({ code: '57P01', message: 'terminating connection' })).status === 503 && failureOf(named({ code: '57P01', message: 'x' })).body.failed === undefined);
    check('failureOf: no connection to be had is 503', failureOf(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })).status === 503);
    check('failureOf: a deadlock is 503', failureOf({ code: '40P01', message: 'deadlock detected' }).status === 503);
    check('failureOf: a bug in apply is 500 and names the mutation', failureOf(named(new TypeError('x is undefined'))).status === 500 && failureOf(named(new TypeError('x'))).body.failed === 'm');

    /* ── B ─────────────────────────────────────────────────────────────── */
    console.log('\nB. One refused action does not take the others with it — and does not stay on screen');
    const A = createStore({ baseUrl: API, debounceMs: 60 });
    await A.hydrate(); A.start(); await A.loadTable(tFiles);
    await until(() => A.streamState.value === 'connected');
    // A record this client holds and the server no longer has. Deleted in SQL, so no
    // event tells A: the state "a colleague deleted it and I have not heard yet".
    const stale = u();
    await send([{ type: 'record.create', id: stale, tableId: tFiles, data: { name: 'about to vanish' } }]);
    await until(() => A.state.records.has(stale));
    await pool.query(`delete from records where id = $1`, [stale]);

    const before = u(), after = u(), half = u();
    A.mutate({ type: 'record.create', id: before, tableId: tFiles, data: { name: 'typed BEFORE the bad one' } } as never);
    await tick();
    A.mutate({ type: 'record.update', id: stale, set: { name: 'an edit to a deleted record' }, unset: [] } as never);
    A.mutate({ type: 'record.create', id: half, tableId: tFiles, data: { name: 'same action as the bad one' } } as never);
    await tick();
    A.mutate({ type: 'record.create', id: after, tableId: tFiles, data: { name: 'typed AFTER the bad one' } } as never);
    check('all four are on screen at once (optimistic), in one unsent batch', A.state.records.has(before) && A.state.records.has(half) && A.state.records.has(after) && A.pending.value.length === 4);
    await A.settled(6000);
    await until(() => A.errors.value.some((e) => e.includes('rejected')) && !A.state.records.has(stale), 6000);
    check('the changes made before and after it are SAVED', (await onServer(before)) && (await onServer(after)), `${await onServer(before)} ${await onServer(after)}`);
    check('the refused action is not — all of it, including its valid half', !(await onServer(half)));
    check('the banner says what was refused, how much went, and that the rest was re-sent',
      A.errors.value.some((e) => e.includes('rejected (400)') && e.includes('record does not exist') && e.includes('Dropped 2') && e.includes('2 other')), A.errors.value[0]);
    check('the SCREEN has stopped showing it: the deleted record is gone', !A.state.records.has(stale));
    check('…and so is the half that was never saved', !A.state.records.has(half));
    check('…while what was saved is still there', A.state.records.has(before) && A.state.records.has(after));
    check('the queue is empty, not wedged', A.unsaved() === 0);
    check('the table is still loaded (no re-walk needed)', A.tableLoads.get(tFiles)?.state === 'loaded');

    // Ctrl+Z must not offer to undo something that never happened.
    const B = createStore({ baseUrl: API, debounceMs: 30 });
    await B.hydrate(); B.start();
    B.mutate({ type: 'record.create', id: u(), tableId: tFiles, data: { name: 'a card', tag: 'x' } } as never);
    B.mutate({ type: 'placement.add', id: u(), canvasId: tFiles, recordId: other, x: 0, y: 0 } as never);    // "on" a table: not a board
    check('before the answer there is something to undo', B.canUndo.value);
    await B.settled(6000);
    await until(() => B.errors.value.some((e) => e.includes('rejected')));
    check('a refused action leaves no Ctrl+Z step behind', !B.canUndo.value);
    B.stop();

    /* ── C ─────────────────────────────────────────────────────────────── */
    console.log('\nC. A mutation that crashes the server is given up after three tries; the queue moves on');
    await pool.query(`create or replace function _crash() returns trigger as $$ begin
        if new.data->>'name' = 'CRASH' then raise exception 'a bug in the server'; end if; return new; end $$ language plpgsql`);
    await pool.query(`create trigger _crash before insert on records for each row execute function _crash()`);
    const crasher = u(), behind = u();
    A.errors.value.length = 0;
    A.mutate({ type: 'record.create', id: crasher, tableId: tFiles, data: { name: 'CRASH' } } as never);
    await tick();
    A.mutate({ type: 'record.create', id: behind, tableId: tFiles, data: { name: 'queued behind it' } } as never);
    await sleep(350);
    check('at first it is retried, and says so (a 500 may pass)', A.unsaved() === 2 && A.errors.value.some((e) => e.includes('Saving is failing')), A.errors.value[0]);
    check('the edit queued behind it is saved within seconds, not never', await until(() => A.unsaved() === 0, 8000) && await onServer(behind), `unsaved=${A.unsaved()}`);
    check('the crasher was dropped, loudly, with the server\'s own words', A.errors.value.some((e) => e.includes('rejected (500)') && e.includes('a bug in the server')) && !A.state.records.has(crasher), A.errors.value[0]);
    check('the "saving is failing" line is gone', !A.errors.value.some((e) => e.includes('Saving is failing')));
    await pool.query(`drop trigger _crash on records`);
    await pool.query(`drop function _crash()`);
    A.stop();

    /* ── D ─────────────────────────────────────────────────────────────── */
    console.log('\nD. A resync keeps you where you were');
    const cards = () => w.findAll('.card').length;
    check('opened on the SECOND canvas, with its card and the record in the tray',
      await until(() => cards() === 1 && w.find('.record-panel .rp-title').exists() && w.find('.record-panel .rp-title').text() === 'reel_10.mov', 8000),
      `cards=${cards()} hash=${win.location.hash}`);
    const store = (w.vm as any).store as Store;
    check('(the suite can reach the app\'s store)', typeof store?.resync === 'function');
    const hash0 = win.location.hash;
    // The emptiest state any watcher is shown — an ordinary one, like the app's own
    // "keep the pickers pointing at something real". Before, the answer was 0: the
    // state was cleared, THEN fetched, and the app spent the wait with no tables.
    let fewestTables = Infinity, fewestPlacements = Infinity;
    const stop = watch(() => [store.state.tables.size, store.state.placements.size], ([t, p]) => { fewestTables = Math.min(fewestTables, t); fewestPlacements = Math.min(fewestPlacements, p); }, { immediate: true });
    const hashes = new Set<string>();
    const poll = setInterval(() => hashes.add(win.location.hash), 5);
    // An unsent change must survive on screen too.
    store.mutate({ type: 'record.update', id: placed, set: { name: 'reel_10.mov (renamed, unsent)' }, unset: [] } as never);
    await store.resync();
    await sleep(300);
    clearInterval(poll); stop();
    check('nothing watching the state ever saw it empty', fewestTables >= 3 && fewestPlacements >= 1, `tables>=${fewestTables} placements>=${fewestPlacements}`);
    check('the address never changed: same canvas, same record', hashes.size <= 1 && win.location.hash === hash0, [...hashes].join(' | '));
    check('the canvas still shows its card', cards() === 1, String(cards()));
    check('the tray still shows its record — with the change that had not been sent yet',
      await until(() => w.find('.record-panel .rp-title').text() === 'reel_10.mov (renamed, unsent)'), w.find('.record-panel').exists() ? w.find('.record-panel .rp-title').text() : 'no panel');
    await store.settled();
    check('…which then reaches the server', (await pool.query(`select data->>'name' n from records where id = $1`, [placed])).rows[0].n === 'reel_10.mov (renamed, unsent)');

    // The grid: a refusal reloads the table in place.
    win.location.hash = `#/all/table/${tFiles}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    const rowCount = () => w.findAll('.gridview tr.row').length;
    await until(() => rowCount() >= 2, 6000);
    const n0 = rowCount();
    const doomed = u();
    await send([{ type: 'record.create', id: doomed, tableId: tFiles, data: { name: 'doomed' } }]);
    check('a new row arrives over the stream', await until(() => rowCount() === n0 + 1, 6000), `${rowCount()} vs ${n0 + 1}`);
    await pool.query(`delete from records where id = $1`, [doomed]);
    store.errors.value.length = 0;
    store.mutate({ type: 'record.update', id: doomed, set: { name: 'edited after it was deleted' }, unset: [] } as never);
    check('editing a row the server no longer has: the row leaves the grid', await until(() => rowCount() === n0, 6000), `${rowCount()} vs ${n0}`);
    check('…the banner says why', await until(() => w.find('.errors').exists() && w.find('.errors').text().includes('record does not exist')), w.find('.errors').exists() ? w.find('.errors').text().slice(0, 140) : 'no banner');
    check('…and you are still on the same table (it is the second in the list, not the first)', win.location.hash.startsWith(`#/all/table/${tFiles}`), win.location.hash);
    await w.find('.errors .error-line').trigger('click');
    check('a banner line goes away when clicked', await until(() => !w.find('.errors').exists()));

    /* ── E ─────────────────────────────────────────────────────────────── */
    console.log('\nE. Leaving the page with unsent changes asks first');
    const leave = () => { const e = new (win as any).Event('beforeunload', { cancelable: true }); win.dispatchEvent(e); return e.defaultPrevented as boolean; };
    await store.settled();
    check('nothing unsent: the page may close without a word', leave() === false);
    store.mutate({ type: 'record.update', id: other, set: { name: 'typed a moment before closing the tab' }, unset: [] } as never);
    check('a change still in the queue: the browser is asked to confirm', store.unsaved() === 1 && leave() === true);
    await store.settled();
    check('…and once it is saved, no longer', leave() === false);
  } finally {
    await ui.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
