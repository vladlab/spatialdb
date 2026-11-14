/**
 * The card's FRONT in the app (CANVAS-BRIEF.md B1, B4). Pure rules: test/cardfront.ts.
 *
 *   W1  a long filename wraps: 320px wide, drawn as the computed lines, the card's
 *       height counts them; a folded card keeps them
 *   W2  the compare button: none / pass / fail, in words; a click opens the tray with
 *       the side by side open; "Compare with target" in the card menu does the same
 */
import { randomUUID } from 'node:crypto';
import { cardHeight, lineCount, titleHeight, CARD_W_DEFAULT_MAX } from '../src/client/canvas/cardLayout.js';
import { mountApp, sleep } from './uiHarness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8864));
  const { w, until, post, nav } = ui;
  try {
    const tFiles = randomUUID(), tDelivs = randomUUID(), tBoards = randomUUID(), sec = randomUUID();
    const fName = randomUUID(), fCodec = randomUUID(), fTarget = randomUUID(), fDName = randomUUID(), fDCodec = randomUUID(), fBName = randomUUID();
    const board = randomUUID(), spec = randomUUID();
    const fLong = randomUUID(), fPass = randomUUID(), fFail = randomUUID(), fNone = randomUUID();
    const LONG = 'SHOW_EP101_TextedMaster_ProRes4444XQ_UHD_2398_20261112.mov';
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const link = (from: string, to: string) => ({ type: 'link.add', id: randomUUID(), fieldId: fTarget, fromRecord: from, toRecord: to });
    const place = (recordId: string, x: number, y: number) => ({ type: 'placement.add', id: randomUUID(), canvasId: board, recordId, x, y, w: null, h: null, z: 1 });
    const setup = await post([
      { type: 'table.create', id: tFiles, name: 'Files' }, { type: 'table.create', id: tDelivs, name: 'Deliverables' },
      { type: 'table.create', id: tBoards, name: 'Boards', kind: 'canvas' },
      { type: 'field.create', id: fBName, tableId: tBoards, name: 'Name', key: 'name', fieldType: 'text' }, pos(fBName, 0),
      { type: 'field.create', id: fDName, tableId: tDelivs, name: 'Name', key: 'name', fieldType: 'text' }, pos(fDName, 0),
      { type: 'field.create', id: fDCodec, tableId: tDelivs, name: 'Codec', key: 'codec', fieldType: 'text' }, pos(fDCodec, 1),
      { type: 'field.create', id: fName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(fName, 0),
      { type: 'field.create', id: fCodec, tableId: tFiles, name: 'Codec', key: 'codec', fieldType: 'text' }, pos(fCodec, 1),
      { type: 'field.create', id: fTarget, tableId: tFiles, name: 'Deliverable', key: 'deliverable', fieldType: 'link',
        options: { target_table_id: tDelivs, single: true, compare: { pairs: [{ from: fCodec, to: fDCodec, rule: 'equals' }] } } }, pos(fTarget, 2),
      { type: 'record.create', id: spec, tableId: tDelivs, data: { name: 'Texted ProRes UHD', codec: 'ProRes 4444 XQ' } },
      { type: 'record.create', id: fLong, tableId: tFiles, data: { name: LONG, codec: 'ProRes 4444 XQ' } },
      { type: 'record.create', id: fPass, tableId: tFiles, data: { name: 'pass.mov', codec: 'ProRes 4444 XQ' } },
      { type: 'record.create', id: fFail, tableId: tFiles, data: { name: 'fail.mov', codec: 'H.264' } },
      { type: 'record.create', id: fNone, tableId: tFiles, data: { name: 'none.mov', codec: 'H.264' } },
      link(fLong, spec), link(fPass, spec), link(fFail, spec),
      { type: 'record.create', id: board, tableId: tBoards, data: { name: 'Delivery board' } },
      place(fLong, 60, 60), place(fPass, 500, 60), place(fFail, 500, 260), place(fNone, 500, 460),
      { type: 'section.create', id: sec, name: 'Post', icon: '🎬' },
      { type: 'section.update', id: sec, tableIds: [tFiles, tDelivs, tBoards] },
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 300));

    await nav.section(sec);
    const listed = await until(() => nav.canvasNames().includes('Delivery board'), 8000);
    check('the board is listed', listed, JSON.stringify(nav.canvasNames()) + ' ' + w.find('.tree').text().slice(0, 300));
    await nav.openCanvas(board);
    const cardOf = (id: string) => w.findAll('.canvas-world .card').find((c: any) => c.find('.card-label').attributes('title') === ({ [fLong]: LONG, [fPass]: 'pass.mov', [fFail]: 'fail.mov', [fNone]: 'none.mov' } as Record<string, string>)[id]);
    await until(() => !!cardOf(fLong) && !!cardOf(fNone), 8000);

    console.log('\nW1. Titles wrap');
    const long = cardOf(fLong)!;
    const style = () => cardOf(fLong)!.attributes('style') ?? '';
    const lines = long.findAll('.card-label-line').map((l: any) => l.text());
    check('a long filename is 320px wide — no longer as wide as its name', style().includes(`width: ${CARD_W_DEFAULT_MAX}px`), style().slice(0, 80));
    check('…and drawn as several lines that join back into the whole name', lines.length > 1 && lines.join('') === LONG, JSON.stringify(lines));
    const rows = long.findAll('.card-field').length;
    check('the card\'s height counts the title lines (the arithmetic the arrows use)', style().includes(`height: ${cardHeight(lineCount(Array(rows).fill({})), false, 0, lines.length)}px`)
      && style().includes(`--title-h: ${titleHeight(lines.length)}px`), style());
    check('a short title is one line, at today\'s height', cardOf(fPass)!.findAll('.card-label-line').length === 1);
    await long.find('.card-fold').trigger('click');
    check('folded, the title still wraps — the same lines', await until(() => cardOf(fLong)!.classes().includes('collapsed'))
      && cardOf(fLong)!.findAll('.card-label-line').length === lines.length && style().includes(`height: ${cardHeight(0, true, 0, lines.length)}px`), style());
    await cardOf(fLong)!.find('.card-fold').trigger('click');

    console.log('\nW2. The compare button');
    const btn = (id: string) => cardOf(id)?.find('.card-compare');
    check('every File card has one — Files has a comparing link', [fLong, fPass, fFail, fNone].every((id) => btn(id)?.exists()));
    check('matching: pass, "match"', await until(() => btn(fPass)!.classes().includes('pass') && btn(fPass)!.find('.card-compare-word').text() === 'match', 8000), btn(fPass)!.text());
    check('a difference: fail, "1 differ", in words not just colour', btn(fFail)!.classes().includes('fail') && btn(fFail)!.find('.card-compare-word').text() === '1 differ' && btn(fFail)!.find('.verdict-mark').exists());
    check('nothing linked: "no target", inert', btn(fNone)!.classes().includes('none') && btn(fNone)!.find('.card-compare-word').text() === 'no target' && btn(fNone)!.attributes('disabled') !== undefined);
    check('the tooltip says where and what', /Deliverable → Texted ProRes UHD: 1 difference/.test(btn(fFail)!.attributes('title') ?? ''), btn(fFail)!.attributes('title'));

    await btn(fFail)!.trigger('click');
    check('click: the tray opens on that file, its side by side already open', await until(() => w.find('.record-panel .sbs').exists() && w.find('.record-panel .rp-title').text() === 'fail.mov', 8000),
      w.find('.record-panel').exists() ? w.find('.record-panel .rp-title').text() : 'no tray');
    check('…showing the difference', /H\.264/.test(w.find('.record-panel .sbs').text()) && /ProRes 4444 XQ/.test(w.find('.record-panel .sbs').text()));
    await w.find('.record-panel .rp-close').trigger('click');
    await sleep(200);

    await cardOf(fPass)!.trigger('contextmenu', { clientX: 520, clientY: 80 });
    const item = () => w.findAll('.canvas-container .ctx button').find((b: any) => b.text() === 'Compare with target');
    check('the card menu offers "Compare with target"', await until(() => !!item()));
    await item()!.trigger('click');
    check('…which opens the same', await until(() => w.find('.record-panel .sbs').exists() && w.find('.record-panel .rp-title').text() === 'pass.mov', 8000));
    await w.find('.record-panel .rp-close').trigger('click');
    await cardOf(fNone)!.trigger('contextmenu', { clientX: 520, clientY: 480 });
    check('…and does not, for a file with no target', await until(() => w.find('.canvas-container .ctx').exists()) && !item());
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
