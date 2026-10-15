/**
 * Links are SYMMETRICAL: one relation, two faces (Oct 15).
 *
 * A link field and its backlink show one set of rows; what could only be done from
 * the link's side can now be done from either. Pinned here:
 *
 *   Y1  the rule, without a server: a backlink is a WAY on the canvas (`back`), whose
 *       row is held on the record the drag lands on; `is` on a backlink matches by
 *       the ids it holds; a stack filtered on a backlink can be dropped into
 *   Y2  the grid: a backlink cell has removable pills and a picker — adding there
 *       writes the row on the far record; its filter offers "is" with a record list
 *   Y3  the tray: the same, with the "add a …" line
 *   Y4  the canvas: a Deliverable card dragged onto a Work card links them through
 *       the Deliverables' "Work" backlink — the row is held on the Work
 *   Y5  a stack on Deliverables filtered "Work is Ep 101" (the backlink) fills, and a
 *       Deliverable dropped into it is linked from the Work's side
 *   Y6  making a link field makes its other face on the target; deleting the link
 *       takes the backlink with it
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';
import { boardsTableMutations } from './harness.js';
import { applyView, opsFor, type ViewField, type ViewRecord } from '../src/contract/views.js';
import { dropVerdict, linkEnds, linkWays, type LinkWay, type WayField, type WayTable } from '../src/contract/canvasLink.js';
import { stackDropLinks } from '../src/contract/canvasStack.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

function pure() {
  console.log('\nY1. The rule, without a server');
  const id = randomUUID;
  const works = id(), delivs = id();
  let pos = 0;
  const field = (table_id: string, name: string, type: string, options: Record<string, unknown> = {}): WayField =>
    ({ id: id(), table_id, name, key: name.toLowerCase().replace(/\W+/g, '_'), type, position: pos++, options });
  const wName = field(works, 'Name', 'text'), wDelivs = field(works, 'Deliverables', 'link', { target_table_id: delivs });
  const dName = field(delivs, 'Name', 'text'), dWork = field(delivs, 'Work', 'backlink', { source_field_id: wDelivs.id });
  const dOrphan = field(delivs, 'Orphan', 'backlink', { source_field_id: id() });   // its link is gone
  const fields = [wName, wDelivs, dName, dWork, dOrphan];
  const tables: WayTable[] = [{ id: works, name: 'Works', singular_name: 'Work', kind: 'records' }, { id: delivs, name: 'Deliverables', singular_name: 'Deliverable', kind: 'records' }];
  const ways = (t: string) => linkWays(fields, tables, t);

  check('a BACKLINK is a way: from a Deliverable to a Work, named by the backlink, keyed by the link it mirrors',
    ways(delivs).length === 1 && ways(delivs)[0].kind === 'link' && ways(delivs)[0].name === 'Work' && ways(delivs)[0].key === wDelivs.id && (ways(delivs)[0] as LinkWay & { back?: boolean }).back === true, JSON.stringify(ways(delivs)));
  check('…a backlink whose link is gone is not one', !ways(delivs).some((w) => w.name === 'Orphan'));
  check('the link side is unchanged: the Work\'s own way, forward', ways(works).length === 1 && ways(works)[0].name === 'Deliverables' && !(ways(works)[0] as { back?: boolean }).back);
  const back = ways(delivs)[0] as Extract<LinkWay, { kind: 'link' }>;
  check('through a backlink the row is HELD on the record the drag lands on, pointing at the starter',
    JSON.stringify(linkEnds(back, 'd1', 'w1')) === JSON.stringify({ holder: 'w1', target: 'd1' }) && JSON.stringify(linkEnds(ways(works)[0] as Extract<LinkWay, { kind: 'link' }>, 'w1', 'd1')) === JSON.stringify({ holder: 'w1', target: 'd1' }));
  check('a Deliverable dropped on a Work: one way — made', dropVerdict(ways(delivs).filter((w) => w.toTable === works), false, () => false).kind === 'link');

  // `is` on a backlink.
  const vf: ViewField[] = fields.map((f) => ({ id: f.id, key: f.key, type: f.type, options: f.options }));
  const ep101 = id(), ep102 = id();
  const a: ViewRecord = { id: id(), data: { name: 'DCP' } }, b: ViewRecord = { id: id(), data: { name: 'Trailer' } };
  const ids = (r: string, f: string) => (f === dWork.id ? (r === a.id ? [ep101] : [ep102]) : []);
  check('opsFor a backlink offers `is` first, as a link does', opsFor('backlink')[0] === 'is' && opsFor('link')[0] === 'is');
  check('`is` on a backlink keeps the records whose backlink holds THAT record',
    applyView([a, b], vf, { sort: [], filters: [{ fieldId: dWork.id, op: 'is', value: ep101 }], hidden: [] }, () => [], ids).map((r) => r.id).join() === a.id);

  // A stack filtered on the backlink: a drop sets the link from the Work's side.
  const dl = stackDropLinks({ tableId: delivs, filters: [{ fieldId: dWork.id, op: 'is', value: ep101 }] }, fields as never, delivs);
  check('a stack filtered "Work is Ep 101" (a backlink) can be dropped into: the link is the Work\'s, held on Ep 101 (`back`)',
    JSON.stringify(dl) === JSON.stringify([{ fieldId: wDelivs.id, recordId: ep101, back: true }]), JSON.stringify(dl));
  check('…a backlink whose link is gone: refused', stackDropLinks({ tableId: delivs, filters: [{ fieldId: dOrphan.id, op: 'is', value: ep101 }] }, fields as never, delivs) === null);
}

async function main() {
  pure();
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8847));
  const { w, win, pool, until, untilDb, post, nav } = ui;
  try {
    const tWorks = randomUUID(), tDelivs = randomUUID(), tBoards = randomUUID();
    const fWName = randomUUID(), fWDelivs = randomUUID(), fDName = randomUUID(), fDWork = randomUUID();
    const ep101 = randomUUID(), ep102 = randomUUID(), dcp = randomUUID(), prores = randomUUID(), trailer = randomUUID(), board = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    // Works LINK to Deliverables (the owner's schema); Deliverables see it as the "Work" backlink.
    const setup = await post([
      { type: 'table.create', id: tWorks, name: 'Works', singularName: 'Work' }, { type: 'table.create', id: tDelivs, name: 'Deliverables', singularName: 'Deliverable' }, ...boardsTableMutations(tBoards),
      { type: 'field.create', id: fWName, tableId: tWorks, name: 'Name', key: 'name', fieldType: 'text' }, pos(fWName, 0),
      { type: 'field.create', id: fWDelivs, tableId: tWorks, name: 'Deliverables', key: 'deliverables', fieldType: 'link', options: { target_table_id: tDelivs } }, pos(fWDelivs, 1),
      { type: 'field.create', id: fDName, tableId: tDelivs, name: 'Name', key: 'name', fieldType: 'text' }, pos(fDName, 0),
      { type: 'field.create', id: fDWork, tableId: tDelivs, name: 'Work', key: 'work', fieldType: 'backlink', options: { source_field_id: fWDelivs } }, pos(fDWork, 1),
      { type: 'record.create', id: ep101, tableId: tWorks, data: { name: 'Ep 101' } }, { type: 'record.create', id: ep102, tableId: tWorks, data: { name: 'Ep 102' } },
      { type: 'record.create', id: dcp, tableId: tDelivs, data: { name: 'DCP' } }, { type: 'record.create', id: prores, tableId: tDelivs, data: { name: 'ProRes' } },
      { type: 'record.create', id: trailer, tableId: tDelivs, data: { name: 'Trailer' } },
      { type: 'link.add', id: randomUUID(), fieldId: fWDelivs, fromRecord: ep101, toRecord: dcp },
      { type: 'record.create', id: board, tableId: tBoards, data: { name: 'Board' } },
      { type: 'placement.add', id: randomUUID(), canvasId: board, recordId: ep101, x: 60, y: 60, w: null, h: null, z: 1 },
      { type: 'placement.add', id: randomUUID(), canvasId: board, recordId: prores, x: 700, y: 400, w: null, h: null, z: 2 },
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 300));

    const PE = (win as any).PointerEvent ?? (win as any).MouseEvent;
    const winEv = (type: string, init: Record<string, unknown>) => win.dispatchEvent(new PE(type, { bubbles: true, ...init }));
    const go = async (tableId: string) => { win.location.hash = `#/all/table/${tableId}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange')); await until(() => w.find('.gridview').exists() && w.findAll('.gridview tr.row').length > 0, 8000); };
    const rows = () => w.findAll('.gridview tr.row');
    const rowNamed = (name: string) => rows().find((r: any) => r.findAll('td')[1].text() === name)!;
    const ths = () => w.findAll('.gridview thead .th-name').map((x: any) => x.text());
    const cellOf = (name: string, col: string) => { const r = rowNamed(name); return r ? r.findAll('td')[ths().indexOf(col) + 1] : undefined as any; };
    const linksOf = async (from: string) => (await pool.query(`select to_record from links where field_id = $1 and from_record = $2`, [fWDelivs, from])).rows.map((r) => r.to_record);
    const linksAre = async (from: string, to: string[]) => { const t = Date.now(); while (Date.now() - t < 5000) { if ((await linksOf(from)).sort().join() === [...to].sort().join()) return true; await sleep(100); } return false; };
    const picker = () => w.find('.gridview .picker');
    const tray = () => w.find('.record-panel');
    const pField = (label: string) => w.findAll('.record-panel .rp-field').find((f: any) => f.find('.rp-name').text().replace(/[★⚠✓]/g, '').trim() === label)!;

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nY2. The grid: a backlink is written from its own side');
    await go(tDelivs);
    await until(() => cellOf('DCP', 'Work').findAll('.pill').length === 1, 8000);
    check('the DCP\'s "Work" backlink shows Ep 101, as a pill WITH a ×', cellOf('DCP', 'Work').find('.pill').text().includes('Ep 101') && cellOf('DCP', 'Work').find('.pill .pill-x').exists());
    await cellOf('Trailer', 'Work').trigger('mousedown');
    await cellOf('Trailer', 'Work').trigger('dblclick');
    check('a double-click on the Trailer\'s "Work" cell opens the picker — of Works', await until(() => picker().exists(), 4000) && await until(() => picker().text().includes('Ep 102'), 4000), picker()?.text());
    await picker().findAll('.list li').find((x: any) => x.find('.name').text() === 'Ep 102')!.trigger('mousedown');
    check('choosing Ep 102 writes the row on Ep 102 — the Work\'s link, pointing at the Trailer', await linksAre(ep102, [trailer]));
    check('…and the Trailer\'s cell shows Ep 102', await until(() => cellOf('Trailer', 'Work')?.findAll('.pill').length === 1, 4000), rows().map((r: any) => r.text()).join(' | '));
    await picker().trigger('keydown', { key: 'Escape' });
    await cellOf('Trailer', 'Work').find('.pill .pill-x').trigger('click');
    check('× on the pill removes that same row', await linksAre(ep102, []) && await until(() => cellOf('Trailer', 'Work')?.findAll('.pill').length === 0));
    await w.find('.gridview').trigger('keydown', { key: 'z', ctrlKey: true });
    check('…one Ctrl+Z brings it back', await linksAre(ep102, [trailer]));

    // The filter: "Work is …" with a record list.
    const filterMenu = () => w.findAll('.gridview details.menu').find((d: any) => d.find('summary').text().startsWith('filter'))!;
    await filterMenu().find('summary').trigger('click');
    await filterMenu().find('.add-filter').trigger('click');
    const line = () => filterMenu().find('.filter-lines .line');
    await until(() => line().exists());
    await line().findAll('select')[0].setValue(fDWork);
    await until(() => line().findAll('select')[1].findAll('option').map((o: any) => o.attributes('value'))[0] === 'is');
    check('a backlink column\'s filter offers "is" first, with a list of Works to choose from',
      await until(() => line().find('.record-select').exists(), 4000) && await until(() => line().find('.record-select').findAll('option').length === 3, 4000), line()?.html());
    await line().find('.record-select').setValue(ep101);
    check('"Work is Ep 101" keeps the DCP only', await until(() => rows().length === 1 && rowNamed('DCP')), rows().map((r: any) => r.text()).join('|'));
    await line().find('.x').trigger('click');
    await until(() => rows().length === 3);
    await filterMenu().find('summary').trigger('click');

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nY3. The tray: the same, with the "add a …" line');
    await rowNamed('ProRes').find('.expand').trigger('click');
    await until(() => tray().exists() && tray().find('.rp-title').text() === 'ProRes');
    check('the "Work" field has an "add a Work…" line, not "nothing links here"', pField('Work').find('.add-link').exists() && pField('Work').find('.add-link').text() === 'add a Work…', pField('Work').text());
    await pField('Work').find('.rp-value').trigger('click');
    check('clicking it opens the picker of Works', await until(() => pField('Work').find('.picker').exists(), 4000));
    await pField('Work').find('.picker input.q').setValue('Ep 101');
    await until(() => pField('Work').findAll('.picker .list li').some((x: any) => x.find('.name').text() === 'Ep 101'));
    await pField('Work').findAll('.picker .list li').find((x: any) => x.find('.name').text() === 'Ep 101')!.trigger('mousedown');
    check('choosing Ep 101 links the ProRes from Ep 101\'s side', await linksAre(ep101, [dcp, prores]) && await until(() => pField('Work').findAll('.pill').length === 1));
    await pField('Work').find('.pill .pill-x').trigger('click');
    check('× removes it', await linksAre(ep101, [dcp]));
    await tray().find('.rp-close').trigger('click');

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nY4. The canvas: a Deliverable onto a Work');
    win.location.hash = `#/all/canvas/${board}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    const cardOf = (name: string) => w.findAll('.canvas-world .card').find((x: any) => x.find('.card-label').text() === name)!;
    await until(() => !!cardOf('Ep 101') && !!cardOf('ProRes'), 12000);
    await w.find('.canvas-controls button[title="Reset to 100%"]').trigger('click');
    const box = (el: any, r: { left: number; top: number; right: number; bottom: number }) => { (el.element as HTMLElement).getBoundingClientRect = () => ({ ...r, width: r.right - r.left, height: r.bottom - r.top, x: r.left, y: r.top, toJSON() {} }) as DOMRect; };
    box(w.find('.canvas-container'), { left: 0, top: 0, right: 800, bottom: 600 });
    const tf = () => { const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(w.find('.canvas-world').attributes('style') ?? '')!; return { x: Number(m[1]), y: Number(m[2]), s: Number(m[3]) }; };
    const toClient = (wx: number, wy: number) => { const t = tf(); return { clientX: t.x + wx * t.s, clientY: t.y + wy * t.s }; };
    check('the ProRes card has a ⊕: a Deliverable has a way — through its backlink', cardOf('ProRes').find('.link-handle').exists());
    await cardOf('ProRes').find('.link-handle').trigger('pointerdown', { button: 0, ...toClient(700 + 260, 400 + 100) });
    winEv('pointermove', { ...toClient(100, 90) });
    await sleep(30);
    check('held over Ep 101, the label says "Work"', await until(() => cardOf('Ep 101').classes('link-over'), 2000) && w.find('.link-note.live').text() === 'Work', w.find('.link-note.live')?.text());
    winEv('pointerup', { ...toClient(100, 90) });
    check('let go: the row is held on Ep 101, pointing at the ProRes', await linksAre(ep101, [dcp, prores]));
    check('…and the Ep 101 card\'s Deliverables row names it', await until(() => cardOf('Ep 101').text().includes('ProRes'), 4000));

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nY5. A stack filtered on the backlink');
    const stackId = randomUUID();
    await post([{ type: 'canvas.update', id: board, config: { cardFields: {}, stacks: [{ id: stackId, tableId: tDelivs, name: 'Ep 102 deliverables', filters: [{ fieldId: fDWork, op: 'is', value: ep102 }], sort: [], x: 100, y: 400, w: null, collapsed: false }] } }]);
    const frame = () => w.find('.canvas-world .stack');
    check('"Work is Ep 102" fills with the Trailer', await until(() => frame().exists() && !!cardOf('Trailer') && cardOf('Trailer').classes('stacked'), 8000));
    const rectOf = (el: any) => { const st = el.attributes('style') ?? ''; const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(st)!; return { x: Number(m[1]), y: Number(m[2]) }; };
    const fr = rectOf(frame());
    const pr = rectOf(cardOf('ProRes'));
    const from = toClient(pr.x + 10, pr.y + 10), to = toClient(fr.x + 30, fr.y + 70);
    await cardOf('ProRes').trigger('pointerdown', { button: 0, pointerId: 1, ...from });
    winEv('pointermove', { ...from, clientX: from.clientX + 6, pointerId: 1 }); await sleep(30);
    winEv('pointermove', { ...to, pointerId: 1 }); await sleep(30);
    winEv('pointerup', { ...to, pointerId: 1 });
    check('the ProRes dropped in: Ep 102 now links to it (the row on the Work\'s side) and it joins', await linksAre(ep102, [trailer, prores]) && await until(() => cardOf('ProRes').classes('stacked'), 4000),
      `links=${JSON.stringify(await linksOf(ep102))} stacked=${cardOf('ProRes').classes('stacked')} at=${JSON.stringify(rectOf(cardOf('ProRes')))} frame=${JSON.stringify(fr)} note=${w.find('.link-note').exists() ? w.find('.link-note').text() : ''} refused=${frame().classes('refused')}`);

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nY6. A new link field makes its other face; deleting it takes that face with it');
    await go(tWorks);
    await w.find('.gridview .th-add').trigger('click');
    const gridPop = () => w.find('.gridview .popover');
    await until(() => gridPop().find('.field-form').exists());
    await gridPop().find('input.name').setValue('Vendor');
    await gridPop().find('select.type').setValue('link');
    await gridPop().find('select.target').setValue(tDelivs);
    // Works already links to Deliverables ("Deliverables"), so the new face says which link it is.
    check('the form offers two-way, ticked, naming what it adds', gridPop().find('.pair input').element.checked && gridPop().find('.pair').text().includes('“Works (via Vendor)” on Deliverables'), gridPop().find('.pair')?.text());
    await gridPop().find('button.add').trigger('click');
    const made = await untilDb(`select id, table_id, type, name, options from fields where name in ('Vendor', 'Works (via Vendor)') and table_id in ('${tWorks}', '${tDelivs}') order by name`, (r) => r.length === 2, 8000);
    check('both faces exist: Works.Vendor (a link) and Deliverables."Works (via Vendor)" (its backlink)',
      made.length === 2 && made[0].name === 'Vendor' && made[0].type === 'link' && made[1].name === 'Works (via Vendor)' && made[1].type === 'backlink' && made[1].table_id === tDelivs && made[1].options.source_field_id === made[0].id, JSON.stringify(made));
    await gridPop().trigger('keydown', { key: 'Escape' });
    await until(() => ths().includes('Vendor'));
    const th = (name: string) => w.findAll('.gridview thead th').find((t: any) => t.find('.th-name').exists() && t.find('.th-name').text() === name)!;
    await th('Vendor').find('.th-menu').trigger('click');
    await until(() => gridPop().find('.field-settings').exists());
    await gridPop().find('.field-settings button.delete').trigger('click');   // the dialog pilot confirms
    check('deleting the link says its other side goes with it', await until(() => nav.dialogs.bodies.some((b) => /“Works \(via Vendor\)” on Deliverables/.test(b)), 4000), nav.dialogs.bodies.join(' || '));
    check('…and it does: neither face remains', (await untilDb(`select count(*)::int n from fields where name in ('Vendor', 'Works (via Vendor)') and table_id in ('${tWorks}', '${tDelivs}')`, (r) => r[0].n === 0, 8000))[0].n === 0);
    await w.find('.gridview').trigger('keydown', { key: 'z', ctrlKey: true });
    check('…one Ctrl+Z restores both', (await untilDb(`select count(*)::int n from fields where name in ('Vendor', 'Works (via Vendor)') and table_id in ('${tWorks}', '${tDelivs}')`, (r) => r[0].n === 2, 8000))[0].n === 2);

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nY7. Two links from one table: each face says which; an old one-way link is made two-way');
    // Works already has "Deliverables" → Deliverables, whose face is "Work" (hand-named: left alone).
    // A one-way link made before Oct 15 — no face — then a second link to the same table.
    const fOld = randomUUID();
    await post([{ type: 'field.create', id: fOld, tableId: tWorks, name: 'Inputs', key: 'inputs', fieldType: 'link', options: { target_table_id: tDelivs } }, pos(fOld, 5)]);
    await until(() => ths().includes('Inputs'), 6000);
    await th('Inputs').find('.th-menu').trigger('click');
    await until(() => gridPop().find('.field-settings').exists());
    check('an old link with no other face says one-way, and offers to make it two-way', gridPop().find('.make-two-way').exists(), gridPop().find('.two-way')?.text());
    await gridPop().find('.make-two-way').trigger('click');
    const inFace = await untilDb(`select name from fields where table_id = '${tDelivs}' and options->>'source_field_id' = '${fOld}'`, (r) => r.length === 1, 6000);
    check('…its face is "Works (via Inputs)" — Works already links to Deliverables', inFace[0]?.name === 'Works (via Inputs)', JSON.stringify(inFace));
    check('…the ⚙ now names it', await until(() => gridPop().find('.two-way').text().includes('“Works (via Inputs)” on Deliverables')), gridPop().find('.two-way')?.text());
    check('…and the hand-named "Work" face is left as it is', (await pool.query(`select name from fields where id = $1`, [fDWork])).rows[0].name === 'Work');
    await gridPop().trigger('keydown', { key: 'Escape' });
    // A bare-named sibling IS renamed: make "Outputs" when "Inputs"' face had the plain name.
    await post([{ type: 'field.update', id: (await pool.query(`select id from fields where table_id = $1 and options->>'source_field_id' = $2`, [tDelivs, fOld])).rows[0].id, name: 'Works' }]);
    await until(() => true);
    await sleep(500);
    await w.find('.gridview .th-add').trigger('click');
    await until(() => gridPop().find('.field-form').exists());
    await gridPop().find('input.name').setValue('Outputs');
    await gridPop().find('select.type').setValue('link');
    await gridPop().find('select.target').setValue(tDelivs);
    check('the form says what the new face will be called', gridPop().find('.pair').text().includes('“Works (via Outputs)”'), gridPop().find('.pair')?.text());
    await gridPop().find('button.add').trigger('click');
    const faces = await untilDb(`select name from fields where table_id = '${tDelivs}' and name like 'Works%' order by name`, (r) => r.length === 3 && r.every((x: any) => x.name.includes('(via')), 6000);
    check('another link from Works: every face says which — the bare "Works" became "Works (via Inputs)"', faces.map((r: any) => r.name).join() === 'Works (via Inputs),Works (via Outputs),Works (via Vendor)', JSON.stringify(faces));
  } finally {
    await ui.close();
  }
}

main().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); console.log(`\nSUITE ABORTED — an exception ended it early; the tally above is incomplete`); process.exit(1); });
