/**
 * Duplicating records (duplicate.ts) and copying a cell between records
 * (cellClipboard.ts): the grid's Ctrl+D / ⧉, Ctrl+C / Ctrl+V; the tray's ⧉ and
 * Ctrl+C / V on a field; the canvas card menu's Duplicate.
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8823));
  const { w, win, pool, until, untilDb, post, nav } = ui;
  try {
    const tWorks = randomUUID(), tFiles = randomUUID(), tSpecs = randomUUID();
    const fWName = randomUUID(), fName = randomUUID(), fCodec = randomUUID(), fRating = randomUUID(), fStatus = randomUUID(), fWork = randomUUID();
    const fSName = randomUUID(), fSStatus = randomUUID(), fSWork = randomUUID();
    const ep1 = randomUUID(), ep2 = randomUUID(), a = randomUUID(), b = randomUUID(), spec = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const r = await post([
      { type: 'table.create', id: tFiles, name: 'Files', singularName: 'File' }, { type: 'table.update', id: tFiles, position: 1 },
      { type: 'table.create', id: tSpecs, name: 'Specs', singularName: 'Spec' }, { type: 'table.update', id: tSpecs, position: 2 },
      { type: 'table.create', id: tWorks, name: 'Works', singularName: 'Work' }, { type: 'table.update', id: tWorks, position: 3 },
      { type: 'field.create', id: fWName, tableId: tWorks, name: 'Name', key: 'name', fieldType: 'text' }, pos(fWName, 0),
      { type: 'field.create', id: fName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(fName, 0),
      { type: 'field.create', id: fCodec, tableId: tFiles, name: 'Codec', key: 'codec', fieldType: 'text' }, pos(fCodec, 1),
      { type: 'field.create', id: fRating, tableId: tFiles, name: 'Rating', key: 'rating', fieldType: 'number' }, pos(fRating, 2),
      { type: 'field.create', id: fStatus, tableId: tFiles, name: 'Status', key: 'status', fieldType: 'select', options: { choices: ['draft', 'final'] } }, pos(fStatus, 3),
      { type: 'field.create', id: fWork, tableId: tFiles, name: 'Work', key: 'work', fieldType: 'link', options: { target_table_id: tWorks } }, pos(fWork, 4),
      { type: 'field.create', id: fSName, tableId: tSpecs, name: 'Name', key: 'name', fieldType: 'text' }, pos(fSName, 0),
      { type: 'field.create', id: fSStatus, tableId: tSpecs, name: 'Status', key: 'status', fieldType: 'select', options: { choices: ['draft'] } }, pos(fSStatus, 1),
      { type: 'field.create', id: fSWork, tableId: tSpecs, name: 'Work', key: 'work', fieldType: 'link', options: { target_table_id: tWorks, single: true } }, pos(fSWork, 2),
      { type: 'record.create', id: ep1, tableId: tWorks, data: { name: 'Ep 101' } }, { type: 'record.create', id: ep2, tableId: tWorks, data: { name: 'Ep 102' } },
      { type: 'record.create', id: a, tableId: tFiles, data: { name: 'a.mov', codec: 'ProRes 4444', rating: 5, status: 'final' } },
      { type: 'record.create', id: b, tableId: tFiles, data: { name: 'b.mov' } },
      { type: 'record.create', id: spec, tableId: tSpecs, data: { name: 'Broadcast' } },
      { type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: a, toRecord: ep1 },
      { type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: a, toRecord: ep2 },
    ]);
    check('fixture accepted', r.status === 200, (await r.text()).slice(0, 200));
    win.location.hash = `#/all/table/${tFiles}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.findAll('.gridview tr.row').length === 2, 8000);
    const rowOf = (name: string) => w.findAll('.gridview tr.row').find((x: any) => x.find('td.num').exists() && x.text().includes(name));
    const ths = () => w.findAll('.gridview th').map((t: any) => t.text().replace(/[⚙▾▴]/g, '').trim());
    const colOf = (label: string) => ths().findIndex((t: string) => t.startsWith(label));
    const cell = (name: string, label: string) => rowOf(name)!.findAll('td')[colOf(label)]!;
    const key = (k: string, opts: Record<string, unknown> = {}) => w.find('.gridview .scroller').trigger('keydown', { key: k, ...opts });

    console.log('\nD1. Ctrl+D duplicates the row and jumps to the copy');
    await cell('a.mov', 'Codec').trigger('mousedown');
    await key('d', { ctrlKey: true });
    const copies = await untilDb(`select id, data, created_by, created_at from records where table_id = '${tFiles}' and data->>'name' = 'a.mov (copy)'`, (x) => x.length === 1, 8000);
    check('a new record, named "a.mov (copy)"', copies.length === 1);
    const copy = copies[0];
    const orig = (await pool.query(`select data, created_by, created_at from records where id = $1`, [a])).rows[0];
    check('its values are the original\'s', copy.data.codec === 'ProRes 4444' && copy.data.rating === 5 && copy.data.status === 'final', JSON.stringify(copy.data));
    check('created now, not when the original was', new Date(copy.created_at) > new Date(orig.created_at) && !!copy.created_by);
    const links = (await pool.query(`select to_record from links where from_record = $1 and field_id = $2 order by to_record`, [copy.id, fWork])).rows.map((x: any) => x.to_record);
    check('its links are the original\'s (both episodes)', links.sort().join() === [ep1, ep2].sort().join(), links.join());
    check('the grid jumped to the copy: its Codec cell is selected, the row selected', await until(() => !!rowOf('a.mov (copy)') && rowOf('a.mov (copy)')!.classes('rowsel')) && cell('a.mov (copy)', 'Codec').classes('sel'));
    check('the row handle has a ⧉ too', rowOf('b.mov')!.find('td.num .dup').exists());
    await rowOf('b.mov')!.find('td.num .dup').trigger('click');
    await untilDb(`select count(*)::int n from records where table_id = '${tFiles}'`, (x) => x[0].n === 4, 8000);
    check('⧉ on a row duplicates it', await until(() => !!rowOf('b.mov (copy)')));

    console.log('\nD2. Ctrl+C / Ctrl+V between cells');
    await cell('a.mov', 'Codec').trigger('mousedown');
    await key('c', { ctrlKey: true });
    await sleep(50);
    await cell('b.mov', 'Codec').trigger('mousedown');
    await key('v', { ctrlKey: true });
    await untilDb(`select data->>'codec' c from records where id = '${b}'`, (x) => x[0]?.c === 'ProRes 4444', 8000);
    check('text → text pastes', true);
    await cell('b.mov', 'Rating').trigger('mousedown');
    await key('v', { ctrlKey: true });
    await sleep(200);
    check('text → number is refused, with a notice', (await pool.query(`select data->>'rating' r from records where id = $1`, [b])).rows[0].r === null && /Not pasted/.test(w.find('.desk-notices').text()), w.find('.desk-notices').exists() ? w.find('.desk-notices').text() : 'no notice');
    await cell('a.mov', 'Work').trigger('mousedown');
    await key('c', { ctrlKey: true });
    await sleep(50);
    await post([{ type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: b, toRecord: ep2 }]);   // b already has Ep 102: paste must REPLACE, not add
    await untilDb(`select count(*)::int n from links where from_record = '${b}'`, (x) => x[0].n === 1, 4000);
    await cell('b.mov', 'Work').trigger('mousedown');
    await key('v', { ctrlKey: true });
    const bl = await untilDb(`select to_record from links where from_record = '${b}' and field_id = '${fWork}'`, (x) => x.length === 2, 8000);
    check('link → link pastes both episodes (Ep 102 kept, Ep 101 added — a replace, one batch)', bl.map((x: any) => x.to_record).sort().join() === [ep1, ep2].sort().join());

    // Into another table: Specs' Work is single (takes the first); its Status lacks "final".
    win.location.hash = `#/all/table/${tSpecs}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.findAll('.gridview tr.row').length === 1, 8000);
    await cell('Broadcast', 'Work').trigger('mousedown');
    await key('v', { ctrlKey: true });
    const sl = await untilDb(`select to_record from links where from_record = '${spec}'`, (x) => x.length === 1, 8000);
    check('pasted into a SINGLE link on another table: the first one', sl.length === 1 && [ep1, ep2].includes(sl[0].to_record));
    win.location.hash = `#/all/table/${tFiles}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.findAll('.gridview tr.row').length === 4, 8000);
    await cell('a.mov', 'Status').trigger('mousedown');
    await key('c', { ctrlKey: true });
    await sleep(50);
    win.location.hash = `#/all/table/${tSpecs}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.findAll('.gridview tr.row').length === 1, 8000);
    await cell('Broadcast', 'Status').trigger('mousedown');
    await key('v', { ctrlKey: true });
    await sleep(200);
    check('select → select is refused when the target has no such choice', (await pool.query(`select data->>'status' s from records where id = $1`, [spec])).rows[0].s === null && /not one of Status/.test(w.find('.desk-notices').text()), w.find('.desk-notices').text());

    console.log('\nD3. The tray');
    win.location.hash = `#/all/table/${tFiles}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.findAll('.gridview tr.row').length === 4, 8000);
    await rowOf('a.mov')!.find('td.num .expand').trigger('click');
    await until(() => w.find('.record-panel .rp-title').text() === 'a.mov');
    check('the tray offers ⧉ duplicate', w.find('.record-panel .rp-dup').exists());
    await w.find('.record-panel .rp-dup').trigger('click');
    check('…and walks to the copy', await until(() => w.find('.record-panel .rp-title').text() === 'a.mov (copy)', 8000));
    await untilDb(`select count(*)::int n from records where table_id = '${tFiles}' and data->>'name' = 'a.mov (copy)'`, (x) => x[0].n === 2, 8000);
    check('a second "a.mov (copy)" exists (no numbering — rename it)', true);
    await w.find('.record-panel .rp-close').trigger('click');

    console.log('\nD4. The canvas card menu');
    await nav.newCanvas('Board');
    const board = (await untilDb(`select id from records where data->>'name' = 'Board'`, (x) => x.length === 1))[0].id as string;
    await post([{ type: 'placement.add', id: randomUUID(), canvasId: board, recordId: b, x: 40, y: 40, w: null, h: null, z: 1 }]);
    await nav.openCanvas(board);
    const cards = () => w.findAll('.canvas-container .card');
    await until(() => cards().length === 1, 8000);
    await cards()[0]!.trigger('contextmenu', { clientX: 200, clientY: 200 });
    check('the card menu offers Duplicate record', await until(() => w.find('.ctx .duplicate-record').exists()));
    await w.find('.ctx .duplicate-record').trigger('click');
    check('the copy is placed beside the original', await until(() => cards().length === 2, 8000) && cards().some((c: any) => c.find('.card-label').text() === 'b.mov (copy)'));
    await sleep(100);
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
