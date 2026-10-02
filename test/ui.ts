/**
 * The UI suite: the real App, mounted in a simulated DOM, driven by clicks.
 *
 * Every other suite drives the store or the HTTP API. None of them ever mounted a
 * component, and the first two bugs found by actually USING the app both lived in
 * that gap: the schema tab rendered nothing (its tag had been deleted from
 * App.vue while the import survived), and creating your first table left the
 * table tab saying "no tables". Six green suites, and no way to create a table.
 *
 * So this one starts where a person does — an EMPTY, bootstrapped database — and
 * does what a person would: open a tab, type, click, look at what changed.
 *
 * What it is: happy-dom (a DOM in Node) + @vue/test-utils, against a real server
 * and real Postgres. The app is compiled by Vite in CLIENT mode first; loading
 * it through Vite's SSR loader compiles templates for server rendering, which
 * cannot be mounted.
 *
 * What it is NOT: a browser. It has no layout and no paint. It can tell you a
 * component did not render or that Enter did not move the selection; it cannot
 * tell you a focus ring is clipped or a menu opens off-screen. Those still need
 * eyes. It also means the grid's row WINDOWING is not exercised here — every
 * element measures 0px, so the viewport falls back to its default height. The
 * window maths is simple and the tables here are tiny; do not read a pass as
 * "scrolling works".
 *
 * Assertions read the DOM, then — where it matters — ask the SERVER, because an
 * optimistic UI will happily show a row that was never saved.
 */

import pg from 'pg';
import { Window } from 'happy-dom';
import { bootServer, type ServerHandle } from './harness.js';
import { CARD_W, cardHeight, rowPortY } from '../src/client/canvas/cardLayout.js';
import { navigator } from './uiHarness.js';

// A throwaway assets directory for the server this suite boots (it inherits env).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const UI_ASSETS = mkdtempSync(join(tmpdir(), 'spatialdb-ui-assets-'));
process.env.SPATIALDB_ASSETS_DIR = UI_ASSETS;
process.on('exit', () => rmSync(UI_ASSETS, { recursive: true, force: true }));

const PORT = Number(process.env.TEST_PORT ?? 8805);
const API = `http://localhost:${PORT}`;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/**
 * Wait for the SERVER to reach a state, by asking it. The first draft waited for
 * the "N queued" badge to clear — but a batch leaves `pending` the moment it goes
 * in flight, so the badge clears before the write has landed and the very next
 * query saw an empty database. Polling for the expected row is the only wait
 * that means "saved".
 */
async function untilDb(sql: string, ok: (rows: any[]) => boolean, ms = 5000) {
  const deadline = Date.now() + ms;
  let rows: any[] = [];
  while (Date.now() < deadline) {
    rows = (await pool.query(sql)).rows;
    if (ok(rows)) break;
    await sleep(50);
  }
  return rows;
}
async function until(predicate: () => boolean, ms = 4000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (predicate()) return true; await sleep(25); }
  return false;
}

/* ── a browser-shaped global scope ─────────────────────────────────────────
   Vue's runtime-dom and test-utils reach for DOM constructors as GLOBALS
   (`Document`, `SVGElement`, `HTMLSelectElement`…). Copy everything the window
   has that Node does not, rather than a hand-picked list — the hand-picked list
   in the throwaway version of this file was missing `Document`, which surfaced
   as a confusing error from inside v-model on a <select>. */
const win = new Window({ url: `${API}/` });
for (const key of Object.getOwnPropertyNames(win)) {
  if (key in globalThis) continue;
  try { Object.defineProperty(globalThis, key, { value: (win as any)[key], configurable: true, writable: true }); }
  catch { /* non-configurable on this Node; nothing here needs it */ }
}
Object.assign(globalThis, { window: win, document: win.document });
// The app calls relative /api paths (same-origin behind Vite in dev).
const nodeFetch = globalThis.fetch;
globalThis.fetch = ((u: any, o: any) =>
  nodeFetch(typeof u === 'string' && u.startsWith('/') ? API + u : u, o)) as typeof fetch;
// prompt/confirm are how the crude UI asks for names and confirms deletes.
// prompt()/confirm() are gone from the app (client/dialogs.ts). The navigator's
// autopilot answers the app's own dialogs through their DOM instead.

const pool = new pg.Pool({ connectionString: process.env.DB_URL });
let server: ServerHandle | undefined;

async function main() {
  // An EMPTY database with a user and nothing else — `reset && bootstrap`.
  // Deliberately not the seeded example: "works once data exists" is what every
  // other suite already establishes.
  await pool.query(`truncate tables, canvases, mutations cascade`);
  if (!(await pool.query(`select 1 from users limit 1`)).rowCount) {
    await pool.query(`insert into users (email, name, role) values ('ui@local','UI','admin')`);
  }
  server = await bootServer(PORT);

  const { build } = await import('vite');
  await build({
    logLevel: 'error',
    build: {
      lib: { entry: 'src/client/App.vue', formats: ['es'], fileName: 'app' },
      outDir: '.uitest', emptyOutDir: true, minify: false,
      rollupOptions: { external: ['vue'] },   // ONE copy of Vue, shared with test-utils
    },
  });
  const { mount } = await import('@vue/test-utils');
  const App = (await import('../.uitest/app.js' as string)).default;

  const w = mount(App, { attachTo: win.document.body as unknown as Element });
  const nav = navigator(w, until);
  // `tab(x).trigger('click')` is how this file has always switched tabs; kept, over the new tab bar.
  const tab = (name: 'canvas' | 'table' | 'history') => ({ trigger: (_: 'click') => nav.tab(name) });
  const texts = (sel: string) => w.findAll(sel).map((x) => x.text());
  /** Column names only — a th also holds the ★, the sort mark, the ▾, and any OPEN popover. */
  const ths = () => texts('.gridview thead th .th-name');

  console.log('\nU0. The front door');
  check('a fresh database opens on HOME: no sections yet, but "Everything" is always there',
    await until(() => w.find('.home').exists()) && w.find('.card.everything').exists() && !w.find('.tree .well').exists());
  await w.find('.card.everything').trigger('click');
  check('Everything is the whole app, as it was', await until(() => w.find('.tree .well').exists()) && win.location.hash.startsWith('#/all/'), win.location.hash);

  console.log('\nU1. A fresh database: connect, and find a way to make a table');
  check('the stream connects promptly on an idle database',
    await until(() => w.find('.status.connected').exists(), 3000),
    w.find('.status').text());
  check('there is NO tab bar: the tree is the navigation, and Settings is its footer',
    !w.find('.tabbar').exists() && !w.find('[role="tab"]').exists() && w.find('.tree .tree-foot .settings-btn').exists());

  check('with no table yet, the main area says so, and where to make one',
    /press \+ beside .Tables./.test(w.find('.hint').text()), w.find('.hint').text());
  check('the tree is there, with its Tables and Canvases subheaders',   // the old regression: no way to make a table
    w.find('.tree .new-table-btn').exists() && /Tables/i.test(w.find('.tree').text()) && /Canvases/i.test(w.find('.tree').text()));

  console.log('\nU2. A table from the tree, then fields from the grid');
  await nav.newTable('Files');
  check('"+" beside Tables makes one, lists it in the tree, and opens it',
    await until(() => nav.tableNames().join() === 'Files' && w.find('.gridview').exists()), nav.tableNames().join());
  check('— through the app\'s own dialog, not the browser\'s', nav.dialogs.seen.includes('New table'), nav.dialogs.seen.join());

  const gridPop = () => w.find('.gridview .popover');
  // FieldForm — opened from the grid's "+" column header, which is now the ONLY place.
  async function addField(name: string, type: string, extra?: string, within?: ReturnType<typeof gridPop>) {
    if (!within) {
      if (!gridPop().exists()) await w.find('.gridview .th-add').trigger('click');
      within = gridPop();
    }
    await within.find('input.name').setValue(name);
    await within.find('select.type').setValue(type);
    if (extra !== undefined) await within.find('input.choices').setValue(extra);
    await within.find('button.add').trigger('click');
  }
  await addField('Name', 'text');
  await addField('Frames', 'number');
  await addField('Status', 'select', 'todo, doing, done');
  check('the key was derived from the name without being typed (it is behind "advanced")',
    !gridPop().find('input.key').exists());
  await gridPop().trigger('keydown', { key: 'Escape' });
  check('three columns, in the order they were added — then the two SYSTEM columns every table has', await until(() => ths().join() === 'Name,Frames,Status,Created,Created by'), ths().join());

  const savedRows = await untilDb(
    `select f.key, f.type, f.options from fields f join tables t on t.id = f.table_id
      where t.name = 'Files' order by f.position`, (r) => r.length === 3);
  const saved = { rows: savedRows };
  check('and the SERVER has them, typed, in that order',
    saved.rows.map((r) => `${r.key}:${r.type}`).join() === 'name:text,frames:number,status:select',
    JSON.stringify(saved.rows.map((r) => `${r.key}:${r.type}`)));
  check('with the select choices parsed from the comma list',
    JSON.stringify(saved.rows[2]?.options?.choices) === '["todo","doing","done"]',
    JSON.stringify(saved.rows[2]?.options));

  console.log('\nU3. The grid for the new table');
  check('with a column per field', ths().join() === 'Name,Frames,Status,Created,Created by', ths().join());
  check('a table with no saved view still shows a Grid tab',
    w.find('.gridview .view-menu .view-name').text() === 'Grid', w.find('.gridview .view-menu').text());
  check('and says it is empty rather than looking broken',
    await until(() => /No records yet/.test(w.find('.gridview').text())));

  console.log('\nU4. Select, then edit');
  const grid = () => w.find('.gridview .scroller');
  const rowsNow = () => w.findAll('.gridview tr.row');
  const cell = (row: number, col: number) => rowsNow()[row].findAll('td')[col + 1];
  const column = (col: number) => rowsNow().map((r) => r.findAll('td')[col + 1].text());
  const names = () => column(0);
  const selAt = () => {
    const rs = rowsNow();
    for (let r = 0; r < rs.length; r++) {
      const c = rs[r].findAll('td').findIndex((td) => td.classes('sel'));
      if (c > 0) return `${r},${c - 1}`;
    }
    return 'none';
  };
  const editor = () => w.find('.gridview td.editing input, .gridview td.editing select, .gridview td.editing textarea');
  const key = (k: string, opts: Record<string, unknown> = {}) => grid().trigger('keydown', { key: k, ...opts });
  /** Replace the open editor's text and end the edit with `endKey`. */
  async function typeAnd(text: string, endKey: string, opts: Record<string, unknown> = {}) {
    await editor().setValue(text);
    await editor().trigger('keydown', { key: endKey, ...opts });
  }
  const mutationCount = async () => Number((await pool.query(`select count(*)::int n from mutations`)).rows[0].n);

  // "+ add record" makes the row AND opens its first cell, because adding a row
  // is almost always followed by typing into it.
  await w.find('.foot button').trigger('click');
  check('add record opens an editor on the new row\'s first cell',
    await until(() => editor().exists()) && selAt() === '0,0', selAt());
  await typeAnd('reel_10', 'Tab');
  check('Tab commits and moves RIGHT', names()[0] === 'reel_10' && selAt() === '0,1', `${names()[0]} @ ${selAt()}`);
  check('and leaves edit mode — the grid is values, not a wall of inputs',
    !editor().exists() && w.findAll('.gridview tr.row input[type="text"]').length === 0);

  await key('2');
  check('typing a character starts an edit that REPLACES the value with it',
    editor().exists() && (editor().element as HTMLInputElement).value === '2');
  await typeAnd('240', 'Tab');
  await key('Enter');
  check('Enter on a select opens the searching PICKER (not a native dropdown), listing every choice', editor().exists() && w.find('.gridview td.editing .cp').exists()
    && w.findAll('.gridview td.editing .cp-item').map((i) => i.text().replace('✓', '')).join() === 'todo,doing,done', w.find('.gridview td.editing').text());
  await editor().setValue('dn');
  check('typing filters FUZZILY ("dn" finds "done"; "doing" too, ranked after)', w.findAll('.gridview td.editing .cp-item').map((i) => i.text()).join() === 'done,doing', w.findAll('.gridview td.editing .cp-item').map((i) => i.text()).join());
  await editor().trigger('keydown', { key: 'ArrowDown' });
  check('↓ moves the highlight', w.findAll('.gridview td.editing .cp-item')[1].classes('hi'));
  await editor().trigger('keydown', { key: 'ArrowUp' });
  // Layout is invisible here, so assert the MECHANISM of the width fix: the value
  // stays in the DOM (hidden) under the editor, still sizing the column.
  check('the displayed value stays in place under the editor, holding the column width',
    w.find('.gridview td.editing .shown.under').exists());
  await typeAnd('done', 'Enter');
  check('Enter commits', column(2)[0] === 'done', column(2)[0]);
  check('Enter on the LAST row stays put and creates nothing',   // decided, not defaulted
    selAt() === '0,2' && rowsNow().length === 1, `${selAt()}, ${rowsNow().length} rows`);

  for (const [name, frames, status] of [['reel_2', '48', 'todo'], ['reel_1', '', 'doing']]) {
    await w.find('.foot button').trigger('click');
    await until(() => editor().exists());
    await typeAnd(name, 'Tab');
    await key('Enter'); await typeAnd(frames, 'Tab');
    await key('Enter'); await typeAnd(status, 'Enter');
  }
  check('three rows, in the order they were entered', names().join() === 'reel_10,reel_2,reel_1', names().join());
  check('the count agrees', /3 records/.test(w.find('.count').text()), w.find('.count').text());
  // What a cell IS has to show: a select's value is a round capsule, typed text is bare.
  check('a select\'s value is drawn as a capsule; a text cell and a number cell are not',
    cell(0, 2).find('.choice').exists() && cell(0, 2).find('.choice').text() === 'done' && !cell(0, 0).find('.choice').exists() && !cell(0, 1).find('.choice').exists(), cell(0, 2).html());
  check('every second row is banded — by its position in the view, not by the DOM', rowsNow().map((r) => r.classes('alt')).join() === 'false,true,false', rowsNow().map((r) => r.classes('alt')).join());
  check('the SELECTED select cell, and only it, shows the dropdown arrow', selAt() === '2,2' && w.findAll('.gridview .choice-arrow').length === 1 && cell(2, 2).find('.choice-arrow').exists(), `${selAt()}: ${w.findAll('.gridview .choice-arrow').length}`);
  await key('Enter');
  check('…and not while the picker is open under it', editor().exists() && !w.find('.gridview .choice-arrow').exists());
  await editor().trigger('keydown', { key: 'Escape' });

  console.log('\nU4b. Moving around');
  await cell(0, 0).trigger('mousedown');
  check('a click selects without opening an editor', selAt() === '0,0' && !editor().exists(), selAt());
  check('a selected TEXT cell gets no dropdown arrow', !w.find('.gridview .choice-arrow').exists());
  await key('ArrowDown'); await key('ArrowRight');
  check('arrows move the selection', selAt() === '1,1', selAt());
  await key('ArrowUp'); await key('ArrowUp'); await key('ArrowUp');
  check('and stop at the edge', selAt() === '0,1', selAt());
  await key('Tab'); await key('Tab');   // → Created, Created by (the system columns, last)
  check('Tab reaches the system columns (Created, Created by) at the end of the row', selAt() === '0,3', selAt());
  await key('Tab'); await key('Tab');
  check('Tab off the end of a row wraps to the start of the next', selAt() === '1,0', selAt());
  await key('Tab', { shiftKey: true });
  check('Shift+Tab wraps back — to the LAST column, which is now Created by', selAt() === '0,4', selAt());
  await key('ArrowDown'); await key('ArrowDown'); await key('ArrowDown');
  check('ArrowDown on the last row does nothing', selAt() === '2,4' && rowsNow().length === 3, selAt());

  // The COLUMN the keyboard lands on is scrolled into view. happy-dom has no layout, so
  // the geometry is handed to it: a scroller 500px wide, `#` and the primary pinned
  // over its first 200px, then four 150px columns — two of them off to the right.
  {
    const sc = w.find('.gridview .scroller').element as HTMLElement;
    const heads = w.findAll('.gridview thead th.col').map((t: any) => t.element as HTMLElement);
    const num = sc.querySelector('thead th.num') as HTMLElement;
    const rect = (left: number, right: number) => ({ left, right, top: 0, bottom: 0, width: right - left, height: 0, x: left, y: 0, toJSON() { return {}; } }) as DOMRect;
    Object.defineProperty(sc, 'clientWidth', { configurable: true, get: () => 500 });
    sc.getBoundingClientRect = () => rect(0, 500);
    num.getBoundingClientRect = () => rect(0, 68);
    heads.forEach((th, i) => { th.getBoundingClientRect = () => (i === 0 ? rect(68, 200) : rect(200 + (i - 1) * 150 - sc.scrollLeft, 350 + (i - 1) * 150 - sc.scrollLeft)); });
    sc.scrollLeft = 0;
    await key('ArrowLeft');                                   // → column 3, which sits at 500–650: off the right edge
    check('an arrow onto a column off the RIGHT edge scrolls it in — by just enough', selAt() === '2,3' && sc.scrollLeft === 150, `${selAt()} ${sc.scrollLeft}`);
    await key('ArrowRight');
    check('…and again for the next one', selAt() === '2,4' && sc.scrollLeft === 300, `${selAt()} ${sc.scrollLeft}`);
    await key('ArrowLeft');
    check('a column already in view moves nothing', selAt() === '2,3' && sc.scrollLeft === 300, `${selAt()} ${sc.scrollLeft}`);
    await key('ArrowLeft');                                   // → column 2, now at 50–200: UNDER the pinned columns
    check('going back LEFT, a column hidden under the pinned `#` and primary is brought out from under them (not merely to the scroller\'s edge)', selAt() === '2,2' && sc.scrollLeft === 150, `${selAt()} ${sc.scrollLeft}`);
    await key('ArrowLeft'); await key('ArrowLeft');
    check('the pinned primary is always in view: landing on it scrolls nothing', selAt() === '2,0' && sc.scrollLeft === 0, `${selAt()} ${sc.scrollLeft}`);
    await key('Tab', { shiftKey: true });                     // wraps to the LAST column of the row above
    check('Shift+Tab wrapping to the end of the row above scrolls all the way right', selAt() === '1,4' && sc.scrollLeft === 300, `${selAt()} ${sc.scrollLeft}`);
    await key('ArrowDown');
    sc.scrollLeft = 0;
    delete (sc as any).clientWidth; delete (sc as any).getBoundingClientRect; delete (num as any).getBoundingClientRect;
    for (const th of heads) delete (th as any).getBoundingClientRect;
  }

  console.log('\nU4c. What gets written, and what must not');
  await untilDb(`select data from records`, (r) => r.length === 3 && r.every((x) => x.data.status));
  const quiet = await mutationCount();
  await cell(0, 0).trigger('mousedown');
  for (let i = 0; i < 3; i++) { await key('Enter'); await editor().trigger('keydown', { key: 'Enter' }); }
  await sleep(400);
  check('walking down a column with Enter writes NOTHING', await mutationCount() === quiet,
    `${await mutationCount() - quiet} mutations`);

  await cell(1, 0).trigger('mousedown');
  await key('Enter');
  await editor().setValue('typed then abandoned');
  await editor().trigger('keydown', { key: 'Escape' });
  await sleep(300);
  check('Escape cancels: the old value stays, on screen and on the server',
    names()[1] === 'reel_2' && !editor().exists() && await mutationCount() === quiet, names()[1]);

  // THE data-loss case. 48 is stored; type garbage over it.
  await cell(1, 1).trigger('mousedown');
  await key('Enter');
  await typeAnd('banana', 'Enter');
  check('a non-number in a number cell is refused AT THE CELL — editor stays open, marked invalid',
    editor().exists() && editor().classes('invalid'));
  check('and the selection has not moved on', selAt() === '1,1', selAt());
  await editor().trigger('keydown', { key: 'Escape' });
  await sleep(300);
  const after48 = (await pool.query(`select data from records where data->>'name' = 'reel_2'`)).rows[0].data;
  check('the stored 48 survived it', after48.frames === 48 && column(1)[1] === '48', JSON.stringify(after48));
  check('no error banner', !w.find('.errors').exists(), w.find('.errors').exists() ? w.find('.errors').text() : '');

  await cell(0, 1).trigger('mousedown');
  await key('Delete');
  const cleared = await untilDb(`select data from records where data->>'name' = 'reel_10'`, (r) => !('frames' in r[0].data));
  check('Delete clears the selected cell — the key is ABSENT, not null or ""', !('frames' in cleared[0].data), JSON.stringify(cleared[0].data));
  await key('2'); await typeAnd('240', 'Enter');
  const stored = await untilDb(`select data from records order by created_at, id`, (r) => r[0].data.frames === 240);
  check('numbers are stored as NUMBERS', stored[0].data.frames === 240 && stored[1].data.frames === 48, JSON.stringify(stored.map((r) => r.data)));
  check('a cell never filled in is absent too', !('frames' in stored[2].data), JSON.stringify(stored[2].data));

  console.log('\nU4d. A checkbox has no edit mode');
  await addField('OK', 'checkbox');
  await gridPop().trigger('keydown', { key: 'Escape' });
  await untilDb(`select 1 from fields where key = 'ok'`, (r) => r.length === 1);
  await until(() => rowsNow().length === 3 && ths().includes('OK'));
  await cell(0, 3).trigger('mousedown');
  await key(' ');
  const ticked = await untilDb(`select data from records where data->>'name' = 'reel_10'`, (r) => r[0].data.ok === true);
  check('Space ticks it', ticked[0].data.ok === true && !editor().exists(), JSON.stringify(ticked[0].data));
  await key('Enter');
  const unticked = await untilDb(`select data from records where data->>'name' = 'reel_10'`, (r) => r[0].data.ok === false);
  check('Enter toggles it too — and unticking stores FALSE, it does not unset',
    unticked[0].data.ok === false, JSON.stringify(unticked[0].data));
  await key('ArrowDown');
  check('and the arrow keys still work afterwards', selAt() === '1,3', selAt());

  console.log('\nU4e. The link picker');
  // Set up by a "peer" over HTTP, which also proves the grid picks up schema
  // changes live: a new table, three records in it, and a link field on Files.
  const { randomUUID } = await import('node:crypto');
  const shows = randomUUID(), linkField = randomUUID(), showName = randomUUID(), showCode = randomUUID();
  const filesId = (await pool.query(`select id from tables where name = 'Files'`)).rows[0].id;
  const showIds = [randomUUID(), randomUUID(), randomUUID()];
  const peer = await fetch(`${API}/api/mutate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: randomUUID(), mutations: [
      { type: 'table.create', id: shows, name: 'Shows' },
      // Positions set explicitly, as API.md says a script must. Without them both
      // fields sit at 0, the tie breaks by name, and "Code" — not "Name" — becomes
      // the primary field. (That is how this fixture first failed.)
      { type: 'field.create', id: showName, tableId: shows, name: 'Name', key: 'name', fieldType: 'text' },
      { type: 'field.update', id: showName, position: 1 },
      { type: 'field.create', id: showCode, tableId: shows, name: 'Code', key: 'code', fieldType: 'text' },
      { type: 'field.update', id: showCode, position: 2 },
      { type: 'record.create', id: showIds[0], tableId: shows, data: { name: 'Alpha' } },
      { type: 'record.create', id: showIds[1], tableId: shows, data: { name: 'Beta' } },
      { type: 'record.create', id: showIds[2], tableId: shows, data: { name: 'Gamma', code: 'XJ9' } },
      { type: 'field.create', id: linkField, tableId: filesId, name: 'Show', key: 'show', fieldType: 'link', options: { target_table_id: shows } },
      // As the schema editor does: field.create carries no position, so without
      // this the column sorts FIRST (position 0) and shifts every index below.
      { type: 'field.update', id: linkField, position: 99 },
    ].map((mutation) => ({ id: randomUUID(), mutation })) }),
  });
  check('fixture: the peer\'s batch was accepted', peer.status === 200, `${peer.status}`);
  check('the new link column appears in the open grid, live',
    await until(() => ths().includes('Show')));

  // Looked up, not assumed: a field created without an explicit position does not
  // necessarily land last, and the first draft of this section clicked the
  // checkbox column by mistake.
  const LINK = ths().indexOf('Show');
  const picker = () => w.find('.gridview .picker');
  const options = () => picker().findAll('.list li .name').map((x) => x.text());
  const chips = (row: number) => cell(row, LINK).findAll('.cell .pill').map((c) => c.text().replace(/[×⤢]/g, '').trim());
  const pkey = (k: string, opts: Record<string, unknown> = {}) => picker().find('input').trigger('keydown', { key: k, ...opts });

  await cell(0, LINK).trigger('mousedown');
  await key('Enter');
  check('Enter on a link cell opens the picker', await until(() => picker().exists()));
  check('with nothing linked yet it is only the "add" line — no empty "linked" section', !picker().find('.current').exists() && picker().find('.find .sec').text() === 'add' && picker().find('.find input.q').exists());
  check('it walks the target table and lists every record',
    await until(() => options().length === 3), options().join());
  const hints = () => picker().findAll('.list li .rest').map((x) => x.text());
  const creator = String((await pool.query(`select name from users limit 1`)).rows[0]?.name ?? '');
  check('the hint beside each candidate is the record\'s own values — never its Created timestamp or who made it',
    hints().length === 3 && hints().some((h) => /XJ9/.test(h)) && !hints().some((h) => /\d{4}-\d\d-\d\dT/.test(h) || h.split(' · ').includes(creator)), `${hints().join(' | ')} (creator: ${creator})`);
  await picker().find('input').setValue('xj9');
  check('search covers the whole record, not just its label ("XJ9" is Gamma\'s code)',
    await until(() => options().join() === 'Gamma'), options().join());
  await pkey('Enter');
  check('Enter links the highlighted record', await until(() => chips(0).join() === 'Gamma'), chips(0).join());
  check('what is linked and where you search are TWO sections: "linked" with its chips, then the "add" line — the input is not among the chips',
    await until(() => picker().find('.current').exists()) && picker().find('.current .sec').text() === 'linked' && picker().findAll('.current .chip').length === 1
    && !picker().find('.current input').exists() && picker().find('.find input.q').exists(), picker().html().slice(0, 200));
  check('and the picker STAYS OPEN with the query cleared, minus what is now linked',
    picker().exists() && (picker().find('input').element as HTMLInputElement).value === ''
    && options().join() === 'Alpha,Beta', options().join());
  await pkey('ArrowDown'); await pkey('Enter');
  check('arrow keys move the highlight: ↓ then Enter links the SECOND candidate',
    await until(() => chips(0).join() === 'Gamma,Beta'), chips(0).join());
  await pkey('Backspace');
  check('Backspace on an empty query unlinks the last one',
    await until(() => chips(0).join() === 'Gamma'), chips(0).join());
  await pkey('Escape');
  check('Escape closes it and leaves the selection on the cell', !picker().exists() && selAt() === `0,${LINK}`, selAt());

  const linkRows = await untilDb(`select to_record from links where field_id = '${linkField}'`, (r) => r.length === 1);
  check('the server ends with exactly the one link', linkRows.length === 1 && linkRows[0].to_record === showIds[2],
    JSON.stringify(linkRows));
  // A cell shows a few pills, then "+N": six links must not pass for three.
  {
    const rec = (await pool.query(`select from_record from links where field_id = $1`, [linkField])).rows[0].from_record;
    const extra = ['Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'].map((name) => ({ id: randomUUID(), name }));
    const post = (mutations: unknown[]) => fetch(`${API}/api/mutate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: randomUUID(), mutations: mutations.map((mutation) => ({ id: randomUUID(), mutation })) }) });
    await post([...extra.map((e) => ({ type: 'record.create', id: e.id, tableId: shows, data: { name: e.name } })),
      ...extra.map((e) => ({ type: 'link.add', id: randomUUID(), fieldId: linkField, fromRecord: rec, toRecord: e.id }))]);
    await until(() => cell(0, LINK).findAll('.pill').length === 6, 8000);
    // happy-dom lays nothing out: give the cell a width and the pills positions (70px pitch),
    // then a re-render, so CellPills can measure — three fit before the badge's room.
    const box = cell(0, LINK).find('.cellpills').element as HTMLElement;
    Object.defineProperty(box, 'clientWidth', { value: 250, configurable: true });
    box.getBoundingClientRect = () => ({ left: 0, right: 250, top: 0, bottom: 20, width: 250, height: 20, x: 0, y: 0, toJSON() {} }) as DOMRect;
    cell(0, LINK).findAll('.pill').forEach((p, i) => { (p.element as HTMLElement).getBoundingClientRect = () => ({ left: i * 70, right: i * 70 + 60, top: 0, bottom: 20, width: 60, height: 20, x: i * 70, y: 0, toJSON() {} }) as DOMRect; });
    await post([{ type: 'record.update', id: rec, set: { name: 'reel_10' }, unset: [] }]);
    check('with more links than fit, a +N says how many are hidden (3 fit, +3)', await until(() => cell(0, LINK).find('.more').exists(), 8000)
      && cell(0, LINK).find('.more').text() === '+3' && cell(0, LINK).findAll('.pill.cut').length === 3, cell(0, LINK).text());
    // Unlink rather than delete: a later section restores "the delete" from History.
    await post(extra.map((e) => ({ type: 'link.remove', fieldId: linkField, fromRecord: rec, toRecord: e.id })));
    await until(() => !cell(0, LINK).find('.more').exists(), 8000);
  }

  await key('b');
  check('typing on a link cell opens the picker already searching',
    await until(() => picker().exists()) && (picker().find('input').element as HTMLInputElement).value === 'b'
    && options().join() === 'Beta', options().join());
  await pkey('Tab');
  check('Tab closes it and moves on to the next column', !picker().exists() && selAt().startsWith('0,') && Number(selAt().split(',')[1]) === LINK + 1, `${selAt()} (link col ${LINK})`);
  await key('Escape');

  console.log('\nU5. Sorting from a column header');
  const header = (name: string) => w.findAll('.gridview thead th').find((t) => t.text().includes(name))!;
  check('before any sort there is no saved view', (await pool.query(`select 1 from views`)).rowCount === 0);
  await cell(0, 0).trigger('mousedown');            // select reel_10, currently row 0
  await header('Name').find('.th-sort').trigger('click');
  check('one click sorts ascending, NATURALLY (reel_2 before reel_10)',
    await until(() => names().join() === 'reel_1,reel_2,reel_10'), names().join());
  check('the selection followed its RECORD to the new position (reel_10 is now last)', selAt() === '2,0', selAt());
  check('and the header shows the direction', header('Name').text().includes('▲'), header('Name').text());
  await header('Name').find('.th-sort').trigger('click');
  check('a second click sorts descending', await until(() => names().join() === 'reel_10,reel_2,reel_1'), names().join());
  await header('Frames').find('.th-sort').trigger('click');
  check('sorting by a column with a blank keeps the blank LAST',
    await until(() => names().join() === 'reel_2,reel_10,reel_1'), names().join());

  const viewRows = await untilDb(`select name, config from views`,
    (r) => r.length === 1 && r[0].config.sort?.[0]?.dir === 'asc');
  const view = { rowCount: viewRows.length, rows: viewRows };
  check('the sort was saved as a shared view, created on first use',
    view.rowCount === 1 && view.rows[0].config.sort?.[0]?.dir === 'asc', JSON.stringify(view.rows));
  check('and the toolbar names it: the Grid — the built-in view keeps its sort, like Airtable\'s default view', w.find('.gridview .view-menu .view-name').text() === 'Grid' && viewRows[0].name === 'Grid', w.find('.gridview .view-menu summary').text());

  console.log('\nU6. Quick search narrows without touching the saved view');
  await w.find('.gridview .search').setValue('reel_1');
  check('search matches substrings across the row', await until(() => names().join() === 'reel_10,reel_1'), names().join());
  check('the count says "2 of 3"', /2\s*of\s*3/.test(w.find('.count').text()), w.find('.count').text());
  await w.find('.gridview .search').setValue('');
  await sleep(150);
  check('and the search was never written into the view',
    (await pool.query(`select config from views`)).rows[0].config.filters.length === 0);

  console.log('\nU7. Deleting a row, and getting it back');
  await rowsNow()[0].find('td.act button').trigger('click');
  check('the row disappears', await until(() => rowsNow().length === 2));
  await tab('history').trigger('click');     // Settings, from the tree's footer — History lives there
  check('History (in Settings) lists the delete, in plain words', await until(() => /Record deleted/.test(w.find('.settings .history').text()), 5000), w.find('.settings').exists() ? w.find('.settings').text().slice(0, 200) : 'no settings dialog');
  await w.find('.settings .history button.restore').trigger('click');
  await tab('table').trigger('click');
  check('Restore brings the row back into the grid', await until(() => rowsNow().length === 3, 5000), `${rowsNow().length} rows`);

  console.log('\nU8. Schema, edited in place from the grid');
  const th = (name: string) => w.findAll('.gridview thead th').find((t) => t.find('.th-name').exists() && t.find('.th-name').text() === name)!;

  await w.find('.gridview .th-add').trigger('click');
  check('the "+" header opens the add-field form — the SAME component as the schema tab',
    gridPop().exists() && gridPop().find('.field-form').exists());
  await addField('Frame Rate', 'number', undefined, gridPop());
  check('the new column appears last among the table\'s OWN fields (the system columns stay after it)', await until(() => ths().at(-3) === 'Frame Rate' && ths().slice(-2).join() === 'Created,Created by'), ths().join());
  const fr = await untilDb(`select key, position from fields where name = 'Frame Rate'`, (r) => r.length === 1);
  const maxOther = (await pool.query(`select max(f.position) m from fields f join tables t on t.id = f.table_id where t.name = 'Files' and f.name <> 'Frame Rate'`)).rows[0].m;
  check('stored with a derived key and a position after every other field',
    fr[0]?.key === 'frame_rate' && fr[0]?.position > maxOther, JSON.stringify(fr));

  const before = await mutationCount();
  await addField('Frame rate', 'text', undefined, gridPop());     // derives the same key
  check('a duplicate key is refused IN THE FORM, with the reason',
    /already exists/.test(gridPop().find('.error').text()), gridPop().text());
  await sleep(300);
  check('and nothing was sent', await mutationCount() === before);
  await gridPop().trigger('keydown', { key: 'Escape' });
  check('Escape closes the popover', !gridPop().exists());

  await th('Frame Rate').find('.th-menu').trigger('click');
  check('a header\'s ▾ opens that field\'s settings — the SAME component as the schema tab\'s rows',
    gridPop().exists() && gridPop().find('.field-settings').exists());
  await gridPop().find('input.name').setValue('FPS');
  await gridPop().find('input.name').trigger('change');
  check('renaming updates the header', await until(() => ths().includes('FPS')), ths().join());
  const renamed = await untilDb(`select key from fields where name = 'FPS'`, (r) => r.length === 1);
  check('and leaves the key alone — that is where the values live', renamed[0]?.key === 'frame_rate', JSON.stringify(renamed));
  check('the header popover has NO move buttons — column order is the view\'s, not the schema\'s',
    !gridPop().find('button.prev').exists() && !gridPop().find('button.next').exists());
  check('opening a menu or clicking inside it never SORTED the column',
    !th('FPS').find('.th-sort.on').exists());
  await gridPop().trigger('keydown', { key: 'Escape' });

  console.log('\nU8a. Column order and widths belong to the VIEW');
  const orderBefore = ths();
  const positionsBefore = (await pool.query(`select key, position from fields where table_id = $1 order by key`, [filesId])).rows;
  const fieldsMenu = () => w.findAll('.gridview details.menu').find((d) => /^fields/.test(d.find('summary').text()))!;
  await fieldsMenu().find('summary').trigger('click');
  const fpsLine = () => fieldsMenu().findAll('.field-line').find((l) => /FPS/.test(l.text()))!;
  await fpsLine().find('button.prev').trigger('click');
  check('↑ in the fields menu moves the column left',
    await until(() => ths().indexOf('FPS') === orderBefore.indexOf('FPS') - 1), ths().join());
  const savedOrder = await untilDb(`select config from views where id = '${filesId}'`, (r) => Array.isArray(r[0]?.config?.order));
  check('…saved as `order` on the built-in Grid view', savedOrder[0]?.config.order.length === ths().length, JSON.stringify(savedOrder[0]?.config));
  await sleep(400);
  const positionsAfter = (await pool.query(`select key, position from fields where table_id = $1 order by key`, [filesId])).rows;
  check('…and the SCHEMA positions did not move — a column drag must never change which field is primary',
    JSON.stringify(positionsAfter) === JSON.stringify(positionsBefore), JSON.stringify(positionsAfter));
  check('the primary is first, starred, pinned, and its tick in the fields menu is disabled',
    ths()[0] === 'Name' && th('Name').classes('pin') && w.find('.gridview thead th.num').classes('pin')
    && fieldsMenu().findAll('.field-line').find((l) => /Name/.test(l.text()))!.find('input').attributes('disabled') !== undefined);
  check('the primary has no move buttons of its own', !fieldsMenu().findAll('.field-line').find((l) => /Name/.test(l.text()))!.find('button.prev').exists());
  await fieldsMenu().find('summary').trigger('click');

  // A REAL header drag: down on FPS, move onto the LAST header (past the threshold), up.
  const PEh = (win as any).PointerEvent ?? (win as any).MouseEvent;
  const lastName = ths()[ths().length - 1];
  await th('FPS').trigger('pointerdown', { button: 0, clientX: 10, clientY: 10 });
  th(lastName).element.dispatchEvent(new PEh('pointermove', { bubbles: true, clientX: 300, clientY: 10 }));
  await sleep(20);
  check('while dragging, the lifted header dims and the target shows a drop mark',
    th('FPS').classes('dragging') && (th(lastName).classes('drop-after') || th(lastName).classes('drop-before')), th(lastName).classes().join());
  win.dispatchEvent(new PEh('pointerup', { bubbles: true, clientX: 300, clientY: 10 }));
  await th('FPS').trigger('click');   // the click a browser fires after the release — the header is not a sort button any more
  check('dropping it moves the column to the far end (schema position untouched)',
    await until(() => ths()[ths().length - 1] === 'FPS' || ths()[ths().length - 2] === 'FPS'), ths().join());
  check('…and the release did NOT sort the column', !th('FPS').find('.th-sort.on').exists());
  const posFps = (await pool.query(`select position from fields where key = 'frame_rate'`)).rows[0]?.position;
  check('(schema position still what it was)', posFps === positionsBefore.find((r) => r.key === 'frame_rate')?.position, String(posFps));

  // Resize: press the handle, move, release → a width on the view, NOT an undo step.
  await th('FPS').find('.th-resize').trigger('pointerdown', { button: 0, clientX: 100, clientY: 10 });
  win.dispatchEvent(new PEh('pointermove', { bubbles: true, clientX: 160, clientY: 10 }));
  win.dispatchEvent(new PEh('pointerup', { bubbles: true, clientX: 160, clientY: 10 }));
  const fpsId = (await pool.query(`select id from fields where key = 'frame_rate'`)).rows[0].id;
  const widths = await untilDb(`select config from views where id = '${filesId}'`, (r) => r[0]?.config?.widths?.[fpsId] !== undefined);
  check('dragging the handle saves a width for the column on the view', typeof widths[0]?.config.widths[fpsId] === 'number', JSON.stringify(widths[0]?.config.widths));
  check('…which the header and the cells then carry as an exact width', /width/.test(w.find(`.gridview thead th[data-field="${fpsId}"]`).attributes('style') ?? '') && w.findAll('.gridview tr.row td.sized').length > 0);
  await th('FPS').find('.th-resize').trigger('click');
  check('the click after a resize does NOT sort', !th('FPS').find('.th-sort.on').exists());
  await th('FPS').find('.th-resize').trigger('dblclick');
  check('double-clicking the handle returns it to auto', await untilDb(`select config from views where id = '${filesId}'`, (r) => r[0]?.config?.widths?.[fpsId] === undefined).then((r) => r[0]?.config?.widths?.[fpsId] === undefined));

  console.log('\nU8b. The primary field names the record');
  check('the first plain-valued field is starred, and only that one',
    th('Name').find('.star').exists() && w.findAll('.gridview thead .star').length === 1);
  // Gamma is linked from reel_10. Its table (Shows) is named by "Name"; make "Code" primary instead.
  await nav.openTable(shows);
  await until(() => ths().includes('Code'));
  await th('Code').find('.th-menu').trigger('click');
  await gridPop().find('button.make-primary').trigger('click');
  check('"make primary" moves the field first and the star with it',
    await until(() => ths()[0] === 'Code' && th('Code').find('.star').exists()), ths().join());
  await gridPop().trigger('keydown', { key: 'Escape' });
  await nav.openTable(filesId);
  await until(() => ths().includes('Show'));
  check('and the link chip pointing at that record is renamed with it (Gamma → XJ9)',
    await until(() => rowsNow().some((r) => r.text().includes('XJ9'))), rowsNow().map((r) => r.text()).join(' / '));
  await untilDb(`select position from fields where key = 'code'`, (r) => r[0]?.position === 0);
  const serverPage: any = await (await fetch(`${API}/api/tables/${filesId}/records?limit=50`)).json();
  check('the SERVER labels it the same way, so nothing changes name on reload',
    serverPage.labels[showIds[2]] === 'XJ9', JSON.stringify(serverPage.labels[showIds[2]]));

  console.log('\nU9. Lookup fields');
  // Files → (Show link) → Shows. reel_10 is linked to Gamma, whose Code is XJ9.
  await w.find('.gridview .th-add').trigger('click');
  await gridPop().find('input.name').setValue('Show code');
  await gridPop().find('select.type').setValue('lookup');
  await gridPop().find('button.add').trigger('click');
  check('a lookup with nothing chosen is refused in the form',
    /needs a link field/.test(gridPop().find('.error').text()), gridPop().find('.error').text());
  check('"follow which link" offers this table\'s link fields',
    gridPop().find('select.via').findAll('option').map((o) => o.text()).includes('Show'));
  await gridPop().find('select.via').setValue(linkField);
  const showOpts = () => gridPop().find('select.show').findAll('option').map((o) => o.text());
  check('"show which field" then offers the FAR table\'s fields', await until(() => showOpts().includes('Code') && showOpts().includes('Name')), showOpts().join());
  await gridPop().find('select.show').setValue(showCode);
  await gridPop().find('button.add').trigger('click');
  await gridPop().trigger('keydown', { key: 'Escape' });
  check('the lookup column appears', await until(() => ths().includes('Show code')), ths().join());

  const LK = () => ths().indexOf('Show code');
  const lookCol = () => column(LK());
  const rowOf = (name: string) => names().indexOf(name);
  check('it shows the far record\'s value on the row that links to it, and nothing elsewhere',
    await until(() => lookCol()[rowOf('reel_10')] === 'XJ9') && lookCol().filter(Boolean).length === 1, lookCol().join('|'));
  const lkStored = await untilDb(`select options from fields where name = 'Show code'`, (r) => r.length === 1);
  check('stored as configuration only — a lookup holds no data',
    lkStored[0]?.options.via_field_id === linkField && lkStored[0]?.options.target_field_id === showCode
    && (await pool.query(`select 1 from records where data ? 'show_code'`)).rowCount === 0, JSON.stringify(lkStored));

  const post = (mutations: unknown[]) => fetch(`${API}/api/mutate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: randomUUID(), mutations: mutations.map((mutation) => ({ id: randomUUID(), mutation })) }),
  });
  await post([{ type: 'record.update', id: showIds[2], set: { code: 'ZZ-TOP' }, unset: [] }]);
  check('a PEER editing the far record updates the cell live', await until(() => lookCol()[rowOf('reel_10')] === 'ZZ-TOP'), lookCol().join('|'));
  await post([{ type: 'record.update', id: showIds[1], set: { code: 'B-2' }, unset: [] },
              { type: 'link.add', id: randomUUID(), fieldId: linkField, fromRecord: (await pool.query(`select id from records where data->>'name' = 'reel_10'`)).rows[0].id, toRecord: showIds[1] }]);
  check('several linked records give several values, comma-separated, in link order',
    await until(() => lookCol()[rowOf('reel_10')] === 'ZZ-TOP, B-2'), lookCol().join('|'));

  await cell(rowOf('reel_10'), LK()).trigger('mousedown');
  await key('Enter'); await key('x'); await key('Delete');
  await sleep(200);
  check('the cell is read-only: Enter, typing and Delete do nothing',
    !editor().exists() && lookCol()[rowOf('reel_10')] === 'ZZ-TOP, B-2');

  await w.find('.gridview .search').setValue('zz-top');
  check('search finds a row by its LOOKED-UP value', await until(() => names().join() === 'reel_10'), names().join());
  await w.find('.gridview .search').setValue('');
  await until(() => names().length === 3);

  await post([{ type: 'field.delete', id: showCode }]);
  check('deleting the far field shows the lookup as BROKEN — not as an empty cell',
    await until(() => lookCol().every((t) => t === 'broken lookup')), lookCol().join('|'));
  check('and the grid still renders and takes input', rowsNow().length === 3 && !w.find('.errors').exists());

  console.log('\nU10. The record panel, from the grid');
  const panel = () => w.find('.record-panel');
  const pField = (name: string) => panel().findAll('.rp-field').find((f) => f.find('.rp-name').text().replace('★', '').trim() === name)!;
  const pEditor = () => panel().find('.rp-field.editing input, .rp-field.editing textarea, .rp-field.editing select');
  const recId = async (name: string) => (await pool.query(`select id from records where data->>'name' = $1`, [name])).rows[0].id as string;

  // A long_text field to exercise the multi-line editor.
  await w.find('.gridview .th-add').trigger('click');
  await addField('Notes', 'long_text', undefined, gridPop());
  await gridPop().trigger('keydown', { key: 'Escape' });
  await until(() => ths().includes('Notes'));

  await cell(rowOf('reel_2'), 0).trigger('mousedown');
  await key(' ');
  check('Space on a selected cell opens that record in the side panel',
    await until(() => panel().exists()) && panel().find('.rp-title').text() === 'reel_2', panel().exists() ? panel().find('.rp-title').text() : 'no panel');
  // Wait for the just-added Notes field to LAND: the grid shows it optimistically,
  // so counting the server's fields straight away came up one short.
  await untilDb(`select 1 from fields where key = 'notes'`, (r) => r.length === 1);
  const nFields = (await pool.query(`select count(*)::int n from fields where table_id = $1`, [filesId])).rows[0].n;
  check('it lists every field of the table, primary starred — plus the two system fields, last',
    panel().findAll('.rp-field').length === nFields + 2 && pField('Name').find('.star').exists() && panel().findAll('.rp-name').slice(-2).map((n) => n.text().trim()).join() === 'Created,Created by',
    `${panel().findAll('.rp-field').length} of ${nFields}; names: ${panel().findAll('.rp-name').map((n) => n.text()).join('|')}`);
  check('a record with data opens READING, not editing', !pEditor().exists());
  check('the tray shows a select\'s value as the same capsule the grid does', pField('Status').find('.rp-value .choice').exists() && !pField('Name').find('.rp-value .choice').exists(), pField('Status').html());

  await pField('Frames').find('.rp-value').trigger('click');
  check('clicking a value opens the same editor the grid uses', pEditor().exists());
  await pEditor().setValue('96');
  await pEditor().trigger('keydown', { key: 'Enter' });
  check('Enter commits and moves to the NEXT field\'s editor',
    await until(() => pField('Status').classes('editing')), panel().findAll('.rp-field.editing').map((f) => f.find('.rp-name').text()).join());
  await pEditor().trigger('keydown', { key: 'Escape' });
  const f96 = await untilDb(`select data from records where data->>'name' = 'reel_2'`, (r) => r[0].data.frames === 96);
  check('and the value reached the server — and the grid beside it', f96[0].data.frames === 96 && column(1)[rowOf('reel_2')] === '96');

  await pField('Notes').find('.rp-value').trigger('click');
  check('long_text gets a multi-line editor here', pEditor().element.tagName === 'TEXTAREA' && pEditor().classes('multi'));
  await pEditor().setValue('line one\nline two');
  await pEditor().trigger('keydown', { key: 'Enter' });
  check('where Enter is a NEWLINE, not a commit', pEditor().exists() && pField('Notes').classes('editing'));
  await pEditor().trigger('keydown', { key: 'Enter', ctrlKey: true });
  const notes = await untilDb(`select data from records where data->>'name' = 'reel_2'`, (r) => typeof r[0].data.notes === 'string');
  check('and Ctrl+Enter commits — both lines', notes[0].data.notes === 'line one\nline two', JSON.stringify(notes[0].data.notes));
  if (pEditor().exists()) await pEditor().trigger('keydown', { key: 'Escape' });

  check('an EMPTY link field says what it takes — "add a …", named by the table it links to', /^add a \S.*…$/.test(pField('Show').find('.add-link').text()), pField('Show').find('.add-link').text());
  await pField('Show').find('.rp-value').trigger('click');
  check('a link field opens the link picker, in the panel', await until(() => panel().find('.picker').exists()));
  check('…as a search line INSIDE the field, where the "add" line was — with no "linked" section of its own (the field\'s pills are that)',
    pField('Show').find('.picker.field .find input.q').exists() && !panel().find('.picker .current').exists() && !pField('Show').find('.add-link').exists());
  await until(() => panel().findAll('.picker .list li').length > 0);
  await panel().find('.picker input').setValue('alpha');
  await panel().find('.picker input').trigger('keydown', { key: 'Enter' });
  const alphaLink = await untilDb(`select 1 from links where from_record = '${await recId('reel_2')}' and to_record = '${showIds[0]}'`, (r) => r.length === 1);
  check('and links from there exactly as from the grid', alphaLink.length === 1
    && pField('Show').findAll('.pill').some((c) => c.text().includes('Alpha')));
  check('the new link is a PILL in the field, above the search line, which is still open', pField('Show').findAll('.pills.column .pill').length === 1 && pField('Show').find('.picker.field').exists());
  await panel().find('.picker input').trigger('keydown', { key: 'Backspace' });
  await new Promise((r) => setTimeout(r, 200));
  check('Backspace on an empty search does NOT unlink here (the pills have their own ×; clearing a query must not eat a link)',
    pField('Show').findAll('.pill').length === 1 && (await pool.query(`select 1 from links where from_record = $1 and field_id = $2`, [await recId('reel_2'), linkField])).rowCount === 1);
  await panel().find('.picker input').trigger('keydown', { key: 'Escape' });
  check('closed, a field that HAS links still offers the way in: "add another …"', await until(() => !panel().find('.picker').exists())
    && /^add another \S.*…$/.test(pField('Show').find('.add-link').text()), pField('Show').find('.add-link').text());

  await cell(rowOf('reel_1'), 0).trigger('mousedown');
  await key(' ');
  check('the panel FOLLOWS: opening another record re-points it', await until(() => panel().find('.rp-title').text() === 'reel_1'));
  await panel().trigger('keydown', { key: 'Escape' });
  check('Escape closes it', !panel().exists());

  console.log('\nU11. Working on the canvas');
  await tab('canvas').trigger('click');
  check('with no canvas yet, the tree says so under its Canvases subheader', /none yet/.test(w.find('.tree').text()));
  await nav.newCanvas('Board');
  check('"+" makes one', await until(() => w.find('.canvas-container').exists()));
  // A canvas is a RECORD in a table of boards (sql/010). There was no boards table,
  // so "+" made one — "Boards", with a Name — and the board is a record in it.
  const boardRows = await untilDb(`select r.id, t.name as table_name, t.kind from records r join tables t on t.id = r.table_id where r.data->>'name' = 'Board'`, (r) => r.length === 1);
  const boardId = boardRows[0].id as string;
  check('"+" with no boards table makes one, and the canvas is a record in it',
    boardRows[0].kind === 'canvas' && boardRows[0].table_name === 'Boards', JSON.stringify(boardRows[0]));
  check('its STATE row does not exist yet — nothing has been placed or moved',
    (await pool.query(`select 1 from canvases where id = $1`, [boardId])).rowCount === 0);
  // Opening a canvas fetches its scene — and this one was not on the server yet
  // when it opened, so the fetch was a 404. It never reached the error banner: it
  // THREW inside the canvas's onMounted and skipped the rest of it. The tray heals
  // itself on the next stream event; what stayed broken was the LAST line — the
  // canvas never took keyboard focus, so Space-to-pan, F, Delete and Ctrl+A were
  // dead on every new canvas until you clicked it. Two earlier versions of this
  // check (no error banner; tray populated) both passed with the fix removed.
  check('a brand-new canvas finishes starting up and takes keyboard focus',
    await until(() => win.document.activeElement === (w.find('.canvas-container').element as unknown)),
    String((win.document.activeElement as unknown as HTMLElement | null)?.className));

  const bg = () => w.find('.canvas-container');
  const cardsNow = () => w.findAll('.canvas-world .card');
  const cardBy = (titleText: string) => cardsNow().find((c) => c.find('.card-label').text() === titleText)!;
  const ctx = () => w.find('.canvas-container .ctx');

  await bg().trigger('dblclick', { clientX: 300, clientY: 200 });
  check('double-click on empty canvas asks WHICH table (there are several)',
    ctx().exists() && ctx().findAll('.create-in').map((b) => b.text()).includes('Files'), ctx().exists() ? ctx().text() : 'no menu');
  await ctx().findAll('.create-in').find((b) => b.text() === 'Files')!.trigger('click');
  check('choosing one creates a card and opens the panel already editing its name',
    await until(() => cardsNow().length === 1 && panel().exists() && pField('Name').classes('editing')),
    `${cardsNow().length} cards, panel ${panel().exists()}`);
  await pEditor().setValue('made on canvas');
  await pEditor().trigger('keydown', { key: 'Enter' });
  check('the card is titled by the primary field, live', await until(() => !!cardBy('made on canvas')), cardsNow().map((c) => c.find('.card-label').text()).join());
  const made1 = await untilDb(`select r.id, p.canvas_id from records r join placements p on p.record_id = r.id where r.data->>'name' = 'made on canvas'`, (r) => r.length === 1);
  check('record AND placement are on the server', made1[0]?.canvas_id === boardId, JSON.stringify(made1));
  await panel().find('.rp-close').trigger('click');

  await bg().trigger('dblclick', { clientX: 600, clientY: 300 });
  check('the next double-click does NOT ask — same table as last time',
    await until(() => cardsNow().length === 2) && !ctx().exists());
  await panel().find('.rp-close').trigger('click');

  // Bring two EXISTING, linked records onto the board, as a peer would.
  const r10 = await recId('reel_10');
  await post([
    { type: 'placement.add', id: randomUUID(), canvasId: boardId, recordId: r10, x: 40, y: 40, w: null, h: null, z: 5 },
    { type: 'placement.add', id: randomUUID(), canvasId: boardId, recordId: showIds[2], x: 500, y: 40, w: null, h: null, z: 6 },
  ]);
  check('cards placed by a peer appear live', await until(() => !!cardBy('reel_10')), cardsNow().map((c) => c.find('.card-label').text()).join());
  // A row's value, as read: linked records are pills whose ⤢ / × are reserved glyphs, not text.
  const rowsOf = (c: ReturnType<typeof cardBy>) => Object.fromEntries(c.findAll('.card-field').map((f) => [f.find('.card-key').text(), f.findAll('.pill-text').length ? f.findAll('.pill-text').map((p) => p.text()).join(', ') : f.find('.card-val').text()]));
  check('a card shows a few fields by default — and NOT the primary twice',
    Object.keys(rowsOf(cardBy('reel_10'))).length > 0 && !('Name' in rowsOf(cardBy('reel_10'))), JSON.stringify(rowsOf(cardBy('reel_10'))));

  await cardBy('reel_10').trigger('contextmenu', { clientX: 100, clientY: 80 });
  check('right-click on a card opens its menu', ctx().exists() && /Open record/.test(ctx().text()));
  await ctx().findAll('button').find((b) => /Fields on Files cards/.test(b.text()))!.trigger('click');
  const choice = (name: string) => ctx().findAll('.ctx-check').find((l) => l.text().trim() === name)!.find('input');
  for (const name of ctx().findAll('.ctx-check').map((l) => l.text().trim())) {
    const want = name === 'Show' || name === 'Status';
    if ((choice(name).element as HTMLInputElement).checked !== want) await choice(name).setValue(want);
  }
  check('choosing fields changes EVERY card of that table on this canvas',
    await until(() => Object.keys(rowsOf(cardBy('reel_10'))).join() === 'Status,Show' && Object.keys(rowsOf(cardBy('made on canvas'))).join() === 'Status,Show'),
    JSON.stringify(rowsOf(cardBy('reel_10'))));
  check('a link field reads as the linked records\' names', /Gamma|ZZ|B-2|XJ9/.test(rowsOf(cardBy('reel_10')).Show ?? '') || (rowsOf(cardBy('reel_10')).Show ?? '').length > 1, rowsOf(cardBy('reel_10')).Show);
  const cfg = await untilDb(`select config from canvases where id = '${boardId}'`, (r) => (r[0].config.cardFields?.[filesId] ?? []).length === 2);
  check('and is saved on the canvas, so everyone sees the board the same way', cfg[0].config.cardFields[filesId].length === 2, JSON.stringify(cfg[0].config));
  await bg().trigger('pointerdown', { button: 0, clientX: 5, clientY: 5 });
  check('clicking away closes the menu', !ctx().exists());

  await cardBy('reel_10').find('.card-fold').trigger('click');
  check('folding leaves the title and hides the fields',
    await until(() => cardBy('reel_10').classes('collapsed') && cardBy('reel_10').findAll('.card-field').length === 0));
  const folded = await untilDb(`select collapsed from placements where canvas_id = '${boardId}' and record_id = '${r10}'`, (r) => r[0]?.collapsed === true);
  check('and is stored per placement', folded[0]?.collapsed === true);

  console.log('\nU11b. Which relationship arrows are drawn');
  const arrows = () => w.findAll('.arrow-layer .arrow').length;
  const modeBtn = () => w.find('.arrows-mode');
  const dimmed = () => w.findAll('.arrow-layer .arrow.dimmed').length;
  // (the mode is remembered per canvas in localStorage; a fresh browser starts in "focus")
  await until(() => arrows() >= 1);
  while (!/focus/.test(modeBtn().text())) await modeBtn().trigger('click');
  check('"focus" (the default): every arrow is drawn, and with nothing selected NOTHING is dimmed — hovering no longer dims anything', arrows() >= 1 && dimmed() === 0, `${arrows()} arrows, ${dimmed()} dimmed`);
  await cardBy('reel_10').trigger('pointerenter');
  check('…hovering a card changes nothing', dimmed() === 0);
  await cardBy('reel_10').trigger('pointerdown', { button: 0, clientX: 60, clientY: 60 });
  await bg().trigger('pointerup', { button: 0, clientX: 60, clientY: 60 });
  await until(() => cardBy('reel_10').classes('selected'));
  const touching = w.findAll('.arrow-layer .arrow').filter((a) => !a.classes('dimmed')).length;
  check('select a card: arrows that do not touch the selection dim; the rest stay full', arrows() >= 1 && touching >= 1 && touching + dimmed() === arrows(), `${arrows()} arrows, ${dimmed()} dimmed`);
  await modeBtn().trigger('click');
  check('"off": none', /off/.test(modeBtn().text()) && arrows() === 0);
  await modeBtn().trigger('click');
  check('"always": every arrow, never dimmed, selection or not', /always/.test(modeBtn().text()) && arrows() >= 1 && dimmed() === 0, `${dimmed()}`);
  await modeBtn().trigger('click');   // back to focus
  await bg().trigger('pointerdown', { button: 0, clientX: 5, clientY: 5 });   // deselect
  const arrowD = w.find('.arrow-layer .arrow-line').attributes('d') ?? '';
  check('arrows anchor to the CARD edge, not to a field row (no port rows are consulted)', !!arrowD && !w.find('.arrow-layer').attributes('ports'));

  console.log('\nU11c. Ctrl+Z on the canvas');
  const PE = (win as any).PointerEvent ?? (win as any).MouseEvent;
  const winEv = (type: string, init: Record<string, unknown>) => win.dispatchEvent(new PE(type, { bubbles: true, ...init }));
  const hotkey = (k: string, shiftKey = false) => win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: k, ctrlKey: true, shiftKey, bubbles: true }));
  const placementOf = async (recordId: string) => (await pool.query(
    `select x, y, w, h, collapsed from placements where canvas_id = $1 and record_id = $2`, [boardId, recordId])).rows[0];
  const moc = (await recId('made on canvas'));
  await untilDb(`select 1 from placements where record_id = '${moc}'`, (r) => r.length === 1);
  const posBefore = await placementOf(moc);

  // A REAL drag: down on the card, move on the window past the threshold, a frame, up.
  await cardBy('made on canvas').trigger('pointerdown', { button: 0, clientX: 300, clientY: 200, pointerId: 1 });
  winEv('pointermove', { clientX: 400, clientY: 250, pointerId: 1 });
  await sleep(60);
  winEv('pointerup', { clientX: 400, clientY: 250, pointerId: 1 });
  const dragged = await untilDb(`select x, y from placements where canvas_id='${boardId}' and record_id='${moc}'`, (r) => r[0].x !== posBefore.x);
  check('fixture: dragging a card moves it, as one mutation', dragged[0].x === posBefore.x + 100 && dragged[0].y === posBefore.y + 50,
    `${posBefore.x},${posBefore.y} -> ${dragged[0].x},${dragged[0].y}`);

  hotkey('z');
  const undone = await untilDb(`select x, y from placements where canvas_id='${boardId}' and record_id='${moc}'`, (r) => r[0].x === posBefore.x);
  // The trap: the drag writes x/y into local state every frame, so by the time the
  // move is issued state already holds the DESTINATION. An inverse read from state
  // at that moment is "move to where it is" — Ctrl+Z would do nothing, silently.
  check('Ctrl+Z puts a dragged card back where it started — on the server too',
    undone[0].x === posBefore.x && undone[0].y === posBefore.y, JSON.stringify(undone[0]));
  hotkey('z', true);
  const redone = await untilDb(`select x from placements where canvas_id='${boardId}' and record_id='${moc}'`, (r) => r[0].x === posBefore.x + 100);
  check('Ctrl+Shift+Z redoes it', redone[0].x === posBefore.x + 100, JSON.stringify(redone[0]));

  // reel_10 is folded. Unplace it, then undo: position AND fold must come cameBack.
  const r10Before = await placementOf(r10);
  await cardBy('reel_10').find('.card-unplace').trigger('click');
  await untilDb(`select 1 from placements where canvas_id='${boardId}' and record_id='${r10}'`, (r) => r.length === 0);
  check('fixture: × removes the card from the canvas (the record is kept)', !cardBy('reel_10')
    && (await pool.query(`select 1 from records where id = $1`, [r10])).rowCount === 1);
  hotkey('z');
  const cameBack = await untilDb(`select x, y, collapsed from placements where canvas_id='${boardId}' and record_id='${r10}'`, (r) => r.length === 1 && r[0].collapsed === true);
  check('Ctrl+Z after "unplace" brings the card back in the same place, still folded',
    cameBack[0]?.x === r10Before.x && cameBack[0]?.y === r10Before.y && cameBack[0]?.collapsed === true && !!cardBy('reel_10'), JSON.stringify(cameBack[0]));

  await cardBy('reel_10').find('.card-fold').trigger('click');
  await untilDb(`select collapsed from placements where canvas_id='${boardId}' and record_id='${r10}'`, (r) => r[0].collapsed === false);
  hotkey('z');
  check('folding is undoable too', (await untilDb(`select collapsed from placements where canvas_id='${boardId}' and record_id='${r10}'`, (r) => r[0].collapsed === true))[0].collapsed === true);

  // Creating a card was TWO mutations (record + placement) and is ONE undo.
  const cardsBefore = cardsNow().length;
  await bg().trigger('dblclick', { clientX: 700, clientY: 400 });
  await until(() => cardsNow().length === cardsBefore + 1);
  await panel().find('.rp-close').trigger('click');
  hotkey('z');
  check('one Ctrl+Z undoes "create a card" whole — the record AND its placement',
    await until(() => cardsNow().length === cardsBefore), `${cardsNow().length} cards`);

  await cardBy('reel_10').trigger('dblclick');
  check('double-click a card opens its record', await until(() => panel().exists() && panel().find('.rp-title').text() === 'reel_10'));
  await panel().find('.rp-close').trigger('click');
  await tab('table').trigger('click');
  await until(() => w.find('.gridview').exists());

  console.log('\nU12. Ctrl+Z in the grid');
  await cell(rowOf('reel_2'), 0).trigger('mousedown');
  await key('Enter'); await typeAnd('renamed', 'Enter');
  await untilDb(`select 1 from records where data->>'name' = 'renamed'`, (r) => r.length === 1);
  hotkey('z');
  check('a cell edit is undone', (await untilDb(`select 1 from records where data->>'name' = 'reel_2'`, (r) => r.length === 1)).length === 1
    && await until(() => names().includes('reel_2')));
  const rowsBefore = rowsNow().length;
  await rowsNow()[rowOf('reel_2')].find('td.act button').trigger('click');
  await untilDb(`select 1 from records where data->>'name' = 'reel_2'`, (r) => r.length === 0);
  hotkey('z');
  check('a DELETED row comes back too — Ctrl+Z asks the server to restore it',
    await until(() => rowsNow().length === rowsBefore, 8000) && names().includes('reel_2'), names().join());
  // Inside an input the key belongs to the browser's text undo.
  await cell(rowOf('reel_1'), 0).trigger('mousedown'); await key('Enter');
  await sleep(600);                       // let the restore above finish landing
  const seqBefore = await mutationCount();
  await editor().trigger('keydown', { key: 'z', ctrlKey: true });
  await sleep(300);
  check('Ctrl+Z while TYPING is left to the text field', await mutationCount() === seqBefore && editor().exists(),
    `${await mutationCount() - seqBefore} mutations, editor ${editor().exists()}`);
  await editor().trigger('keydown', { key: 'Escape' });

  console.log('\nU13. Backlinks: the other end of a link');
  // Files.Show → Shows. reel_10 links to Gamma (and Beta), reel_2 to Alpha. From the
  // Shows side, nothing says so — until a backlink field mirrors that link.
  await nav.openTable(shows);
  await until(() => ths().includes('Code') || ths().includes('Name'));
  await w.find('.gridview .th-add').trigger('click');
  await gridPop().find('input.name').setValue('Used by');
  await gridPop().find('select.type').setValue('backlink');
  const srcOpts = () => gridPop().find('select.source').findAll('option').map((o) => o.text());
  check('the form offers every link field that POINTS AT this table, named by table · field',
    await until(() => srcOpts().includes('Files · Show')), srcOpts().join(' | '));
  await gridPop().find('button.add').trigger('click');
  check('nothing chosen is refused in the form', /needs the link field/.test(gridPop().find('.error').text()), gridPop().find('.error').text());
  await gridPop().find('select.source').setValue(linkField);
  await gridPop().find('button.add').trigger('click');
  await gridPop().trigger('keydown', { key: 'Escape' });
  await until(() => ths().includes('Used by'));
  const UB = () => ths().indexOf('Used by');
  const showRow = (name: string) => rowsNow().findIndex((r) => r.text().includes(name));
  check('each show now lists the files that link to it',
    await until(() => /reel_10/.test(column(UB())[showRow('Gamma')] ?? '') && /reel_2/.test(column(UB())[showRow('Alpha')] ?? '')),
    column(UB()).join(' | '));
  await cell(showRow('Gamma'), UB()).trigger('mousedown');
  await key('Enter'); await key('x'); await key('Delete');
  check('it is read-only — the link is made on the file, not here', !editor().exists() && !w.find('.gridview .picker').exists());
  check('and stores nothing', (await pool.query(`select 1 from records where data ? 'used_by'`)).rowCount === 0);

  await key(' ');
  await until(() => panel().exists());
  check('the record panel shows the backlink as chips', await until(() => pField('Used by').findAll('.pill.back').some((c) => c.find('.pill-text').text() === 'reel_10')),
    pField('Used by').text());
  check('and a "Referenced by" section lists EVERY incoming link, grouped by where it comes from',
    panel().find('.rp-refs').exists() && /Files · Show/.test(panel().find('.rp-refs').text()) && /reel_10/.test(panel().find('.rp-refs').text()),
    panel().find('.rp-refs').exists() ? panel().find('.rp-refs').text() : 'no section');
  await panel().find('.rp-refs .pill.back').trigger('dblclick');
  check('a double-click on a referrer opens THAT record', await until(() => panel().find('.rp-title').text() === 'reel_10'), panel().find('.rp-title').text());
  await panel().find('.rp-close').trigger('click');

  await tab('canvas').trigger('click');
  console.log('\nU13b. Several links on a card: a vertical list');
  // reel_10 links to Gamma AND Beta. On its card the Show row is one line per record —
  // what the record panel already does — and the card is taller by one line for it.
  await until(() => !!cardBy('reel_10'));
  if (cardBy('reel_10').find('.card-fold').text().includes('▸')) await cardBy('reel_10').find('.card-fold').trigger('click');   // unfold (an earlier section folded it)
  await until(() => cardBy('reel_10').find('.card-list').exists(), 8000);
  const listRow = cardBy('reel_10').findAll('.card-field').find((f) => f.find('.card-key').text() === 'Show')!;
  check('a link row with two records is a LIST, one per line, not "Gamma, Beta" on one line',
    listRow.find('.card-list').exists() && listRow.findAll('.card-line').map((l) => l.find('.pill-text').text()).sort().join() === 'Beta,Gamma', listRow.text());
  await tab('table').trigger('click');

  console.log('\nU14. The command palette (Ctrl+K)');
  const pal = () => w.find('.palette');
  const palInput = () => pal().find('input.pq');
  const palRows = () => pal().findAll('.presults li');
  const palLabels = () => palRows().map((r) => r.find('.plabel').text());
  const palKey = (k: string, shiftKey = false) => palInput().trigger('keydown', { key: k, shiftKey });
  const ctrlK = () => win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));

  ctrlK();
  check('Ctrl+K opens it', await until(() => pal().exists()));
  await palInput().setValue('reel_1');
  check('it finds records in a table that is NOT the one open (the grid is on Shows)',
    await until(() => palLabels().includes('reel_10') && palLabels().includes('reel_1')), palLabels().join());
  await palInput().setValue('sho');
  check('a table whose name matches is offered first', await until(() => palLabels()[0] === 'Shows:'), palLabels().join());
  await palKey('Tab');
  check('Tab completes it into a scope', (palInput().element as HTMLInputElement).value === 'Shows:' );
  check('a bare scope lists that table\'s records', await until(() => ['Alpha', 'Beta', 'Gamma'].every((n) => palLabels().some((l) => l.includes(n) || l === 'XJ9' || l === 'ZZ-TOP'))) || palRows().length >= 3, palLabels().join());
  await palInput().setValue('file:reel_2');
  check('"file:reel_2" fuzzy-matches the Files table and searches inside it',
    await until(() => palLabels().join() === 'reel_2'), palLabels().join());
  await palKey('Enter');
  check('Enter (not on a canvas) goes to the record: its table opens, and the panel',
    await until(() => !pal().exists() && panel().exists() && panel().find('.rp-title').text() === 'reel_2')
    && nav.currentTable() === filesId, panel().exists() ? panel().find('.rp-title').text() : 'no panel');
  await panel().find('.rp-close').trigger('click');

  await tab('canvas').trigger('click');
  await until(() => w.find('.canvas-container').exists());
  const cardsBeforePal = cardsNow().length, arrowsBeforePal = arrows();
  ctrlK(); await until(() => pal().exists());
  await palInput().setValue('show:alpha');
  await until(() => palRows().length === 1);
  await palKey('Enter', true);
  check('on a canvas, Shift+Enter PLACES the record and keeps the palette open',
    await until(() => cardsNow().length === cardsBeforePal + 1) && pal().exists(), `${cardsNow().length} cards, palette ${pal().exists()}`);
  await palInput().setValue('reel_2');
  await until(() => palLabels().includes('reel_2'));
  await palRows()[palLabels().indexOf('reel_2')].trigger('mousedown');
  check('a plain pick places and closes', await until(() => cardsNow().length === cardsBeforePal + 2 && !pal().exists()));
  // reel_2 → Alpha is a link. Neither record came from this canvas's scene, so the
  // link was not in memory; it has to be fetched once the placements have landed.
  check('the arrow between two records placed from the palette appears WITHOUT a reload',
    await until(() => arrows() > arrowsBeforePal, 6000), `${arrowsBeforePal} -> ${arrows()}`);
  const alphaPlaced = await untilDb(`select 1 from placements where canvas_id = '${boardId}' and record_id = '${showIds[0]}'`, (r) => r.length === 1);
  check('and the placements are on the server', alphaPlaced.length === 1);

  ctrlK(); await until(() => pal().exists());
  await palInput().setValue('reel_10');
  await until(() => palLabels().includes('reel_10'));
  const r10row = () => palRows()[palLabels().indexOf('reel_10')];
  check('a record already on this canvas says so', r10row().find('.placed').exists(), r10row().text());
  const placementsBefore = Number((await pool.query(`select count(*)::int n from placements where canvas_id = $1`, [boardId])).rows[0].n);
  while (palLabels()[palRows().findIndex((r) => r.classes('hi'))] !== 'reel_10') await palKey('ArrowDown');
  await palKey('Enter');
  await sleep(500);
  check('choosing it JUMPS to the card instead of placing it twice',
    !pal().exists() && cardBy('reel_10').classes('selected')
    && Number((await pool.query(`select count(*)::int n from placements where canvas_id = $1`, [boardId])).rows[0].n) === placementsBefore);
  console.log('\nU15. Ports, colours and direction');
  // reel_2 —Show→ Alpha, both placed from the palette. Files cards on this board
  // show [Status, Show]; Shows cards show their default fields, which include the
  // "Used by" BACKLINK made in U13 — the input port for that same link.
  const r2 = await recId('reel_2');
  const arrowOf = () => w.find(`.arrow-layer .arrow[data-field="${linkField}"]`);
  const arrowsOfField = () => w.findAll(`.arrow-layer .arrow[data-field="${linkField}"]`);
  const pathFor = (fromId: string, toId: string) => {
    // data-field is per FIELD; pick the arrow for this pair by matching an end point.
    return arrowsOfField().map((a) => a.find('.arrow-line').attributes('d') ?? '');
  };
  const startOf = (d: string) => d.slice(1).split(' ')[0].split(',').map(Number) as [number, number];
  const place = async (id: string) => (await pool.query(`select x, y, w, h, collapsed from placements where canvas_id = $1 and record_id = $2`, [boardId, id])).rows[0];
  await untilDb(`select 1 from placements where canvas_id = '${boardId}' and record_id = '${r2}'`, (r) => r.length === 1);
  const pr2 = await place(r2), pAlpha = await place(showIds[0]);

  const filesRows = Object.keys(rowsOf(cardBy('reel_2')));
  const showRowIdx = filesRows.indexOf('Show');
  const alphaRows = Object.keys(rowsOf(cardBy('Alpha')));
  const usedByIdx = alphaRows.indexOf('Used by');
  check('fixture: reel_2\'s card shows its link row and Alpha\'s shows the backlink row', showRowIdx >= 0 && usedByIdx >= 0,
    `${filesRows.join()} / ${alphaRows.join()}`);

  // ARROWS ANCHOR TO THE CARD, never to a field's row (the owner retired row anchoring:
  // "let's just have all arrows stem from the card"). The row's PORT still exists — as
  // the handle to START a link from, tested in U18 — but a drawn arrow leaves the
  // card's left or right EDGE, at its vertical middle, folded or not.
  // The four edge MIDPOINTS of reel_2's card (bestSides picks whichever faces the other card), ±4px stand-off.
  const mids = (h: number) => { const w0 = pr2.w ?? CARD_W; return [[pr2.x - 4, pr2.y + h / 2], [pr2.x + w0 + 4, pr2.y + h / 2], [pr2.x + w0 / 2, pr2.y - 4], [pr2.x + w0 / 2, pr2.y + h + 4]]; };
  const atAnEdgeMid = (h: number) => pathFor(r2, showIds[0]).some((d) => mids(h).some(([x, y]) => Math.abs(startOf(d)[0] - x) < 1 && Math.abs(startOf(d)[1] - y) < 1));
  const openH = cardHeight(filesRows.length, false);
  check('the arrow leaves the CARD\'s edge at its midpoint — not the link field\'s row', await until(() => atAnEdgeMid(openH)),
    `want one of ${JSON.stringify(mids(openH))}; got ${pathFor(r2, showIds[0]).map((d) => startOf(d).join()).join(' | ')}`);
  const rowY = pr2.y + rowPortY(showRowIdx, openH, false)!;
  check('…and not from the row', !pathFor(r2, showIds[0]).some((d) => Math.abs(startOf(d)[1] - rowY) < 0.6 && Math.abs(startOf(d)[0] - (pr2.x + (pr2.w ?? CARD_W) + 4)) < 0.6));
  await cardBy('reel_2').find('.card-fold').trigger('click');
  check('FOLD the card and the arrow follows the smaller card\'s edge', await until(() => atAnEdgeMid(cardHeight(filesRows.length, true))), pathFor(r2, showIds[0]).map((d) => startOf(d).join()).join(' | '));
  await cardBy('reel_2').find('.card-fold').trigger('click');
  await until(() => atAnEdgeMid(openH));
  void pAlpha; void usedByIdx;

  // Colour and direction live on the FIELD. Set them the way a person would: the
  // column's ▾ menu in the grid.
  await tab('table').trigger('click');
  await nav.openTable(filesId);
  await until(() => ths().includes('Show'));
  await th('Show').find('.th-menu').trigger('click');
  check('a link field\'s settings offer arrow colour and direction', gridPop().find('.arrow-style input[type="color"]').exists()
    && gridPop().find('.arrow-rev input').exists());
  await gridPop().find('.arrow-style input[type="color"]').setValue('#ff3366');
  await gridPop().find('.arrow-style input[type="color"]').trigger('change');
  const styledOpt = await untilDb(`select options from fields where id = '${linkField}'`, (r) => r[0].options.arrow?.color === '#ff3366');
  check('the colour is stored on the field — and the link\'s TARGET survives the write',
    styledOpt[0].options.arrow?.color === '#ff3366' && styledOpt[0].options.target_table_id === shows, JSON.stringify(styledOpt[0].options));
  await gridPop().trigger('keydown', { key: 'Escape' });

  await tab('canvas').trigger('click');
  await until(() => arrowOf().exists());
  check('every arrow of that relationship takes the colour', arrowsOfField().every((a) => (a.attributes('style') ?? '').includes('#ff3366')),
    arrowOf().attributes('style') ?? '');
  check('and so does the port row\'s dot on the card', (cardBy('reel_2').find('.port-dot').attributes('style') ?? '').includes('rgb(255, 51, 102)')
    || (cardBy('reel_2').find('.port-dot').attributes('style') ?? '').includes('#ff3366'), cardBy('reel_2').find('.port-dot').attributes('style') ?? 'no dot');

  const headBefore = arrowsOfField().map((a) => a.find('.arrow-head').attributes('d')).join('|');
  await post([{ type: 'field.update', id: linkField, options: { target_table_id: shows, arrow: { color: '#ff3366', reversed: true } } }]);
  check('"reversed" moves the arrowhead to the record that HOLDS the link — live, from a peer',
    await until(() => arrowsOfField().map((a) => a.find('.arrow-head').attributes('d')).join('|') !== headBefore)
    && pathFor(r2, showIds[0]).some((d) => { const e = d.trim().split(' ').pop()!.split(',').map(Number); return mids(openH).some(([x, y]) => Math.abs(e[0] - x) < 12 && Math.abs(e[1] - y) < 12); }));

  await w.find('.arrows-legend').trigger('click');
  const legendRow = () => w.findAll('.legend .legend-row').find((r) => r.text().includes('Files · Show'))!;
  check('the legend names each relationship drawn here, with its count', !!legendRow() && /\d/.test(legendRow().find('.legend-n').text()), w.find('.legend').text());
  const nBefore = arrowsOfField().length;
  await legendRow().find('input').setValue(false);
  check('unticking one hides just that relationship\'s arrows', nBefore > 0 && await until(() => arrowsOfField().length === 0), `${arrowsOfField().length}`);
  check('as a way of LOOKING — nothing was written to the server',
    (await pool.query(`select config from canvases where id = $1`, [boardId])).rows[0].config.hiddenFields === undefined);
  await legendRow().find('input').setValue(true);
  await until(() => arrowsOfField().length === nBefore);
  await bg().trigger('pointerdown', { button: 0, clientX: 5, clientY: 5 });

  // (U16 used to be the grid DOCKED beside the canvas, and dragging its rows onto it.
  //  The dock was removed at the owner's request — a one-off dock does not fit the
  //  split-pane system planned for later. Row SELECTION is kept and tested below; the
  //  drag service and the canvas's multi-record drop (`placeMany`) are kept for split
  //  panes but have NO UI path and NO test until then — say so rather than imply cover.)
  console.log('\nU16. Selecting rows');
  await nav.openTable(filesId);
  await until(() => rowsNow().length >= 3);
  const numCell = (i: number) => rowsNow()[i].find('td.num');
  await numCell(0).trigger('pointerdown', { button: 0, clientX: 40, clientY: 300 });
  winEv('pointerup', { clientX: 40, clientY: 300 });
  check('clicking a row NUMBER selects the row', rowsNow()[0].classes('rowsel') && w.findAll('.gridview tr.rowsel').length === 1);
  await numCell(2).trigger('pointerdown', { button: 0, ctrlKey: true, clientX: 40, clientY: 360 });
  winEv('pointerup', { clientX: 40, clientY: 360 });
  check('Ctrl+click adds a row to the selection', w.findAll('.gridview tr.rowsel').length === 2);
  await numCell(0).trigger('pointerdown', { button: 0, clientX: 40, clientY: 300 });
  await numCell(2).trigger('pointerdown', { button: 0, shiftKey: true, clientX: 40, clientY: 360 });
  winEv('pointerup', { clientX: 40, clientY: 360 });
  check('Shift+click selects the range', w.findAll('.gridview tr.rowsel').length === 3);
  await w.find('.gridview .scroller').trigger('keydown', { key: 'a', ctrlKey: true });
  check('Ctrl+A selects every row in the view', w.findAll('.gridview tr.rowsel').length === rowsNow().length);
  await w.find('.gridview .scroller').trigger('keydown', { key: 'Escape' });
  check('Escape clears it', w.findAll('.gridview tr.rowsel').length === 0);
  check('there is no dock: no toggle on the canvas, no "not on canvas" filter, no ◧ in the tree',
    !w.find('.dock-toggle').exists() && !w.find('.not-placed').exists() && !w.find('.tree .dock-it').exists() && !w.find('.workspace').exists());

  console.log('\nU17. Rich text notes');
  await nav.openTable(filesId);
  await until(() => ths().includes('Show'));
  await w.find('.gridview .th-add').trigger('click');
  await addField('Brief', 'rich_text', undefined, gridPop());
  await addField('Refs', 'attachment', undefined, gridPop());
  await gridPop().trigger('keydown', { key: 'Escape' });
  await untilDb(`select 1 from fields where key in ('brief','refs')`, (r) => r.length === 2);

  const BRIEF = () => ths().indexOf('Brief');
  await cell(rowOf('reel_1'), BRIEF()).trigger('mousedown');
  await key('Enter');
  check('Enter on a rich text cell opens the RECORD — a 30px row is no place to write',
    await until(() => panel().exists() && panel().find('.rp-title').text() === 'reel_1') && !editor().exists());
  // THE STEADY EDITOR: it is simply there — no click to enter an edit mode, no
  // rendered view that swaps out, a toolbar that never appears or disappears.
  check('the editor is ALREADY there when the record opens — nothing to click, nothing that swaps', await until(() => panel().find('.rte .ProseMirror').exists(), 8000));
  const pm = () => (panel().find('.rte .ProseMirror').element as any).editor;
  const rteState = () => panel().find('.rte-state').text();
  const save = () => panel().find('.rte').trigger('keydown', { key: 'Enter', ctrlKey: true });
  const para = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  check('with a permanent formatting bar, and a word saying what state your text is in', panel().findAll('.rte-bar button').length > 8 && rteState() === 'saved', rteState());
  check('the writing area has a FIXED height — the content never sets it', /height:\s*340px/.test(panel().find('.rte-body').attributes('style') ?? ''), panel().find('.rte-body').attributes('style'));
  check('its place is reserved while it loads, so the fields below never jump', /min-height:\s*374px/.test(panel().find('.rp-rich').attributes('style') ?? ''), panel().find('.rp-rich').attributes('style'));

  pm().commands.setContent({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'QC notes' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Slate is wrong at 01:00:00:00' }] }] });
  check('typing turns the word to "editing" and says when it will save', await until(() => /^editing/.test(rteState())), rteState());
  const logBefore = await mutationCount();
  await save();
  const brief = await untilDb(`select data from records where data->>'name' = 'reel_1'`, (r) => r[0].data.brief?.type === 'doc');
  check('Ctrl+Enter stores a DOCUMENT — once, as one mutation', brief[0].data.brief.content[0].type === 'heading' && await mutationCount() === logBefore + 1,
    `${await mutationCount() - logBefore} mutations`);
  check('and NOTHING moved: same editor, same toolbar, the heading still in it, the word back to "saved"',
    await until(() => rteState() === 'saved') && panel().find('.rte .ProseMirror h2').text() === 'QC notes' && !panel().find('.rich').exists(), rteState());
  check('the grid cell shows the first line', await until(() => column(BRIEF())[rowOf('reel_1')] === 'QC notes'), column(BRIEF())[rowOf('reel_1')]);

  const quietLog = await mutationCount();
  await save();
  await panel().find('.rte').trigger('focusout');
  await sleep(300);
  check('saving or clicking away with no change writes nothing', await mutationCount() === quietLog && panel().find('.rte').exists());

  // Two people, one document.
  const r1 = await recId('reel_1');
  await post([{ type: 'record.update', id: r1, set: { brief: para('a colleague wrote this') }, unset: [] }]);
  check('NOT editing: a colleague\'s save simply appears in your editor', await until(() => /a colleague wrote this/.test(pm().getText()), 6000) && rteState() === 'saved', pm().getText());

  pm().commands.setContent(para('my unsaved words'));
  await until(() => /^editing/.test(rteState()));
  await post([{ type: 'record.update', id: r1, set: { brief: para('a colleague got here first') }, unset: [] }]);
  await untilDb(`select data from records where id = '${r1}'`, (r) => /got here first/.test(JSON.stringify(r[0].data.brief)));
  await sleep(300);
  check('EDITING: their save is NOT pushed into your editor while you type', /my unsaved words/.test(pm().getText()) && !/got here first/.test(pm().getText()), pm().getText());
  await save();
  check('saving over a value that changed underneath you STOPS and says so', await until(() => panel().find('.rte-conflict').exists()) && /decision/.test(rteState()));
  check('— nothing has been overwritten yet', /got here first/.test(JSON.stringify((await pool.query(`select data from records where id = $1`, [r1])).rows[0].data.brief)));
  await panel().findAll('.rte-conflict button').find((b) => /Keep mine/.test(b.text()))!.trigger('click');
  const mine = await untilDb(`select data from records where id = '${r1}'`, (r) => /my unsaved words/.test(JSON.stringify(r[0].data.brief)));
  check('"Keep mine" then writes it', /my unsaved words/.test(JSON.stringify(mine[0].data.brief)));

  pm().commands.setContent(para('a change of heart'));
  await until(() => /^editing/.test(rteState()));
  await panel().find('.rte').trigger('keydown', { key: 'Escape' });
  check('Escape with unsaved words puts back what was saved — and does NOT close the tray',
    await until(() => /my unsaved words/.test(pm().getText()) && rteState() === 'saved') && panel().exists(), pm().getText());

  // The dangerous one. Unsaved words, then jump straight to ANOTHER record: the
  // editor saves as it unmounts — and by then the panel is showing the next record.
  pm().commands.setContent(para('written on reel_1, saved on the way out'));
  await until(() => /^editing/.test(rteState()));
  // (r10 — reel_10's id — was looked up earlier in this file.)
  await cell(rowOf('reel_10'), 0).trigger('mousedown');
  await key(' ');                                   // Space opens the selected row's record
  await until(() => panel().find('.rp-title').text() === 'reel_10');
  const kept = await untilDb(`select data from records where id = '${r1}'`, (r) => /saved on the way out/.test(JSON.stringify(r[0].data.brief)));
  check('switching records with unsaved words saves them — to the record they were written on',
    /saved on the way out/.test(JSON.stringify(kept[0].data.brief)));
  check('— and NOT onto the record you switched to', !('brief' in (await pool.query(`select data from records where id = $1`, [r10])).rows[0].data));
  await cell(rowOf('reel_1'), 0).trigger('mousedown');
  await key(' ');
  await until(() => panel().find('.rp-title').text() === 'reel_1' && panel().find('.rte .ProseMirror').exists());

  console.log('\nU17b. Images: pasted HTML → the asset store');
  const { adoptImagesInHtml } = await import('../src/client/richtext/paste.js');
  const tinyPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'),
    Buffer.from([0, 0, 0, 64, 0, 0, 0, 48, 8, 6, 0, 0, 0]), Buffer.from(`ui-${Date.now()}`)]);
  const uploadReal = async (blob: Blob, name = '') => {
    const res = await fetch(`${API}/api/assets?name=${encodeURIComponent(name)}`, { method: 'POST', body: Buffer.from(await blob.arrayBuffer()) });
    return res.json();
  };
  const pasted = `<p>From the email:</p><img src="data:image/png;base64,${tinyPng.toString('base64')}" alt="inline.png"><img src="https://mail.example.com/logo.png"><img src="cid:part1">`;
  const adopted = await adoptImagesInHtml(pasted, uploadReal);
  const adoptedId = /data-asset-id="([0-9a-f-]{36})"/.exec(adopted.html)?.[1];
  check('an embedded (data:) image is uploaded and the tag rewritten to the asset', !!adoptedId && !adopted.html.includes('base64') && /width="64"/.test(adopted.html), adopted.html.slice(0, 200));
  check('images that live on another server cannot be copied — and that is REPORTED, not silent', adopted.dropped === 2 && !adopted.html.includes('example.com') && !adopted.html.includes('cid:'));
  check('the bytes are in the asset store', (await fetch(`${API}/api/assets/${adoptedId}`)).status === 200);

  pm().commands.setContent(adopted.html);
  check('the editor parses that tag back into an asset-backed image node',
    JSON.stringify(pm().getJSON()).includes(`"assetId":"${adoptedId}"`) && !JSON.stringify(pm().getJSON()).includes('"src"'), JSON.stringify(pm().getJSON()).slice(0, 240));
  await save();
  await untilDb(`select data from records where id = '${r1}'`, (r) => JSON.stringify(r[0].data.brief).includes(adoptedId!));
  check('and it shows in the editor with a src BUILT from the id', await until(() => (panel().find('.rte .ProseMirror img').attributes('src') ?? '').endsWith(`/api/assets/${adoptedId}`)),
    panel().find('.rte .ProseMirror img').exists() ? panel().find('.rte .ProseMirror img').attributes('src') : 'no img');

  console.log('\nU17c. Attachments');
  const att = () => pField('Refs').find('.attach');
  // Node's File, not happy-dom's: the upload goes through Node's fetch, which can
  // only serialise its own Blob/File — given happy-dom's it sent "[object File]".
  // Its OWN bytes: the same bytes as the image above would be the same asset, and
  // an asset keeps the first name it was uploaded under ("inline.png").
  const file = new File([Buffer.concat([tinyPng, Buffer.from('attachment')])], 'still_0042.png', { type: 'image/png' });
  await att().trigger('drop', { dataTransfer: { files: [file] } });
  const refs = await untilDb(`select data from records where id = '${r1}'`, (r) => Array.isArray(r[0].data.refs) && r[0].data.refs.length === 1, 8000);
  check('dropping a file uploads it and stores its ASSET ID on the record', refs[0].data.refs?.length === 1, JSON.stringify(refs[0].data.refs));
  check('it shows as a thumbnail with its name', await until(() => att().findAll('.att').length === 1 && att().find('.att-name').text() === 'still_0042.png'), att().text());
  await att().trigger('drop', { dataTransfer: { files: [file] } });
  await sleep(600);
  check('the same file again is the same asset — not listed twice', att().findAll('.att').length === 1);
  check('the grid summarises it', column(ths().indexOf('Refs'))[rowOf('reel_1')].includes('1 file'), column(ths().indexOf('Refs'))[rowOf('reel_1')]);
  await att().find('.att-x').trigger('click');
  const refsCleared = await untilDb(`select data from records where id = '${r1}'`, (r) => !('refs' in r[0].data));
  check('removing the last file unsets the field; the asset itself stays in the store',
    !('refs' in refsCleared[0].data) && (await pool.query(`select 1 from assets where id = $1`, [refs[0].data.refs[0]])).rowCount === 1);
  await panel().find('.rp-close').trigger('click');

  console.log('\nU17d. Notes on canvas cards: formatting and images, in a fixed window');
  const briefField = (await pool.query(`select id from fields where key = 'brief'`)).rows[0].id as string;
  const statusField = (await pool.query(`select id from fields where key = 'status' and table_id = $1`, [filesId])).rows[0].id as string;
  await post([
    { type: 'record.update', id: r1, set: { brief: { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'QC notes' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Slate is ' }, { type: 'text', text: 'wrong', marks: [{ type: 'bold' }] }, { type: 'text', text: ' at 01:00:00:00' }] },
      { type: 'image', attrs: { assetId: adoptedId, width: 64, height: 48, alt: 'inline.png' } }] } }, unset: [] },
    { type: 'canvas.update', id: boardId, config: { cardFields: { [filesId]: [statusField, linkField, briefField] } } },
    { type: 'placement.add', id: randomUUID(), canvasId: boardId, recordId: r1, x: 900, y: 40, w: null, h: null, z: 50 },
  ]);
  await nav.openCanvas(boardId);
  await until(() => !!cardBy('reel_1'), 8000);
  const noteCard = () => cardBy('reel_1');
  check('a record WITH a note shows it as a block under its rows', await until(() => noteCard().find('.card-rich .rich').exists(), 8000), noteCard().html().slice(0, 300));
  check('…FORMATTED — a heading, bold — not the first line as plain text',
    noteCard().find('.card-rich .rich h2').text() === 'QC notes' && noteCard().find('.card-rich .rich strong').text() === 'wrong');
  check('…with its IMAGE, from the asset store (it used to say "[image]")',
    (noteCard().find('.card-rich .rich img').attributes('src') ?? '').endsWith(`/api/assets/${adoptedId}`) && !/\[image\]/.test(noteCard().text()));
  check('the note is NOT also a row — the rows are Status and Show', Object.keys(rowsOf(noteCard())).join() === 'Status,Show', Object.keys(rowsOf(noteCard())).join());
  const hOf = (c: ReturnType<typeof cardBy>) => Number(/height:\s*(\d+)px/.exec(c.attributes('style') ?? '')?.[1]);
  check('the card\'s height is ARITHMETIC: two rows plus one fixed note window', hOf(noteCard()) === cardHeight(2, false, 1), `${hOf(noteCard())} vs ${cardHeight(2, false, 1)}`);
  check('a record with NO note gets no block and no empty hole — same rows, shorter card',
    !cardBy('reel_2').find('.card-rich').exists() && hOf(cardBy('reel_2')) === cardHeight(2, false, 0) && Object.keys(rowsOf(cardBy('reel_2'))).join() === 'Status,Show',
    `reel_2: h=${hOf(cardBy('reel_2'))} want ${cardHeight(2, false, 0)} rows=${Object.keys(rowsOf(cardBy('reel_2'))).join()} style=${cardBy('reel_2').attributes('style')}`);   // (reel_10 was folded by an earlier test)
  // Ports: the Show row is index 1 on BOTH cards, so its arrow leaves from the same offset.
  await noteCard().find('.card-fold').trigger('click');
  check('folded, the note folds away with the rows', await until(() => !noteCard().find('.card-rich').exists() && hOf(noteCard()) === cardHeight(2, true, 1)));
  await noteCard().find('.card-fold').trigger('click');

  console.log('\nU18. Arrows you can select; links you can make and remove on the canvas');
  // On the board: reel_1 and reel_2 (Files — rows Status, Show), Alpha and Gamma (Shows).
  // reel_2 —Show→ Alpha already exists. reel_1 links to nothing yet.
  const linkCount = async () => Number((await pool.query(`select count(*)::int n from links where field_id = $1`, [linkField])).rows[0].n);
  const arrowFor = (from: string, to: string) => w.find(`.arrow-layer .arrow[data-key="${linkField}|${from}|${to}"]`);
  check('a LINK row carries a handle to drag a new link from; an ordinary row does not',
    cardBy('reel_1').findAll('.card-field').filter((r) => r.find('.port-handle').exists()).map((r) => r.find('.card-key').text()).join() === 'Show');

  await arrowFor(r2, showIds[0]).find('.arrow-hit').trigger('pointerdown', { button: 0 });
  check('clicking an arrow selects it', await until(() => arrowFor(r2, showIds[0]).classes('selected')) && w.findAll('.arrow.selected').length === 1);
  check('…and a selected arrow SAYS which relationship it is', w.find('.arrow-label text').text() === 'Show', w.find('.arrow-label').exists() ? w.find('.arrow-label').text() : 'no label');
  check('an arrow OR cards are selected, never both (Delete must be unambiguous)', w.findAll('.canvas-world .card.selected').length === 0);

  const linksBefore = await linkCount();
  await arrowFor(r2, showIds[0]).find('.arrow-hit').trigger('contextmenu', { clientX: 300, clientY: 200 });
  check('right-click offers to remove THIS link, naming it and its two ends',
    w.find('.canvas-container .ctx .ctx-head').text() === 'Show' && /reel_2 → Alpha/.test(w.find('.canvas-container .ctx .ctx-sub').text()) && w.find('.ctx .remove-link').exists(), w.find('.ctx').text());
  nav.dialogs.cancelNext = true;
  await w.find('.ctx .remove-link').trigger('click');
  await until(() => nav.dialogs.seen.some((t) => /^Remove this .Show. link/.test(t)));
  await sleep(250);
  check('it ASKS first — and Cancel leaves the link alone', await linkCount() === linksBefore && arrowFor(r2, showIds[0]).exists(), nav.dialogs.seen.slice(-1)[0]);
  await arrowFor(r2, showIds[0]).find('.arrow-hit').trigger('contextmenu', { clientX: 300, clientY: 200 });
  await w.find('.ctx .remove-link').trigger('click');
  check('confirmed, the link is removed — from the DATABASE, not just the drawing', (await untilDb(`select count(*)::int n from links where field_id = '${linkField}'`, (r) => Number(r[0].n) === linksBefore - 1))[0].n == linksBefore - 1
    && await until(() => !arrowFor(r2, showIds[0]).exists()));
  check('both records are still there', !!cardBy('reel_2') && !!cardBy('Alpha'));
  hotkey('z');
  check('and it is one Ctrl+Z', (await untilDb(`select count(*)::int n from links where field_id = '${linkField}'`, (r) => Number(r[0].n) === linksBefore))[0].n == linksBefore && await until(() => arrowFor(r2, showIds[0]).exists()));

  await arrowFor(r2, showIds[0]).find('.arrow-hit').trigger('pointerdown', { button: 0 });
  nav.dialogs.cancelNext = true;
  const seenBefore = nav.dialogs.seen.length;
  await w.find('.canvas-container').trigger('keydown', { key: 'Delete' });
  check('Delete with an arrow selected asks the same question — it never just deletes', await until(() => nav.dialogs.seen.length > seenBefore) && await linkCount() === linksBefore);
  await sleep(250);

  // ── dragging a new link out of a port ──
  // happy-dom has no layout, so the container's box is at the origin; world → client is
  // just the viewport transform, read from the world layer's own style.
  const toClient = (wx: number, wy: number) => {
    const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(w.find('.canvas-world').attributes('style') ?? '')!;
    return { clientX: wx * Number(m[3]) + Number(m[1]), clientY: wy * Number(m[3]) + Number(m[2]) };
  };
  const gammaId = await recId('Gamma');       // (showIds is in creation order; Gamma is not its second entry)
  const pGamma = await place(gammaId), pReel2 = await place(r2);
  const handle = () => cardBy('reel_1').find('.port-handle');
  await handle().trigger('pointerdown', { button: 0, ...toClient(1100, 80) });
  winEv('pointermove', toClient(pGamma.x + 30, pGamma.y + 20));
  check('dragging from the handle draws a line from the port', await until(() => w.find('.arrow-layer .rubber').exists()));
  check('cards that COULD take this link are marked — the Shows cards, and only them',
    await until(() => cardBy('Gamma').classes('link-over')) && cardBy('Alpha').classes('link-ok') && !cardBy('reel_2').classes('link-ok') && !cardBy('reel_1').classes('link-ok'));
  check('over one, the line goes solid', w.find('.arrow-layer .rubber').classes('valid'));
  winEv('pointerup', toClient(pGamma.x + 30, pGamma.y + 20));
  const linkMade = await untilDb(`select 1 from links where field_id = '${linkField}' and from_record = '${r1}' and to_record = '${gammaId}'`, (r) => r.length === 1);
  check('dropping on a card of the RIGHT table makes the link — through the field you dragged from', linkMade.length === 1
    && await until(() => arrowFor(r1, gammaId).exists() && !w.find('.rubber').exists()));
  check('the card\'s own row shows it', await until(() => rowsOf(cardBy('reel_1')).Show === 'Gamma'), JSON.stringify(rowsOf(cardBy('reel_1'))));

  const afterAdd = await linkCount();
  await handle().trigger('pointerdown', { button: 0, ...toClient(1100, 80) });
  winEv('pointermove', toClient(pReel2.x + 30, pReel2.y + 10));
  check('over a card of the WRONG table the line stays dashed and nothing lights up', await until(() => w.find('.rubber').exists()) && !w.find('.rubber').classes('valid') && !cardBy('reel_2').classes('link-over'));
  winEv('pointerup', toClient(pReel2.x + 30, pReel2.y + 10));
  await sleep(300);
  check('dropping there does NOTHING: no link, no error, the line is gone', await linkCount() === afterAdd && !w.find('.rubber').exists() && !w.find('.errors').exists());

  await handle().trigger('pointerdown', { button: 0, ...toClient(1100, 80) });
  winEv('pointermove', toClient(pGamma.x + 30, pGamma.y + 20));
  await sleep(50);
  check('a record ALREADY linked is not offered again', !cardBy('Gamma').classes('link-over') && !cardBy('Gamma').classes('link-ok') && cardBy('Alpha').classes('link-ok'));
  win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('Escape abandons the drag', await until(() => !w.find('.rubber').exists()) && await linkCount() === afterAdd);
  winEv('pointerup', toClient(pGamma.x + 30, pGamma.y + 20));

  // Drop on EMPTY canvas: a picker at that spot — choose an existing record, or make one.
  const emptySpot = toClient(2200, 900);
  await handle().trigger('pointerdown', { button: 0, ...toClient(1100, 80) });
  winEv('pointermove', emptySpot);
  winEv('pointerup', emptySpot);
  const lp = () => w.find('.link-pick');
  check('dropping a link on EMPTY canvas opens a picker there (the same search as a link cell), naming the link', await until(() => lp().exists()) && /reel_1/.test(lp().text()) && /Shows/.test(lp().text()), lp().text());
  await lp().find('.picker input').setValue('Beta');
  await until(() => lp().findAll('.picker .list li').some((li) => li.find('.name').text() === 'Beta'));
  const betaId = (await pool.query(`select id from records where data->>'name' = 'Beta'`)).rows[0].id;
  await lp().findAll('.picker .list li').find((li) => li.find('.name').text() === 'Beta')!.trigger('mousedown');
  check('choosing a record LINKS it and PLACES its card at the drop point', (await untilDb(`select 1 from links where field_id = '${linkField}' and from_record = '${r1}' and to_record = '${betaId}'`, (r) => r.length === 1)).length === 1
    && (await untilDb(`select x, y from placements where canvas_id = '${boardId}' and record_id = '${betaId}'`, (r) => r.length === 1))[0].x > 2000 && !lp().exists());
  await handle().trigger('pointerdown', { button: 0, ...toClient(1100, 80) });
  winEv('pointermove', toClient(2200, 1300));
  winEv('pointerup', toClient(2200, 1300));
  await until(() => lp().exists());
  await lp().find('.picker input').setValue('Zeta (new)');
  check('a name that matches nothing offers "+ new"', await until(() => lp().find('.picker .create').exists()) && /Zeta \(new\)/.test(lp().find('.picker .create').text()));
  await lp().find('.picker .create').trigger('mousedown');
  const zeta = await untilDb(`select r.id, r.data->>'name' n from records r where r.table_id = '${shows}' and r.data->>'name' = 'Zeta (new)'`, (r) => r.length === 1);
  check('"+ new" CREATES the record, named as typed, LINKS it and PLACES it', zeta.length === 1
    && (await untilDb(`select 1 from links where field_id = '${linkField}' and from_record = '${r1}' and to_record = '${zeta[0].id}'`, (r) => r.length === 1)).length === 1
    && (await untilDb(`select 1 from placements where canvas_id = '${boardId}' and record_id = '${zeta[0].id}'`, (r) => r.length === 1)).length === 1
    && await until(() => !!cardBy('Zeta (new)')), JSON.stringify(zeta));
  hotkey('z');
  check('…and that is ONE Ctrl+Z: record, link and card all go', (await untilDb(`select 1 from records where id = '${zeta[0].id}'`, (r) => r.length === 0)).length === 0
    && (await pool.query(`select count(*)::int n from placements where record_id = $1`, [zeta[0].id])).rows[0].n === 0);
  hotkey('z');   // the Beta link + placement
  await untilDb(`select 1 from placements where canvas_id = '${boardId}' and record_id = '${betaId}'`, (r) => r.length === 0);

  hotkey('z');
  check('a link made by dragging is one Ctrl+Z', (await untilDb(`select count(*)::int n from links where field_id = '${linkField}'`, (r) => Number(r[0].n) === afterAdd - 1))[0].n == afterAdd - 1);

  console.log('\nU19. Grouping — and a record added in a group inherits it');
  await nav.openTable(filesId);
  await until(() => w.find('.gridview .group-menu').exists() && rowsNow().length >= 3);
  const gm = () => w.find('.gridview .group-menu');
  const headers = () => w.findAll('.gridview tr.group-row').map((h) => ({ label: h.find('.group-label').text(), n: Number(h.find('.group-count').text()), level: h.classes('level-1') ? 1 : 0 }));
  const recordCount = rowsNow().length;
  (gm().element as HTMLDetailsElement).open = true;
  await gm().find('.add-group').trigger('click');
  check('asking to group does NOT group by anything until a field is chosen', gm().find('.pending-group').exists() && headers().length === 0);
  await gm().find('.pending-group').setValue(statusField);
  const expected = (await pool.query(`select coalesce(data->>'status', '') s, count(*)::int n from records where table_id = $1 group by 1`, [filesId])).rows as Array<{ s: string; n: number }>;
  check('grouping by a select puts a header over each value, with its count',
    await until(() => headers().length === expected.length) && expected.every((e) => headers().some((h) => h.label === (e.s || '(empty)') && h.n === e.n)),
    `${JSON.stringify(headers())} vs ${JSON.stringify(expected)}`);
  check('the empty group is last', !expected.some((e) => !e.s) || headers()[headers().length - 1].label === '(empty)');
  check('every record is still there exactly once; the count in the toolbar has not changed', rowsNow().length === recordCount && new RegExp(`^\\s*${recordCount} records`).test(w.find('.gridview .count').text()), w.find('.gridview .count').text());
  // Banding restarts under each header: the first row of a group is the plain one, then they alternate.
  const bands = () => { const out: string[] = []; let n = 0; for (const tr of w.findAll('.gridview tbody tr')) { if (tr.classes('group-row')) n = 0; else if (tr.classes('row')) out.push(`${tr.classes('alt')}=${n++ % 2 === 1}`); } return out; };
  check('banding counts from each group header, so no group opens on a banded row', bands().length === recordCount && bands().every((b) => b === 'true=true' || b === 'false=false'), bands().join());
  check('row numbers count RECORDS, not header rows', w.findAll('.gridview tr.row .n').map((n) => n.text()).join() === Array.from({ length: recordCount }, (_, i) => String(i + 1)).join());
  check('the grouping is part of the VIEW (saved, shared)', (await untilDb(`select config from views where table_id = '${filesId}' and jsonb_array_length(coalesce(config->'groupBy', '[]')) = 1`, (r) => r.length === 1))[0]?.config.groupBy[0] === statusField);
  check('the toolbar says what it is grouped by', /group · Status/.test(gm().find('summary').text()), gm().find('summary').text());

  // Add a record INSIDE a group.
  const target = expected.find((e) => e.s)!;
  const headerOf = (label: string) => w.findAll('.gridview tr.group-row').find((h) => h.find('.group-label').text() === label)!;
  const filesBefore = (await pool.query(`select count(*)::int n from records where table_id = $1`, [filesId])).rows[0].n;
  await headerOf(target.s).find('.group-add').trigger('click');
  const born = await untilDb(`select id, data from records where table_id = '${filesId}' and not (data ? 'name') and data->>'status' = '${target.s}'`, (r) => r.length === 1);
  check('"+" on a group header makes a record that ALREADY HAS that group\'s value', born.length === 1 && born[0].data.status === target.s, JSON.stringify(born));
  check('…so it appears in that group, and the header counts it', await until(() => headers().find((h) => h.label === target.s)?.n === target.n + 1), JSON.stringify(headers()));
  if (editor().exists()) await editor().trigger('keydown', { key: 'Escape' });
  hotkey('z');
  check('and it is one Ctrl+Z', (await untilDb(`select count(*)::int n from records where table_id = '${filesId}'`, (r) => r[0].n === filesBefore))[0].n === filesBefore);

  // Collapse.
  const firstHeader = () => w.findAll('.gridview tr.group-row')[0];
  const firstCount = headers()[0].n;
  await firstHeader().find('.group-fold').trigger('click');
  check('collapsing a group hides its rows and keeps its header and count', await until(() => rowsNow().length === recordCount - firstCount) && headers()[0].n === firstCount);
  check('…and does not change what the toolbar says matches', new RegExp(`^\\s*${recordCount} records`).test(w.find('.gridview .count').text()));
  await firstHeader().find('.group-fold').trigger('click');
  await until(() => rowsNow().length === recordCount);

  // Arrow keys step over headers.
  const lastOfFirstGroup = firstCount - 1;
  await cell(lastOfFirstGroup, 0).trigger('mousedown');
  await key('ArrowDown');
  check('the arrow keys move between RECORDS: down from the last row of a group lands on the first row of the next',
    cell(lastOfFirstGroup + 1, 0).classes('sel'));

  // Group by a LINK, and add inside it.
  await gm().find('.pop select').setValue(linkField);
  await until(() => headers().some((h) => h.label === 'Alpha'));
  const alphaBefore = headers().find((h) => h.label === 'Alpha')!.n;
  await headerOf('Alpha').find('.group-add').trigger('click');
  const linked = await untilDb(`select r.id from records r join links l on l.from_record = r.id and l.field_id = '${linkField}' and l.to_record = '${showIds[0]}' where r.table_id = '${filesId}' and not (r.data ? 'name')`, (r) => r.length === 1);
  check('grouped by a LINK field, a record added under "Alpha" is LINKED to Alpha', linked.length === 1
    && await until(() => headers().find((h) => h.label === 'Alpha')?.n === alphaBefore + 1), JSON.stringify(headers()));
  if (editor().exists()) await editor().trigger('keydown', { key: 'Escape' });
  hotkey('z');
  await untilDb(`select count(*)::int n from records where table_id = '${filesId}'`, (r) => r[0].n === filesBefore);

  // Two levels.
  await gm().find('.add-group').trigger('click');
  await gm().find('.pending-group').setValue(statusField);
  // Adding a level groups by the first free field for an instant, before the select
  // is set — wait for the REAL second level (every inner label is a status).
  const statuses = new Set([...expected.map((e) => e.s || '(empty)')]);
  check('a second level nests inside the first', await until(() => headers().some((h) => h.level === 1) && headers().filter((h) => h.level === 1).every((h) => statuses.has(h.label)))
    && headers()[0].level === 0, JSON.stringify(headers()));
  check('two levels is the limit — a third is a report, not a grid', !gm().find('.add-group').exists() && !gm().find('.pending-group').exists());
  const idsBefore = new Set((await pool.query(`select id from records where table_id = $1`, [filesId])).rows.map((r) => r.id as string));
  const innerNow = () => w.findAll('.gridview tr.group-row.level-1')[0];       // looked up at the moment of use, never held
  const outerLabel = headers()[0].label, innerLabel = innerNow().find('.group-label').text();
  await innerNow().find('.group-add').trigger('click');
  const both = (await untilDb(`select r.id, r.data, (select count(*)::int from links l where l.from_record = r.id and l.field_id = '${linkField}') nl from records r where r.table_id = '${filesId}'`,
    (r) => r.some((x: any) => !idsBefore.has(x.id)))).filter((x: any) => !idsBefore.has(x.id));
  check('a record added under an INNER header inherits both levels', both.length === 1
    && (innerLabel === '(empty)' ? !('status' in both[0].data) : both[0].data.status === innerLabel) && (outerLabel === '(empty)' ? both[0].nl === 0 : both[0].nl >= 1),
    `${outerLabel} › ${innerLabel}: ${JSON.stringify(both)}`);
  if (editor().exists()) await editor().trigger('keydown', { key: 'Escape' });
  hotkey('z');
  await untilDb(`select count(*)::int n from records where table_id = '${filesId}'`, (r) => r[0].n === filesBefore);

  await gm().findAll('.pop .x')[1].trigger('click');
  await gm().findAll('.pop .x')[0].trigger('click');
  check('removing the grouping returns the plain grid', await until(() => headers().length === 0 && rowsNow().length === recordCount));
  (gm().element as HTMLDetailsElement).open = false;

  console.log('\nU8b2. Views: one control that names the view and lists them all');
  // Start from a clean slate: earlier sections left saved views on this table. First let
  // the app's own debounced queue drain — deleting a view under a pending update of it
  // (from another client) is a race this test is not about.
  await sleep(700);
  for (const v of (await pool.query(`select id from views where table_id = $1`, [filesId])).rows) await post([{ type: 'view.delete', id: v.id }]);
  await nav.openTable(filesId);
  await until(() => w.find('.gridview .view-menu').exists());
  const vm = () => w.find('.gridview .view-menu');
  const listedViews = () => vm().findAll('.view-row').map((r) => ({ name: r.find('.view-title').text(), on: r.classes('on'), sum: r.find('.view-sum').text() }));
  const named = (name: string) => vm().findAll('.view-row').find((r) => r.find('.view-title').text() === name)!;
  // …and wait until the CLIENT has seen the deletions, or the next sort would update a row that is gone.
  (vm().element as HTMLDetailsElement).open = true;
  await until(() => vm().find('.view-name').text() === 'Grid' && vm().findAll('.view-row').length === 1 && /everything, unsorted/.test(named('Grid').find('.view-sum').text()));
  (vm().element as HTMLDetailsElement).open = false;
  check('with no saved views, the toolbar names the built-in GRID', vm().find('.view-name').text() === 'Grid', vm().find('summary').text());
  (vm().element as HTMLDetailsElement).open = true;
  await sleep(20);
  check('opened, it lists the permanent Grid, ticked, with no rename/delete controls (it is the table itself)',
    listedViews().length === 1 && listedViews()[0].name === 'Grid' && listedViews()[0].on && !named('Grid').find('.view-act').exists(), JSON.stringify(listedViews()));
  // A sort made on the built-in Grid STARTS a view; the Grid stays plain.
  (vm().element as HTMLDetailsElement).open = false;
  await w.findAll('.gridview thead th').find((t) => t.find('.th-name').exists() && t.find('.th-name').text() === 'Name')!.find('.th-sort').trigger('click');   // the header's ⇅: sort
  const started = await untilDb(`select name, config from views where table_id = '${filesId}'`, (r) => r.length === 1);
  check('sorting on the Grid SAVES to the Grid (its row appears, with the TABLE\'s id, so every client knows it), and you stay in it',
    started[0].name === 'Grid' && started[0].config.sort.length === 1 && (await pool.query(`select id from views where table_id = $1`, [filesId])).rows[0].id === filesId
    && await until(() => vm().find('.view-name').text() === 'Grid'), JSON.stringify(started));
  (vm().element as HTMLDetailsElement).open = true;
  await sleep(20);
  nav.dialogs.text = 'QC failures';
  await vm().find('.new-view').trigger('click');
  check('"+ new view" makes one (through the app\'s dialog), switches to it, and the toolbar says so',
    await until(() => vm().find('.view-name').text() === 'QC failures') && (await untilDb(`select name from views where table_id = '${filesId}' order by position`, (r) => r.length === 2)).length === 2);
  check('…and closes the list', !(vm().element as HTMLDetailsElement).open);
  check('a new view STARTS FROM the one you were in', JSON.stringify((await pool.query(`select config from views where name = 'QC failures'`)).rows[0].config.sort)
    === JSON.stringify((await pool.query(`select config from views where id = $1`, [filesId])).rows[0].config.sort));   // THIS table's Grid: other tables have one too
  (vm().element as HTMLDetailsElement).open = true;
  await sleep(20);
  check('all are listed, the Grid first, without rename/delete controls', listedViews().map((r) => r.name).join() === 'Grid,QC failures' && named('QC failures').classes('on') && !named('Grid').find('.view-act').exists(), JSON.stringify(listedViews()));
  nav.dialogs.text = 'QC failures (copy)';
  await named('QC failures').findAll('.view-act')[1].trigger('click');
  check('duplicate', await until(() => vm().find('.view-name').text() === 'QC failures (copy)') && (await untilDb(`select 1 from views where table_id = '${filesId}'`, (r) => r.length === 3)).length === 3);   // Grid, QC failures, the copy
  (vm().element as HTMLDetailsElement).open = true;
  await sleep(20);
  nav.dialogs.text = 'Offline only';
  await named('QC failures (copy)').findAll('.view-act')[0].trigger('click');
  check('rename', await until(() => vm().find('.view-name').text() === 'Offline only'));
  await named('Offline only').find('.view-act.danger').trigger('click');
  check('delete asks first, then falls back to another view', (await untilDb(`select 1 from views where table_id = '${filesId}'`, (r) => r.length === 2)).length === 2
    && await until(() => ['Grid', 'QC failures'].includes(vm().find('.view-name').text())) && nav.dialogs.seen.some((t) => t.startsWith('Delete the view')));
  await named('Grid').trigger('click');
  check('clicking a row switches to it and closes the list', await until(() => vm().find('.view-name').text() === 'Grid') && !(vm().element as HTMLDetailsElement).open);
  await post([{ type: 'view.delete', id: (await pool.query(`select id from views where name = 'QC failures'`)).rows[0].id }]);
  await until(() => listedViews().length <= 2);

  console.log('\nU8c. Table settings — where the Schema tab\'s table controls went');
  await nav.openTable(filesId);
  await nav.tableSettings(filesId);
  const ts = () => w.find('.ts');
  check('⚙ on a table\'s row in the tree opens its settings', await until(() => ts().exists()) && (ts().find('.name-in').element as HTMLInputElement).value === 'Files');
  await ts().find('.name-in').setValue('Media files');
  await ts().find('.name-in').trigger('change');
  check('renaming a table there renames it in the tree and the breadcrumb',
    await until(() => nav.tableNames().includes('Media files') && /Media files/.test(w.find('.crumbs').text())), nav.tableNames().join());
  await ts().find('input[type="color"]').setValue('#3366ff');
  await ts().find('input[type="color"]').trigger('change');
  const tcol = await untilDb(`select name, color from tables where id = '${filesId}'`, (r) => r[0].color === '#3366ff');
  check('colour (in the database since the first migration, never editable) is set here', tcol[0].color === '#3366ff' && tcol[0].name === 'Media files', JSON.stringify(tcol[0]));
  check('it says what kind of table it is, and lists the fields as an editor', /ordinary table/.test(ts().text()) && ts().find('.schema .fadd').exists());
  await ts().find('.name-in').setValue('Files');
  await ts().find('.name-in').trigger('change');
  await ts().find('.x').trigger('click');
  check('an old #/…/schema address lands on the Table tab instead of nowhere', (win.location.hash = '#/all/schema', win.dispatchEvent(new (win as any).HashChangeEvent('hashchange')), await until(() => w.find('.gridview').exists())));

  console.log('\nU8d. A new table from the grid');
  await tab('table').trigger('click');
  await nav.newTable('Deliverables');
  check('"+" beside Tables creates a table and opens it',
    await until(() => /press \+ in the header/.test(w.find('.gridview').text())), w.find('.gridview').text().slice(0, 120));
  const made = await untilDb(`select position from tables where name = 'Deliverables'`, (r) => r.length === 1);
  check('positioned after the others', made[0]?.position > 0, JSON.stringify(made));

  nav.stop();
  w.unmount();
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
