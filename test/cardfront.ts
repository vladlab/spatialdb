/**
 * The card's FRONT, pure (CANVAS-BRIEF.md B1, B4): no server, no database.
 *
 *   T1  wrapTitle — words, filename separators, by character, the reserve, the cap
 *   T2  heights — one line is today's height; each more adds one title line
 *   T3  the default width cap (320) and fit-to-content (720)
 *   T4  cardVerdict — none, pass, unknown, fail; worst wins; what it opens
 *   T5  stackCardWidth agrees with stackLayout
 */
import {
  wrapTitle, titleHeight, cardHeight, effectiveHeight, defaultCardWidth, fitCardWidth, TITLE_CHROME,
  CARD_TITLE_H, CARD_TITLE_LINE_H, CARD_TITLE_MAX_LINES, CARD_W, CARD_W_DEFAULT_MAX, CARD_W_MAX,
} from '../src/client/canvas/cardLayout.js';
import { cardVerdict, type CompareResult, type PairResult } from '../src/contract/compare.js';
import { stackCardWidth, stackLayout } from '../src/contract/canvasStack.js';

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
