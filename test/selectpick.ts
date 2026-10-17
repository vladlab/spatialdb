/**
 * Picking a select's choice with the MOUSE, in the grid.
 *
 * The bug (Oct 17): a click on a choice closed the editor — and the same mousedown
 * then reached the cell, which read "the selected cell, clicked again, not editing"
 * and opened a fresh, empty editor over the value just written. The capsule only
 * showed once you clicked away. Keyboard picks never went through that path, so
 * Enter worked all along.
 *
 * Also here: Tab on a select picks the highlighted choice AND moves right, as Tab
 * does in every other cell (it used to pick and stay); Enter picks and moves down.
 * The same picker serves the multi-select's "+ add…", which must stay open per tick.
 */
import { randomUUID } from 'node:crypto';
import { mountApp } from './uiHarness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8841));
  const { w, win, until, untilDb, post } = ui;
  try {
    const t = randomUUID(), fName = randomUUID(), fStatus = randomUUID(), fTags = randomUUID(), fFrames = randomUUID();
    const r1 = randomUUID(), r2 = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const setup = await post([
      { type: 'table.create', id: t, name: 'Masters', singularName: 'Master' },
      { type: 'field.create', id: fName, tableId: t, name: 'Name', key: 'name', fieldType: 'text' }, pos(fName, 0),
      { type: 'field.create', id: fStatus, tableId: t, name: 'Status', key: 'status', fieldType: 'select', options: { choices: ['todo', 'doing', 'done'] } }, pos(fStatus, 1),
      { type: 'field.create', id: fTags, tableId: t, name: 'Tags', key: 'tags', fieldType: 'multi_select', options: { choices: ['hdr', 'sdr', 'dv'] } }, pos(fTags, 2),
      { type: 'field.create', id: fFrames, tableId: t, name: 'Frames', key: 'frames', fieldType: 'number' }, pos(fFrames, 3),
      { type: 'record.create', id: r1, tableId: t, data: { name: 'a.mov' } },
      { type: 'record.create', id: r2, tableId: t, data: { name: 'b.mov' } },
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 200));

    win.location.hash = `#/all/table/${t}`;
    win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.find('.gridview').exists() && w.findAll('.gridview tr.row').length === 2, 8000);

    const grid = () => w.find('.gridview .scroller');
    const rows = () => w.findAll('.gridview tr.row');
    const cell = (row: number, col: number) => rows()[row].findAll('td')[col + 1];
    const selAt = () => {
      const rs = rows();
      for (let r = 0; r < rs.length; r++) { const c = rs[r].findAll('td').findIndex((td: any) => td.classes('sel')); if (c > 0) return `${r},${c - 1}`; }
      return 'none';
    };
    const editing = () => w.find('.gridview td.editing');
    const items = () => w.findAll('.gridview td.editing .cp-item');
    const key = (k: string, opts: Record<string, unknown> = {}) => grid().trigger('keydown', { key: k, ...opts });

    console.log('\nS1. A MOUSE pick closes the editor and shows the capsule — at once, with the cell still selected');
    await cell(0, 1).trigger('mousedown', { button: 0 });
    await cell(0, 1).trigger('mousedown', { button: 0 });   // the second click on the selected cell edits it
    check('the picker is open', editing().exists() && items().length === 3, editing().html().slice(0, 300));
    const doing = items().find((i: any) => i.text().replace('✓', '') === 'doing')!;
    await doing.trigger('mousedown', { button: 0 });   // the pick — this mousedown also bubbles to the cell
    await until(() => !editing().exists(), 1000);
    check('the editor is GONE after the pick (it used to reopen, empty, over the new value)', !editing().exists(), editing().exists() ? editing().html().slice(0, 300) : '');
    check('the cell is still the selected one', selAt() === '0,1', selAt());
    check('…and shows the new choice as a capsule', cell(0, 1).find('.choice').exists() && cell(0, 1).find('.choice').text() === 'doing', cell(0, 1).text());
    await untilDb(`select data->>'status' s from records where id='${r1}'`, (rs) => rs[0]?.s === 'doing');
    check('written', true);

    console.log('\nS2. Tab on a select picks the highlighted choice and moves RIGHT, like Tab anywhere else');
    await key('Enter');
    check('Enter on the selected select cell opens the picker, highlight on the CURRENT value', editing().exists() && items().find((i: any) => i.classes('hi'))?.text().replace('✓', '') === 'doing', items().map((i: any) => i.text() + (i.classes('hi') ? '*' : '')).join());
    await editing().find('.cp-input').setValue('done');
    await editing().find('.cp-input').trigger('keydown', { key: 'Tab' });
    await until(() => !editing().exists(), 1000);
    check('the edit ended', !editing().exists());
    check('the selection moved right', selAt() === '0,2', selAt());
    check('the typed-for choice was picked', cell(0, 1).find('.choice').text() === 'done', cell(0, 1).text());

    console.log('\nS3. Enter picks and moves DOWN, like Enter anywhere else');
    await key('ArrowLeft');
    check('back on the select', selAt() === '0,1', selAt());
    await key('Enter');
    await editing().find('.cp-input').setValue('todo');
    await editing().find('.cp-input').trigger('keydown', { key: 'Enter' });
    await until(() => !editing().exists(), 1000);
    check('the edit ended and the selection moved down', !editing().exists() && selAt() === '1,1', selAt());
    check('the pick is shown on the row above', cell(0, 1).find('.choice').text() === 'todo', cell(0, 1).text());

    console.log('\nS4. The multi-select\'s "+ add…" is the same picker and must STAY open per tick');
    await key('ArrowRight');
    await key('Enter');
    check('the multi-select editor is open', editing().exists() && editing().find('.chip-add').exists());
    const hdr = items().find((i: any) => i.text() === 'hdr')!;
    await hdr.trigger('mousedown', { button: 0 });
    await until(() => editing().findAll('.chip.choice').length === 1, 1000);
    check('a mouse tick adds the chip and the editor stays open', editing().exists() && editing().findAll('.chip.choice').map((c: any) => c.text().replace('×', '')).join() === 'hdr', editing().exists() ? editing().text() : 'closed');
    const sdr = items().find((i: any) => i.text() === 'sdr')!;
    await sdr.trigger('mousedown', { button: 0 });
    await until(() => editing().findAll('.chip.choice').length === 2, 1000);
    check('a second tick too', editing().exists() && editing().findAll('.chip.choice').length === 2);
    await key('Escape');
    await editing().exists() && await editing().find('.cp-input').trigger('keydown', { key: 'Escape' });
    await until(() => !editing().exists(), 1000);
    check('Escape closes it; both chips stay', !editing().exists() && cell(1, 2).findAll('.choice').length === 2, cell(1, 2).text());
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
