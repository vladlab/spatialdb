/**
 * Sections, the home page, and addresses.
 *
 *   S1  client/router.ts       — pure
 *   S2  section.* mutations    — over HTTP, against Postgres
 *   S3  the app                — Home → a section → its pickers; filing; URLs; the palette
 */

import { randomUUID } from 'node:crypto';
import { formatRoute, parseRoute, HOME } from '../src/client/router.js';
import { mountApp, sleep } from './uiHarness.js';
import { boardsTableMutations } from './harness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

function pure() {
  console.log('\nS1. Addresses (client/router.ts)');
  const sec = randomUUID(), tbl = randomUUID(), rec = randomUUID();
  const r = { section: sec, view: 'table' as const, target: tbl, record: rec, scope: '' };
  const url = formatRoute(r, 'Field Drives!');
  check('a route formats with a readable slug and the id', url === `#/s/field-drives-${sec}/table/${tbl}?r=${rec}`, url);
  check('and parses back to itself', JSON.stringify(parseRoute(url)) === JSON.stringify(r));
  check('the slug is DECORATION — a link survives the section being renamed',
    parseRoute(`#/s/some-old-name-${sec}/table/${tbl}`).section === sec && parseRoute(`#/s/${sec}/canvas`).section === sec);
  check('Everything and Home have their own addresses',
    parseRoute('#/all/canvas').section === 'all' && parseRoute('#/').section === null && parseRoute('').section === null && formatRoute(HOME) === '#/');
  check('a mangled link goes HOME, not somewhere wrong',
    parseRoute('#/s/not-an-id/table').section === null && parseRoute('#/nonsense/x').section === null);
  check('an unknown view falls back to the table; a junk record id is dropped',
    parseRoute(`#/all/spreadsheet/${tbl}`).view === 'table' && parseRoute(`#/all/table/${tbl}?r=banana`).record === '');
}

async function main() {
  pure();
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8807));
  const { w, win, pool, until, untilDb, post, nav } = ui;
  try {
    console.log('\nS2. Sections on the server');
    const tFiles = randomUUID(), tProj = randomUUID(), tComp = randomUUID(), tDrive = randomUUID();
    const fName = randomUUID(), fArch = randomUUID(), fOther = randomUUID(), fCompName = randomUUID(), fProjName = randomUUID(), fDriveName = randomUUID();
    const setup = await post([
      ...[[tFiles, 'Files'], [tProj, 'Projects'], [tComp, 'Computers'], [tDrive, 'Drives']].map(([id, name]) => ({ type: 'table.create', id, name })),
      { type: 'field.create', id: fName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' },
      { type: 'field.create', id: fProjName, tableId: tProj, name: 'Name', key: 'name', fieldType: 'text' },
      { type: 'field.create', id: fArch, tableId: tProj, name: 'Archived', key: 'archived', fieldType: 'checkbox' },
      { type: 'field.create', id: fOther, tableId: tFiles, name: 'Approved', key: 'approved', fieldType: 'checkbox' },
      { type: 'field.create', id: fCompName, tableId: tComp, name: 'Name', key: 'name', fieldType: 'text' },
      { type: 'field.create', id: fDriveName, tableId: tDrive, name: 'Name', key: 'name', fieldType: 'text' },
      { type: 'record.create', id: randomUUID(), tableId: tFiles, data: { name: 'zebra master' } },
      { type: 'record.create', id: randomUUID(), tableId: tComp, data: { name: 'zebra workstation' } },
    ]);
    check('fixture: four tables, in no section', setup.status === 200, `${setup.status}`);

    const sProj = randomUUID();
    const made = await post([
      { type: 'section.create', id: sProj, name: 'Projects', icon: '🎬' },
      { type: 'section.update', id: sProj, tableIds: [tProj, tFiles], scopeTableId: tProj, archivedFieldId: fArch },
    ]);
    check('a section with its tables, a scope table and an archived marker — in one batch', made.status === 200, await made.text());
    const row = (await pool.query(`select * from sections where id = $1`, [sProj])).rows[0];
    check('stored as given, tables in the given ORDER', JSON.stringify(row.table_ids) === JSON.stringify([tProj, tFiles]) && row.scope_table_id === tProj && row.archived_field_id === fArch);

    const bad1 = await post([{ type: 'section.update', id: sProj, scopeTableId: tComp }]);
    check('the scope table must be one of the section\'s OWN tables', bad1.status === 400 && /one of the section/.test(await bad1.text()));
    const bad2 = await post([{ type: 'section.update', id: sProj, archivedFieldId: fOther }]);
    check('the archived marker must be a checkbox ON the scope table', bad2.status === 400);
    const bad3 = await post([{ type: 'section.update', id: sProj, archivedFieldId: fName }]);
    check('…and a checkbox at all', bad3.status === 400);
    await post([{ type: 'section.update', id: sProj, scopeTableId: null }]);
    const cleared = (await pool.query(`select scope_table_id, archived_field_id from sections where id = $1`, [sProj])).rows[0];
    check('clearing the scope table clears its marker too', cleared.scope_table_id === null && cleared.archived_field_id === null, JSON.stringify(cleared));
    await post([{ type: 'section.update', id: sProj, scopeTableId: tProj, archivedFieldId: fArch }]);

    const listed = await (await fetch(`${ui.API}/api/sections`)).json() as any[];
    check('GET /api/sections returns them', listed.length === 1 && listed[0].name === 'Projects' && listed[0].icon === '🎬');

    const delId = randomUUID();
    await fetch(`${ui.API}/api/mutate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: randomUUID(), mutations: [{ id: delId, mutation: { type: 'section.delete', id: sProj } }] }) });
    check('deleting a section deletes NOTHING else', (await pool.query(`select count(*)::int n from tables`)).rows[0].n === 4
      && (await pool.query(`select count(*)::int n from records`)).rows[0].n === 2 && (await pool.query(`select 1 from sections`)).rowCount === 0);
    const cap = await (await fetch(`${ui.API}/api/mutations/${delId}/undo`)).json() as any;
    const restored = await post([{ type: 'restore', id: randomUUID(), undoOf: delId, rows: cap.rows ?? cap }]);
    const back = (await pool.query(`select * from sections where id = $1`, [sProj])).rows[0];
    check('and it is undoable — back whole, scope and all', restored.status === 200 && back?.scope_table_id === tProj && back.table_ids.length === 2, JSON.stringify(back ?? null));

    await post([{ type: 'table.delete', id: tDrive }]);
    await post([{ type: 'section.update', id: sProj, tableIds: [tProj, tFiles, tDrive] }]);
    check('a table id that no longer resolves is tolerated on write (and skipped on read — see S3)',
      (await pool.query(`select table_ids from sections where id = $1`, [sProj])).rows[0].table_ids.length === 3);

    console.log('\nS3. Home, sections and addresses in the app');
    // The app mounted before any of the above existed; it has been hearing it on the stream.
    const texts = (sel: string) => w.findAll(sel).map((x: any) => x.text());
    const cardNamed = (name: string) => w.findAll('.home .card').find((c: any) => c.find('h2').exists() && c.find('h2').text() === name);
    check('HOME lists the section, live, with its tables — and Everything',
      await until(() => !!cardNamed('Projects')) && /2 tables/.test(cardNamed('Projects').text()) && !!cardNamed('Everything'), texts('.home .card h2').join());
    check('the dangling table id is simply not counted', !/3 tables/.test(cardNamed('Projects').text()));
    check('Everything says how many tables are in NO section', /in no section/.test(cardNamed('Everything').text()), cardNamed('Everything').text());
    check('a scoped section says what it is scoped by', /scoped by Projects/.test(cardNamed('Projects').text()));

    await cardNamed('Projects').trigger('click');
    // The tree's TABLES list is what the table picker used to be.
    const pickerOptions = () => nav.tableNames();
    check('opening a section shows ITS tables in the picker, in its order — not all four',
      await until(() => pickerOptions().join() === 'Projects,Files'), pickerOptions().join());
    check('the breadcrumb and the tree both say where you are', /Projects/.test(w.find('.section-crumb').text()) && nav.currentSection() === sProj, w.find('.crumbs').text());
    check('and so does the address bar', win.location.hash.startsWith(`#/s/projects-${sProj}/table/`), win.location.hash);

    await nav.newTable('Deliverables');
    const filed = await untilDb(`select table_ids from sections where id = '${sProj}'`, (r) => r[0].table_ids.length === 4);
    const newTable = (await pool.query(`select id from tables where name = 'Deliverables'`)).rows[0]?.id;
    check('a table made INSIDE a section is filed under it', !!newTable && filed[0].table_ids.includes(newTable) && pickerOptions().includes('Deliverables'), `${pickerOptions().join()} | db: ${JSON.stringify(filed[0])} new=${newTable}`);

    await nav.tab('canvas');
    await nav.newCanvas('Duke overview');
    // No per-canvas filing any more: "+" made a boards table IN this section, and
    // the canvas is a record in it. Filing a canvas is which table it lives in.
    const cv = await untilDb(`select r.id, r.table_id from records r join tables t on t.id = r.table_id and t.kind = 'canvas' where r.data->>'name' = 'Duke overview'`, (r) => r.length === 1);
    const secNow = (await untilDb(`select table_ids from sections where id = '${sProj}'`, (r) => r[0].table_ids.includes(cv[0]?.table_id)))[0];
    check('a canvas made in a section lives in a boards table FILED UNDER that section', !!cv[0] && secNow.table_ids.includes(cv[0].table_id), JSON.stringify(secNow));
    // A board in a boards table that is in NO section: only Everything lists it.
    const otherBoards = randomUUID();
    await post([...boardsTableMutations(otherBoards), { type: 'record.create', id: randomUUID(), tableId: otherBoards, data: { name: 'Unfiled board' } }]);
    const canvasOptions = () => nav.canvasNames();
    await sleep(400);
    check('a section\'s canvas list holds only boards from ITS tables', canvasOptions().some((t: string) => t.startsWith('Duke overview')) && !canvasOptions().some((t: string) => t.startsWith('Unfiled')), canvasOptions().join());

    await nav.section('all');
    check('switching to Everything widens both pickers', await until(() => canvasOptions().some((t: string) => t.startsWith('Unfiled board'))), canvasOptions().join());
    await nav.tab('table');
    check('— every table, filed or not', await until(() => pickerOptions().includes('Computers') && pickerOptions().includes('Files')), pickerOptions().join());

    // The back button, as the browser does it: the hash changes underneath the app.
    win.location.hash = '#/';
    win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    check('navigating to #/ goes Home', await until(() => w.find('.home').exists()));
    const zebraFile = (await pool.query(`select id from records where data->>'name' = 'zebra master'`)).rows[0].id;
    win.location.hash = `#/s/renamed-since-${sProj}/table/${tFiles}?r=${zebraFile}`;
    win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    check('a link to a RECORD opens its section, its table, and its panel — old slug and all',
      await until(() => w.find('.record-panel').exists() && w.find('.record-panel .rp-title').text() === 'zebra master', 8000)
      && nav.currentTable() === tFiles, win.location.hash);
    await w.find('.record-panel .rp-close').trigger('click');
    check('closing the panel drops the record from the address', await until(() => !win.location.hash.includes('?r=')), win.location.hash);

    console.log('\nS3b. The palette leans towards your section, and hides nothing');
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    await until(() => w.find('.palette').exists());
    await w.find('.palette input.pq').setValue('zebra');
    const labels = () => w.findAll('.palette .presults li .plabel').map((x: any) => x.text());
    check('both matches are there — the one in THIS section first',
      await until(() => labels().length === 2) && labels()[0] === 'zebra master' && labels()[1] === 'zebra workstation', labels().join());
    check('the one from elsewhere is marked', w.findAll('.palette .ptable.far').length === 1);
    await w.find('.palette input.pq').trigger('keydown', { key: 'ArrowDown' });
    await w.find('.palette input.pq').trigger('keydown', { key: 'Enter' });
    check('choosing it takes you to where it lives (Everything), not to a picker that cannot show it',
      await until(() => w.find('.record-panel').exists() && w.find('.record-panel .rp-title').text() === 'zebra workstation', 8000)
      && nav.currentSection() === 'all', win.location.hash);
    await w.find('.record-panel .rp-close').trigger('click');

    console.log('\nS3c. Section settings');
    win.location.hash = '#/'; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.find('.home').exists());
    ui.setPrompt('Machines');
    await w.find('.card.new').trigger('click');
    check('"+ new section" creates it and opens its settings', await until(() => w.find('.ss').exists()) && (w.find('.ss .name-in').element as HTMLInputElement).value === 'Machines');
    const tick = (name: string) => w.findAll('.ss .checks label').find((l: any) => l.text().trim().startsWith(name)).find('input');
    await tick('Computers').setValue(true);
    const machines = await untilDb(`select table_ids from sections where name = 'Machines'`, (r) => r[0]?.table_ids.length === 1);
    check('ticking a table files it', machines[0].table_ids[0] === tComp);
    await tick('Files').setValue(true);
    await untilDb(`select table_ids from sections where name = 'Machines'`, (r) => r[0]?.table_ids.length === 2);
    check('a table can be in TWO sections', (await pool.query(`select count(*)::int n from sections where table_ids ? $1`, [tFiles])).rows[0].n === 2);
    await w.find('.ss .scope-table').setValue(tComp);
    await untilDb(`select scope_table_id from sections where name = 'Machines'`, (r) => r[0].scope_table_id === tComp);
    await tick('Computers').setValue(false);
    const unscoped = await untilDb(`select scope_table_id, table_ids from sections where name = 'Machines'`, (r) => r[0].scope_table_id === null);
    check('unticking the SCOPE table un-scopes the section in the same step (the server would refuse otherwise)',
      unscoped[0].scope_table_id === null && !unscoped[0].table_ids.includes(tComp) && !w.find('.errors').exists(), JSON.stringify(unscoped[0]));

    console.log('\nS4. A canvas is a record');
    await w.find('.ss .x').trigger('click');
    await nav.section('all');
    await nav.tab('table');
    await nav.newTable('Flow boards', true);      // the "a table of boards" tick box in the dialog
    const flow = await untilDb(`select t.id, t.kind, (select count(*)::int from fields f where f.table_id = t.id) nf from tables t where t.name = 'Flow boards'`, (r) => r.length === 1 && r[0].nf === 1);
    check('the new-table dialog can make "a table of boards" — kind canvas, with a Name to call each board by', flow[0]?.kind === 'canvas' && flow[0].nf === 1, JSON.stringify(flow[0]));
    const flowId = flow[0].id as string;
    const b1 = randomUUID(), b2 = randomUUID();
    await post([
      { type: 'record.create', id: b1, tableId: flowId, data: { name: 'Duke — conform' } },
      { type: 'record.create', id: b2, tableId: flowId, data: { name: 'Duke — delivery' } },
    ]);

    await nav.openTable(flowId);
    const gridNames = () => w.findAll('.gridview tr.row').map((r: any) => r.findAll('td')[1].text());
    check('boards are ROWS: they sort, filter and take fields like any record', await until(() => gridNames().join() === 'Duke — conform,Duke — delivery'), gridNames().join());
    check('each row offers to open its board', w.findAll('.gridview .open-board').length === 2);
    await w.findAll('.gridview .open-board')[0].trigger('click');
    check('…which goes to that canvas', await until(() => w.find('.canvas-container').exists() && nav.currentCanvas() === b1), win.location.hash);
    check('a board nobody has placed anything on is an EMPTY canvas, not an error (its state is made lazily)',
      !w.find('.errors').exists() && (await pool.query(`select 1 from canvases where id = $1`, [b1])).rowCount === 0, w.find('.errors').exists() ? w.find('.errors').text() : '');
    check('the tree lists boards from every boards table under Everything', nav.canvasNames().includes('Duke — delivery') && nav.canvasNames().some((n: string) => n.startsWith('Duke overview')), nav.canvasNames().join());

    // ONE name. Rename the record; the canvas picker follows.
    await post([{ type: 'record.update', id: b1, set: { name: 'Duke — CONFORM v2' }, unset: [] }]);
    check('a board\'s name IS its record\'s primary field — rename the record and the picker follows',
      await until(() => nav.canvasNames().includes('Duke — CONFORM v2')), nav.canvasNames().join());

    // A board ON a board: navigation between canvases, for free.
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    await until(() => w.find('.palette').exists());
    await w.find('.palette input.pq').setValue('delivery');
    check('boards are found by the palette like any record', await until(() => w.findAll('.palette .presults li .plabel').some((x: any) => x.text() === 'Duke — delivery')));
    await w.find('.palette input.pq').trigger('keydown', { key: 'Enter' });
    const cardNamed2 = (n: string) => w.findAll('.canvas-world .card').find((c: any) => c.find('.card-label').text() === n);
    check('…and placed on another board as a card', await until(() => !!cardNamed2('Duke — delivery')));
    const placedBoard = await untilDb(`select 1 from placements where canvas_id = '${b1}' and record_id = '${b2}'`, (r) => r.length === 1);
    check('(now b1 HAS state: the placement created it)', placedBoard.length === 1 && (await pool.query(`select 1 from canvases where id = $1`, [b1])).rowCount === 1);
    await cardNamed2('Duke — delivery').trigger('contextmenu', { clientX: 50, clientY: 50 });
    check('its menu offers "Open this board"', /Open this board/.test(w.find('.canvas-container .ctx').text()));
    await w.find('.canvas-container .ctx .open-board').trigger('click');
    check('— which walks to that canvas', await until(() => nav.currentCanvas() === b2) && win.location.hash.includes(b2), win.location.hash);

    // Deleting a board from the grid, and getting it back WITH what was on it.
    win.location.hash = `#/all/table/${flowId}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => gridNames().length === 2);
    const rowOfB1 = w.findAll('.gridview tr.row').find((r: any) => r.text().includes('CONFORM v2'));
    await rowOfB1.find('td.act .x').trigger('click');
    await untilDb(`select 1 from records where id = '${b1}'`, (r) => r.length === 0);
    check('deleting the row deletes the board — and the card that was on it',
      (await pool.query(`select 1 from placements where canvas_id = $1`, [b1])).rowCount === 0 && (await pool.query(`select 1 from canvases where id = $1`, [b1])).rowCount === 0);
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    const undone = await untilDb(`select 1 from placements where canvas_id = '${b1}' and record_id = '${b2}'`, (r) => r.length === 1, 8000);
    check('Ctrl+Z brings the board back with its contents', undone.length === 1 && await until(() => gridNames().some((n: string) => n.includes('CONFORM v2'))));

    console.log('\nS5. The shell');
    check('the status readout is ONE element that says what is happening in words',
      await until(() => w.find('.topbar .status').exists() && /^(saved|saving \d+…)$/.test(w.find('.topbar .status-text').text())), w.find('.topbar .status').text());
    check('the old come-and-go badges are gone (they made the header jump on every write)', !w.find('.topbar .meta').exists());

    await nav.openTable(flowId);
    await until(() => w.find('.gridview').exists());
    const sortMenu = () => w.find('.gridview details.menu');
    (sortMenu().element as HTMLDetailsElement).open = true;
    win.document.body.dispatchEvent(new (win as any).MouseEvent('mousedown', { bubbles: true }));
    check('a press outside an open sort/filter/fields menu closes it', await until(() => !(sortMenu().element as HTMLDetailsElement).open));

    await w.findAll('.gridview tr.row')[0].find('.expand').trigger('click');
    await until(() => w.find('.record-panel').exists());
    const stageKids = w.find('.stage').element.children;
    check('the record panel is a TRAY beside the viewport — a sibling, not an overlay inside it',
      [...stageKids].some((el: any) => el.classList.contains('viewport')) && [...stageKids].some((el: any) => el.classList.contains('record-panel'))
      && !w.find('.viewport .record-panel').exists() && w.find('.stage .tray-splitter').exists());
    await w.find('.record-panel .rp-close').trigger('click');

    const tablesBefore = (await pool.query(`select count(*)::int n from tables`)).rows[0].n;
    nav.dialogs.cancelNext = true;
    await nav.tableSettings(flowId);
    await until(() => w.find('.ts').exists());
    await w.find('.ts .danger').trigger('click');
    await until(() => nav.dialogs.seen.some((t: string) => t.startsWith('Delete the table')));
    await sleep(300);
    check('a delete asks first, in the app\'s own dialog — and Cancel means nothing happens',
      (await pool.query(`select count(*)::int n from tables`)).rows[0].n === tablesBefore && w.find('.ts').exists(), nav.dialogs.seen.slice(-2).join(' | '));
    await w.find('.ts .danger').trigger('click');
    check('…and OK deletes it, and closes the settings', (await untilDb(`select count(*)::int n from tables`, (r) => r[0].n === tablesBefore - 1))[0].n === tablesBefore - 1
      && await until(() => !w.find('.ts').exists()));

    check('no tab bar — the tree is the navigation', !w.find('.tabbar').exists() && !w.find('[role="tab"]').exists());
    check('what is inside the current location sits in its own recessed box', w.findAll('.tree .well').length === 1 && w.find('.tree .well .table-row').exists());
    const everythingRow = w.find('.tree [data-section="all"]');
    check('no section row reserves an empty icon slot (that is what made "Projects" look indented)',
      !everythingRow.find('.icon').exists() && !/∗/.test(everythingRow.text()));

    // THE STYLESHEET GUARD. happy-dom has no layout, so a missing CSS rule is
    // invisible to every other check here — and one went missing: rewriting the
    // header's styles deleted `.workspace` along with them, the canvas collapsed to
    // zero height, and 800 tests stayed green while the owner looked at a blank
    // board. The test build emits the app's CSS; every class the LAYOUT depends on
    // must still have a rule in it.
    const { readdirSync, readFileSync } = await import('node:fs');
    const css = readdirSync('.uitest').filter((f) => f.endsWith('.css')).map((f) => readFileSync(`.uitest/${f}`, 'utf8')).join('\n')
      // Comments OUT first: the note in App.vue explaining this very bug mentions
      // `.workspace`, and the first version of this check matched that and passed.
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const LAYOUT = ['app', 'topbar', 'body', 'main', 'stage', 'viewport', 'tray-splitter', 'workspace', 'dock', 'splitter',
      'drag-ghost', 'canvas-view', 'canvas-container', 'canvas-controls', 'canvas-world', 'tree', 'tree-scroll', 'tree-foot', 'well', 'record-panel', 'gridview', 'scroller', 'home',
      // the steady editor: its fixed-height body and the wrapper that holds its place
      'rte', 'rte-bar', 'rte-body', 'rp-rich',
      // notes on cards: a fixed-height window — without its rule the card's arithmetic is a lie
      'card-rich', 'card-rich-body',
      // arrows are only clickable because `.arrow-hit` opts back into pointer events, and a
      // link can only be dragged from a handle that is positioned and visible
      'arrow-hit', 'port-handle'];
    const unstyled = LAYOUT.filter((c) => !new RegExp(`\\.${c}(?![\\w-])[^{}]*\\{`).test(css));
    check('every class the layout depends on still has a CSS rule', css.length > 1000 && unstyled.length === 0, `no rule for: ${unstyled.join(', ') || '—'} (css ${css.length} bytes)`);
    const usedInApp = [...w.find('.app').element.querySelectorAll('[class]')].flatMap((el: any) => [...el.classList]);
    check('…and the ones on screen right now are among them (the list is not stale)', ['body', 'stage', 'viewport', 'tree', 'tree-foot', 'well'].every((c) => usedInApp.includes(c)));

    await nav.tab('history');
    check('Settings opens from the tree\'s footer, and History is inside it',
      await until(() => w.find('.settings .history').exists()) && /restore something deleted/i.test(w.find('.settings').text()));
    check('…listing the table deleted a moment ago, in plain words, with when',
      await until(() => w.findAll('.settings .hist tr').some((r: any) => /Table deleted/.test(r.text()) && r.find('.when').text().length > 4), 6000), w.find('.settings .hist').text().slice(0, 200));
    const before = (await pool.query(`select count(*)::int n from tables`)).rows[0].n;
    await w.findAll('.settings .hist tr').find((r: any) => /Table deleted/.test(r.text())).find('.restore').trigger('click');
    check('Restore brings it back — this is what Ctrl+Z cannot do after a reload, or for someone else\'s delete',
      (await untilDb(`select count(*)::int n from tables`, (r) => r[0].n === before + 1))[0].n === before + 1);
    await w.find('.settings .x').trigger('click');
    win.location.hash = '#/all/history'; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    check('an old #/…/history address opens Settings instead of going nowhere', await until(() => w.find('.settings').exists()));
    await w.find('.settings .x').trigger('click');

    await w.find('.topbar .tree-toggle').trigger('click');
    check('☰ hides the tree; the breadcrumb still says where you are', !w.find('.tree').exists() && w.find('.crumbs .section-crumb').exists());
    await w.find('.topbar .tree-toggle').trigger('click');
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}

// A throw ends the suite EARLY: the tally above then says "N passed, 0 failed" for the
// checks that ran, which reads as success. Say plainly that it is not.
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
