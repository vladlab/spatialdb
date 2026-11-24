/**
 * OPEN CARDS (client/hand.ts; Nov 23 2026), in the app: lifted, the hand, pinned.
 *
 *   E1  Space TAPPED on a selected card lifts it; Space held and dragged pans and does not
 *   E2  the lifted card is the record's OPEN card: its strip, its whole title, every
 *       field, every link; its place on the canvas kept by a see-through copy
 *   E3  it is EDITABLE
 *   E4  while it is up the canvas hears nothing (Delete, Z); Esc, Space or a click
 *       outside put it down; "Examine" in the card menu
 *   E5  a LINE: a double-click on a linked record brings its card up at the right, once;
 *       a card's own × (or Esc inside it) puts that one down
 *   E6  THE HAND: H, the card menu, a lifted card's chip and a drag of its strip put a
 *       record in it; a stub brings its card up, alone or beside others; a record not
 *       in the hand, put down, just goes away
 *   E7  PINNED: the card floats at the right of every view, above it; unpinned it is
 *       back in the hand; a pinned record is not lifted as well; the grid opens rows
 *       by lifting them too, and gets scroll room for what floats over it
 *   E8  the palette: Enter BRINGS A CARD UP; "place" puts it on the canvas
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
    check('…"hand", "pin", and — it is on this canvas — "on canvas →" rather than "place"', card().find('.rp-pin').text() === 'pin' && card().find('.rp-hand').text() === 'hand' && card().find('.rp-place').text() === 'on canvas →');
    check('no flip here any more', !ex().find('.ex-flip').exists() && !ex().find('.ex-reverse').exists());
    check('its place on the canvas is kept by a see-through copy', cardOf('a.mov')!.classes('examined') && !cardOf('b.mov')!.classes('examined'));
    check('the overlay has the keyboard', win.document.activeElement === ex().element);
    check('lifting keeps nothing: the hand is still empty, nothing is pinned', !w.find('.hand').exists() && !w.find('.pins').exists());

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

    console.log('\nE6. The hand');
    const stubs = () => w.findAll('.hand .stub');
    const stub = (name: string) => stubs().find((x: any) => x.find('.stub-name').text() === name);
    const stored = () => { try { return JSON.parse((win as any).localStorage.getItem('spatialdb.hand') ?? '[]'); } catch { return null; } };
    await select('b.mov');
    await w.find('.canvas-container').trigger('keydown', { key: 'h' });
    check('H on a selected card: its record is in the hand — a stub with its table and its name', await until(() => stubs().length === 1)
      && stub('b.mov')!.find('.stub-table').text() === 'Files', stubs().map((x: any) => x.text()).join());
    check('…remembered in this browser, with its table', (() => { const h = stored(); return h === null || (h.length === 1 && h[0].id === fileB && h[0].table === tFiles); })());
    check('…and its card on the canvas is marked; it has not moved', cardOf('b.mov')!.find('.card-held').exists() && !cardOf('a.mov')!.find('.card-held').exists()
      && (await pool.query(`select count(*)::int n from placements where canvas_id = $1`, [board])).rows[0].n === 2);
    await w.find('.canvas-container').trigger('keydown', { key: 'h' });
    check('H again takes it out; the strip goes with its last stub', await until(() => !w.find('.hand').exists()));
    await cardOf('b.mov')!.trigger('contextmenu', { clientX: 520, clientY: 80 });
    await until(() => w.find('.canvas-container .ctx .to-hand').exists());
    check('the card menu says "To hand"', w.find('.canvas-container .ctx .to-hand').text() === 'To hand');
    await w.find('.canvas-container .ctx .to-hand').trigger('click');
    await until(() => stubs().length === 1);
    // from a lifted card: its chip
    await select('a.mov');
    await tapSpace();
    await until(() => ex().exists());
    await card().find('.rp-hand').trigger('click');
    check('a lifted card\'s "hand" chip keeps its record: a second stub, at the end, marked "up"', await until(() => stubs().length === 2) && stubs()[1].find('.stub-name').text() === 'a.mov'
      && stubs()[1].classes('up') && stubs()[1].find('.stub-state').text() === 'up' && /in hand/.test(card().find('.rp-hand').text()));
    await ex().trigger('keydown', { key: 'Escape' });
    check('put down, its stub stays', await until(() => !ex().exists(), 3000) && stubs().length === 2 && !stub('a.mov')!.classes('up'));
    await stub('a.mov')!.find('.stub-main').trigger('click');
    check('a click on a stub brings its card up', await until(() => ex().exists() && lineIds().join() === fileA));
    await stub('b.mov')!.find('.stub-main').trigger('click', { ctrlKey: true });
    check('Ctrl+click on another brings that one up BESIDE it', await until(() => lineIds().join() === [fileA, fileB].join()), lineIds().join());
    await stub('a.mov')!.find('.stub-main').trigger('click');
    check('a click on the stub of a card that is up puts that card down', await until(() => lineIds().join() === fileB) && !stub('a.mov')!.classes('up'));
    await stub('a.mov')!.find('.stub-main').trigger('click');
    check('a plain click brings its card up ALONE', await until(() => lineIds().join() === fileA));
    await w.find('.hand .hand-all').trigger('click');
    check('"all up": the whole hand, side by side', await until(() => lineIds().join() === [fileB, fileA].join()), lineIds().join());
    await ex().find('.ex-scrim').trigger('click');
    await until(() => !ex().exists(), 3000);
    // a record that is NOT in the hand: up, then down, and it is gone
    await stub('a.mov')!.find('.stub-main').trigger('click');
    await until(() => ex().exists() && fieldOf(card(), 'Works').findAll('.pill').length === 8);
    await fieldOf(card(), 'Works').find('.pill').trigger('dblclick');
    await until(() => lineIds().length === 2, 4000);
    const workUp = lineIds()[1]!;
    check('a card brought up from a link is not in the hand', stubs().length === 2 && card(1).find('.rp-hand').text() === 'hand');
    // …unless its strip is DRAGGED to the hand
    // (PE: the pointer event class, declared with E1's helpers)
    const handEl = w.find('.hand').element as HTMLElement;
    handEl.getBoundingClientRect = () => ({ left: 0, right: 1200, top: 760, bottom: 794, width: 1200, height: 34, x: 0, y: 760, toJSON() {} }) as DOMRect;
    await card(1).find('.rp-strip').trigger('pointerdown', { button: 0, clientX: 700, clientY: 100 });
    win.dispatchEvent(new PE('pointermove', { bubbles: true, clientX: 700, clientY: 400 }));
    check('dragging a lifted card\'s strip: a stub follows the pointer and the hand offers itself', await until(() => w.find('.hand-ghost').exists() && w.find('.hand').classes('dropping') && w.find('.hand .hand-drop').exists()));
    win.dispatchEvent(new PE('pointermove', { bubbles: true, clientX: 700, clientY: 775 }));
    await until(() => w.find('.hand').classes('over'));
    win.dispatchEvent(new PE('pointerup', { bubbles: true, clientX: 700, clientY: 775 }));
    check('…let go over the hand: the record is kept there, and its card goes down', await until(() => stubs().length === 3 && lineIds().join() === fileA) && stubs()[2].attributes('data-record') === workUp && !w.find('.hand-ghost').exists());
    await stubs()[2].find('.stub-x').trigger('click');
    check('a stub\'s × takes it out of the hand', await until(() => stubs().length === 2));
    await ex().trigger('keydown', { key: 'Escape' });
    await until(() => !ex().exists(), 3000);

    console.log('\nE7. Pinned: floating at the right');
    const pinsEl = () => w.findAll('.stage > .pins > .record-panel');
    await stub('b.mov')!.find('.stub-main').trigger('click');
    await until(() => ex().exists());
    await card().find('.rp-pin').trigger('click');
    check('"pin" on a lifted card: it leaves the line…', await until(() => !ex().exists(), 3000));
    check('…and floats at the right — a layer of the stage over the body, not a column beside it', await until(() => pinsEl().length === 1) && pinsEl()[0].find('.rp-title').text() === 'b.mov'
      && /pinned/.test(pinsEl()[0].find('.rp-pin').text()) && !pinsEl()[0].find('.rp-hand').exists());
    check('its stub stays in the hand, marked pinned', stubs().length === 2 && stub('b.mov')!.classes('pinned') && /pinned/.test(stub('b.mov')!.find('.stub-pin').text()) && stored()?.find((h: any) => h.id === fileB)?.pinned !== false);
    await select('b.mov');
    await tapSpace();
    await sleep(250);
    check('a pinned record is not lifted as well: one open card per record — its pinned card rings', !ex().exists() && pinsEl().length === 1 && pinsEl()[0].classes('current'));
    await pinsEl()[0].trigger('keydown', { key: 'Escape' });
    await sleep(100);
    check('Esc does not close a pinned card', pinsEl().length === 1);
    await cardOf('a.mov')!.trigger('dblclick');
    check('a double-click on a canvas card LIFTS it now (there is no preview slot), the pinned card staying', await until(() => ex().exists() && lineIds().join() === fileA) && pinsEl().length === 1);
    await ex().trigger('keydown', { key: 'Escape' });
    await until(() => !ex().exists(), 3000);
    await nav.openTable(tWorks);
    check('the pin and the hand follow you to another view: the Works grid', await until(() => w.find('.gridview').exists() && pinsEl().length === 1 && stubs().length === 2, 6000));
    check('…whose table is given scroll room for what floats over its right edge', /border-right(-width)?: \d+px/.test(w.find('.gridview table.grid').attributes('style') ?? ''), w.find('.gridview table.grid').attributes('style'));
    await w.findAll('.gridview tr.row')[0].find('.expand').trigger('click');
    check('a row opened there is LIFTED too', await until(() => ex().exists() && lifted().length === 1 && card().find('.rp-strip .rp-table').text() === 'Works'));
    check('…with nowhere to place it: no "place" chip off a canvas', !card().find('.rp-place').exists());
    await card().find('.rp-close').trigger('click');
    check('…and put down it is gone: not in the hand, nothing open', await until(() => !ex().exists(), 3000) && stubs().length === 2 && !w.find('.gridview tr.row.opened').exists());
    await w.findAll('.gridview tr.row')[0].trigger('contextmenu', { clientX: 300, clientY: 200 });
    await until(() => w.find('.row-menu .to-hand').exists());
    await w.find('.row-menu .to-hand').trigger('click');
    check('a row\'s menu has "To hand" as well', await until(() => stubs().length === 3) && stubs()[2].find('.stub-table').text() === 'Works');
    await stubs()[2].find('.stub-x').trigger('click');
    await pinsEl()[0].find('.rp-pin').trigger('click');
    check('unpinned, the card is back in the hand: gone from the right, its stub where it was', await until(() => !w.find('.pins').exists()) && stubs().length === 2 && stubs()[0].find('.stub-name').text() === 'b.mov' && !stubs()[0].classes('pinned'));
    check('…and the grid\'s scroll room goes with it', !/border-right/.test(w.find('.gridview table.grid').attributes('style') ?? ''));
    await stub('b.mov')!.find('.stub-pin').trigger('click');
    check('a stub\'s own "pin" floats its card without lifting it first', await until(() => pinsEl().length === 1) && !ex().exists());
    await pinsEl()[0].find('.rp-close').trigger('click');
    check('a pinned card\'s × sends it back to the hand, not away', await until(() => !w.find('.pins').exists()) && stubs().length === 2);
    await stub('a.mov')!.find('.stub-x').trigger('click');
    await stub('b.mov')!.find('.stub-x').trigger('click');
    await until(() => !w.find('.hand').exists());
    await nav.openCanvas(board);
    await until(() => !!cardOf('a.mov'), 6000);

    console.log('\nE8. The palette brings a card up');
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
