/**
 * The card's FRONT, pure (CANVAS-BRIEF.md B1, B4): no server, no database.
 *
 *   T1  wrapTitle — words, filename separators, by character, the reserve, the cap
 *   T2  heights — one line is today's height; each more adds one title line
 *   T3  the default width cap (320) and fit-to-content (720)
 *   T4  cardVerdict — none, pass, unknown, fail; worst wins; what it opens
 *   T5  stackCardWidth agrees with stackLayout
 *   T6  the watermark (B2) — iconFor, suggestMap, validation
 *   T7  the mini timeline (B3) — shared columns, gaps, the clip cap, lanes, ticks
 *   T8  the card's back (C2) — default by section, a chosen list, validation
 *   T9  compareRows (C4) — a row per pair, an audio layout's tracks under it
 */
import {
  wrapTitle, titleHeight, cardHeight, effectiveHeight, defaultCardWidth, fitCardWidth, TITLE_CHROME,
  CARD_TITLE_H, CARD_TITLE_LINE_H, CARD_TITLE_MAX_LINES, CARD_W, CARD_W_DEFAULT_MAX, CARD_W_MAX,
} from '../src/client/canvas/cardLayout.js';
import { cardVerdict, compareRows, type CompareResult, type PairResult } from '../src/contract/compare.js';
import { stackCardWidth, stackLayout } from '../src/contract/canvasStack.js';
import { CardIcon, canDriveIcon, iconFor, suggestMap } from '../src/contract/cardIcon.js';
import { MEDIA } from '../src/contract/tools.js';
import { labelSeconds, ticksThatFit, timelineStrip, STRIP_MAX_CLIPS } from '../src/contract/timelineStrip.js';
import { rowLines } from '../src/client/canvas/cardLayout.js';
import { CardBack, backLines } from '../src/contract/cardBack.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/** A monospace stand-in: every character is 7px. */
const measure = (t: string) => t.length * 7;
/** A card whose text width is exactly `chars` characters. */
const cardFor = (chars: number) => chars * 7 + TITLE_CHROME;

console.log('\nT1. wrapTitle');
check('a title that fits is one line, unchanged', JSON.stringify(wrapTitle('Episode 101', cardFor(20), measure)) === '["Episode 101"]');
check('an empty title is one empty line', JSON.stringify(wrapTitle('', cardFor(20), measure)) === '[""]');
const words = wrapTitle('Duke Ep 101 Texted Master Network', cardFor(16), measure);
check('words break at spaces, and no line ends in a space', JSON.stringify(words) === '["Duke Ep 101","Texted Master","Network"]', JSON.stringify(words));
const file = wrapTitle('SHOW_EP101_TextedMaster_UHD.mov', cardFor(12), measure);
check('a filename breaks just AFTER _ and . (the separator stays on the line it ends)', JSON.stringify(file) === '["SHOW_EP101_","TextedMaster","_UHD.mov"]' || JSON.stringify(file) === '["SHOW_EP101_","TextedMaster_","UHD.mov"]', JSON.stringify(file));
check('…and joined back it is the title, every character kept', file.join('') === 'SHOW_EP101_TextedMaster_UHD.mov');
const hard = wrapTitle('A005C0122610275JCANON0001234567', cardFor(10), measure);
check('no break anywhere: cut by character, every line full but the last', hard.join('') === 'A005C0122610275JCANON0001234567' && hard.slice(0, -1).every((l) => l.length === 10), JSON.stringify(hard));
check('every line fits its width', [words, file, hard].every((ls) => ls.every((l) => measure(l) <= 16 * 7)));
const reserved = wrapTitle('alpha beta gamma delta', cardFor(12), measure, 5 * 7);
check('the reserve narrows the FIRST line only', measure(reserved[0]) <= 7 * 7 && reserved.slice(1).some((l) => l.length > 7), JSON.stringify(reserved));
const many = wrapTitle(Array.from({ length: 40 }, (_, i) => `w${i}`).join(' '), cardFor(4), measure);
check(`capped at ${CARD_TITLE_MAX_LINES} lines, the last ending in "…"`, many.length === CARD_TITLE_MAX_LINES && many[many.length - 1].endsWith('…') && measure(many[many.length - 1]) <= 4 * 7, JSON.stringify(many));
check('a separator run stays together ("Down_-24")', wrapTitle('Fold_Down_-24LKFS', cardFor(11), measure)[0] === 'Fold_Down_-');

console.log('\nT2. Heights');
check('one line is exactly today\'s title height', titleHeight(1) === CARD_TITLE_H && cardHeight(3, false) === cardHeight(3, false, 0, 1));
check('each more line adds one title line', titleHeight(3) - titleHeight(1) === 2 * CARD_TITLE_LINE_H && cardHeight(3, false, 0, 3) - cardHeight(3, false) === 2 * CARD_TITLE_LINE_H);
check('a FOLDED card keeps its whole title (it wraps there too)', cardHeight(3, true, 0, 4) - cardHeight(3, true) === 3 * CARD_TITLE_LINE_H);
check('effectiveHeight passes the lines through, and a hand height cannot cut a title', effectiveHeight(null, 2, false, 0, 2) === cardHeight(2, false, 0, 2)
  && effectiveHeight(10, 2, false, 0, 3) === cardHeight(2, false, 0, 3) && effectiveHeight(10, 2, true, 0, 3) === cardHeight(2, true, 0, 3));

console.log('\nT3. Widths');
check('the default width cap is 320', CARD_W_DEFAULT_MAX === 320 && defaultCardWidth('x'.repeat(200), measure) === 320);
check('a short name still gets the 240 minimum', defaultCardWidth('Ep 101', measure) === CARD_W);
check('in between: as wide as its name', defaultCardWidth('x'.repeat(35), measure) === 35 * 7 + TITLE_CHROME);
check('fit-to-content (double-click an edge) may still go to 720', fitCardWidth('x'.repeat(200), [], measure) === CARD_W_MAX);

console.log('\nT4. cardVerdict');
const pr = (status: PairResult['status']): PairResult => ({ pair: { from: 'a', to: 'b', rule: 'equals' } as never, status, detail: '', expected: '', found: '' });
const res = (...s: PairResult['status'][]): CompareResult => ({ same: s.every((x) => x === 'match'), results: s.map(pr) });
const one = (result: CompareResult | null) => [{ linkId: 'L', linkName: 'Deliverable', targets: [{ id: 'T', label: 'Texted ProRes', result }] }];
check('no comparing link → no button (null)', cardVerdict([]) === null);
const none = cardVerdict([{ linkId: 'L', linkName: 'Deliverable', targets: [] }]);
check('a comparing link with nothing linked → none, opens nothing', none?.state === 'none' && none.linkId === null && /Nothing linked through Deliverable/.test(none.title));
check('every pair matching → pass', cardVerdict(one(res('match', 'match')))?.state === 'pass');
const f = cardVerdict(one(res('match', 'differ', 'missing', 'unspecified')));
check('a difference → fail, counting differ AND missing', f?.state === 'fail' && f.differ === 2 && f.linkId === 'L' && f.targetId === 'T' && /2 differences/.test(f.title));
check('nothing differs, something unspecified → unknown', cardVerdict(one(res('match', 'unspecified')))?.state === 'unknown');
check('the target not loaded → unknown, "not loaded yet"', cardVerdict(one(null))?.state === 'unknown' && /not loaded/.test(cardVerdict(one(null))!.title));
const worst = cardVerdict([
  { linkId: 'L1', linkName: 'Deliverable', targets: [{ id: 'T1', label: 'A', result: res('match') }] },
  { linkId: 'L2', linkName: 'Also', targets: [{ id: 'T2', label: 'B', result: res('unspecified') }, { id: 'T3', label: 'C', result: res('differ') }] },
]);
check('several: the worst wins, and the button opens THAT one', worst?.state === 'fail' && worst.linkId === 'L2' && worst.targetId === 'T3');

console.log('\nT5. stackCardWidth');
const cardsIn = [{ recordId: 'a', h: 50, w: 260 }, { recordId: 'b', h: 50, w: 300 }];
check('no width of its own: the widest card\'s', stackCardWidth({ w: null }, [260, 300]) === stackLayout({ x: 0, y: 0, w: null, collapsed: false }, cardsIn).cardW && stackCardWidth({ w: null }, [260, 300]) === 300);
check('a width of its own: that, less padding — same as the layout', stackCardWidth({ w: 500 }, [260]) === stackLayout({ x: 0, y: 0, w: 500, collapsed: false }, cardsIn).cardW);

console.log('\nT6. The watermark');
const byMedia = { byField: '00000000-0000-4000-8000-000000000001', map: suggestMap([...MEDIA]) };
check('Media\'s choices are recognised: video, audio, image → sequence, document; "other" left alone',
  byMedia.map.video === 'video' && byMedia.map.audio === 'audio' && byMedia.map.image === 'sequence' && byMedia.map.document === 'document' && !('other' in byMedia.map), JSON.stringify(byMedia.map));
check('iconFor: the record\'s value picks the icon', iconFor(byMedia, 'audio') === 'audio');
check('…matching case and surrounding space loosely', iconFor(byMedia, ' Video ') === 'video');
check('…an unmapped value, or none: the fallback icon if there is one, else nothing', iconFor(byMedia, 'other') === null && iconFor({ ...byMedia, icon: 'generic' }, 'other') === 'generic' && iconFor({ ...byMedia, icon: 'generic' }, '') === 'generic');
check('one icon for every card', iconFor({ icon: 'deliverable' }) === 'deliverable' && iconFor({ icon: 'deliverable' }, 'whatever') === 'deliverable');
check('no config / a broken one → nothing', iconFor(null) === null && iconFor({ icon: 'unicorn' }) === null);
check('a map without the field it reads is refused', !CardIcon.safeParse({ map: { a: 'video' } }).success && CardIcon.safeParse(byMedia).success);
check('the fields that may drive it: select, text, single link', canDriveIcon({ type: 'select' }) && canDriveIcon({ type: 'text' }) && canDriveIcon({ type: 'link', options: { single: true } })
  && !canDriveIcon({ type: 'link', options: {} }) && !canDriveIcon({ type: 'number' }));

console.log('\nT7. The mini timeline');
check('labelSeconds reads non-drop and drop labels; refuses junk', labelSeconds('01:00:00:00') === 3600 && labelSeconds('00:00:01;15') === 1.5 && Number.isNaN(labelSeconds('1:00')));
const clip = (name: string, start: string, end: string, path?: string) => ({ name, start, end, frames: 0, ...(path ? { path } : {}) });
const ta = { tracks: [
  { index: 2, name: 'A2', format: 'stereo', clips: [clip('Tone', '00:59:30:00', '01:00:00:00'), clip('Mix ST', '01:00:00:00', '01:52:00:00', '/m/st.wav')] },
  { index: 1, name: 'A1', format: '5.1', clips: [clip('Tone', '00:59:30:00', '01:00:00:00'), clip('Mix 51', '01:00:00:00', '01:52:00:00', '/m/51.wav')] },
  { index: 3, name: 'A3', format: '5.1', clips: [clip('M&E', '01:00:10:00', '01:52:00:00', '/m/me.wav')] },
] };
const st = timelineStrip(ta)!;
check('lanes in TRACK order, labelled name + format', st.lanes.map((l) => l.label).join() === 'A1 5.1,A2 stereo,A3 5.1');
check('columns are SHARED: both mixes start at the same x', st.lanes[0].clips[1].left === st.lanes[1].clips[1].left && st.lanes[0].clips[1].left > 0);
check('a lane starting late leaves a gap: A3\'s M&E starts right of the mixes', st.lanes[2].clips[0].left > st.lanes[0].clips[1].left);
check('the strip spans 0–100%', st.lanes[0].clips[0].left === 0 && Math.abs(st.lanes[0].clips[1].left + st.lanes[0].clips[1].width - 100) < 1e-9);
check('NOT to scale: 30s of tone is far wider than 30/3150 of the strip', st.lanes[0].clips[0].width > 10, String(st.lanes[0].clips[0].width));
check('the same clip name is the same colour on every lane; no file → grey', st.lanes[0].clips[0].tint === st.lanes[1].clips[0].tint && st.lanes[0].clips[0].tint === 'grey' && st.lanes[0].clips[1].tint !== 'grey');
check('ticks at every clip START, labelled as stored', st.ticks.map((t) => t.tc).join() === '00:59:30:00,01:00:00:00,01:00:10:00');
const busy = { tracks: [{ index: 1, name: 'A1', format: 'mono', clips: Array.from({ length: STRIP_MAX_CLIPS + 3 }, (_, i) => clip(`c${i}`, `01:00:${String(i * 2).padStart(2, '0')}:00`, `01:00:${String(i * 2 + 1).padStart(2, '0')}:00`, '/x')) }] };
check(`more than ${STRIP_MAX_CLIPS} clips on a lane: one block, "N clips"`, timelineStrip(busy)!.lanes[0].clips.length === 1 && timelineStrip(busy)!.lanes[0].clips[0].name === `${STRIP_MAX_CLIPS + 3} clips`);
const capped = timelineStrip(ta, 2)!;
check('a lane cap: the first lanes, and how many were left out', capped.lanes.length === 2 && capped.hidden === 1);
check('nothing to draw → null (no clips, junk)', timelineStrip({ tracks: [{ index: 1, name: 'A1', format: 'mono', clips: [] }] }) === null && timelineStrip({ nope: 1 }) === null);
check('ticksThatFit: the first always; then only those that clear the last', ticksThatFit([{ x: 0, tc: 'a' }, { x: 5, tc: 'b' }, { x: 60, tc: 'c' }], 200, 60).map((t) => t.tc).join() === 'a,c');
check('a timeline row is as many card rows as its strip says', rowLines({ stripLines: 6 }) === 6 && rowLines({}) === 1);

console.log('\nT8. The back');
const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const fs = [{ id: U(1) }, { id: U(2) }, { id: U(3) }, { id: U(4) }];
const show = (ls: ReturnType<typeof backLines<{ id: string }>>) => ls.map((l) => (l.kind === 'head' ? `#${l.name}` : l.field.id.slice(-1))).join(' ');
check('default: every field but the title, schema order', show(backLines(fs, null, [], U(1))) === '2 3 4');
check('default: under the section names, unsectioned first', show(backLines(fs, undefined, [{ id: 's', name: 'Technical', fields: [U(3)] }], U(1))) === '2 #Technical 3 4');
check('an empty section draws no heading', show(backLines(fs, null, [{ id: 's', name: 'Empty', fields: [] }], U(1))) === '2 3 4');
check('chosen: those fields, that order, no headings — the title too, if chosen', show(backLines(fs, [U(4), U(1)], [{ id: 's', name: 'Technical', fields: [U(4)] }], U(1))) === '4 1');
check('chosen: an id that no longer resolves is skipped', show(backLines(fs, [U(9), U(2)], [], U(1))) === '2');
check('chosen and empty: nothing (it was chosen so)', backLines(fs, [], [], U(1)).length === 0);
check('validation: ids only', CardBack.safeParse([U(1)]).success && !CardBack.safeParse(['x']).success);

console.log('\nT9. compareRows');
const names: Record<string, string> = { a: 'Codec', b: 'Codec spec', la: 'Audio', lb: 'Audio spec' };
const lay = (formats: string[][]) => ({ tracks: formats.map((ch) => ({ name: '', channels: ch })) });
const rowsOf = compareRows({ same: false, results: [
  { pair: { from: 'a', to: 'b', rule: 'equals' } as never, status: 'differ', detail: 'H.264 ≠ ProRes', expected: 'ProRes', found: 'H.264' },
  { pair: { from: 'la', to: 'lb', rule: 'layout' } as never, status: 'differ', detail: 'layouts differ', expected: '2 tracks', found: '1 track',
    layouts: { found: lay([['L', 'R']]), expected: lay([['L', 'R'], ['L', 'R', 'C', 'LFE', 'Ls', 'Rs']]), diff: { same: false, channelCount: [8, 2], issues: [{ kind: 'count', detail: '8 channels expected, 2 found' }] } } },
] }, (id) => names[id]);
check('a row per pair, field names from each side, values as found / expected', rowsOf[0].kind === 'pair' && rowsOf[0].fromName === 'Codec' && rowsOf[0].toName === 'Codec spec' && rowsOf[0].found === 'H.264' && rowsOf[0].expected === 'ProRes');
check('the rule in words, and its detail, for the connector', rowsOf[0].rule === 'equals' && rowsOf[0].detail === 'H.264 ≠ ProRes');
check('a layout pair: its row, then a row per track of the longer layout', rowsOf.map((r) => r.kind).join() === 'pair,pair,track,track' && rowsOf[2].fromName === 'Track 1');
check('…a track one side lacks reads "—", and differs', rowsOf[3].found === '—' && rowsOf[3].status === 'differ' && /5\.1/.test(rowsOf[3].expected));
check('…the diff\'s own words join the pair\'s detail', /8 channels expected, 2 found/.test(rowsOf[1].detail));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
