/**
 * Video layouts — the `video_layout` structured shape (contract/videoLayout.ts) and
 * the timecode arithmetic under it (contract/timecode.ts) — and then the same thing
 * in the app: the grid cell, the tray's strip and editor, the JSON escape hatch.
 *
 * V1–V5 are pure (no database). V6 on mounts the real app.
 */
import { randomUUID } from 'node:crypto';
import { mountApp } from './uiHarness.js';
import {
  completeTc, formatLength, framesToTc, labelToTc, lengthToTc, parseLength, snapLabel, tcAdd, tcError, tcToFrames, tcToLabel,
} from '../src/contract/timecode.js';
import {
  VideoLayout, addItem, moveItem, patchItem, rebase, removeItem, resolveLayout, stripLayout, summariseVideoLayout,
  type VideoLayout as Layout,
} from '../src/contract/videoLayout.js';
import { FIELD_FORM_SHAPES, structuredError, summarise } from '../src/contract/shapes.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/** The layout the feature was specified with: a head build that adds up to picture at 01:00:00:00. */
const SPEC: Layout = { rate: 23.976, drop: false, items: [
  { label: 'Black', kind: 'black', start: '00:59:27:00', duration: '00:00:03:00' },
  { label: 'Bars and tone', kind: 'bars', duration: '00:00:15:00' },
  { label: 'Slate', kind: 'slate', duration: '00:00:10:00' },
  { label: 'Black', kind: 'black', duration: '00:00:05:00' },
  { label: '2-pop', start: '00:59:58:00' },
  { label: 'Program', kind: 'picture', start: '01:00:00:00', duration: 'open' },
  { label: 'Black', kind: 'black', duration: '00:00:02:00' },
  { label: 'Textless', kind: 'textless', duration: 'open' },
] };
const clone = (l: Layout): Layout => JSON.parse(JSON.stringify(l));

function pure() {
  const nd = { rate: 23.976, drop: false }, df = { rate: 29.97, drop: true }, df60 = { rate: 59.94, drop: true };

  console.log('\nV1. Timecode (contract/timecode.ts)');
  check('23.976 counts 24 labels a second: 01:00:00:00 is label 86400', tcToLabel('01:00:00:00', nd) === 86400 && labelToTc(86400, nd) === '01:00:00:00');
  check('a frame the rate does not count is refused, and says the range', /frame 24.*00–23/.test(tcError('00:00:00:24', nd) ?? ''), tcError('00:00:00:24', nd) ?? '');
  check('…as is a minute 60, and text that is not a timecode', !!tcError('00:60:00:00', nd) && !!tcError('1:00:00:00', nd) && !!tcError('01:00:00', nd));
  check('DROP-FRAME: one hour of 29.97 is 107,892 real frames, both ways', tcToFrames('01:00:00;00', df) === 107892 && framesToTc(107892, df) === '01:00:00;00');
  check('…frame 1800 is 00:01:00;02 (labels ;00 and ;01 are skipped), frame 17,982 is 00:10:00;00 (the tenth minute skips none)',
    framesToTc(1799, df) === '00:00:59;29' && framesToTc(1800, df) === '00:01:00;02' && framesToTc(17982, df) === '00:10:00;00');
  let bad = 0; for (let n = 0; n < 220000; n += 7) if (tcToFrames(framesToTc(n, df), df) !== n) bad++;
  for (let n = 0; n < 440000; n += 11) if (tcToFrames(framesToTc(n, df60), df60) !== n) bad++;
  check('…and frames → timecode → frames is the identity at 29.97 and 59.94 (which skips four)', bad === 0 && tcToFrames('01:00:00;00', df60) === 215784, String(bad));
  check('a label drop-frame skips does not exist — and is refused', /does not exist in drop-frame/.test(tcError('00:59:00;00', df) ?? '') && tcError('00:50:00;00', df) === null);
  check('either separator is accepted at a drop base; the base decides how it is WRITTEN', tcToLabel('01:00:00:00', df) === tcToLabel('01:00:00;00', df) && labelToTc(108000, df) === '01:00:00;00');
  check('ADDING is label arithmetic: bars at 00:58:30;00 for a minute end at 00:59:30;00 — what the spec means — not ;02',
    tcAdd('00:58:30;00', 1800, df) === '00:59:30;00', tcAdd('00:58:30;00', 1800, df) ?? '');
  check('…and a sum that lands on a skipped label moves on to the first that exists', tcAdd('00:58:59;15', 15, df) === '00:59:00;02' && snapLabel(tcToLabel('00:58:59;29', df)! + 1, df) === tcToLabel('00:59:00;02', df));
  check('timecode wraps at 24 hours', tcAdd('23:59:59:23', 1, nd) === '00:00:00:00');

  console.log('\nV2. What a person types');
  check('a timecode is completed from the RIGHT: "59:27:00" → 00:59:27:00, "3:00" is three seconds',
    completeTc('59:27:00', nd) === '00:59:27:00' && completeTc('3:00', nd) === '00:00:03:00' && completeTc('1:0:0:0', nd) === '01:00:00:00');
  check('…written the base\'s way (";" at drop-frame), refused when it is not a timecode there', completeTc('1:00:00:00', df) === '01:00:00;00' && completeTc('3:24', nd) === null && completeTc('1:2:3:4:5', nd) === null && completeTc('abc', nd) === null);
  check('a length: "3s", "1m30s", "72f", "2s12f", "1h", a bare number (seconds), or a timecode',
    parseLength('3s', nd) === 72 && parseLength('1m30s', nd) === 2160 && parseLength('72f', nd) === 72 && parseLength('2s12f', nd) === 60
    && parseLength('1h', nd) === 86400 && parseLength('45', nd) === 1080 && parseLength('3:00', nd) === 72 && parseLength('00:01:00:00', nd) === 1440
    && parseLength(' 1 M 30 S ', nd) === 2160);
  check('…nonsense is null, not zero', parseLength('soon', nd) === null && parseLength('', nd) === null && parseLength('3x', nd) === null);
  check('a length is said the way it is typed: 3s, 1m 30s, 2s 12f, 1 frame', formatLength(72, nd) === '3s' && formatLength(2160, nd) === '1m 30s' && formatLength(60, nd) === '2s 12f' && formatLength(1, nd) === '1 frame' && formatLength(86400 + 1440, nd) === '1h 1m');
  check('…until it needs three units: a program\'s length reads as a timecode', formatLength(tcToLabel('01:32:10:05', nd)!, nd) === '01:32:10:05' && formatLength(2172, nd) === '00:01:30:12');
  check('…and STORED as timecode text, never drop-frame (a length is a count, not a label)', lengthToTc(72, nd) === '00:00:03:00' && lengthToTc(1800, df) === '00:01:00:00');

  console.log('\nV3. The shape (contract/videoLayout.ts)');
  const err = (v: unknown) => structuredError('v', 'video_layout', v);
  check('the worked example is accepted', err(SPEC) === null, err(SPEC) ?? '');
  check('"video_layout" is a shape the field form offers', FIELD_FORM_SHAPES.includes('video_layout'));
  check('an unknown KEY is refused, on the layout and on an item — a typo must fail loudly', !!err({ ...SPEC, fps: 24 }) && /video layout/.test(err({ rate: 24, drop: false, items: [{ label: 'x', lenght: '1' }] }) ?? ''));
  check('the rate must be one timecode counts at; drop-frame only where it exists', /rate is one of/.test(err({ rate: 23.98, drop: false, items: [] }) ?? '') && /drop-frame exists at 29.97/.test(err({ rate: 24, drop: true, items: [] }) ?? ''));
  check('a start must be a timecode AT THAT RATE (frame 24 at 23.976 is refused, by item)', /items\.0\.start.*frame 24/.test(err({ rate: 23.976, drop: false, items: [{ label: 'x', start: '01:00:00:24' }] }) ?? ''), err({ rate: 23.976, drop: false, items: [{ label: 'x', start: '01:00:00:24' }] }) ?? '');
  check('a duration is "open" or a length; zero is refused (that is a marker), and so is "3s" (typing is the editor\'s job)',
    /zero is a marker/.test(err({ rate: 24, drop: false, items: [{ label: 'x', duration: '00:00:00:00' }] }) ?? '')
    && /"open" or a length/.test(err({ rate: 24, drop: false, items: [{ label: 'x', duration: '3s' }] }) ?? '')
    && err({ rate: 24, drop: false, items: [{ label: 'x', duration: 'open' }] }) === null);
  check('a drop-frame layout refuses a start on a skipped label', /does not exist in drop-frame/.test(err({ rate: 29.97, drop: true, items: [{ label: 'x', start: '00:59:00;00' }] }) ?? ''));
  check('an unknown kind is refused; no kind at all is fine', !!err({ rate: 24, drop: false, items: [{ label: 'x', kind: 'leader' }] }) && err({ rate: 24, drop: false, items: [{ label: 'x' }] }) === null);

  console.log('\nV4. Resolving: lengths and pins → positions');
  const r = resolveLayout(SPEC);
  const at = (i: number) => (r.items[i].start === null ? null : labelToTc(r.items[i].start!, r.base));
  check('an item with no start begins where the block before it ends: bars 00:59:30:00, slate 00:59:45:00, black 00:59:55:00',
    at(1) === '00:59:30:00' && at(2) === '00:59:45:00' && at(3) === '00:59:55:00' && !r.items[1].pinned && r.items[0].pinned, [at(1), at(2), at(3)].join());
  check('a pinned block the chain meets EXACTLY has landed — the head adds up — and there are no issues', r.items[5].landed && r.issues.length === 0 && !r.items[0].landed);
  check('three kinds of item, by duration alone: block, open, marker', r.items.map((i) => i.type).join() === 'span,span,span,span,marker,open,span,open');
  check('a marker never moves the chain (the 2-pop sits inside the black; Program still lands)', at(4) === '00:59:58:00' && r.items[4].end === null);
  check('after an OPEN block positions are unknown — the item says what it comes after instead', r.items[6].start === null && r.items[6].follows === 5 && r.items[7].follows === 6);
  check('first frame of file and first frame of picture', labelToTc(r.fileStart!, r.base) === '00:59:27:00' && labelToTc(r.pictureStart!, r.base) === '01:00:00:00');

  const short = clone(SPEC); short.items[3].duration = '00:00:03:00';
  const gap = resolveLayout(short);
  check('a head that falls SHORT of a pinned block is a gap, in words, with both timecodes', gap.issues.length === 1 && gap.issues[0].kind === 'gap' && gap.issues[0].item === 5 && gap.issues[0].frames === 48
    && /2s unaccounted for before Program \(00:59:58:00 to 01:00:00:00\)/.test(gap.issues[0].detail) && !gap.items[5].landed, JSON.stringify(gap.issues));
  const long = clone(SPEC); long.items[1].duration = '00:00:20:00';
  const over = resolveLayout(long);
  check('…and one that runs PAST it is an overlap, saying by how much', over.issues.length === 1 && over.issues[0].kind === 'overlap' && /Program starts at 01:00:00:00, but the items before it run to 01:00:05:00 — 5s over/.test(over.issues[0].detail), JSON.stringify(over.issues));
  const ended = clone(SPEC); ended.items[6].start = '01:30:00:00';
  const e = resolveLayout(ended);
  check('an open block STOPS at the next pinned block: Program then has a length, and the chain is known again after it',
    e.items[5].length === 30 * 60 * 24 && e.items[5].type === 'open' && labelToTc(e.items[7].start!, e.base) === '01:30:02:00' && e.issues.length === 0);
  const noAnchor = resolveLayout({ rate: 25, drop: false, items: [{ label: 'Black', duration: '00:00:03:00' }, { label: 'Bars', duration: '00:00:10:00' }] });
  check('with nothing pinned nothing is positioned (and nothing is invented)', noAnchor.items.every((i) => i.start === null) && noAnchor.fileStart === null && noAnchor.items[1].follows === 0);
  const dfLayout = resolveLayout({ rate: 29.97, drop: true, items: [{ label: 'Bars', start: '00:58:30;00', duration: '00:01:00:00' }, { label: 'Slate', duration: '00:00:20:00' }, { label: 'Program', kind: 'picture', start: '00:59:50;00', duration: 'open' }] });
  check('drop-frame: a minute of bars from 00:58:30;00 ends at 00:59:30;00, and the head lands', labelToTc(dfLayout.items[0].end!, dfLayout.base) === '00:59:30;00' && dfLayout.items[2].landed);

  check('the summary is the grid cell: rate · file · picture · count', summariseVideoLayout(SPEC) === '23.976 · file 00:59:27:00 · picture 01:00:00:00 · 8 items' && summarise('video_layout', SPEC) === summariseVideoLayout(SPEC), summariseVideoLayout(SPEC));
  check('…with what is not known left out, and an invalid value said to be one', summarise('video_layout', { rate: 29.97, drop: true, items: [{ label: 'Slate', duration: '00:00:10:00' }] }) === '29.97 DF · 1 item' && summarise('video_layout', { rate: 1 }) === 'invalid layout');

  console.log('\nV5. The strip, and the operations');
  const s = stripLayout(SPEC);
  check('one block per block-or-open item, in file order, filling the strip', s.blocks.map((b) => b.label).join() === 'Black,Bars and tone,Slate,Black,Program,Black,Textless'
    && Math.abs(s.blocks.reduce((t, b) => t + b.width, 0) - 100) < 1e-6 && s.blocks[0].left === 0);
  check('NOT true to time: 15s of bars is wider than 3s of black, but nowhere near five times', s.blocks[1].width > s.blocks[0].width && s.blocks[1].width < s.blocks[0].width * 2);
  check('an open block takes a fixed generous width and says "open"; a block says its length', s.blocks[4].open && s.blocks[4].sub === 'open' && s.blocks[4].width > s.blocks[1].width && s.blocks[0].sub === '3s');
  check('only TYPED timecodes are printed under the strip (file start and picture)', s.blocks.filter((b) => b.tc).map((b) => b.tc).join() === '00:59:27:00,01:00:00:00' && s.blocks.every((b) => (b.tc ? b.tcRow >= 0 : b.tcRow === -1)));
  const pop = s.markers[0], black = s.blocks[3];
  check('a marker sits IN PROPORTION inside the block that contains it: the 2-pop three fifths through the black',
    s.markers.length === 1 && Math.abs(pop.x - (black.left + black.width * 0.6)) < 1e-6 && pop.tc === '00:59:58:00', JSON.stringify(pop));
  const sg = stripLayout(short);
  check('a gap is DRAWN, as its own block before the pinned one, with its length', sg.blocks.map((b) => b.kind).join() === 'black,bars,slate,black,gap,picture,black,textless' && sg.blocks[4].sub === '2s' && sg.blocks[4].item === null);
  check('…and an overlap marks the block it points at', stripLayout(long).blocks.find((b) => b.item === 5)!.warn && !s.blocks.some((b) => b.warn));
  const crowded = stripLayout({ rate: 24, drop: false, items: [
    { label: 'Program', kind: 'picture', start: '01:00:00:00', duration: '00:00:10:00' },
    { label: 'FFOA', start: '01:00:00:00' }, { label: 'First cut', start: '01:00:00:12' }, { label: 'Title', start: '01:00:01:00' } ] }, 300);
  check('markers whose labels would collide go on separate rows', new Set(crowded.markers.map((m) => m.row)).size === 3 && crowded.markerRows === 3, JSON.stringify(crowded.markers.map((m) => m.row)));
  const allPinned = stripLayout({ rate: 24, drop: false, items: [
    { label: 'A', start: '01:00:00:00', duration: '00:00:01:00' }, { label: 'B', start: '01:00:01:00', duration: '00:00:01:00' },
    { label: 'C', start: '01:00:02:00', duration: '00:00:01:00' }, { label: 'D', start: '01:00:03:00', duration: '00:00:01:00' }, { label: 'E', start: '01:00:04:00', duration: '00:00:01:00' } ] }, 200);
  check('typed timecodes with no room under the strip are left to the list (never drawn over each other)', allPinned.blocks[0].tcRow === 0 && allPinned.blocks.some((b) => b.tcRow === -1) && allPinned.tcRows <= 2, JSON.stringify(allPinned.blocks.map((b) => b.tcRow)));

  const empty: Layout = { rate: 23.976, drop: false, items: [] };
  const built = addItem(addItem(empty, 'black'), 'picture');
  check('presets: a black with a length, a Program that is open, a marker with neither', built.items[0].duration === '00:00:02:00' && built.items[1].duration === 'open' && built.items[1].kind === 'picture'
    && addItem(empty, 'marker').items[0].duration === undefined && VideoLayout.safeParse(built).success);
  const patched = patchItem(patchItem(built, 0, { start: '00:59:58:00' }), 1, { duration: undefined, kind: undefined });
  check('patching sets and REMOVES keys (a strict object stores no undefined); clearing a duration makes a marker', patched.items[0].start === '00:59:58:00' && !('duration' in patched.items[1]) && !('kind' in patched.items[1])
    && JSON.stringify(Object.keys(patched.items[0])) === '["label","kind","start","duration"]');
  check('move and remove', moveItem(built, 0, 1).items[0].label === 'Program' && moveItem(built, 0, -1) === built && removeItem(built, 0).items.length === 1);
  const to25 = rebase(SPEC, 25, false);
  check('changing the rate keeps the digits (00:59:27:00 is 00:59:27:00 at 25) and stays valid', to25.items[0].start === '00:59:27:00' && VideoLayout.safeParse(to25).success && resolveLayout(to25).items[5].landed);
  const squeezed = rebase({ rate: 29.97, drop: false, items: [{ label: 'x', start: '00:59:00:29', duration: '00:00:00:29' }] }, 23.976, true);
  check('…except where it cannot: frame 29 becomes the last frame of 24, and drop is cleared at a rate that has none', squeezed.items[0].start === '00:59:00:23' && squeezed.items[0].duration === '00:00:00:23' && squeezed.drop === false);
  const toDf = rebase({ rate: 29.97, drop: false, items: [{ label: 'x', start: '00:59:00:00', duration: '00:01:00:00' }] }, 29.97, true);
  check('turning drop-frame ON moves a skipped label to the first that exists, and leaves lengths alone', toDf.items[0].start === '00:59:00;02' && toDf.items[0].duration === '00:01:00:00' && VideoLayout.safeParse(toDf).success);
}

async function app() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8831));
  const { w, win, pool, until, untilDb, post } = ui;
  try {
    const tDel = randomUUID(), fName = randomUUID(), fLayout = randomUUID(), fRate = randomUUID();
    const spec = randomUUID(), blank = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const setup = await post([
      { type: 'table.create', id: tDel, name: 'Deliverables' },
      { type: 'field.create', id: fName, tableId: tDel, name: 'Name', key: 'name', fieldType: 'text' }, pos(fName, 0),
      { type: 'field.create', id: fLayout, tableId: tDel, name: 'Video layout', key: 'video_layout', fieldType: 'structured', options: { shape: 'video_layout' } }, pos(fLayout, 1),
      { type: 'field.create', id: fRate, tableId: tDel, name: 'Frame rate', key: 'frame_rate', fieldType: 'number' }, pos(fRate, 2),
      { type: 'record.create', id: spec, tableId: tDel, data: { name: 'Network master', video_layout: SPEC } },
      { type: 'record.create', id: blank, tableId: tDel, data: { name: 'Screener', frame_rate: 25 } },
    ]);
    check('fixture accepted — a video_layout field, and a record carrying the worked example', setup.status === 200, (await setup.text()).slice(0, 200));
    const refused = await post([{ type: 'record.update', id: blank, set: { video_layout: { rate: 24, drop: false, items: [{ label: 'x', start: '01:00:00:30' }] } } }]);
    const why = await refused.text();
    check('the SERVER refuses a layout whose timecode the rate does not count, naming the item', refused.status === 400 && /video layout/.test(why) && /items\.0\.start/.test(why), why.slice(0, 200));

    const go = async () => { win.location.hash = `#/all/table/${tDel}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange')); await until(() => w.find('.gridview').exists() && w.findAll('.gridview tr.row').length > 0, 8000); };
    const ths = () => w.findAll('.gridview thead .th-name').map((x: any) => x.text());
    const rowNamed = (name: string) => w.findAll('.gridview tr.row').find((r: any) => r.findAll('td')[1].text() === name);
    const cellOf = (name: string, col: string) => rowNamed(name).findAll('td')[ths().indexOf(col) + 1];
    const openRecord = async (name: string) => { await rowNamed(name).find('.expand').trigger('click'); await until(() => w.find('.record-panel .rp-title').text() === name); };
    const pField = (label: string) => w.findAll('.record-panel .rp-field').find((f: any) => f.find('.rp-name').text().replace(/[★⚠✓]/g, '').trim() === label);
    const field = () => pField('Video layout');
    const mutations = async () => Number((await pool.query(`select count(*)::int n from mutations`)).rows[0].n);
    const type = async (el: any, text: string) => { el.element.value = text; await el.trigger('change'); };
    const item = (i: number) => field().findAll('.vl-item')[i];

    console.log('\nV6. The grid cell');
    await go();
    check('the cell is the one-line summary…', await until(() => cellOf('Network master', 'Video layout').text() === '23.976 · file 00:59:27:00 · picture 01:00:00:00 · 8 items'), cellOf('Network master', 'Video layout').text());
    const mini = cellOf('Network master', 'Video layout').find('.vls.mini');
    check('…with the MINI strip before it: seven blocks, one pin, colours only (no words)', mini.exists() && mini.findAll('.vls-block').length === 7 && mini.findAll('.vls-pin').length === 1
      && mini.text() === '' && mini.findAll('.vls-block')[4].classes().includes('vl-k-picture'));
    check('an empty cell has neither', cellOf('Screener', 'Video layout').text() === '' && !cellOf('Screener', 'Video layout').find('.vls').exists());

    console.log('\nV7. The tray: strip and list');
    await openRecord('Network master');
    await until(() => !!field() && field().find('.vl').exists());
    const strip = () => field().find('.vl .vls');
    check('the strip names its blocks and their lengths', strip().findAll('.vls-block').map((b: any) => b.find('.vls-name').text()).join() === 'Black,Bars and tone,Slate,Black,Program,Black,Textless'
      && strip().findAll('.vls-block').map((b: any) => b.find('.vls-sub').text()).join() === '3s,15s,10s,5s,open,2s,open');
    check('open blocks are marked as such; the kind is the colour', strip().findAll('.vls-block.open').length === 2 && strip().findAll('.vls-block')[1].classes().includes('vl-k-bars'));
    check('the 2-pop is a labelled pin; the typed timecodes are under the strip', strip().find('.vls-mark-name').text() === '2-pop' && strip().find('.vls-mark .vls-num').text() === '00:59:58:00' && strip().findAll('.vls-tc').map((t: any) => t.text()).join() === '00:59:27:00,01:00:00:00', `${strip().find('.vls-mark').text()} / ${strip().findAll('.vls-tc').map((t: any) => t.text()).join()}`);
    const starts = () => field().findAll('.vl-item .vl-start input').map((i: any) => [i.element.value, i.attributes('placeholder')].join('|'));
    check('in the list a TYPED start is the value; a worked-out one is the greyed hint behind ↳', starts()[0] === '00:59:27:00|↳ 00:59:27:00' && starts()[1] === '|↳ 00:59:30:00' && starts()[3] === '|↳ 00:59:55:00', starts().join('  '));
    check('…after the open Program the hint says what the item comes after', starts()[6] === '|↳ after Program' && starts()[7] === '|↳ after Black', starts().slice(6).join('  '));
    check('lengths read 3s / open / empty (a marker); ends are worked out', field().findAll('.vl-item .vl-len input').map((i: any) => i.element.value).join() === '3s,15s,10s,5s,,open,2s,open'
      && field().findAll('.vl-item .vl-end').map((t: any) => t.text()).join() === '00:59:30:00,00:59:45:00,00:59:55:00,01:00:00:00,,,,');
    check('Program wears the ✓ and the note says the head adds up', item(5).find('.vl-ok').exists() && field().findAll('.vl-ok').length === 1
      && field().findAll('.vl-note.ok').length === 1 && field().find('.vl-note.ok').text() === '✓ Head adds up — 33s before Program lands on 01:00:00:00', field().find('.vl-note.ok').text());
    check('the field\'s first line is the same summary as the grid', field().find('.sf-summary').text() === '23.976 · file 00:59:27:00 · picture 01:00:00:00 · 8 items');

    console.log('\nV8. Editing');
    const before = await mutations();
    await type(item(3).find('.vl-len input'), '3s');
    check('shortening the black to 3s is ONE write…', (await untilDb(`select data->'video_layout'->'items'->3->>'duration' d from records where id = '${spec}'`, (r) => r[0].d === '00:00:03:00')).length === 1 && (await mutations()) === before + 1);
    check('…and the head no longer adds up: a 2s GAP, said in words and drawn in the strip, the ✓ gone',
      await until(() => field().find('.vl-note.gap').exists()) && /2s unaccounted for before Program \(00:59:58:00 to 01:00:00:00\)/.test(field().find('.vl-note.gap').text())
      && strip().find('.vls-block.vl-k-gap').exists() && !field().find('.vl-ok').exists() && !field().find('.vl-note.ok').exists(), field().find('.vl-note.gap').text());
    await type(item(3).find('.vl-len input'), '00:00:05:00');
    check('a length may be typed as a timecode; it reads back as 5s and the ✓ returns', await until(() => field().find('.vl-ok').exists()) && item(3).find('.vl-len input').element.value === '5s'
      && (await untilDb(`select data->'video_layout'->'items'->3->>'duration' d from records where id = '${spec}'`, (r) => r[0].d === '00:00:05:00')).length === 1);
    const n1 = await mutations();
    await type(item(3).find('.vl-len input'), '5s');
    await new Promise((r) => setTimeout(r, 200));
    check('re-typing what is already there writes nothing (no dead undo step)', (await mutations()) === n1);
    await type(item(1).find('.vl-len input'), 'a while');
    check('a length that is not one is REFUSED where it was typed, with what would be accepted — nothing is written', await until(() => field().find('.vl-note.error').exists()) && /not a length — try 3s/.test(field().find('.vl-note.error').text()) && (await mutations()) === n1);
    await type(item(1).find('.vl-start input'), '59:30:00');
    check('pinning a start: "59:30:00" is completed to 00:59:30:00, stored, and — being where the chain already was — lands',
      (await untilDb(`select data->'video_layout'->'items'->1->>'start' s from records where id = '${spec}'`, (r) => r[0].s === '00:59:30:00')).length === 1
      && await until(() => item(1).find('.vl-ok').exists()) && !field().find('.vl-note.error').exists());
    await type(item(1).find('.vl-start input'), '00:59:30:24');
    check('a frame the rate does not count is refused, saying the range', await until(() => /not a timecode at 23.976.*frames 00 to 23/.test(field().find('.vl-note.error')?.text() ?? '')), field().find('.vl-note.error')?.text());
    await type(item(1).find('.vl-start input'), '');
    check('clearing a start un-pins it: the key is REMOVED, not stored empty', (await untilDb(`select data->'video_layout'->'items'->1 i from records where id = '${spec}'`, (r) => !('start' in r[0].i))).length === 1);
    await type(item(4).find('.vl-len input'), '1f');
    check('giving the 2-pop a length makes it a BLOCK (and, pinned inside the black, an overlap that says so)', await until(() => field().find('.vl-note.overlap').exists()) && /2-pop starts at 00:59:58:00/.test(field().find('.vl-note.overlap').text()), field().find('.vl-note.overlap')?.text());
    await type(item(4).find('.vl-len input'), '');
    check('…and clearing the length makes it a marker again', await until(() => !field().find('.vl-note.overlap').exists()) && (await untilDb(`select data->'video_layout'->'items'->4 i from records where id = '${spec}'`, (r) => !('duration' in r[0].i))).length === 1);
    await item(2).find('.vl-kindsel').setValue('other');
    check('the swatch is the kind picker; "other" stores no kind at all', (await untilDb(`select data->'video_layout'->'items'->2 i from records where id = '${spec}'`, (r) => !('kind' in r[0].i))).length === 1
      && await until(() => strip().findAll('.vls-block')[2].classes().includes('vl-k-other')));
    await item(7).find('.vl-acts .x').trigger('click');
    check('× removes an item', (await untilDb(`select jsonb_array_length(data->'video_layout'->'items') n from records where id = '${spec}'`, (r) => r[0].n === 7)).length === 1);
    await field().find('.vl-rate').setValue('29.97');
    await until(() => !field().find('.vl-drop input').element.disabled);
    await field().find('.vl-drop input').setValue(true);
    const dfv = (await untilDb(`select data->'video_layout' v from records where id = '${spec}'`, (r) => r[0].v.drop === true))[0].v;
    check('the rate and drop-frame are changed in place: the digits stay, written the drop-frame way', dfv.rate === 29.97 && dfv.items[0].start === '00:59:27;00' && dfv.items[5].start === '01:00:00;00' && dfv.items[0].duration === '00:00:03:00', JSON.stringify(dfv.items[0]));
    win.document.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    check('Ctrl+Z undoes the last change like any other write', (await untilDb(`select data->'video_layout'->>'drop' d from records where id = '${spec}'`, (r) => r[0].d === 'false', 4000)).length === 1);
    await w.find('.record-panel .rp-close').trigger('click');

    console.log('\nV9. From nothing, and the JSON escape hatch');
    await openRecord('Screener');
    await until(() => !!field() && field().find('.vl').exists());
    check('an empty field offers the presets, and starts at the record\'s own frame rate (25)', field().findAll('.vl-btn.add-item').map((b: any) => b.text()).join() === 'Black,Bars and tone,Slate,Program,Textless,Marker'
      && field().find('.vl-rate').element.value === '25' && field().find('.vl-empty').exists() && field().find('.vl-drop input').element.disabled);
    await field().find('.vl-btn.add-item[data-preset="black"]').trigger('click');
    const first = (await untilDb(`select data->'video_layout' v from records where id = '${blank}'`, (r) => r[0].v !== null))[0].v;
    check('adding the first item writes the layout — at 25, not drop', first.rate === 25 && first.drop === false && first.items.length === 1 && first.items[0].kind === 'black', JSON.stringify(first));
    check('with nothing pinned the editor asks for a start instead of inventing one', await until(() => field().find('.vl-note.hint').exists()) && field().find('.vl-item .vl-start input').attributes('placeholder') === 'start tc');
    await type(item(0).find('.vl-start input'), '9:59:50:00');
    await field().find('.vl-btn.add-item[data-preset="picture"]').trigger('click');
    await until(() => field().findAll('.vl-item').length === 2);
    check('a Program added after it follows on: ↳ 09:59:52:00, open', await until(() => item(1).find('.vl-start input').attributes('placeholder') === '↳ 09:59:52:00') && item(1).find('.vl-len input').element.value === 'open', item(1).find('.vl-start input').attributes('placeholder'));
    await item(0).find('.vl-acts .x').trigger('click'); await until(() => field().findAll('.vl-item').length === 1);
    await item(0).find('.vl-acts .x').trigger('click');
    check('removing the last item clears the value (an empty layout is no value)', (await untilDb(`select data ? 'video_layout' has from records where id = '${blank}'`, (r) => r[0].has === false)).length === 1);
    await field().find('.edit-json').trigger('click');
    await field().find('.sf-json').setValue(JSON.stringify({ rate: 24, drop: true, items: [] }));
    await field().find('.save-json').trigger('click');
    check('"edit as JSON" saves only what the shape accepts — and says why not', await until(() => /drop-frame exists at 29.97/.test(field().find('.sf-error')?.text() ?? '')), field().find('.sf-error')?.text());
    await field().find('.sf-json').setValue(JSON.stringify({ rate: 24, drop: false, items: [{ label: 'FFOA', start: '01:00:00:00' }] }));
    await field().find('.save-json').trigger('click');
    check('a valid one is stored and drawn: a lone marker', (await untilDb(`select data->'video_layout'->'items'->0->>'label' l from records where id = '${blank}'`, (r) => r[0].l === 'FFOA')).length === 1
      && await until(() => field().find('.vl-item.marker').exists() && field().find('.vl-pinmark').exists()));
  } finally {
    await ui.close();
  }
}

async function main() {
  pure();
  await app();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log(`\n${pass} passed, ${fail} failed`); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
