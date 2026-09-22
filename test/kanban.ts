/**
 * The kanban board: a view whose body is columns of cards. Columns by a select and
 * by a link; drag = move or add; drop on "(none)"; "+" per column; a "single" link
 * field's picker REPLACES. The pure column rule and the server's "single" check are
 * in test/grid.ts.
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8814));
  const { w, win, pool, until, untilDb, post, nav } = ui;
  const dialogs = nav.dialogs;
  try {
    const tWorks = randomUUID(), tFiles = randomUUID();
    const fWName = randomUUID(), fName = randomUUID(), fStatus = randomUUID(), fWork = randomUUID();
    const ep1 = randomUUID(), ep2 = randomUUID(), a = randomUUID(), b = randomUUID(), c = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const setup = await post([
      { type: 'table.create', id: tWorks, name: 'Works' }, { type: 'table.create', id: tFiles, name: 'Files' },
      { type: 'field.create', id: fWName, tableId: tWorks, name: 'Name', key: 'name', fieldType: 'text' }, pos(fWName, 0),
      { type: 'field.create', id: fName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(fName, 0),
      { type: 'field.create', id: fStatus, tableId: tFiles, name: 'Status', key: 'status', fieldType: 'select', options: { choices: ['todo', 'doing', 'done'] } }, pos(fStatus, 1),
      { type: 'field.create', id: fWork, tableId: tFiles, name: 'Work', key: 'work', fieldType: 'link', options: { target_table_id: tWorks } }, pos(fWork, 2),   // NOT single yet
      { type: 'record.create', id: ep1, tableId: tWorks, data: { name: 'Ep 101' } }, { type: 'record.create', id: ep2, tableId: tWorks, data: { name: 'Ep 102' } },
      { type: 'record.create', id: a, tableId: tFiles, data: { name: 'a.mov', status: 'todo' } },
      { type: 'record.create', id: b, tableId: tFiles, data: { name: 'b.mov', status: 'done' } },
      { type: 'record.create', id: c, tableId: tFiles, data: { name: 'c.mov' } },
      { type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: a, toRecord: ep1 },
      { type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: b, toRecord: ep2 },
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 200));
    win.location.hash = `#/all/table/${tFiles}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.findAll('.gridview tr.row').length === 3, 8000);

    const viewMenu = () => w.find('.gridview .view-menu');
    const board = () => w.find('.kanban');
    const cols = () => board().findAll('.kcol').map((col: any) => `${col.find('.kcol-label').text()}[${col.findAll('.kcard .kcard-title').map((t: any) => t.text().replace('⤢', '').trim()).join(',')}]`).join(' ');
    const colNamed = (label: string) => board().findAll('.kcol').find((col: any) => col.find('.kcol-label').text() === label)!;
    const cardIn = (label: string, name: string) => colNamed(label).findAll('.kcard').find((k: any) => k.find('.kcard-title').text().includes(name))!;
    const PE = (win as any).PointerEvent ?? (win as any).MouseEvent;
    const rect = (el: any) => (el.element as HTMLElement).getBoundingClientRect();
    /** Drag a card by pointer onto a column. happy-dom has no layout, so every rect is 0×0 — we give the columns real boxes. */
    const dragTo = async (label: string, name: string, toLabel: string) => {
      const card = cardIn(label, name), to = colNamed(toLabel);
      const box = (col: any, i: number) => { (col.element as HTMLElement).getBoundingClientRect = () => ({ left: i * 300, right: i * 300 + 250, top: 0, bottom: 800, width: 250, height: 800, x: i * 300, y: 0, toJSON() {} }) as DOMRect; };
      board().findAll('.kcol').forEach(box);
      const ti = board().findAll('.kcol').findIndex((col: any) => col.find('.kcol-label').text() === toLabel);
      void rect;
      await card.trigger('pointerdown', { button: 0, clientX: 10, clientY: 10 });
      win.dispatchEvent(new PE('pointermove', { bubbles: true, clientX: 40, clientY: 40 }));
      win.dispatchEvent(new PE('pointermove', { bubbles: true, clientX: ti * 300 + 100, clientY: 100 }));
      win.dispatchEvent(new PE('pointerup', { bubbles: true, clientX: ti * 300 + 100, clientY: 100 }));
      void to;
      await sleep(400);
    };

    console.log('\nK1. A board over a select');
    (viewMenu().element as HTMLDetailsElement).open = true;
    check('the views menu offers "+ new board"', viewMenu().find('.new-board').exists());
    dialogs.text = 'By status';
    await viewMenu().find('.new-board').trigger('click');          // the dialog autopilot types the name
    await untilDb(`select config from views where table_id = '${tFiles}' and (config->'kanban') is not null`, (r) => r.length === 1);
    check('a board is a VIEW: saved, shared, listed', await until(() => board().exists()) && /board/.test(viewMenu().text()));
    check('one column per choice (empty ones too), "(none)" last, cards where their status says', await until(() => cols() === 'todo[a.mov] doing[] done[b.mov] (none)[c.mov]'), cols());
    check('the grid\'s toolbar is still there (filter, sort, fields) and the group menu is not', w.find('.gridview .kanban-menu').exists() && !w.find('.gridview .group-menu').exists());
    check('a plain (multi) link may NOT make columns — only the select is offered', w.findAll('.gridview .kanban-field option').map((o: any) => o.text()).join() === 'Status', w.find('.gridview .kanban-field').text());

    await dragTo('todo', 'a.mov', 'doing');
    check('dragging a card to a column sets the value', (await untilDb(`select data->>'status' s from records where id = '${a}'`, (r) => r[0].s === 'doing'))[0].s === 'doing' && await until(() => cols() === 'todo[] doing[a.mov] done[b.mov] (none)[c.mov]'), cols());
    await dragTo('doing', 'a.mov', '(none)');
    check('dropping on "(none)" clears it', (await untilDb(`select data from records where id = '${a}'`, (r) => !('status' in r[0].data))).length === 1);
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    check('one Ctrl+Z', (await untilDb(`select data->>'status' s from records where id = '${a}'`, (r) => r[0].s === 'doing'))[0].s === 'doing');

    const filesBefore = Number((await pool.query(`select count(*)::int n from records where table_id = $1`, [tFiles])).rows[0].n);
    await colNamed('done').find('.kcol-add').trigger('click');
    check('"+" in a column makes a record that is already IN it', (await untilDb(`select data->>'status' s from records where table_id = '${tFiles}' and not (data ? 'name')`, (r) => r.length === 1))[0].s === 'done');
    if (w.find('.gridview td.editing input').exists()) await w.find('.gridview td.editing input').trigger('keydown', { key: 'Escape' });
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await untilDb(`select count(*)::int n from records where table_id = '${tFiles}'`, (r) => r[0].n === filesBefore);

    console.log('\nK2. Columns by a "single" link');
    await post([{ type: 'field.update', id: fWork, options: { target_table_id: tWorks, single: true } }]);
    (w.find('.gridview .kanban-menu').element as HTMLDetailsElement).open = true;
    check('ticked single, the link is offered for columns', await until(() => w.findAll('.gridview .kanban-field option').map((o: any) => o.text()).join() === 'Status,Work'));
    await w.find('.gridview .kanban-field').setValue(fWork);
    check('a column per target record; every card in exactly one', await until(() => cols() === 'Ep 101[a.mov] Ep 102[b.mov] (none)[c.mov]'), cols());
    await dragTo('Ep 101', 'a.mov', 'Ep 102');
    check('a drag MOVES — the link is replaced, in one batch', await until(() => cols() === 'Ep 101[] Ep 102[a.mov,b.mov] (none)[c.mov]')
      && (await pool.query(`select count(*)::int n from links where field_id = $1 and from_record = $2`, [fWork, a])).rows[0].n === 1, cols());
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    check('…one Ctrl+Z', await until(() => cols() === 'Ep 101[a.mov] Ep 102[b.mov] (none)[c.mov]'), cols());
    await dragTo('Ep 102', 'b.mov', '(none)');
    check('dropping on "(none)" removes the link', await until(() => cols() === 'Ep 101[a.mov] Ep 102[] (none)[b.mov,c.mov]'), cols());
    await colNamed('Ep 102').find('.kcol-add').trigger('click');
    check('"+" in a link column makes a record already linked there', (await untilDb(`select 1 from links l join records r on r.id = l.from_record where l.field_id = '${fWork}' and l.to_record = '${ep2}' and not (r.data ? 'name')`, (r) => r.length === 1)).length === 1);
    if (w.find('.gridview td.editing input').exists()) await w.find('.gridview td.editing input').trigger('keydown', { key: 'Escape' });
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await untilDb(`select count(*)::int n from records where table_id = '${tFiles}'`, (r) => r[0].n === filesBefore);
    await post([{ type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: b, toRecord: ep2 }]);

    await post([{ type: 'field.update', id: fWork, options: { target_table_id: tWorks } }]);
    check('un-tick single and the board over that field falls back to the grid rather than guessing', await until(() => !board().exists() && w.findAll('.gridview tr.row').length === 3, 8000));
    await post([{ type: 'field.update', id: fWork, options: { target_table_id: tWorks, single: true } }]);
    await until(() => board().exists());
    (w.find('.gridview .kanban-menu').element as HTMLDetailsElement).open = false;

    console.log('\nK3. The picker replaces on a single field');
    // The picker replaces too — in the grid view.
    (viewMenu().element as HTMLDetailsElement).open = true;
    // (a fresh table has no saved 'Grid' row; the board is the only real view. Make a grid view to switch to.)
    dialogs.text = 'Plain';
    await viewMenu().find('.new-view').trigger('click');
    await untilDb(`select id from views where table_id = '${tFiles}' and (config->'kanban') is null`, (r) => r.length === 1);
    await until(() => w.findAll('.gridview tr.row').length === 3 && !board().exists(), 8000);
    const rowOf = (name: string) => w.findAll('.gridview tr.row').find((r: any) => r.findAll('td')[1].text().trim() === name)!;
    check('"+ new view" from a board makes a GRID (it used to copy the board\'s columns setting along with everything else)', !!rowOf('a.mov') && !board().exists());
    const workCell = (name: string) => rowOf(name).findAll('td')[3];
    await workCell('a.mov').trigger('mousedown'); await workCell('a.mov').trigger('dblclick');
    await until(() => w.find('.picker').exists());
    await w.find('.picker input').setValue('Ep 102');
    await until(() => w.findAll('.picker .list li').some((li: any) => /Ep 102/.test(li.text())));
    await w.findAll('.picker .list li').find((li: any) => /Ep 102/.test(li.text()))!.trigger('mousedown');
    const links = await untilDb(`select to_record from links where field_id = '${fWork}' and from_record = '${a}'`, (r) => r.length === 1 && r[0].to_record === ep2);
    check('picking another record in the grid\'s link picker REPLACES on a single field (the server would refuse a second)', links.length === 1 && links[0].to_record === ep2 && !w.find('.errors').exists());
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
