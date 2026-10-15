/**
 * Canvas STACKS — a saved view, placed (contract/canvasStack.ts).
 *
 *   S1  the rules, without a server: layout arithmetic, the census (who is in, who is
 *       elsewhere, who is missing, who is stale, the cap), what a drop can set, the
 *       label, and the `is` filter op in applyView
 *   S2  on the canvas: a stack in the config draws a frame, and its matching records
 *       are PLACED into it — with no undo step; a record that comes to match later
 *       appears; one that stops matching stays, dimmed; a matching card placed by
 *       hand is counted as elsewhere and gathered on request
 *   S3  the stack's own menu: break out keeps the cards; remove unplaces them (asked)
 *   S4  a card dragged out of its stack is placed by hand where it was let go; a card
 *       dropped into a link-filtered stack is given the link and joins
 *   S5  the editor: table, filter lines, a preview that counts, and Make stack
 *
 * happy-dom has no layout: the canvas's rectangle is faked (800×600 at 0,0) so world
 * coordinates are real, as the other canvas suites do.
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';
import { boardsTableMutations } from './harness.js';
import { applyView, type ViewField, type ViewRecord } from '../src/contract/views.js';
import { STACK_HEAD_H, STACK_MAX, STACK_MIN_W, STACK_PAD, STACK_GAP, describeFilters, stackCensus, stackDropLinks, stackLayout } from '../src/contract/canvasStack.js';
import { CanvasConfig } from '../src/contract/canvasConfig.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

function pure() {
  console.log('\nS1. The rules, without a server');
  const id = randomUUID;
  const works = id(), delivs = id();
  const fName: ViewField = { id: id(), key: 'name', type: 'text' };
  const fWork: ViewField = { id: id(), key: 'work', type: 'link', options: { target_table_id: works } };
  const fStatus: ViewField = { id: id(), key: 'status', type: 'select', options: { choices: ['todo', 'done'] } };
  const fields = [fName, fWork, fStatus];
  const ep101 = id(), ep102 = id();
  const rec = (name: string, status?: string): ViewRecord => ({ id: id(), data: { name, ...(status ? { status } : {}) } });
  const a = rec('DCP', 'todo'), b = rec('ProRes', 'done'), c = rec('Trailer'), d = rec('Stills');
  const linksOf = new Map<string, string[]>([[a.id, [ep101]], [b.id, [ep101]], [c.id, [ep102]]]);
  const linkIds = (r: string, f: string) => (f === fWork.id ? linksOf.get(r) ?? [] : []);
  const labels = (r: string, f: string) => linkIds(r, f).map((x) => (x === ep101 ? 'Ep 101' : 'Ep 102'));
  const records = [a, b, c, d];

  // The `is` op.
  const isEp101 = { fieldId: fWork.id, op: 'is' as const, value: ep101 };
  check('`is` on a link keeps the records linked to THAT record — identity, not text',
    applyView(records, fields, { sort: [], filters: [isEp101], hidden: [] }, labels, linkIds).map((r) => r.data.name).join() === 'DCP,ProRes');
  check('`is` without link ids is inert (filters nothing), like a half-built filter',
    applyView(records, fields, { sort: [], filters: [isEp101], hidden: [] }, labels).length === 4);
  check('`is` on a non-link field is inert', applyView(records, fields, { sort: [], filters: [{ fieldId: fStatus.id, op: 'is', value: 'x' }], hidden: [] }, labels, linkIds).length === 4);

  // The census.
  const stack = { id: id(), tableId: delivs, filters: [isEp101], sort: [{ fieldId: fName.id, dir: 'desc' as const }] };
  const placed = new Map<string, string | undefined>([[a.id, stack.id], [b.id, ''], [d.id, stack.id]]);
  const census = stackCensus(stack, records, fields, (r) => placed.get(r), labels, linkIds);
  check('matching, in the stack\'s order', census.matching.map((x) => x === a.id ? 'a' : 'b').join() === 'b,a' && census.total === 2);
  check('in the stack / placed elsewhere / missing: told apart by where each card is', census.inStack.join() === a.id && census.elsewhere.join() === b.id && census.missing.length === 0);
  check('a card IN the stack that no longer matches is stale', census.stale.join() === d.id);
  check('the stack draws its own first, then the stale', census.order.join() === [a.id, d.id].join());
  const empty = stackCensus({ ...stack, filters: [] }, records, fields, () => undefined, labels, linkIds);
  check('no filter: everything matches, nothing is placed → all missing', empty.total === 4 && empty.missing.length === 4);
  const many = Array.from({ length: STACK_MAX + 7 }, (_, i) => rec(`r${i}`));
  const capped = stackCensus({ ...stack, filters: [] }, many, fields, () => undefined, labels, linkIds);
  check(`the cap: ${STACK_MAX} placed of ${STACK_MAX + 7} matched — and the total is still said`, capped.matching.length === STACK_MAX && capped.total === STACK_MAX + 7 && capped.missing.length === STACK_MAX);

  // Layout.
  const L = stackLayout({ x: 100, y: 50, w: null, collapsed: false }, [{ recordId: 'p', h: 80, w: 240 }, { recordId: 'q', h: 120, w: 300 }]);
  check('as wide as its widest card wants (+ padding); the frame is the bar, the cards, the gaps and the padding',
    L.rect.w === 300 + 2 * STACK_PAD && L.cardW === 300 && L.rect.h === STACK_HEAD_H + STACK_PAD + 80 + STACK_GAP + 120 + STACK_PAD, JSON.stringify(L.rect));
  check('cards sit in a column under the bar, each at the stack\'s card width',
    L.cards.get('p')!.x === 100 + STACK_PAD && L.cards.get('p')!.y === 50 + STACK_HEAD_H + STACK_PAD && L.cards.get('q')!.y === L.cards.get('p')!.y + 80 + STACK_GAP && L.cards.get('q')!.w === 300);
  const hand = stackLayout({ x: 0, y: 0, w: 400, collapsed: false }, [{ recordId: 'p', h: 80, w: 240 }]);
  check('a hand-set width wins, and the cards take it', hand.rect.w === 400 && hand.cards.get('p')!.w === 400 - 2 * STACK_PAD);
  check('never narrower than the minimum', stackLayout({ x: 0, y: 0, w: null, collapsed: false }, [{ recordId: 'p', h: 80, w: 100 }]).rect.w === STACK_MIN_W);
  const folded = stackLayout({ x: 0, y: 0, w: null, collapsed: true }, [{ recordId: 'p', h: 80, w: 240 }]);
  check('folded: the bar alone, no card placed', folded.rect.h === STACK_HEAD_H && folded.cards.size === 0);
  check('empty: the bar and a line to say so', stackLayout({ x: 0, y: 0, w: null, collapsed: false }, []).rect.h > STACK_HEAD_H);

  // What a drop can set.
  check('a filter of "<link> is <record>" lines is something a drop can set — the links',
    JSON.stringify(stackDropLinks(stack, fields, delivs)) === JSON.stringify([{ fieldId: fWork.id, recordId: ep101 }]));
  check('…a record of another table: not', stackDropLinks(stack, fields, works) === null);
  check('…a filter with any other kind of line: not', stackDropLinks({ ...stack, filters: [isEp101, { fieldId: fStatus.id, op: 'eq', value: 'done' }] }, fields, delivs) === null);
  check('…no filter at all: not (nothing to set)', stackDropLinks({ ...stack, filters: [] }, fields, delivs) === null);

  // The label.
  const nameOf = (f: string) => fields.find((x) => x.id === f) && (f === fWork.id ? 'Work' : f === fStatus.id ? 'Status' : 'Name');
  check('the filter, read aloud', describeFilters([isEp101, { fieldId: fStatus.id, op: 'neq', value: 'done' }, { fieldId: fName.id, op: 'notEmpty' }], nameOf, (r) => (r === ep101 ? 'Ep 101' : '?')) === 'Work is Ep 101 · Status is not done · Name is not empty');
  check('no filter reads as every record', describeFilters([], nameOf, () => '') === 'every record');

  // The config.
  const cfg = CanvasConfig.safeParse({ cardFields: {}, stacks: [{ id: stack.id, tableId: delivs, filters: [isEp101], sort: [], x: 1, y: 2 }] });
  check('a stack in the canvas config parses, with its defaults', cfg.success && cfg.data.stacks![0].w === null && cfg.data.stacks![0].collapsed === false);
  check('…and a bad one is refused', !CanvasConfig.safeParse({ cardFields: {}, stacks: [{ id: 'x', tableId: delivs, x: 1, y: 2 }] }).success);
}

async function main() {
  pure();
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8846));
  const { w, win, pool, until, untilDb, post, nav } = ui;
  try {
    const tWorks = randomUUID(), tDelivs = randomUUID(), tBoards = randomUUID();
    const fWName = randomUUID(), fDName = randomUUID(), fWork = randomUUID(), fStatus = randomUUID();
    const ep101 = randomUUID(), ep102 = randomUUID(), dcp = randomUUID(), prores = randomUUID(), trailer = randomUUID(), stills = randomUUID(), board = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const setup = await post([
      { type: 'table.create', id: tWorks, name: 'Works', singularName: 'Work' }, { type: 'table.create', id: tDelivs, name: 'Deliverables', singularName: 'Deliverable' }, ...boardsTableMutations(tBoards),
      { type: 'field.create', id: fWName, tableId: tWorks, name: 'Name', key: 'name', fieldType: 'text' }, pos(fWName, 0),
      { type: 'field.create', id: fDName, tableId: tDelivs, name: 'Name', key: 'name', fieldType: 'text' }, pos(fDName, 0),
      { type: 'field.create', id: fWork, tableId: tDelivs, name: 'Work', key: 'work', fieldType: 'link', options: { target_table_id: tWorks } }, pos(fWork, 1),
      { type: 'field.create', id: fStatus, tableId: tDelivs, name: 'Status', key: 'status', fieldType: 'select', options: { choices: ['todo', 'done'] } }, pos(fStatus, 2),
      { type: 'record.create', id: ep101, tableId: tWorks, data: { name: 'Ep 101' } }, { type: 'record.create', id: ep102, tableId: tWorks, data: { name: 'Ep 102' } },
      { type: 'record.create', id: dcp, tableId: tDelivs, data: { name: 'DCP', status: 'todo' } }, { type: 'record.create', id: prores, tableId: tDelivs, data: { name: 'ProRes', status: 'done' } },
      { type: 'record.create', id: trailer, tableId: tDelivs, data: { name: 'Trailer' } }, { type: 'record.create', id: stills, tableId: tDelivs, data: { name: 'Stills' } },
      { type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: dcp, toRecord: ep101 },
      { type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: prores, toRecord: ep101 },
      { type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: trailer, toRecord: ep102 },
      { type: 'record.create', id: board, tableId: tBoards, data: { name: 'Ep 101 board' } },
      // The ProRes is on the canvas BY HAND, far from where the stack will be.
      { type: 'placement.add', id: randomUUID(), canvasId: board, recordId: prores, x: 900, y: 700, w: null, h: null, z: 1 },
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 300));

    const PE = (win as any).PointerEvent ?? (win as any).MouseEvent;
    const winEv = (type: string, init: Record<string, unknown>) => win.dispatchEvent(new PE(type, { bubbles: true, ...init }));
    const cardOf = (name: string) => w.findAll('.canvas-world .card').find((x: any) => x.find('.card-label').text() === name)!;
    const frames = () => w.findAll('.canvas-world .stack');
    const frame = () => frames()[0];
    // The save queue flushes a moment after the UI moves: DB checks WAIT for the expected state.
    const stackOf = async (recordId: string) => (await pool.query(`select style->>'stack' as s from placements where canvas_id = $1 and record_id = $2`, [board, recordId])).rows[0]?.s ?? null;
    const stackIs = async (recordId: string, expected: string | null) => { const t = Date.now(); while (Date.now() - t < 5000) { if ((await stackOf(recordId)) === expected) return true; await sleep(100); } return false; };
    const placedCountNow = async () => Number((await pool.query(`select count(*)::int as n from placements where canvas_id = $1`, [board])).rows[0].n);
    const placedCount = async (expected: number) => { const t = Date.now(); let n = -1; while (Date.now() - t < 5000) { n = await placedCountNow(); if (n === expected) return n; await sleep(100); } return n; };
    const box = (el: any, r: { left: number; top: number; right: number; bottom: number }) => { (el.element as HTMLElement).getBoundingClientRect = () => ({ ...r, width: r.right - r.left, height: r.bottom - r.top, x: r.left, y: r.top, toJSON() {} }) as DOMRect; };
    const world = () => w.find('.canvas-world').attributes('style') ?? '';
    const tf = () => { const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(world())!; return { x: Number(m[1]), y: Number(m[2]), s: Number(m[3]) }; };
    const toClient = (wx: number, wy: number) => { const t = tf(); return { clientX: t.x + wx * t.s, clientY: t.y + wy * t.s }; };
    const rectOf = (el: any) => { const st = el.attributes('style') ?? ''; const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(st)!; const wm = /width:\s*([\d.]+)px/.exec(st)!; const hm = /height:\s*([\d.]+)px/.exec(st)!; return { x: Number(m[1]), y: Number(m[2]), w: Number(wm[1]), h: Number(hm[1]) }; };
    const menu = () => w.find('.canvas-container .ctx');

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nS2. A stack in the config: a frame, and its records placed into it');
    win.location.hash = `#/all/canvas/${board}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => !!cardOf('ProRes'), 12000);
    void nav;
    const stackId = randomUUID();
    const stackDef = { id: stackId, tableId: tDelivs, filters: [{ fieldId: fWork, op: 'is', value: ep101 }], sort: [{ fieldId: fDName, dir: 'asc' }], x: 100, y: 100, w: null, collapsed: false };
    const set = await post([{ type: 'canvas.update', id: board, config: { cardFields: {}, stacks: [stackDef] } }]);
    check('a stack is accepted into the canvas config', set.status === 200, (await set.text()).slice(0, 200));
    check('the frame is drawn, labelled with its table and its filter', await until(() => frames().length === 1, 8000) && frame().find('.stack-table').text() === 'Deliverables' && frame().find('.stack-label').text() === 'Work is Ep 101', frame()?.text());
    check('the DCP — matching, not on the canvas — is placed INTO the stack', await untilDb(`select 1 from placements where canvas_id = '${board}' and record_id = '${dcp}' and style->>'stack' = '${stackId}'`, (r) => r.length === 1, 8000).then((r) => r.length === 1));
    await until(() => !!cardOf('DCP'), 4000);
    check('…and drawn inside the frame, as a stacked card', cardOf('DCP').classes('stacked') && (() => { const f = rectOf(frame()), c = rectOf(cardOf('DCP')); return c.x === f.x + STACK_PAD && c.y === f.y + STACK_HEAD_H + STACK_PAD && c.w === f.w - 2 * STACK_PAD; })(), `${rectOf(frame()) && JSON.stringify(rectOf(frame()))} ${JSON.stringify(rectOf(cardOf('DCP')))}`);
    check('the ProRes, placed BY HAND, is not moved: counted as elsewhere, with a gather button', !cardOf('ProRes').classes('stacked') && frame().find('.stack-gather').exists() && frame().find('.stack-gather').text().startsWith('1 elsewhere'), frame().text());
    check('the count is what the stack holds', frame().find('.stack-n').text() === '1');
    check('a stacked card has no × and no sideways resize', !cardOf('DCP').find('.card-unplace').exists() && !cardOf('DCP').find('.handle-e').exists() && cardOf('ProRes').find('.card-unplace').exists());
    await w.find('.canvas-container').trigger('keydown', { key: 'z', ctrlKey: true });
    await sleep(300);
    check('placing it was not an undo step: Ctrl+Z has nothing to take back', !!cardOf('DCP') && (await stackOf(dcp)) === stackId);

    // A deliverable that comes to match later appears.
    const bonus = randomUUID();
    await post([{ type: 'record.create', id: bonus, tableId: tDelivs, data: { name: 'Bonus' } }, { type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: bonus, toRecord: ep101 }]);
    check('a deliverable assigned to Ep 101 LATER appears in the stack', await until(() => !!cardOf('Bonus') && cardOf('Bonus').classes('stacked'), 8000) && await stackIs(bonus, stackId),
      `card=${!!cardOf('Bonus')} stacked=${cardOf('Bonus')?.classes('stacked')} db=${await stackOf(bonus)} frame=${frame().text()}`);
    check('…in the stack\'s order (by name): Bonus above DCP', rectOf(cardOf('Bonus')).y < rectOf(cardOf('DCP')).y);
    check('the Trailer (Ep 102) and the Stills (no work) are not placed', !cardOf('Trailer') && !cardOf('Stills'));

    // Added while AWAY from the canvas — in the table's grid — then back: the race the
    // owner hit (the stack's table already loaded, the scene not yet) — the card must be
    // there, in this tab, not only on the server.
    win.location.hash = `#/all/table/${tDelivs}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.find('.gridview').exists() && !w.find('.canvas-container').exists(), 8000);
    const away = randomUUID();
    await post([{ type: 'record.create', id: away, tableId: tDelivs, data: { name: 'Away' } }, { type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: away, toRecord: ep101 }]);
    await until(() => w.findAll('.gridview tr.row').some((r: any) => r.text().includes('Away')), 8000);
    win.location.hash = `#/all/canvas/${board}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    check('a deliverable added while in the grid is in the stack when the canvas is opened again — and stays',
      await until(() => !!cardOf('Away') && cardOf('Away').classes('stacked'), 8000) && await stackIs(away, stackId) && await (async () => { await sleep(1500); return !!cardOf('Away') && cardOf('Away').classes('stacked'); })());
    await until(() => !!cardOf('Bonus') && !!cardOf('DCP'), 4000);

    // Gather.
    await frame().find('.stack-gather').trigger('click');
    check('gather: the ProRes joins the stack', await until(() => cardOf('ProRes').classes('stacked'), 4000) && await stackIs(prores, stackId) && !frame().find('.stack-gather').exists());
    check('…undoable: Ctrl+Z puts it back by hand', await (async () => { await w.find('.canvas-container').trigger('keydown', { key: 'z', ctrlKey: true }); return until(() => !cardOf('ProRes').classes('stacked'), 4000); })() && await stackIs(prores, null));
    await w.find('.canvas-container').trigger('keydown', { key: 'y', ctrlKey: true });
    await until(() => cardOf('ProRes').classes('stacked'), 4000);

    // Stops matching → stale.
    await post([{ type: 'link.remove', fieldId: fWork, fromRecord: dcp, toRecord: ep101 }]);
    check('un-assigning the DCP leaves its card in the stack, dimmed, and says so', await until(() => cardOf('DCP')?.classes('stale'), 8000) && cardOf('DCP').find('.card-stale').text() === 'no longer matches' && frame().find('.stack-stale').text().startsWith('1'));
    check('…at the BOTTOM, under the matching ones', rectOf(cardOf('DCP')).y > rectOf(cardOf('ProRes')).y);
    check('…and it has its × back', cardOf('DCP').find('.card-unplace').exists());
    await post([{ type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: dcp, toRecord: ep101 }]);
    await until(() => !cardOf('DCP').classes('stale'), 8000);

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nS3. The stack\'s menu: break out keeps the cards; remove unplaces them');
    await frame().trigger('contextmenu', { clientX: 20, clientY: 20 });
    check('right-click on the frame: its menu', await until(() => menu().exists() && menu().find('.stack-breakout').exists()), menu()?.text());
    const before = { bonus: rectOf(cardOf('Bonus')), dcp: rectOf(cardOf('DCP')) };
    await menu().find('.stack-breakout').trigger('click');
    check('break out: the frame is gone, the cards stay — by hand, where they were drawn',
      await until(() => frames().length === 0 && !cardOf('Bonus').classes('stacked'), 4000)
        && rectOf(cardOf('Bonus')).x === before.bonus.x && rectOf(cardOf('Bonus')).y === before.bonus.y && rectOf(cardOf('DCP')).y === before.dcp.y
        && await stackIs(bonus, null) && (await placedCount(4)) === 4);
    await w.find('.canvas-container').trigger('keydown', { key: 'z', ctrlKey: true });
    check('…one Ctrl+Z: the stack is back with its cards', await until(() => frames().length === 1 && cardOf('Bonus').classes('stacked') && cardOf('DCP').classes('stacked'), 4000));

    await frame().trigger('contextmenu', { clientX: 20, clientY: 20 });
    await until(() => menu().exists());
    await menu().find('.stack-remove').trigger('click');
    check('remove: asked first, naming how many cards', await until(() => nav.dialogs.seen.some((t) => t.startsWith('Remove this stack and its 4 cards')), 4000));
    check('…the frame and its cards are gone; the records are not', await until(() => frames().length === 0 && !cardOf('Bonus') && !cardOf('DCP') && !cardOf('ProRes'), 4000) && (await placedCount(0)) === 0
      && (await pool.query(`select count(*)::int as n from records where table_id = $1`, [tDelivs])).rows[0].n === 6);
    await w.find('.canvas-container').trigger('keydown', { key: 'z', ctrlKey: true });
    check('…one Ctrl+Z brings all of it back', await until(() => frames().length === 1 && !!cardOf('Bonus') && !!cardOf('DCP') && !!cardOf('ProRes') && cardOf('ProRes').classes('stacked'), 6000) && (await placedCount(4)) === 4);

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nS4. Dragging out of, and into, a stack');
    box(w.find('.canvas-container'), { left: 0, top: 0, right: 800, bottom: 600 });
    const dragCard = async (name: string, toWorld: { x: number; y: number }) => {
      const r = rectOf(cardOf(name));
      const from = toClient(r.x + 10, r.y + 10), to = toClient(toWorld.x + 10, toWorld.y + 10);
      await cardOf(name).trigger('pointerdown', { button: 0, pointerId: 1, ...from });
      winEv('pointermove', { ...from, clientX: from.clientX + 6, pointerId: 1 });
      await sleep(30);
      winEv('pointermove', { ...to, pointerId: 1 });
      await sleep(30);
      winEv('pointerup', { ...to, pointerId: 1 });
    };
    await dragCard('DCP', { x: 600, y: 400 });
    check('a card dragged OUT of the stack is placed by hand where it was let go',
      await until(() => !cardOf('DCP').classes('stacked'), 4000) && rectOf(cardOf('DCP')).x === 600 && rectOf(cardOf('DCP')).y === 400 && await stackIs(dcp, null));
    check('…and the stack now counts it as elsewhere', await until(() => frame().find('.stack-gather').exists() && frame().find('.stack-gather').text().startsWith('1 elsewhere'), 4000));
    const fr = rectOf(frame());
    await dragCard('DCP', { x: fr.x + 20, y: fr.y + 60 });
    check('dropped back INTO the stack (it matches): it joins', await until(() => cardOf('DCP').classes('stacked'), 4000) && await stackIs(dcp, stackId));
    // Trailer (Ep 102) placed by hand, then dropped on the Ep 101 stack: given the link, joins.
    await post([{ type: 'placement.add', id: randomUUID(), canvasId: board, recordId: trailer, x: 700, y: 100, w: null, h: null, z: 9 }]);
    await until(() => !!cardOf('Trailer'), 4000);
    const fr2 = rectOf(frame());
    await dragCard('Trailer', { x: fr2.x + 20, y: fr2.y + 60 });
    check('a Trailer dropped on "Work is Ep 101": it is LINKED to Ep 101 and joins',
      await until(() => cardOf('Trailer').classes('stacked'), 4000) && await stackIs(trailer, stackId)
        && (await untilDb(`select 1 from links where field_id = '${fWork}' and from_record = '${trailer}' and to_record = '${ep101}'`, (r) => r.length === 1)).length === 1);
    await w.find('.canvas-container').trigger('keydown', { key: 'z', ctrlKey: true });
    check('…one Ctrl+Z: unlinked and out again', await until(() => !cardOf('Trailer').classes('stacked'), 4000)
      && (await untilDb(`select 1 from links where field_id = '${fWork}' and from_record = '${trailer}' and to_record = '${ep101}'`, (r) => r.length === 0)).length === 0);
    // A Work dropped on a Deliverables stack: refused, flashed, left by hand where it fell.
    await post([{ type: 'placement.add', id: randomUUID(), canvasId: board, recordId: ep102, x: 700, y: 300, w: null, h: null, z: 10 }]);
    await until(() => !!cardOf('Ep 102'), 4000);
    const fr3 = rectOf(frame());
    await dragCard('Ep 102', { x: fr3.x + 20, y: fr3.y + 60 });
    check('a Work dropped on the Deliverables stack is refused — the frame flashes, the card is placed where it fell',
      await until(() => frame().classes('refused'), 2000) && await until(() => !cardOf('Ep 102').classes('stacked') && rectOf(cardOf('Ep 102')).x === fr3.x + 20, 4000) && await stackIs(ep102, null));

    // Several cards selected: no ⊕ on any of them (a link cannot be dragged from "several").
    await cardOf('DCP').trigger('pointerdown', { button: 0, clientX: 5, clientY: 5 }); winEv('pointerup', { clientX: 5, clientY: 5 });
    await until(() => cardOf('DCP').classes('selected'));
    check('one card selected: it has its ⊕', cardOf('DCP').find('.link-handle').exists());
    await cardOf('ProRes').trigger('pointerdown', { button: 0, shiftKey: true, clientX: 5, clientY: 5 }); winEv('pointerup', { clientX: 5, clientY: 5 });
    check('two selected: neither has one', await until(() => cardOf('ProRes').classes('selected') && cardOf('DCP').classes('selected')) && !cardOf('DCP').find('.link-handle').exists() && !cardOf('ProRes').find('.link-handle').exists());
    await w.find('.canvas-container').trigger('keydown', { key: 'Escape' });
    check('…and back when the selection is one again', await until(() => !cardOf('DCP').classes('selected')) && cardOf('DCP').find('.link-handle').exists());

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nS5. The editor');
    await w.find('.canvas-controls .new-stack').trigger('click');
    const ed = () => w.find('.stack-editor');
    check('"+ stack" opens the editor', await until(() => ed().exists()));
    // A table nothing has loaded yet (Works): the editor loads it itself — the preview must not sit on "loading…".
    await ed().find('.stack-table').setValue(tWorks);
    check('a table the canvas has not loaded: the preview counts it anyway', await until(() => ed().find('.preview-line').text().includes('2 records match'), 8000), ed().find('.preview-line')?.text());
    await ed().find('.stack-table').setValue(tDelivs);
    await until(() => ed().find('.add-filter').exists());
    await ed().find('.add-filter').trigger('click');
    await until(() => ed().findAll('.filter-lines .line').length === 1);
    const line = () => ed().find('.filter-lines .line');
    await line().findAll('select')[0].setValue(fWork);
    await until(() => line().findAll('select')[1].exists());
    await line().findAll('select')[1].setValue('is');
    check('"Work is": a record select of Works', await until(() => line().find('.record-select').exists(), 4000) && await until(() => line().find('.record-select').findAll('option').length === 3, 4000));
    await line().find('.record-select').setValue(ep102);
    check('the preview counts what matches now, and says what is new to the canvas',
      await until(() => ed().find('.preview-line').text().includes('1 record matches'), 4000) && ed().find('.preview-line').text().includes('0 new to the canvas') && ed().find('.preview-line').text().includes('1 placed elsewhere'), ed().find('.preview-line')?.text());
    check('…and lists them with where they are', ed().findAll('.preview-list li').length === 1 && ed().find('.preview-list li').text().includes('Trailer') && ed().find('.preview-list li .preview-tag').text() === 'placed elsewhere');
    await ed().find('.gather-check input').setValue(true);
    await ed().find('.stack-name').setValue('Ep 102 masters');
    await ed().find('.stack-ok').trigger('click');
    check('Make stack: a second frame whose bar is just the name — no table, no filter on it', await until(() => frames().length === 2, 4000) && frames()[1].find('.stack-label').text() === 'Ep 102 masters' && !frames()[1].find('.stack-table').exists() && !frames()[1].text().includes('Work is Ep 102'), frames()[1]?.text());
    check('…a named bar is the short one', rectOf(frames()[1]).h < rectOf(frames()[0]).h);
    await frames()[1].trigger('contextmenu', { clientX: 20, clientY: 20 });
    check('…its menu has the table and the filter, read aloud', await until(() => menu().exists()) && menu().find('.stack-ctx-table').text().startsWith('Deliverables') && menu().find('.stack-ctx-filter').text() === 'Work is Ep 102', menu()?.text());
    await w.find('.canvas-container').trigger('keydown', { key: 'Escape' });
    check('…gathered on request: the Trailer is in it', await until(() => cardOf('Trailer').classes('stacked'), 4000) && await (async () => { const t = Date.now(); while (Date.now() - t < 5000) { const v = await stackOf(trailer); if (v && v !== stackId) return true; await sleep(100); } return false; })());
    // Z fits the selection (the second stack, selected by its bar); Shift+Z fits everything.
    const barOf = (i: number) => frames()[i].find('.stack-head');
    await barOf(1).trigger('pointerdown', { button: 0, clientX: 5, clientY: 5 });
    winEv('pointerup', { clientX: 5, clientY: 5 });
    await until(() => frames()[1].classes('selected'));
    await w.find('.canvas-container').trigger('keydown', { key: 'z' });
    const sel = tf(), f2 = rectOf(frames()[1]);
    check('Z with a stack selected: the view is on that stack, zoomed in no further than 125%',
      Math.abs((f2.x + f2.w / 2) * sel.s + sel.x - 400) < 1 && Math.abs((f2.y + f2.h / 2) * sel.s + sel.y - 300) < 1 && sel.s <= 1.25, JSON.stringify(sel));
    await w.find('.canvas-container').trigger('keydown', { key: 'Z', shiftKey: true });
    const all = tf();
    check('Shift+Z: everything — further out', all.s < sel.s, JSON.stringify(all));
    check('…saved to the canvas, for everyone', (await untilDb(`select jsonb_array_length(config->'stacks') as n from canvases where id = '${board}'`, (r) => r[0]?.n === 2)).length === 1);
  } finally {
    await ui.close();
  }
}

main().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); console.log(`\nSUITE ABORTED — an exception ended it early; the tally above is incomplete`); process.exit(1); });
