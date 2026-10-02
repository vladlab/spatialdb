/**
 * Five small things about finding your place (Oct 2):
 *
 *   N1  the record open in the tray is MARKED — its grid row, its canvas card, its board card
 *   N2  a pill dragged off a canvas card is only placed once it has LEFT that card
 *   N3  a pill whose record is already on the open canvas wears a → that goes to its card
 *       (on a card, and in the tray beside the canvas)
 *   N4  a grid row's right-click menu: open, duplicate, delete — one row, or the selected rows
 *   N5  "reset column order" puts a view back on the table's own field order
 *
 * happy-dom has no layout: this can say what rendered and what a press did, not where
 * anything is or what it looks like. The canvas's rectangle is faked (800×600 at 0,0),
 * as test/scope.ts does, so "inside the card" and "outside it" are real coordinates.
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';
import { boardsTableMutations } from './harness.js';
import { CARD_W } from '../src/client/canvas/cardLayout.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8841));
  const { w, win, pool, until, untilDb, post, nav } = ui;
  try {
    const tWorks = randomUUID(), tFiles = randomUUID(), tBoards = randomUUID();
    const fWName = randomUUID(), fWFiles = randomUUID(), fFName = randomUUID(), fWork = randomUUID(), fStatus = randomUUID(), fNotes = randomUUID();
    const ep101 = randomUUID(), ep102 = randomUUID(), a = randomUUID(), b = randomUUID(), c = randomUUID(), board = randomUUID(), kanbanView = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const setup = await post([
      { type: 'table.create', id: tWorks, name: 'Works', singularName: 'Work' }, { type: 'table.create', id: tFiles, name: 'Files', singularName: 'File' }, ...boardsTableMutations(tBoards),
      { type: 'field.create', id: fWName, tableId: tWorks, name: 'Name', key: 'name', fieldType: 'text' }, pos(fWName, 0),
      { type: 'field.create', id: fFName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(fFName, 0),
      { type: 'field.create', id: fWork, tableId: tFiles, name: 'Work', key: 'work', fieldType: 'link', options: { target_table_id: tWorks } }, pos(fWork, 1),
      { type: 'field.create', id: fStatus, tableId: tFiles, name: 'Status', key: 'status', fieldType: 'select', options: { choices: ['todo', 'done'] } }, pos(fStatus, 2),
      { type: 'field.create', id: fNotes, tableId: tFiles, name: 'Notes', key: 'notes', fieldType: 'text' }, pos(fNotes, 3),
      { type: 'field.create', id: fWFiles, tableId: tWorks, name: 'Files', key: 'files', fieldType: 'backlink', options: { source_field_id: fWork } }, pos(fWFiles, 1),
      { type: 'record.create', id: ep101, tableId: tWorks, data: { name: 'Ep 101' } }, { type: 'record.create', id: ep102, tableId: tWorks, data: { name: 'Ep 102' } },
      { type: 'record.create', id: a, tableId: tFiles, data: { name: 'a.mov', status: 'todo' } }, { type: 'record.create', id: b, tableId: tFiles, data: { name: 'b.mov', status: 'done' } },
      { type: 'record.create', id: c, tableId: tFiles, data: { name: 'c.mov' } },
      { type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: a, toRecord: ep101 },
      { type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: b, toRecord: ep101 },
      { type: 'record.create', id: board, tableId: tBoards, data: { name: 'Overview' } },
      { type: 'placement.add', id: randomUUID(), canvasId: board, recordId: ep101, x: 60, y: 60, w: null, h: null, z: 1 },
      { type: 'placement.add', id: randomUUID(), canvasId: board, recordId: a, x: 900, y: 700, w: null, h: null, z: 2 },
      { type: 'view.create', id: kanbanView, tableId: tFiles, name: 'By status', config: { sort: [], filters: [], hidden: [], kanban: { fieldId: fStatus } } },
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 300));

    const PE = (win as any).PointerEvent ?? (win as any).MouseEvent;
    const winEv = (type: string, init: Record<string, unknown>) => win.dispatchEvent(new PE(type, { bubbles: true, ...init }));
    const go = async (tableId: string) => { win.location.hash = `#/all/table/${tableId}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange')); await until(() => w.find('.gridview').exists() && w.findAll('.gridview tr.row').length > 0, 8000); };
    const ths = () => w.findAll('.gridview thead .th-name').map((x: any) => x.text());
    const rows = () => w.findAll('.gridview tr.row');
    const names = () => rows().map((r: any) => r.findAll('td')[1].text());
    const rowNamed = (name: string) => rows().find((r: any) => r.findAll('td')[1].text() === name)!;
    const tray = () => w.find('.record-panel');
    const trayTitle = () => (tray().exists() ? tray().find('.rp-title').text() : '');
    const pField = (label: string) => w.findAll('.record-panel .rp-field').find((f: any) => f.find('.rp-name').text().replace(/[★⚠✓]/g, '').trim() === label)!;
    const count = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0].n as number;

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nN1. The record open in the tray is marked');
    await go(tFiles);
    check('nothing is marked while the tray is closed', !tray().exists() && !w.find('.gridview tr.row.opened').exists());
    await rowNamed('a.mov').find('.expand').trigger('click');
    check('opening a record marks ITS row — and only it', await until(() => trayTitle() === 'a.mov' && rowNamed('a.mov').classes('opened')) && w.findAll('.gridview tr.row.opened').length === 1);
    check('…which is not the same thing as a selected row', !rowNamed('a.mov').classes('rowsel'));
    await rowNamed('b.mov').find('.expand').trigger('click');
    check('opening another moves the mark', await until(() => trayTitle() === 'b.mov' && rowNamed('b.mov').classes('opened')) && !rowNamed('a.mov').classes('opened'));

    // The board (kanban) view of the same table: the open record's card.
    const viewMenu = () => w.find('.gridview details.view-menu');
    await viewMenu().find('summary').trigger('click');
    await viewMenu().findAll('.view-row').find((r: any) => r.find('.view-title').text() === 'By status')!.trigger('click');
    const kcard = (name: string) => w.findAll('.kanban .kcard').find((k: any) => k.find('.kcard-title').text().startsWith(name))!;
    check('on a board view, the open record\'s card is marked', await until(() => !!kcard('b.mov') && kcard('b.mov').classes('opened')) && w.findAll('.kanban .kcard.opened').length === 1);
    await viewMenu().find('summary').trigger('click');
    await viewMenu().find('.view-row.builtin').trigger('click');
    await until(() => rows().length > 0);

    await tray().find('.rp-close').trigger('click');
    check('closing the tray clears it', await until(() => !tray().exists()) && !w.find('.gridview tr.row.opened').exists());

    await nav.openCanvas(board);
    const cardOf = (name: string) => w.findAll('.canvas-world .card').find((x: any) => x.find('.card-label').text() === name)!;
    await until(() => !!cardOf('Ep 101') && !!cardOf('a.mov'), 8000);
    check('on a canvas nothing is marked until something is open', !w.find('.canvas-world .card.opened').exists());
    await cardOf('Ep 101').trigger('dblclick');
    check('opening a card\'s record marks that card', await until(() => trayTitle() === 'Ep 101' && cardOf('Ep 101').classes('opened')) && w.findAll('.canvas-world .card.opened').length === 1);
    // Select the OTHER card: the open one keeps its mark — selected and open are different facts.
    await cardOf('a.mov').trigger('pointerdown', { button: 0, clientX: 5, clientY: 5 });
    winEv('pointerup', { clientX: 5, clientY: 5 });
    check('selecting another card does not move it: one is selected, the other is open',
      await until(() => cardOf('a.mov').classes('selected')) && cardOf('Ep 101').classes('opened') && !cardOf('a.mov').classes('opened') && !cardOf('Ep 101').classes('selected'));
    await tray().find('.rp-close').trigger('click');
    check('closing the tray clears it', await until(() => !tray().exists()) && !w.find('.canvas-world .card.opened').exists());

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nN2. A pill dragged off a card is placed only once it has left the card');
    const box = (el: any, r: { left: number; top: number; right: number; bottom: number }) => { (el.element as HTMLElement).getBoundingClientRect = () => ({ ...r, width: r.right - r.left, height: r.bottom - r.top, x: r.left, y: r.top, toJSON() {} }) as DOMRect; };
    box(w.find('.canvas-container'), { left: 0, top: 0, right: 800, bottom: 600 });
    // Put the view somewhere known: a pan gesture, then read the transform back.
    const world = () => w.find('.canvas-world').attributes('style') ?? '';
    const tf = () => { const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(world())!; return { x: Number(m[1]), y: Number(m[2]), s: Number(m[3]) }; };
    const toClient = (wx: number, wy: number) => { const t = tf(); return { clientX: t.x + wx * t.s, clientY: t.y + wy * t.s }; };
    const filesRow = () => cardOf('Ep 101').findAll('.card-field').find((r: any) => r.find('.card-key').text() === 'Files')!;
    const pillOn = (name: string) => filesRow().findAll('.pill').find((p: any) => p.find('.pill-text').text() === name)!;
    await until(() => !!filesRow() && filesRow().findAll('.pill').length === 2, 8000);
    check('the Ep 101 card names both its files, as pills', !!pillOn('a.mov') && !!pillOn('b.mov'), filesRow()?.text());

    const placedB = () => count(`select count(*)::int n from placements where canvas_id = $1 and record_id = $2`, [board, b]);
    const inside = () => toClient(60 + 40, 60 + 30), alsoInside = () => toClient(60 + CARD_W - 20, 60 + 50), outside = () => toClient(60 + CARD_W + 200, 60 + 30);
    // Pick b.mov up and let go 100px away — but still over the Ep 101 card.
    await pillOn('b.mov').trigger('pointerdown', { button: 0, ...inside() });
    winEv('pointermove', alsoInside());
    check('the drag has begun (the ghost is up)…', await until(() => w.find('.drag-ghost').exists()) && /b\.mov/.test(w.find('.drag-ghost').text()));
    check('…but over its own card the ghost is not lit: a release here would do nothing', !w.find('.drag-ghost').classes('over'));
    winEv('pointerup', alsoInside());
    await sleep(350);
    check('let go over the card it came from: NOT placed', (await placedB()) === 0 && !cardOf('b.mov') && !w.find('.drag-ghost').exists());
    check('…and nothing else happened either: no tray, view unmoved', !tray().exists());

    const before = world();
    await pillOn('b.mov').trigger('pointerdown', { button: 0, ...inside() });
    winEv('pointermove', alsoInside());
    winEv('pointermove', outside());
    check('past the card\'s edge the ghost lights up', await until(() => w.find('.drag-ghost').classes('over')));
    winEv('pointerup', outside());
    check('let go OUTSIDE the card: placed, once', (await untilDb(`select 1 from placements where canvas_id = '${board}' and record_id = '${b}'`, (r) => r.length === 1)).length === 1 && await until(() => !!cardOf('b.mov')));
    check('…where it was dropped, without the view moving', world() === before);

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nN3. A → on a pill whose record is already on this canvas');
    check('both files are on the canvas now, and both pills end in the arrow', await until(() => pillOn('a.mov').find('.pill-jump').exists() && pillOn('b.mov').find('.pill-jump').exists()));
    check('…the pill itself reads as before (the arrow is a drawing, not text)', pillOn('a.mov').find('.pill-text').text() === 'a.mov' && pillOn('a.mov').classes('jumps'));
    const workRow = (card: string) => cardOf(card).findAll('.card-field').find((r: any) => r.find('.card-key').text() === 'Work')!;
    check('a LINK row has it too: a.mov → Ep 101, which is here', await until(() => !!workRow('a.mov') && workRow('a.mov').find('.pill .pill-jump').exists()));
    // Take b.mov's card off the canvas again: its pill loses the arrow.
    await post([{ type: 'placement.remove', canvasId: board, recordId: b }]);
    check('a record that is NOT on the canvas has no arrow', await until(() => !cardOf('b.mov') && !pillOn('b.mov').find('.pill-jump').exists()) && pillOn('a.mov').find('.pill-jump').exists());

    await w.find('.canvas-container').trigger('keydown', { key: 'Escape' });       // nothing selected
    const away = world();
    await pillOn('a.mov').find('.pill-jump').trigger('pointerdown', { button: 0, ...inside() });
    await pillOn('a.mov').find('.pill-jump').trigger('click');
    check('pressing it goes to that card: the view pans, the card is selected', await until(() => cardOf('a.mov').classes('selected') && world() !== away), `${away} → ${world()}`);
    check('…centred on it, at the same zoom', (() => { const t = tf(); const cx = (400 - t.x) / t.s; return Math.abs(cx - (900 + CARD_W / 2)) < 1; })(), world());
    check('…and the card pulses once, so the eye lands on it', await until(() => cardOf('a.mov').classes('flash')) && await until(() => !cardOf('a.mov').classes('flash'), 2500));
    await sleep(200);
    check('it did not start a drag, open the tray, or place anything', !w.find('.drag-ghost').exists() && !tray().exists()
      && (await count(`select count(*)::int n from placements where canvas_id = $1`, [board])) === 2);
    await pillOn('a.mov').find('.pill-jump').trigger('dblclick');
    await sleep(150);
    check('two quick presses on the arrow are not a double-click on the pill', !tray().exists());

    // The tray, beside the canvas: the same pills, the same arrow.
    await cardOf('Ep 101').trigger('dblclick');
    await until(() => trayTitle() === 'Ep 101' && !!pField('Files') && pField('Files').findAll('.pill').length === 2);
    const trayPill = (name: string) => pField('Files').findAll('.pill').find((p: any) => p.find('.pill-text').text() === name)!;
    check('in the tray beside the canvas, the file that is on it has the arrow; the one that is not, has none',
      trayPill('a.mov').find('.pill-jump').exists() && !trayPill('b.mov').find('.pill-jump').exists());
    await w.find('.canvas-container').trigger('pointerdown', { button: 1, clientX: 5, clientY: 5 });      // pan away (middle button)
    await w.find('.canvas-container').trigger('pointermove', { clientX: 265, clientY: 185 });
    await w.find('.canvas-container').trigger('pointerup', { button: 1, clientX: 265, clientY: 185 });
    await w.find('.canvas-container').trigger('keydown', { key: 'Escape' });
    const panned = world();
    await trayPill('a.mov').find('.pill-jump').trigger('click');
    check('…and it goes to the card from there', await until(() => cardOf('a.mov').classes('selected') && world() !== panned) && trayTitle() === 'Ep 101');
    await nav.openTable(tFiles);            // through the tree: the open record stays open
    await until(() => w.find('.gridview').exists() && trayTitle() === 'Ep 101' && !!pField('Files') && pField('Files').findAll('.pill').length === 2, 8000);
    check('over a TABLE there is no canvas to jump on: no arrows in the tray', pField('Files').findAll('.pill').length === 2 && !tray().find('.pill-jump').exists());
    await tray().find('.rp-close').trigger('click');

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nN4. A row\'s right-click menu');
    const menu = () => w.find('.gridview .row-menu');
    const item = (cls: string) => menu().find(`button.${cls}`);
    const rightClick = async (name: string) => {
      // As a browser sends it: the button's mousedown first, then `contextmenu`.
      const cell = rowNamed(name).findAll('td')[2].element;
      cell.dispatchEvent(new (win as any).MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2, clientX: 300, clientY: 200 }));
      const ev = new (win as any).MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 300, clientY: 200 });
      cell.dispatchEvent(ev);
      await sleep(30);
      return ev as MouseEvent;
    };
    check('no menu until asked', !menu().exists());
    const ev1 = await rightClick('c.mov');
    check('right-click on a row opens its menu, in place of the browser\'s', await until(() => menu().exists()) && ev1.defaultPrevented);
    check('it says which record it is about, and offers open, duplicate, delete',
      menu().find('.ctx-head').text() === 'c.mov' && item('open-record').text() === 'Open record' && item('duplicate-record').text() === 'Duplicate record' && /^Delete record/.test(item('delete-record').text()), menu().text());
    check('the row holds its shade while the menu is open — and nothing was selected', rowNamed('c.mov').classes('menued') && !w.find('.gridview tr.rowsel').exists() && !w.find('.gridview td.sel').exists());
    await w.find('.gridview').trigger('keydown', { key: 'Escape' });
    check('Escape closes it', await until(() => !menu().exists()) && !w.find('.gridview tr.row.menued').exists());
    await rightClick('c.mov');
    await until(() => menu().exists());
    await w.find('.gridview .search').trigger('mousedown');
    check('…and so does a press anywhere else', await until(() => !menu().exists()));

    await rightClick('c.mov');
    await item('open-record').trigger('click');
    check('Open record opens it in the tray (and its row is marked)', await until(() => trayTitle() === 'c.mov' && rowNamed('c.mov').classes('opened')) && !menu().exists());
    await tray().find('.rp-close').trigger('click');

    await rightClick('c.mov');
    await item('duplicate-record').trigger('click');
    check('Duplicate record makes the copy', await until(() => names().includes('c.mov (copy)'))
      && (await untilDb(`select 1 from records where table_id = '${tFiles}' and data->>'name' = 'c.mov (copy)'`, (r) => r.length === 1)).length === 1, names().join());

    nav.dialogs.seen.length = 0;
    nav.dialogs.cancelNext = true;
    await rightClick('c.mov (copy)');
    await item('delete-record').trigger('click');
    check('Delete record… ASKS first, by name', await until(() => nav.dialogs.seen.some((t) => /Delete “c\.mov \(copy\)” everywhere/.test(t))), nav.dialogs.seen.join(' | '));
    await sleep(300);
    check('…and Cancel keeps it', names().includes('c.mov (copy)'));
    await rightClick('c.mov (copy)');
    await item('delete-record').trigger('click');
    check('confirmed, it is deleted', await until(() => !names().includes('c.mov (copy)'), 6000)
      && (await untilDb(`select 1 from records where table_id = '${tFiles}' and data->>'name' = 'c.mov (copy)'`, (r) => r.length === 0)).length === 0);

    // Several rows selected: the menu on one of them is about all of them.
    const num = (name: string) => rowNamed(name).find('td.num');
    await num('a.mov').trigger('pointerdown', { button: 0, clientX: 20, clientY: 100 });
    winEv('pointerup', { clientX: 20, clientY: 100 });
    await num('c.mov').trigger('pointerdown', { button: 0, ctrlKey: true, clientX: 20, clientY: 160 });
    winEv('pointerup', { clientX: 20, clientY: 160 });
    check('(two rows selected)', w.findAll('.gridview tr.rowsel').length === 2);
    await rightClick('b.mov');
    check('right-click on a row OUTSIDE the selection is about that row alone — and the selection stays',
      await until(() => menu().exists()) && menu().find('.ctx-head').text() === 'b.mov' && /^Delete record/.test(item('delete-record').text()) && w.findAll('.gridview tr.rowsel').length === 2);
    await w.find('.gridview').trigger('keydown', { key: 'Escape' });
    await rightClick('c.mov');
    check('right-click on a SELECTED row is about the whole selection',
      await until(() => menu().exists()) && menu().find('.ctx-head').text() === '2 records' && item('duplicate-record').text() === 'Duplicate 2 records'
      && /^Delete 2 records/.test(item('delete-record').text()) && item('open-record').text() === 'Open “c.mov”' && w.findAll('.gridview tr.row.menued').length === 2, menu().text());
    nav.dialogs.seen.length = 0;
    await item('delete-record').trigger('click');
    check('Delete 2 records… asks once, for both', await until(() => nav.dialogs.seen.some((t) => /Delete 2 records everywhere/.test(t))), nav.dialogs.seen.join(' | '));
    check('…and both go', await until(() => names().join() === 'b.mov', 6000), names().join());
    await untilDb(`select 1 from records where table_id = '${tFiles}'`, (r) => r.length === 1);
    await sleep(300);
    await w.findAll('.topbar .hist')[0].trigger('click');
    check('…as ONE step: a single undo brings both back', await until(() => ['a.mov', 'b.mov', 'c.mov'].every((n) => names().includes(n)), 6000), names().join());

    // A cell that is being edited keeps the browser's own menu.
    await rowNamed('b.mov').findAll('td')[4].trigger('mousedown');
    await rowNamed('b.mov').findAll('td')[4].trigger('dblclick');
    await until(() => rowNamed('b.mov').findAll('td')[4].classes('editing'));
    const evEdit = new (win as any).MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 300, clientY: 200 });
    rowNamed('b.mov').findAll('td')[4].find('input').element.dispatchEvent(evEdit);
    await sleep(60);
    check('inside a cell being edited the right-click is the browser\'s (paste…): no row menu', !menu().exists() && !evEdit.defaultPrevented);
    await rowNamed('b.mov').findAll('td')[4].find('input').trigger('keydown', { key: 'Escape' });

    // A table of boards: the menu can also go to the board.
    await nav.openTable(tBoards);
    await until(() => names().includes('Overview'));
    await rightClick('Overview');
    check('in a table of boards the menu also offers “Open this board”', await until(() => menu().exists()) && menu().find('.open-board-item').exists());
    await w.find('.gridview').trigger('keydown', { key: 'Escape' });

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nN5. Reset column order');
    await go(tFiles);
    const fieldsMenu = () => w.findAll('.gridview details.menu').find((d: any) => /^fields/.test(d.find('summary').text()))!;
    const reset = () => fieldsMenu().find('.reset-order');
    const line = (name: string) => fieldsMenu().findAll('.field-line').find((l: any) => l.find('.field-tick').text().replace('★', '').trim() === name)!;
    const cfg = async () => (await pool.query(`select config from views where id = $1`, [tFiles])).rows[0]?.config;
    const schemaOrder = 'Name,Work,Status,Notes,Created,Created by';
    check('(the grid starts in the table\'s own order)', ths().join() === schemaOrder, ths().join());
    await fieldsMenu().find('summary').trigger('click');
    check('the fields menu has “reset column order” — greyed out while the view has no order of its own', reset().exists() && reset().attributes('disabled') !== undefined);

    await line('Notes').find('button.prev').trigger('click');
    await line('Notes').find('button.prev').trigger('click');
    await line('Status').find('input').setValue(false);            // hide Status: reset must leave that alone
    check('move Notes up twice and hide Status: the view has its own arrangement', await until(() => ths().join() === 'Name,Notes,Work,Created,Created by'), ths().join());
    await untilDb(`select config from views where id = '${tFiles}'`, (r) => Array.isArray(r[0]?.config?.order) && r[0].config.hidden.length === 1);
    check('…and the button is live', reset().attributes('disabled') === undefined);

    await reset().trigger('click');
    check('reset: the columns are back in the table\'s order — the hidden field still hidden', await until(() => ths().join() === 'Name,Work,Notes,Created,Created by'), ths().join());
    const after = await untilDb(`select config from views where id = '${tFiles}'`, (r) => r[0] && !('order' in r[0].config));
    check('…saved by DROPPING the view\'s `order`, not by writing the table\'s order into it', !('order' in after[0].config) && after[0].config.hidden.length === 1 && after[0].config.hidden[0] === fStatus, JSON.stringify(after[0]?.config));
    check('…and the button greys out again', await until(() => reset().attributes('disabled') !== undefined));

    // So the view FOLLOWS Table settings from here on: reorder the schema, the grid moves.
    await post([pos(fNotes, 1), pos(fWork, 3)]);
    check('with no order of its own the view follows a reorder made in Table settings', await until(() => ths().join() === 'Name,Notes,Work,Created,Created by'), ths().join());
    await post([pos(fWork, 1), pos(fNotes, 3)]);
    await until(() => ths().join() === 'Name,Work,Notes,Created,Created by');

    await sleep(300);
    await w.findAll('.topbar .hist')[0].trigger('click');
    check('Ctrl+Z gives the arrangement back', await until(() => ths().join() === 'Name,Notes,Work,Created,Created by', 6000)
      && Array.isArray((await untilDb(`select config from views where id = '${tFiles}'`, (r) => Array.isArray(r[0]?.config?.order)))[0]?.config.order)
      && await until(() => reset().attributes('disabled') === undefined), `${ths().join()} · ${JSON.stringify(await cfg())}`);
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
