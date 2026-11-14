/**
 * The card's FRONT in the app (CANVAS-BRIEF.md B1, B4). Pure rules: test/cardfront.ts.
 *
 *   W1  a long filename wraps: 320px wide, drawn as the computed lines, the card's
 *       height counts them; a folded card keeps them
 *   W2  the compare button: none / pass / fail, in words; a click opens the tray with
 *       the side by side open; "Compare with target" in the card menu does the same
 *   W3  the watermark: set "by a field" in Table settings, Media's values guessed;
 *       cards wear their icon; one Ctrl+Z
 *   W4  a timeline's audio as a mini timeline on its card (counted in its height),
 *       and drawn again at the top of the tray's Audio tracks
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
  const { w, win, until, untilDb, post, nav } = ui;
  try {
    const tFiles = randomUUID(), tDelivs = randomUUID(), tBoards = randomUUID(), sec = randomUUID();
    const fName = randomUUID(), fCodec = randomUUID(), fTarget = randomUUID(), fDName = randomUUID(), fDCodec = randomUUID(), fBName = randomUUID();
    const board = randomUUID(), spec = randomUUID();
    const fLong = randomUUID(), fPass = randomUUID(), fFail = randomUUID(), fNone = randomUUID();
    const fMedia = randomUUID(), tEdits = randomUUID(), fEName = randomUUID(), fEAudio = randomUUID(), oev3 = randomUUID();
    const clip = (name: string, start: string, end: string, path?: string) => ({ name, start, end, frames: 0, ...(path ? { path } : {}) });
    const audio = { tracks: [
      { index: 1, name: 'A1', format: '5.1', clips: [clip('Tone', '00:59:30:00', '01:00:00:00'), clip('Mix 51', '01:00:00:00', '01:52:00:00', '/m/51.wav')] },
      { index: 2, name: 'A2', format: 'stereo', clips: [clip('Tone', '00:59:30:00', '01:00:00:00'), clip('Mix ST', '01:00:00:00', '01:52:00:00', '/m/st.wav')] },
      { index: 3, name: 'A3', format: '5.1', clips: [clip('M&E', '01:00:00:00', '01:52:00:00', '/m/me.wav')] },
    ] };
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
      { type: 'field.create', id: fMedia, tableId: tFiles, name: 'Media', key: 'media', fieldType: 'select', options: { choices: ['video', 'audio', 'image', 'document', 'other'] } }, pos(fMedia, 3),
      { type: 'table.create', id: tEdits, name: 'Edits' },
      { type: 'field.create', id: fEName, tableId: tEdits, name: 'Name', key: 'name', fieldType: 'text' }, pos(fEName, 0),
      { type: 'field.create', id: fEAudio, tableId: tEdits, name: 'Audio tracks', key: 'audio_tracks', fieldType: 'structured', options: { shape: 'timeline_audio' } }, pos(fEAudio, 1),
      { type: 'record.create', id: oev3, tableId: tEdits, data: { name: 'EP101_OEV3', audio_tracks: audio } },
      { type: 'field.create', id: fTarget, tableId: tFiles, name: 'Deliverable', key: 'deliverable', fieldType: 'link',
        options: { target_table_id: tDelivs, single: true, compare: { pairs: [{ from: fCodec, to: fDCodec, rule: 'equals' }] } } }, pos(fTarget, 2),
      { type: 'record.create', id: spec, tableId: tDelivs, data: { name: 'Texted ProRes UHD', codec: 'ProRes 4444 XQ' } },
      { type: 'record.create', id: fLong, tableId: tFiles, data: { name: LONG, codec: 'ProRes 4444 XQ' } },
      { type: 'record.create', id: fPass, tableId: tFiles, data: { name: 'pass.mov', codec: 'ProRes 4444 XQ', media: 'video' } },
      { type: 'record.create', id: fFail, tableId: tFiles, data: { name: 'fail.wav', codec: 'H.264', media: 'audio' } },
      { type: 'record.create', id: fNone, tableId: tFiles, data: { name: 'none.mov', codec: 'H.264' } },
      link(fLong, spec), link(fPass, spec), link(fFail, spec),
      { type: 'record.create', id: board, tableId: tBoards, data: { name: 'Delivery board' } },
      place(fLong, 60, 60), place(fPass, 500, 60), place(fFail, 500, 260), place(fNone, 500, 460), place(oev3, 900, 60),
      { type: 'section.create', id: sec, name: 'Post', icon: '🎬' },
      { type: 'section.update', id: sec, tableIds: [tFiles, tDelivs, tBoards, tEdits] },
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 300));

    await nav.section(sec);
    const listed = await until(() => nav.canvasNames().includes('Delivery board'), 8000);
    check('the board is listed', listed, JSON.stringify(nav.canvasNames()) + ' ' + w.find('.tree').text().slice(0, 300));
    await nav.openCanvas(board);
    const cardOf = (id: string) => w.findAll('.canvas-world .card').find((c: any) => c.find('.card-label').attributes('title') === ({ [fLong]: LONG, [fPass]: 'pass.mov', [fFail]: 'fail.wav', [fNone]: 'none.mov' } as Record<string, string>)[id]);
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
    check('click: the tray opens on that file, its side by side already open', await until(() => w.find('.record-panel .sbs').exists() && w.find('.record-panel .rp-title').text() === 'fail.wav', 8000),
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
    await w.find('.canvas-container').trigger('pointerdown', { button: 0, clientX: 5, clientY: 5 });

    console.log('\nW3. The watermark');
    check('no watermark until one is set', !cardOf(fPass)!.find('.card-watermark').exists());
    await nav.tableSettings(tFiles);
    await until(() => w.find('.ts .wm').exists());
    await w.findAll('.ts .wm-mode input').at(2)!.setValue(true);
    const stored = (await untilDb(`select card_icon from tables where id = '${tFiles}'`, (r) => !!r[0].card_icon?.byField))[0].card_icon;
    check('"by a field" picks the SELECT (Media), not the name, and guesses its values', stored.byField === fMedia && stored.map.video === 'video' && stored.map.audio === 'audio' && stored.map.image === 'sequence', JSON.stringify(stored));
    check('the picker lists Media\'s choices, each with its icon chosen', w.findAll('.ts .wm-row .wm-val').map((x: any) => x.text()).join() === 'video,audio,image,document,other'
      && w.findAll('.ts .wm-row').find((r: any) => r.find('.wm-val').exists() && r.find('.wm-val').text() === 'video')!.find('.wm-sw.on').attributes('aria-label') === 'video: Video');
    await w.find('.ts .x').trigger('click');
    const paths = (id: string) => cardOf(id)?.find('.card-watermark svg').findAll('path').length ?? 0;
    check('a video file\'s card wears the film strip, an audio file\'s the waveform', await until(() => paths(fPass) === 5 && paths(fFail) === 7, 8000), `${paths(fPass)} ${paths(fFail)}`);
    check('a file with no Media value wears none', !cardOf(fNone)!.find('.card-watermark').exists());
    check('…and the watermark is decoration: hidden from screen readers', cardOf(fPass)!.find('.card-watermark').attributes('aria-hidden') === 'true');
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    check('one Ctrl+Z takes it away', (await untilDb(`select card_icon from tables where id = '${tFiles}'`, (r) => r[0].card_icon === null)).length === 1
      && await until(() => !cardOf(fPass)!.find('.card-watermark').exists()));

    console.log('\nW4. The mini timeline');
    const edit = () => w.findAll('.canvas-world .card').find((c: any) => c.find('.card-label').attributes('title') === 'EP101_OEV3');
    check('the Edit card draws its audio as lanes: A1, A2, A3', await until(() => !!edit()?.find('.tls').exists(), 8000)
      && edit()!.findAll('.tls-lane:not(.tls-ticks) .tls-label').map((x: any) => x.text()).join() === 'A1 5.1,A2 stereo,A3 5.1', edit()?.html().slice(0, 300));
    check('…tone then mix on A1, the mixes lined up across lanes', edit()!.findAll('.tls-lane').at(0)!.findAll('.tls-clip').length === 2
      && edit()!.findAll('.tls-lane').at(0)!.findAll('.tls-clip').at(1)!.attributes('style') === edit()!.findAll('.tls-lane').at(1)!.findAll('.tls-clip').at(1)!.attributes('style'));
    check('…with the start timecode under it', /00:59:30:00/.test(edit()!.find('.tls-ticks').text()));
    const eStyle = edit()!.attributes('style') ?? '';
    const otherRows = edit()!.findAll('.card-field').length - 1;
    check('the card is as tall as its rows PLUS the strip\'s (name, 3 lanes, timecodes = 5 rows)', eStyle.includes(`height: ${cardHeight(otherRows + 5, false)}px`), eStyle);
    await edit()!.trigger('dblclick');
    check('the tray draws the same lanes at the top of Audio tracks', await until(() => w.find('.record-panel .ta-strip .tls-lane').exists(), 8000)
      && w.findAll('.record-panel .ta-strip .tls-lane:not(.tls-ticks) .tls-label').length === 3);
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
