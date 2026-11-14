/**
 * EXAMINE and FLIP (CANVAS-BRIEF.md C1–C3), in the app.
 *
 *   E1  Space TAPPED on a selected card lifts it; Space held and dragged pans and does not
 *   E2  the lifted card: fixed size, no handles, every line of its lists; its place on
 *       the canvas kept by a see-through copy
 *   E3  F flips it; the back lists every field under its section names — or the
 *       table's chosen fields, in order (Table settings › Card back, one Ctrl+Z)
 *   E4  while it is up the canvas hears nothing (Delete, Z); Esc, Space or the scrim
 *       put it back; "Examine" in the card menu; a pill on the back opens that record
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

    console.log('\nE2. The lifted card');
    const front = () => ex().find('.ex-front .card');
    check('a fixed size, whatever the zoom: 380 × 520', /width: 380px/.test(front().attributes('style') ?? '') && /height: 520px/.test(front().attributes('style') ?? ''), front().attributes('style'));
    check('…no handles, no ×, no fold: it is being looked at, not edited', !front().find('.handle').exists() && !front().find('.card-unplace').exists() && !front().find('.card-fold').exists() && !front().find('.link-handle').exists());
    const worksPills = () => front().findAll('.card-field').find((r: any) => r.find('.card-key').text() === 'Works')!;
    check('…every line of a list — the canvas card stops at six, "+2 more"', worksPills().findAll('.pill').length === 8 && !worksPills().find('.more').exists()
      && /\+2 more/.test(cardOf('a.mov')!.text()), String(worksPills().findAll('.pill').length));
    check('its place on the canvas is kept by a see-through copy', cardOf('a.mov')!.classes('examined') && !cardOf('b.mov')!.classes('examined'));
    check('it owns the keyboard: focus is on it', win.document.activeElement === ex().element);

    console.log('\nE3. Flip, and the back');
    await ex().trigger('keydown', { key: 'f' });
    check('F flips it', ex().find('.ex-flip').classes('flipped'));
    const backRows = () => ex().findAll('.ex-back .ex-row').map((r: any) => `${r.find('.ex-key').text()}=${r.find('.ex-val').text().replace(/\s+/g, ' ').trim()}`);
    const backHeads = () => ex().findAll('.ex-back .ex-sec').map((r: any) => r.text());
    check('the back, by default: every field but the title, in schema order', backRows().map((r: string) => r.split('=')[0]).join() === 'Status,Works,Codec', backRows().join(' | '));
    check('…under the table\'s section names', backHeads().join() === 'Technical');
    check('…values as they are: text, every linked record as a pill', backRows()[0] === 'Status=Pending QC' && ex().findAll('.ex-back .ex-pills .pill').length === 8);
    await ex().find('.ex-back .ex-back-title').trigger('click');
    check('a click on the card flips it back', !ex().find('.ex-flip').classes('flipped'));

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
    check('…which lifts THAT card', await until(() => ex().exists() && ex().find('.ex-front .card').attributes('data-record') === fileB));
    await ex().find('.ex-scrim').trigger('click');
    check('a click outside puts it back', await until(() => !ex().exists(), 3000));

    console.log('\nE5. The back, chosen');
    await post([{ type: 'table.update', id: tFiles, cardBack: [fCodec, fStatus] }]);
    await nav.tableSettings(tFiles);
    check('Table settings › Card back says "chosen fields", ticked in that order', await until(() => w.find('.ts .cb-list').exists(), 8000)
      && w.findAll('.ts .cb-row').map((r: any) => `${(r.find('input').element as HTMLInputElement).checked ? '+' : '-'}${r.find('.cb-on').text().trim()}`).join() === '+Codec,+Status,-Name,-Works',
      w.findAll('.ts .cb-row').map((r: any) => r.text()).join('|'));
    await w.findAll('.ts .cb-row').at(1)!.find('.cb-mv[aria-label="Move Status up"]').trigger('click');
    check('↑ reorders it — saved on the table', JSON.stringify((await untilDb(`select card_back from tables where id = '${tFiles}'`, (r) => r[0].card_back?.[0] === fStatus))[0].card_back) === JSON.stringify([fStatus, fCodec]));
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    check('one Ctrl+Z puts the order back', JSON.stringify((await untilDb(`select card_back from tables where id = '${tFiles}'`, (r) => r[0].card_back?.[0] === fCodec))[0].card_back) === JSON.stringify([fCodec, fStatus]));
    await w.find('.ts .x').trigger('click');
    await select('b.mov');
    await tapSpace();
    await until(() => ex().exists());
    await ex().trigger('keydown', { key: 'F' });
    check('the back now shows those fields, in that order, no section headings', backRows().join() === 'Codec=H.264,Status=Accepted' && !backHeads().length, backRows().join());
    await ex().trigger('keydown', { key: 'Escape' });
    await until(() => !ex().exists(), 3000);

    await select('a.mov');
    await post([{ type: 'table.update', id: tFiles, cardBack: [fWork] }]);
    await tapSpace();
    await until(() => ex().exists());
    await ex().trigger('keydown', { key: 'f' });
    check('the back shows the chosen link field\'s pills', await until(() => ex().findAll('.ex-back .ex-pills .pill').length === 8), ex().exists() ? ex().find('.ex-back').html().slice(0, 400) : 'not lifted');
    await ex().find('.ex-back .ex-pills .pill').trigger('dblclick');
    check('a double-click on a pill on the back opens that record — and the card goes back down', await until(() => w.find('.record-panel').exists() && /^Ep 10\d$/.test(w.find('.record-panel .rp-title').text()), 8000)
      && await until(() => !ex().exists(), 3000), w.find('.record-panel').exists() ? w.find('.record-panel .rp-title').text() : 'no tray');
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
