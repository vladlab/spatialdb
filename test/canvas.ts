/**
 * ============================================================================
 *  Canvas tests.
 * ============================================================================
 *
 *  Part A is the geometry, which is pure and needs no DOM. Arrow routing is the
 *  thing most likely to look subtly wrong rather than fail loudly — an arrow
 *  leaving the wrong edge, a curve that loops back over its own card — and a pure
 *  module can be checked at a hundred positions instantly instead of eyeballed.
 *
 *  Part B drives the placement mutations the canvas actually emits, through a
 *  real server, with two clients. Pointer handling can only be checked in a
 *  browser; what a drag PRODUCES can be checked here.
 *
 *  Run: npm run test:canvas
 */

import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { boardsTableMutations, bootServer, type ServerHandle } from './harness.js';
import {
  anchorDirection, anchorPoint, bestSides, bezierPath, boundsOf, fitTransform,
  rectsIntersect, toWorld, zoomAbout, type Rect,
} from '../src/client/canvas/geometry.js';
import { createStore } from '../src/client/store.js';
import { cardHeight, effectiveHeight, rowPortY, CARD_RICH_H, CARD_ROW_H } from '../src/client/canvas/cardLayout.js';
import { arrowStyleError, arrowStyleOf } from '../src/contract/arrows.js';
import { bezierMid } from '../src/client/canvas/geometry.js';
import { cardFieldsFor, DEFAULT_CARD_FIELDS } from '../src/contract/canvasConfig.js';
import { placementKey } from '../src/client/state.js';

const PORT = Number(process.env.TEST_PORT ?? 8807);
const API = `http://localhost:${PORT}`;

let pass = 0;
/** The table of boards this suite's canvases live in — see harness.boardsTableMutations. */
const BOARDS = randomUUID();

let fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Poll for something a PEER will see once the stream delivers it. */
async function waitFor(predicate: () => boolean, ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (predicate()) return true; await sleep(25); }
  return false;
}
const near = (a: number, b: number, eps = 0.001) => Math.abs(a - b) < eps;

/* ────────────────────────────────────────────────────────────────────────────
 *  Part A — geometry
 * ──────────────────────────────────────────────────────────────────────────*/

function partA() {
  console.log('\nA1. Anchors sit on the right edges');
  const r: Rect = { x: 100, y: 100, w: 200, h: 100 };
  check('top anchor is above, horizontally centred',
    anchorPoint(r, 'top', 0).x === 200 && anchorPoint(r, 'top', 0).y === 100);
  check('right anchor is past the right edge',
    anchorPoint(r, 'right', 0).x === 300 && anchorPoint(r, 'right', 0).y === 150);
  check('the offset pushes the anchor further out',
    anchorPoint(r, 'right', 8).x === 308);

  console.log('\nA2. Arrows leave through the sides facing the target');
  // Side by side: the arrow must exit right and arrive left. Getting this wrong
  // is the classic bug where two adjacent cards connect top-to-top and the curve
  // loops over both of them.
  const left: Rect = { x: 0, y: 0, w: 100, h: 60 };
  const right: Rect = { x: 400, y: 0, w: 100, h: 60 };
  const h = bestSides(left, right);
  check('horizontal neighbours connect right → left',
    h.from === 'right' && h.to === 'left', `${h.from} → ${h.to}`);

  const below: Rect = { x: 0, y: 400, w: 100, h: 60 };
  const v = bestSides(left, below);
  check('vertical neighbours connect bottom → top',
    v.from === 'bottom' && v.to === 'top', `${v.from} → ${v.to}`);

  // Reversing the pair must mirror the answer, or arrows would be asymmetric
  // depending on which record happened to be the link source.
  const back = bestSides(right, left);
  check('the reverse direction mirrors',
    back.from === 'left' && back.to === 'right', `${back.from} → ${back.to}`);

  // Sweep the target all the way round and confirm both chosen sides FACE each
  // other — the exit normal points toward the target, the entry normal points
  // back toward the source. This is the actual invariant.
  //
  // An earlier version of this test asserted the stronger "horizontal target ⇒
  // horizontal exit", which is wrong at a perfect diagonal: at 45° the distances
  // tie exactly and `bottom → left` is a perfectly good answer (leave downward,
  // arrive from the left). The test was over-specified, not the code — worth
  // saying, because a test that demands one arbitrary answer among several
  // correct ones invites someone to "fix" working code.
  let wrong = 0;
  const src: Rect = { x: -50, y: -30, w: 100, h: 60 };
  for (let deg = 0; deg < 360; deg += 15) {
    const rad = (deg * Math.PI) / 180;
    const target: Rect = {
      x: 500 * Math.cos(rad) - 50, y: 500 * Math.sin(rad) - 30, w: 100, h: 60,
    };
    const s = bestSides(src, target);
    const pa = anchorPoint(src, s.from, 0);
    const pb = anchorPoint(target, s.to, 0);
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
    const ux = (pb.x - pa.x) / len;
    const uy = (pb.y - pa.y) / len;
    const da = anchorDirection(s.from);
    const db = anchorDirection(s.to);
    // Strictly positive: an exit side perpendicular to the run would be a tie we
    // do not want either, and pointing away is plainly wrong.
    if (da.x * ux + da.y * uy <= 0) wrong++;
    if (db.x * -ux + db.y * -uy <= 0) wrong++;
  }
  check('both anchors face each other, all the way round', wrong === 0,
    `${wrong} of 48 anchor checks wrong`);

  console.log('\nA3. Paths are well formed');
  const a = anchorPoint(left, 'right');
  const b = anchorPoint(right, 'left');
  const path = bezierPath(a, 'right', b, 'left');
  check('is a single cubic bezier', /^M[-\d.,]+ C[-\d.,]+ [-\d.,]+ [-\d.,]+$/.test(path), path);
  check('no NaN anywhere', !path.includes('NaN'), path);

  // Coincident cards used to be the crash case: zero distance means a zero-length
  // direction vector and a division by zero.
  const same: Rect = { x: 10, y: 10, w: 50, h: 50 };
  const degenerate = bezierPath(
    anchorPoint(same, 'top'), 'top', anchorPoint(same, 'top'), 'top');
  check('overlapping cards do not produce NaN', !degenerate.includes('NaN'), degenerate);

  console.log('\nA4. Box selection catches partial overlap');
  const box: Rect = { x: 0, y: 0, w: 100, h: 100 };
  check('a card fully inside is caught', rectsIntersect(box, { x: 10, y: 10, w: 20, h: 20 }));
  check('a card clipping the corner is caught',
    rectsIntersect(box, { x: 90, y: 90, w: 50, h: 50 }));
  check('a card outside is not', !rectsIntersect(box, { x: 200, y: 0, w: 10, h: 10 }));
  check('edge contact counts', rectsIntersect(box, { x: 100, y: 0, w: 10, h: 10 }));

  console.log('\nA5. Fit-all frames every card');
  const spread: Rect[] = [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 900, y: 500, w: 100, h: 100 },
  ];
  const t = fitTransform(spread, 800, 600);
  const bounds = boundsOf(spread)!;
  check('scales down to fit', t.scale < 1 && t.scale > 0, String(t.scale));
  // Every corner must land inside the viewport after transforming.
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
  ].map((p) => ({ x: p.x * t.scale + t.x, y: p.y * t.scale + t.y }));
  check('all content lands on screen',
    corners.every((c) => c.x >= -1 && c.x <= 801 && c.y >= -1 && c.y <= 601),
    JSON.stringify(corners));
  check('never zooms past 100%',
    fitTransform([{ x: 0, y: 0, w: 10, h: 10 }], 800, 600).scale === 1);
  check('an empty canvas is a no-op', fitTransform([], 800, 600).scale === 1);

  console.log('\nA6. Zoom keeps the point under the cursor still');
  // The single most noticeable way a canvas can feel broken: zoom that drifts.
  const start = { x: 40, y: -25, scale: 1 };
  const screen = { x: 300, y: 220 };
  const rect0 = { left: 0, top: 0 };
  const worldBefore = toWorld(screen.x, screen.y, rect0, start);
  let cur = start;
  for (const s of [1.4, 0.6, 2.7, 0.15, 1]) {
    cur = zoomAbout(cur, screen.x, screen.y, s);
    const after = toWorld(screen.x, screen.y, rect0, cur);
    if (!near(after.x, worldBefore.x, 0.0001) || !near(after.y, worldBefore.y, 0.0001)) {
      check(`world point stays fixed at scale ${s}`, false,
        `${JSON.stringify(worldBefore)} vs ${JSON.stringify(after)}`);
      return;
    }
  }
  check('world point stays fixed across five zoom steps', true);

  const roundTrip = toWorld(123, 456, { left: 17, top: 29 }, { x: 40, y: -25, scale: 1.75 });
  check('screen → world accounts for the container offset',
    near(roundTrip.x, (123 - 17 - 40) / 1.75) && near(roundTrip.y, (456 - 29 + 25) / 1.75),
    JSON.stringify(roundTrip));
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Part B — placement mutations against a real server
 * ──────────────────────────────────────────────────────────────────────────*/

const pool = new pg.Pool({ connectionString: process.env.DB_URL });
let server: ServerHandle | undefined;

async function partB() {
  const db = await pool.connect();
  let user = (await db.query(`select id from users limit 1`)).rows[0];
  if (!user) {
    user = (await db.query(
      `insert into users (email,name,role) values ('canvas@local','Canvas','admin')
       returning id`)).rows[0];
  }
  db.release();

  server = await bootServer(PORT);

  const A = createStore({ baseUrl: API, debounceMs: 50 });
  const B = createStore({ baseUrl: API, debounceMs: 50 });
  await A.hydrate();
  await B.hydrate();
  A.start(); B.start();
  for (let i = 0; i < 40 && A.streamState.value !== 'connected'; i++) await sleep(100);
  for (let i = 0; i < 40 && B.streamState.value !== 'connected'; i++) await sleep(100);

  console.log('\nB1. Placing a record from the tray');
  const tableId = randomUUID();
  const canvasId = randomUUID();
  const recId = randomUUID();
  for (const m of boardsTableMutations(BOARDS)) A.mutate(m);
  A.mutate({ type: 'table.create', id: tableId, name: `Canvas test ${Date.now()}`, singularName: 'Row', color: '#446', icon: '' });
  A.mutate({ type: 'field.create', id: randomUUID(), tableId, name: 'Name', key: 'name', fieldType: 'text', options: {}, required: false });
  A.mutate({ type: 'record.create', id: canvasId, tableId: BOARDS, data: { name: 'Test board' } });
  A.mutate({ type: 'record.create', id: recId, tableId, data: { name: 'card one' } });
  await A.settled();

  // The record exists but is not placed — exactly what the tray shows.
  const trayBefore = await A.unplaced(canvasId, 200);
  check('an unplaced record appears in the tray',
    (trayBefore.records as any[]).some((r) => r.id === recId));

  A.mutate({
    type: 'placement.add', id: randomUUID(), canvasId, recordId: recId,
    x: 120, y: 80, w: null, h: null, z: 1,
  });
  await A.settled();
  check('it is on the canvas locally',
    A.state.placements.has(placementKey(canvasId, recId)));
  const trayAfter = await A.unplaced(canvasId, 200);
  check('and has left the tray',
    !(trayAfter.records as any[]).some((r) => r.id === recId));

  console.log('\nB2. A drag of N cards is ONE mutation');
  // The core design decision of the drag: positions move locally every frame,
  // and a single placement.move lands on drop. Ten cards, one log row.
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) {
    const id = randomUUID();
    ids.push(id);
    A.mutate({ type: 'record.create', id, tableId, data: { name: `bulk ${i}` } });
    A.mutate({
      type: 'placement.add', id: randomUUID(), canvasId, recordId: id,
      x: i * 30, y: 0, w: null, h: null, z: i,
    });
  }
  await A.settled();

  const seqBefore = Number((await (await fetch(`${API}/api/head`)).json()).seq);
  A.mutate({
    type: 'placement.move',
    canvasId,
    moves: ids.map((id, i) => ({ recordId: id, x: i * 30 + 500, y: 240, z: 100 + i })),
  });
  await A.settled();
  const seqAfter = Number((await (await fetch(`${API}/api/head`)).json()).seq);
  check('ten cards moved in a single log row', seqAfter - seqBefore === 1,
    `${seqAfter - seqBefore} rows`);

  const moved = await pool.query(
    `select count(*)::int n from placements
      where canvas_id = $1 and y = 240 and record_id = any($2::uuid[])`,
    [canvasId, ids]);
  check('all ten landed server-side', moved.rows[0].n === 10, `${moved.rows[0].n}`);

  console.log('\nB3. Another client sees the move');
  await B.loadScene(canvasId);
  for (let i = 0; i < 60; i++) {
    const p = B.state.placements.get(placementKey(canvasId, ids[0]));
    if (p && p.y === 240) break;
    await sleep(50);
  }
  const bp = B.state.placements.get(placementKey(canvasId, ids[0]));
  check('B has the moved position', bp?.y === 240, JSON.stringify(bp));
  check('B has all eleven cards',
    [...B.state.placements.values()].filter((p) => p.canvas_id === canvasId).length === 11);

  console.log('\nB4. Unplacing is not deleting — through the canvas path');
  A.mutate({ type: 'placement.remove', canvasId, recordId: recId });
  await A.settled();
  check('placement gone locally', !A.state.placements.has(placementKey(canvasId, recId)));
  check('the record survives locally', A.state.records.has(recId));
  const stillThere = await pool.query(`select count(*)::int n from records where id=$1`, [recId]);
  check('and survives server-side', stillThere.rows[0].n === 1);
  const trayAgain = await A.unplaced(canvasId, 200);
  check('it is back in the tray',
    (trayAgain.records as any[]).some((r) => r.id === recId));

  console.log('\nB5. Resize persists w/h');
  A.mutate({ type: 'placement.update', canvasId, recordId: ids[0], w: 380, h: 210 });
  await A.settled();
  const sized = await pool.query(
    `select w, h from placements where canvas_id=$1 and record_id=$2`, [canvasId, ids[0]]);
  check('width and height stored', sized.rows[0].w === 380 && sized.rows[0].h === 210,
    JSON.stringify(sized.rows[0]));

  console.log('\nB6. Only links with BOTH ends on the canvas are drawable');
  const linkField = randomUUID();
  const offCanvas = randomUUID();
  A.mutate({ type: 'field.create', id: linkField, tableId, name: 'Rel', key: 'rel', fieldType: 'link', options: { target_table_id: tableId }, required: false });
  A.mutate({ type: 'record.create', id: offCanvas, tableId, data: { name: 'not placed' } });
  await A.settled();
  A.mutate({ type: 'link.add', id: randomUUID(), fieldId: linkField, fromRecord: ids[0], toRecord: ids[1] });
  A.mutate({ type: 'link.add', id: randomUUID(), fieldId: linkField, fromRecord: ids[0], toRecord: offCanvas });
  await A.settled();

  const scene = await A.loadScene(canvasId);
  check('the both-ends-placed link is returned', scene.links.length === 1,
    `${scene.links.length} links`);
  check('the dangling one is filtered out server-side',
    !scene.links.some((l: any) => l.to_record === offCanvas));

  // And the geometry can route it — the join between parts A and B.
  const rects = new Map<string, Rect>();
  for (const p of scene.placements) {
    rects.set(p.record_id, { x: p.x, y: p.y, w: p.w ?? 240, h: p.h ?? 108 });
  }
  const l = scene.links[0];
  const fr = rects.get(l.from_record)!;
  const to = rects.get(l.to_record)!;
  const sides = bestSides(fr, to);
  const d = bezierPath(anchorPoint(fr, sides.from), sides.from, anchorPoint(to, sides.to), sides.to);
  check('a real link produces a usable path', d.startsWith('M') && !d.includes('NaN'), d);

  console.log('\nB7. Deleting a record takes its card and arrows with it');
  A.mutate({ type: 'record.delete', id: ids[1] });
  await A.settled();
  check('card gone', !A.state.placements.has(placementKey(canvasId, ids[1])));
  check('its link gone too',
    ![...A.state.links.values()].some((x) => x.to_record === ids[1]));
  for (let i = 0; i < 60 && B.state.records.has(ids[1]); i++) await sleep(50);
  check('B lost the card as well', !B.state.placements.has(placementKey(canvasId, ids[1])));

  // Undo should bring back the card AND the arrow — the cascade the capture work
  // exists for, now visible on a canvas.
  const undoable = await A.undoable(50);
  const entry = undoable.find((e) => e.type === 'record.delete' && !e.undone_by);
  check('the delete is undoable', !!entry);
  if (entry) {
    await A.undo(entry.id);
    await A.settled();
    check('the card is back on the canvas',
      A.state.placements.has(placementKey(canvasId, ids[1])));
    check('and so is its arrow',
      [...A.state.links.values()].some((x) => x.to_record === ids[1]));
  }

  console.log('\nB8. Link fields are visible from the GRID, not just the canvas');
  // A link is a row in `links`, not a value in `records.data`, so a grid
  // rendering `record.data[field.key]` finds nothing and shows the column blank —
  // while the canvas reads the links table and draws an arrow. Same relation,
  // visible in one view and invisible in the other. loadRecords now returns the
  // links touching the page, plus labels for far-end records in tables the client
  // has not loaded.
  // Asserted on the STORE, not on the fetched page: loadTable now walks the whole
  // table and returns nothing, and what the grid renders from is state anyway.
  await A.loadTable(tableId, { force: true });
  const gridLinks = [...A.state.links.values()].filter((l) => ids.includes(l.from_record));
  check('loading a table brings its links into the store', gridLinks.length > 0,
    `${gridLinks.length}`);
  check('and both endpoints of each can be named',
    gridLinks.every((l) => A.state.records.has(l.from_record)
      && (A.state.records.has(l.to_record) || A.farLabels.has(l.to_record))));

  // The far end is the interesting case: a link pointing at a record in another
  // table the grid never loaded would otherwise render as a raw UUID.
  const otherTable = randomUUID();
  const otherRec = randomUUID();
  A.mutate({ type: 'table.create', id: otherTable, name: `Far ${Date.now()}`, singularName: 'Far', color: '', icon: '' });
  A.mutate({ type: 'field.create', id: randomUUID(), tableId: otherTable, name: 'Name', key: 'name', fieldType: 'text', options: {}, required: false });
  A.mutate({ type: 'record.create', id: otherRec, tableId: otherTable, data: { name: 'far side' } });
  const crossField = randomUUID();
  A.mutate({ type: 'field.create', id: crossField, tableId, name: 'Cross', key: 'cross', fieldType: 'link', options: { target_table_id: otherTable }, required: false });
  await A.settled();
  A.mutate({ type: 'link.add', id: randomUUID(), fieldId: crossField, fromRecord: ids[0], toRecord: otherRec });
  await A.settled();

  await A.loadTable(tableId, { force: true });
  check('a cross-table link comes back with the table',
    [...A.state.links.values()].some((l) => l.to_record === otherRec));
  check('and its far-end record is labelled, not a bare uuid',
    A.farLabels.get(otherRec) === 'far side', A.farLabels.get(otherRec));

  // Editing from the grid: link.remove then link.add, the same mutations the
  // canvas would use.
  A.mutate({ type: 'link.remove', fieldId: crossField, fromRecord: ids[0], toRecord: otherRec });
  await A.settled();
  // Asked of the SERVER directly — the store would say yes either way, since it
  // applied the removal optimistically.
  const serverLinks = async () =>
    (await (await fetch(`${API}/api/tables/${tableId}/records?limit=500`)).json())
      .links as Array<{ to_record: string }>;
  check('removing a link from the grid works',
    !(await serverLinks()).some((l) => l.to_record === otherRec));

  A.mutate({ type: 'link.add', id: randomUUID(), fieldId: crossField, fromRecord: ids[0], toRecord: otherRec });
  await A.settled();
  check('and adding one back works',
    (await serverLinks()).some((l) => l.to_record === otherRec));

  console.log('\nB8b. Card height is arithmetic (arrows attach to a computed edge)');
  check('each extra row adds exactly one row height', cardHeight(4, false) - cardHeight(3, false) === CARD_ROW_H);
  check('a folded card is title-only, however many fields it has',
    cardHeight(9, true) === cardHeight(0, false) && cardHeight(9, true) < cardHeight(1, false));
  check('a user-set height wins while open — and is ignored while folded',
    effectiveHeight(400, 3, false) === 400 && effectiveHeight(400, 3, true) === cardHeight(3, true));

  console.log('\nB8b2. Ports: where a row sits, by arithmetic');
  const open3 = cardHeight(3, false);
  check('rows are evenly spaced, one row height apart',
    rowPortY(1, open3, false)! - rowPortY(0, open3, false)! === CARD_ROW_H && rowPortY(2, open3, false)! - rowPortY(1, open3, false)! === CARD_ROW_H);
  check('every row of an unresized card is inside it', [0, 1, 2].every((i) => { const y = rowPortY(i, open3, false); return y !== null && y > 0 && y < open3; }));
  check('a FOLDED card has no ports — arrows go to its edge', rowPortY(0, cardHeight(3, true), true) === null);
  check('a row clipped away by resizing the card shorter is not a port either',
    rowPortY(2, cardHeight(1, false), false) === null && rowPortY(0, cardHeight(1, false), false) !== null);

  console.log('\nB8b2b. Notes on cards: still arithmetic');
  check('a note block adds a FIXED amount to a card — its height never depends on how long the note is',
    cardHeight(3, false, 1) - cardHeight(3, false) === CARD_RICH_H && cardHeight(3, false, 2) - cardHeight(3, false, 1) === CARD_RICH_H);
  check('a card with a note and NO rows still has a body', cardHeight(0, false, 1) > cardHeight(0, false));
  check('folded, a note adds nothing', cardHeight(3, true, 2) === cardHeight(3, true));
  check('a user-set height wins over the arithmetic (the blocks share what is left)', effectiveHeight(400, 3, false, 1) === 400);
  check('blocks sit BELOW the rows, so a row\'s port is where it was — note or no note',
    rowPortY(1, cardHeight(3, false, 1), false) === rowPortY(1, cardHeight(3, false), false));

  console.log('\nB8b2c. Where a selected arrow\'s label goes');
  const mid = bezierMid({ x: 0, y: 0 }, 'right', { x: 400, y: 0 }, 'left');
  check('the midpoint of a straight left-to-right arrow is halfway along it, on it', Math.abs(mid.x - 200) < 0.01 && Math.abs(mid.y) < 0.01, JSON.stringify(mid));
  const mid2 = bezierMid({ x: 0, y: 0 }, 'right', { x: 400, y: 300 }, 'left');
  check('for a diagonal one it is still between the two ends — not out at a control point', mid2.x > 100 && mid2.x < 300 && mid2.y > 100 && mid2.y < 200, JSON.stringify(mid2));

  console.log('\nB8b3. Arrow style on a link field');
  check('read tolerantly: a good colour and reversed are kept, junk is ignored',
    JSON.stringify(arrowStyleOf({ options: { arrow: { color: '#3B82F6', reversed: true } } })) === '{"color":"#3B82F6","reversed":true}'
    && JSON.stringify(arrowStyleOf({ options: { arrow: { color: 'blue', reversed: 'yes' } } })) === '{}'
    && JSON.stringify(arrowStyleOf({ options: {} })) === '{}');
  check('validated strictly on write', arrowStyleError({ arrow: { color: '#123456' } }) === null && arrowStyleError({}) === null
    && /#3b82f6/.test(arrowStyleError({ arrow: { color: 'blue' } }) ?? '') && /no setting/.test(arrowStyleError({ arrow: { dashed: true } }) ?? ''));

  console.log('\nB8c. What a canvas says about its cards');
  const F = (id: string) => ({ id });
  const fs6 = ['p', 'a', 'b', 'c', 'd', 'e', 'f', 'g'].map(F);
  check('default: the first few fields, WITHOUT the primary (it is the title)',
    cardFieldsFor({}, 't', fs6, 'p').map((f) => f.id).join('') === 'abcde'
    && cardFieldsFor(undefined, 't', fs6, 'p').length === DEFAULT_CARD_FIELDS);
  check('a choice for the table is used, in the chosen order',
    cardFieldsFor({ cardFields: { [tableId]: [] } }, tableId, fs6, 'p').length === 0);
  const u1 = randomUUID(), u2 = randomUUID(), gone = randomUUID();
  check('ids that no longer resolve are skipped, not errors',
    cardFieldsFor({ cardFields: { [tableId]: [u2, gone, u1] } }, tableId, [F(u1), F(u2)], undefined).map((f) => f.id).join() === `${u2},${u1}`);
  check('a malformed config falls back to the default rather than throwing',
    cardFieldsFor({ cardFields: 'nope' }, 't', fs6, 'p').length === DEFAULT_CARD_FIELDS);

  const nameField = [...A.state.fields.values()].find((f) => f.table_id === tableId && f.key === 'name')!;
  A.mutate({ type: 'canvas.update', id: canvasId, config: { cardFields: { [tableId]: [nameField.id] } } });
  await A.settled();
  const savedCfg = (await pool.query(`select config from canvases where id = $1`, [canvasId])).rows[0].config;
  check('the config is stored on the canvas', savedCfg.cardFields?.[tableId]?.[0] === nameField.id, JSON.stringify(savedCfg));
  check('a peer receives it live', await waitFor(() =>
    (B.state.canvases.get(canvasId)?.config as any)?.cardFields?.[tableId]?.[0] === nameField.id));
  const C = createStore({ baseUrl: API });
  await C.hydrate(); await C.loadScene(canvasId);
  check('and a fresh client gets it with the scene', (C.state.canvases.get(canvasId)?.config as any)?.cardFields?.[tableId]?.[0] === nameField.id,
    JSON.stringify(C.state.canvases.get(canvasId)));
  C.stop();
  const badCfg = await fetch(`${API}/api/mutate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: randomUUID(), mutations: [{ id: randomUUID(), mutation: { type: 'canvas.update', id: canvasId, config: { cardfields: {} } } }] }) });
  check('a config in the wrong shape is a 400', badCfg.status === 400, `${badCfg.status}`);

  const styled = await fetch(`${API}/api/mutate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: randomUUID(), mutations: [
      { id: randomUUID(), mutation: { type: 'field.update', id: linkField, options: { target_table_id: tableId, arrow: { color: '#ff8800', reversed: true } } } }] }) });
  check('the server accepts a valid arrow style on a link field', styled.status === 200, `${styled.status}`);
  const badStyle = await fetch(`${API}/api/mutate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: randomUUID(), mutations: [
      { id: randomUUID(), mutation: { type: 'field.update', id: linkField, options: { target_table_id: tableId, arrow: { color: 'orange' } } } }] }) });
  check('and refuses a malformed one', badStyle.status === 400, `${badStyle.status}`);
  check('a peer sees the style arrive', await waitFor(() => arrowStyleOf(B.state.fields.get(linkField) ?? {}).color === '#ff8800'));

  A.mutate({ type: 'placement.update', canvasId, recordId: ids[0], collapsed: true });
  await A.settled();
  check('folding a card is per placement, stored, and reaches a peer',
    (await pool.query(`select collapsed from placements where canvas_id=$1 and record_id=$2`, [canvasId, ids[0]])).rows[0].collapsed === true
    && await waitFor(() => B.state.placements.get(placementKey(canvasId, ids[0]))?.collapsed === true));

  console.log('\nB9. An unbootstrapped database says so, and loses nothing');
  // `currentActor()` picks the first user in the table, so with no users EVERY
  // write fails while reads keep working — an unconfigured database looks like a
  // half-broken one. This used to surface as a bare "Internal Server Error",
  // because currentActor() was called OUTSIDE the mutate handler's try block, so
  // the one message written to explain the problem was the one you could never
  // see.
  const admins = await pool.query(`select id, email, name, role from users`);
  await pool.query(`delete from users`);
  try {
    const res = await fetch(`${API}/api/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: randomUUID(),
        mutations: [{
          id: randomUUID(),
          mutation: { type: 'record.create', id: randomUUID(), tableId: BOARDS, data: { name: 'x' } },
        }],
      }),
    });
    const body = await res.json().catch(() => ({}));
    // 503, not 500: the server is fine, it is unconfigured — a state the caller
    // can fix, and one that should not sit in the "server crashed" bucket.
    check('an unbootstrapped write returns 503', res.status === 503, `${res.status}`);
    check('and the body says what to run',
      typeof (body as any).error === 'string' && (body as any).error.includes('bootstrap'),
      JSON.stringify(body));
  } finally {
    // Put the users back before anything else runs.
    for (const u of admins.rows) {
      await pool.query(
        `insert into users (id, email, name, role) values ($1,$2,$3,$4)
         on conflict (id) do nothing`, [u.id, u.email, u.name, u.role]);
    }
  }
  const restored = await pool.query(`select count(*)::int n from users`);
  check('users restored for the remaining tests', restored.rows[0].n === admins.rowCount);

  check('no apply errors on A', A.errors.value.length === 0, A.errors.value.join(' | '));
  check('no apply errors on B', B.errors.value.length === 0, B.errors.value.join(' | '));

  A.stop(); B.stop();
}

async function main() {
  partA();
  await partB();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  await server?.stop();
  await pool.end();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await server?.stop();
  await pool.end().catch(() => {});
  process.exit(1);
});
