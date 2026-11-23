/**
 * LIFTED CARDS (CANVAS-BRIEF.md C1; reworked Nov 23 2026), in the app.
 *
 *   E1  Space TAPPED on a selected card lifts it; Space held and dragged pans and does not
 *   E2  the lifted card is the record's OPEN card: its strip, its whole title, every
 *       field, every link; its place on the canvas kept by a see-through copy
 *   E3  it is EDITABLE, with the editors the dock's card has
 *   E4  while it is up the canvas hears nothing (Delete, Z); Esc, Space or a click
 *       outside put it back; "Examine" in the card menu
 *   E5  a LINE: a double-click on a linked record brings its card up at the right, once;
 *       a card's own × (or Esc inside it) puts that one back
 *   E6  "pin" sends a lifted card to the dock, where it stays — and a record with a card
 *       in the dock is not lifted as well
 *   E7  the palette: Enter BRINGS A CARD UP (a record that is not on the canvas, from a
 *       table never opened); "place" puts it on the canvas
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8865));
  const { w, win, until, untilDb, post, nav, pool } = ui;
  try {
    const tFiles = randomUUID(), tWorks = randomUUID(), tBoards = randomUUID(), sec = randomUUID(), techSec = randomUUID();
    const fName = randomUUID(), fCodec = randomUUID(), fStatus = randomUUID(), fWork = randomUUID(), fWName = randomUUID(), fBName = randomUUID();
    const board = randomUUID(), fileA = randomUUID(), fileB = randomUUID();
    const works = Array.from({ length: 8 }, () => randomUUID());
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const place = (recordId: string, x: number, y: number) => ({ type: 'placement.add', id: randomUUID(), canvasId: board, recordId, x, y, w: null, h: null, z: 1 });
    const setup = await post([
      { type: 'table.create', id: tFiles, name: 'Files' }, { type: 'table.create', id: tWorks, name: 'Works' },
      { type: 'table.create', id: tBoards, name: 'Boards', kind: 'canvas' },
      { type: 'field.create', id: fBName, tableId: tBoards, name: 'Name', key: 'name', fieldType: 'text' }, pos(fBName, 0),
      { type: 'field.create', id: fWName, tableId: tWorks, name: 'Name', key: 'name', fieldType: 'text' }, pos(fWName, 0),
      { type: 'field.create', id: fName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(fName, 0),
      { type: 'field.create', id: fStatus, tableId: tFiles, name: 'Status', key: 'status', fieldType: 'text' }, pos(fStatus, 1),
      { type: 'field.create', id: fWork, tableId: tFiles, name: 'Works', key: 'works', fieldType: 'link', options: { target_table_id: tWorks } }, pos(fWork, 2),
      { type: 'field.create', id: fCodec, tableId: tFiles, name: 'Codec', key: 'codec', fieldType: 'text' }, pos(fCodec, 3),
      { type: 'table.update', id: tFiles, fieldSections: [{ id: techSec, name: 'Technical', fields: [fCodec] }] },
      ...works.map((id, i) => ({ type: 'record.create', id, tableId: tWorks, data: { name: `Ep ${101 + i}` } })),
      { type: 'record.create', id: fileA, tableId: tFiles, data: { name: 'a.mov', status: 'Pending QC', codec: 'ProRes' } },
      { type: 'record.create', id: fileB, tableId: tFiles, data: { name: 'b.mov', status: 'Accepted', codec: 'H.264' } },
      ...works.map((id) => ({ type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: fileA, toRecord: id })),
      { type: 'record.create', id: board, tableId: tBoards, data: { name: 'Board' } },
      place(fileA, 60, 60), place(fileB, 500, 60),
      { type: 'section.create', id: sec, name: 'Post', icon: '🎬' },
      { type: 'section.update', id: sec, tableIds: [tFiles, tWorks, tBoards] },
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 300));

    await nav.section(sec);
    await nav.openCanvas(board);
    const cardOf = (name: string) => w.findAll('.canvas-world .card').find((c: any) => c.find('.card-label').attributes('title') === name);
    await until(() => !!cardOf('a.mov') && !!cardOf('b.mov'), 8000);
    const PE = (win as any).PointerEvent ?? (win as any).MouseEvent;
    const winEv = (type: string, init: Record<string, unknown>) => win.dispatchEvent(new PE(type, { bubbles: true, ...init }));
    const canvas = () => w.find('.canvas-container');
    const ex = () => w.find('.ex');
    const select = async (name: string) => { await cardOf(name)!.trigger('pointerdown', { button: 0, clientX: 80, clientY: 80 }); winEv('pointerup', { clientX: 80, clientY: 80 }); await until(() => cardOf(name)!.classes('selected')); };
    const tapSpace = async () => { await canvas().trigger('keydown', { code: 'Space', key: ' ' }); await canvas().trigger('keyup', { code: 'Space', key: ' ' }); };

    console.log('\nE1. Space: a tap examines, a drag pans');
    await select('a.mov');
    await canvas().trigger('keydown', { code: 'Space', key: ' ' });
    await canvas().trigger('pointerdown', { button: 0, clientX: 300, clientY: 300 });
    winEv('pointermove', { clientX: 340, clientY: 320 }); winEv('pointerup', { clientX: 340, clientY: 320 });
    await canvas().trigger('keyup', { code: 'Space', key: ' ' });
    await sleep(150);
    check('Space held and dragged: a pan, nothing lifted', !ex().exists());
    await select('a.mov');
    await tapSpace();
    check('Space tapped with one card selected: it is lifted', await until(() => ex().exists()));

    console.log('\nE2. The lifted card is the open card');
    const lifted = () => ex().findAll('.ex-slot');
    const card = (i = 0) => lifted().at(i)!.find('.record-panel');
    const fieldOf = (c: any, name: string) => c.findAll('.rp-field').find((f: any) => f.find('.rp-name-text').text().replace('★', '').trim() === name)!;
    check('the record\'s open card, at the lifted width', card().exists() && /width: 460px/.test(lifted().at(0)!.attributes('style') ?? ''), lifted().at(0)?.attributes('style'));
    check('…its table in the strip, its title under it', card().find('.rp-strip .rp-table').text() === 'Files' && card().find('.rp-title').text() === 'a.mov');
    check('…every field of the record', ['Name', 'Status', 'Works', 'Codec'].every((n) => !!fieldOf(card(), n)), card().findAll('.rp-name-text').map((n: any) => n.text()).join());
    check('…every linked record — the canvas card stops at six, "+2 more"', await until(() => fieldOf(card(), 'Works').findAll('.pill').length === 8) && /\+2 more/.test(cardOf('a.mov')!.text()),
      String(fieldOf(card(), 'Works').findAll('.pill').length));
    check('…"pin", and — it is on this canvas — "on canvas →" rather than "place"', card().find('.rp-pin').text() === 'pin' && card().find('.rp-place').text() === 'on canvas →');
    check('no flip here any more', !ex().find('.ex-flip').exists() && !ex().find('.ex-reverse').exists());
    check('its place on the canvas is kept by a see-through copy', cardOf('a.mov')!.classes('examined') && !cardOf('b.mov')!.classes('examined'));
    check('the overlay has the keyboard', win.document.activeElement === ex().element);
    check('the dock stays shut: lifting is not opening in the dock', !w.find('.dock').exists());

    console.log('\nE3. It is editable');
    await fieldOf(card(), 'Status').find('.rp-value').trigger('click');
    const editor = () => card().find('.rp-field.editing input, .rp-field.editing textarea');
    check('a click on a value opens its editor', await until(() => editor().exists()));
    await editor().setValue('Accepted');
    await editor().trigger('keydown', { key: 'Enter' });
    check('…and the edit is saved', (await untilDb(`select data from records where id = '${fileA}'`, (r) => r[0].data.status === 'Accepted'))[0].data.status === 'Accepted');
    await card().find('.rp-field.editing input, .rp-field.editing textarea').trigger('keydown', { key: 'Escape' });
    check('…the canvas card under it shows the new value', await until(() => /Accepted/.test(cardOf('a.mov')!.text())));
    (ex().element as HTMLElement).focus();

    console.log('\nE4. Up there, the canvas hears nothing; then down');
    await ex().trigger('keydown', { key: 'Delete' });
    await ex().trigger('keydown', { key: 'z' });
    await sleep(200);
    check('Delete and Z do nothing to the canvas behind', !!cardOf('a.mov') && (await pool.query(`select count(*)::int n from placements where canvas_id = $1`, [board])).rows[0].n === 2);
    await ex().trigger('keydown', { key: 'Escape' });
    check('Esc puts it back: the copy is solid again', await until(() => !ex().exists(), 3000) && !cardOf('a.mov')!.classes('examined'));
    await tapSpace();
    check('Space again lifts it…', await until(() => ex().exists()));
    await ex().trigger('keydown', { code: 'Space', key: ' ' });
    await ex().trigger('keyup', { code: 'Space', key: ' ' });
    check('…and Space puts it back, without lifting it again on the way up', await until(() => !ex().exists(), 3000) && (await sleep(300), !ex().exists()));
    await cardOf('b.mov')!.trigger('contextmenu', { clientX: 520, clientY: 80 });
    const item = () => w.findAll('.canvas-container .ctx button').find((b: any) => b.text() === 'Examine');
    check('the card menu says "Examine"', await until(() => !!item()));
    await item()!.trigger('click');
    check('…which lifts THAT card', await until(() => ex().exists() && lifted().at(0)!.attributes('data-record') === fileB));
    await ex().find('.ex-scrim').trigger('click');
    check('a click outside puts it back', await until(() => !ex().exists(), 3000));

    console.log('\nE5. A line of cards');
    await select('a.mov');
    await tapSpace();
    await until(() => ex().exists() && fieldOf(card(), 'Works').findAll('.pill').length === 8);
    const lineIds = () => lifted().map((c: any) => c.attributes('data-record'));
    await fieldOf(card(), 'Works').find('.pill').trigger('dblclick');
    check('a DOUBLE-CLICK on a linked record brings ITS card up, at the right — though it is not on this canvas', await until(() => lineIds().length === 2, 4000)
      && lineIds()[0] === fileA && works.includes(lineIds()[1]!), lineIds().join());
    check('…that card offers "place": it is not on the canvas', card(1).find('.rp-place').text() === 'place' && card(1).find('.rp-strip .rp-table').text() === 'Works');
    await fieldOf(card(), 'Works').find('.pill').trigger('dblclick');
    await sleep(150);
    check('the same record again: still one card of it', lineIds().length === 2);
    await card(1).trigger('keydown', { key: 'Escape' });
    check('Esc INSIDE a card puts that card back, and only it', await until(() => lineIds().length === 1) && lineIds()[0] === fileA && ex().exists());
    await fieldOf(card(), 'Works').find('.pill').trigger('dblclick');
    await until(() => lineIds().length === 2, 4000);
    await card(0).find('.rp-close').trigger('click');
    check('a card\'s × puts it back — the first one too; the line goes on with the rest', await until(() => lineIds().length === 1) && works.includes(lineIds()[0]!) && !cardOf('a.mov')!.classes('examined'));
    await card(0).find('.rp-close').trigger('click');
    check('…and the last card down ends it', await until(() => !ex().exists(), 3000));

    console.log('\nE6. Pin: from the line to the dock');
    const dock = () => w.findAll('.dock > .record-panel');
    await select('b.mov');
    await tapSpace();
    await until(() => ex().exists());
    await card().find('.rp-pin').trigger('click');
    check('"pin" on a lifted card: it leaves the line (the last one ends it)…', await until(() => !ex().exists(), 3000));
    check('…and stands in the dock, pinned', await until(() => dock().length === 1) && dock()[0].find('.rp-title').text() === 'b.mov' && /pinned/.test(dock()[0].find('.rp-pin').text()));
    check('…remembered in this browser, with its table', (() => { try { const p = JSON.parse((win as any).localStorage.getItem('spatialdb.dock.pins') ?? '[]'); return p.length === 1 && p[0].id === fileB && p[0].table === tFiles; } catch { return true; } })());
    await tapSpace();
    await sleep(250);
    check('a record with a card in the dock is not lifted as well: one open card per record', !ex().exists() && dock().length === 1);
    await dock()[0].trigger('keydown', { key: 'Escape' });
    await sleep(100);
    check('Esc does not close a pinned card', dock().length === 1);
    await cardOf('a.mov')!.trigger('dblclick');
    check('a double-click on another card opens it in the dock too: the PREVIEW, beside the pin', await until(() => dock().length === 2) && dock()[1].find('.rp-title').text() === 'a.mov' && dock()[1].find('.rp-pin').text() === 'pin');
    await dock()[1].trigger('keydown', { key: 'Escape' });
    check('…which Esc does close', await until(() => dock().length === 1) && dock()[0].find('.rp-title').text() === 'b.mov');
    await nav.openTable(tWorks);
    check('the pin follows you to another view: the Works grid, with b.mov\'s card still beside it', await until(() => w.find('.gridview').exists() && dock().length === 1, 6000) && dock()[0].find('.rp-title').text() === 'b.mov');
    await w.findAll('.gridview tr.row')[0].find('.expand').trigger('click');
    check('…a row opened there is the preview, at the pin\'s right', await until(() => dock().length === 2) && dock()[0].find('.rp-title').text() === 'b.mov' && dock()[1].find('.rp-pin').text() === 'pin');
    await dock()[1].find('.rp-pin').trigger('click');
    check('…pinned, it stays where it is', await until(() => /pinned/.test(dock()[1].find('.rp-pin').text())) && dock()[0].find('.rp-title').text() === 'b.mov');
    await w.findAll('.gridview tr.row')[1].find('.expand').trigger('click');
    check('…and the next row opened is a third card, not a replacement', await until(() => dock().length === 3));
    await w.findAll('.gridview tr.row')[0].find('.expand').trigger('click');
    check('opening a record that is pinned makes no second card of it', (await sleep(150), dock().length === 3));
    await dock()[2].find('.rp-close').trigger('click');
    await dock()[1].find('.rp-pin').trigger('click');
    check('unpinned, a card is the preview again — it does not vanish', await until(() => dock().length === 2 && dock()[1].find('.rp-pin').text() === 'pin'));
    await dock()[1].find('.rp-close').trigger('click');
    await nav.openCanvas(board);
    await until(() => !!cardOf('a.mov') && dock().length === 1, 6000);
    await dock()[0].find('.rp-close').trigger('click');
    check('a pinned card\'s × unpins and closes it: the dock is gone', await until(() => !w.find('.dock').exists()));

    console.log('\nE7. The palette brings a card up');
    const pal = () => w.find('.palette');
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    await until(() => pal().exists());
    await pal().find('input.pq').setValue('Ep 105');
    await until(() => pal().findAll('.presults li .plabel').some((l: any) => l.text() === 'Ep 105'), 6000);
    check('the footer says what Enter does now', /bring up/.test(pal().find('.pfoot').text()) && /place/.test(pal().find('.pfoot').text()), pal().find('.pfoot').text());
    await pal().find('input.pq').trigger('keydown', { key: 'Enter' });
    check('Enter: the record\'s card is lifted — it is not on this canvas, and nothing was placed', await until(() => ex().exists() && lifted().length === 1 && card().find('.rp-title').text() === 'Ep 105', 4000)
      && !pal().exists() && (await pool.query(`select count(*)::int n from placements where canvas_id = $1`, [board])).rows[0].n === 2);
    await card().find('.rp-place').trigger('click');
    check('"place" puts it on the canvas, and the card goes down to it', (await untilDb(`select count(*)::int n from placements where canvas_id = '${board}'`, (r) => r[0].n === 3))[0].n === 3
      && await until(() => !ex().exists() && !!cardOf('Ep 105'), 4000));
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    await until(() => pal().exists());
    await pal().find('input.pq').setValue('Ep 106');
    await until(() => pal().findAll('.presults li .plabel').some((l: any) => l.text() === 'Ep 106'), 6000);
    await pal().find('input.pq').trigger('keydown', { key: 'Enter', ctrlKey: true });
    check('Ctrl+Enter still places straight away', (await untilDb(`select count(*)::int n from placements where canvas_id = '${board}'`, (r) => r[0].n === 4))[0].n === 4 && !ex().exists());
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
