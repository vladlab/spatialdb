/**
 * Colour rules in the app (contract/colorRules.ts) — the three homes, in one fixture:
 *
 *   K1  the GRID: a view's rules paint rows (wash, stripe on the # cell) and one cell;
 *       the Colour menu edits them, saved to the view; the legend chips in the bar
 *   K2  the CANVAS: per-table rules in the canvas config glow the matching cards (ring
 *       and halo; "ring" alone when the canvas says so); a field rule tints the row
 *   K3  the REPORT: a level's rules paint its bands from a ROLLUP, its leaf rows from
 *       a field; the legend prints in the report's bar
 *
 * The evaluation itself is test/colorrules.ts and test/reports.ts R14; this is that
 * the surfaces read it, and that the editors write it.
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';
import { boardsTableMutations } from './harness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8851));
  const { w, win, until, untilDb, post, nav } = ui;
  try {
    const tDel = randomUUID(), tFiles = randomUUID(), tRep = randomUUID(), tBoards = randomUUID();
    const fDName = randomUUID(), fFName = randomUUID(), fStatus = randomUUID(), fDeliv = randomUUID(), fSize = randomUUID(), fRName = randomUUID(), fRDef = randomUUID();
    const prores = randomUUID(), dcp = randomUUID(), v1 = randomUUID(), v2 = randomUUID(), sent = randomUUID(), report = randomUUID(), board = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const setup = await post([
      { type: 'table.create', id: tDel, name: 'Deliverables', singularName: 'Deliverable' }, { type: 'table.create', id: tFiles, name: 'Files', singularName: 'File' },
      { type: 'table.create', id: tRep, name: 'Reports', singularName: 'Report', kind: 'report' }, ...boardsTableMutations(tBoards),
      { type: 'field.create', id: fDName, tableId: tDel, name: 'Name', key: 'name', fieldType: 'text' }, pos(fDName, 0),
      { type: 'field.create', id: fFName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(fFName, 0),
      { type: 'field.create', id: fStatus, tableId: tFiles, name: 'Status', key: 'status', fieldType: 'select', options: { choices: ['Working', 'Sent', 'Pending QC', 'Accepted'] } }, pos(fStatus, 1),
      { type: 'field.create', id: fDeliv, tableId: tFiles, name: 'Deliverable', key: 'deliverable', fieldType: 'link', options: { target_table_id: tDel } }, pos(fDeliv, 2),
      { type: 'field.create', id: fSize, tableId: tFiles, name: 'Size', key: 'size', fieldType: 'number' }, pos(fSize, 3),
      { type: 'field.create', id: fRName, tableId: tRep, name: 'Name', key: 'name', fieldType: 'text' }, pos(fRName, 0),
      { type: 'field.create', id: fRDef, tableId: tRep, name: 'Report', key: 'report', fieldType: 'structured', options: { shape: 'report' } }, pos(fRDef, 1),
      { type: 'record.create', id: prores, tableId: tDel, data: { name: 'ProRes 4444 texted' } }, { type: 'record.create', id: dcp, tableId: tDel, data: { name: 'DCP 2K Flat' } },
      { type: 'record.create', id: v1, tableId: tFiles, data: { name: 'ep101_v1.mov', status: 'Pending QC', size: 10 } },
      { type: 'record.create', id: v2, tableId: tFiles, data: { name: 'ep101_v2.mov', status: 'Accepted', size: 12 } },
      { type: 'record.create', id: sent, tableId: tFiles, data: { name: 'ep101_wild.mov', status: 'Sent', size: 400 } },
      { type: 'link.add', id: randomUUID(), fieldId: fDeliv, fromRecord: v1, toRecord: prores }, { type: 'link.add', id: randomUUID(), fieldId: fDeliv, fromRecord: v2, toRecord: prores },
      // A VIEW with rules, saved: the grid reads them. The built-in Grid's id is the table's.
      { type: 'view.create', id: tFiles, tableId: tFiles, name: 'Grid', config: { sort: [], filters: [], hidden: [], rules: [
        { id: 'ok', tint: 'green', paint: 'row', label: 'Accepted', when: [{ fieldId: fStatus, op: 'eq', value: 'Accepted' }] },
        { id: 'qc', tint: 'amber', paint: 'row', label: 'In QC', when: [{ fieldId: fStatus, op: 'eq', value: 'Pending QC' }] },
        { id: 'nodeliv', tint: 'red', paint: { field: fDeliv }, label: 'No deliverable', when: [{ fieldId: fStatus, op: 'eq', value: 'Sent' }, { fieldId: fDeliv, op: 'empty' }] },
      ] } },
      { type: 'record.create', id: board, tableId: tBoards, data: { name: 'Delivery board' } },
      ...[v1, v2, sent].map((r, i) => ({ type: 'placement.add', id: randomUUID(), canvasId: board, recordId: r, x: 100, y: 100 + i * 200, w: null, h: null, z: 1 })),
      { type: 'canvas.update', id: board, config: { cardFields: {}, rules: { [tFiles]: [
        { id: 'ok', tint: 'green', paint: 'row', when: [{ fieldId: fStatus, op: 'eq', value: 'Accepted' }] },
        { id: 'nodeliv', tint: 'red', paint: { field: fDeliv }, when: [{ fieldId: fDeliv, op: 'empty' }] },
      ] } } },
      { type: 'record.create', id: report, tableId: tRep, data: { name: 'Delivery', report: {
        v: 1, root: { id: 'delivs', table: tDel, sort: [{ fieldId: fDName, dir: 'asc' }],
          rollups: [{ id: 'files', label: 'files', op: 'count', over: 'files' }, { id: 'accepted', label: 'accepted', op: 'countWhere', over: 'files', where: [{ fieldId: fStatus, op: 'eq', value: 'Accepted' }] }],
          rules: [
            { id: 'sat', tint: 'green', paint: 'row', label: 'satisfied', when: [{ rollup: 'accepted', op: 'gte', value: 1 }] },
            { id: 'none', tint: 'red', paint: 'row', label: 'nothing yet', when: [{ rollup: 'files', op: 'eq', value: 0 }] },
          ],
          children: [{ id: 'files', via: [{ fieldId: fDeliv }], fields: [fStatus, fSize], sort: [{ fieldId: fFName, dir: 'asc' }], children: [],
            rules: [{ id: 'acc', tint: 'green', paint: { field: fStatus }, when: [{ fieldId: fStatus, op: 'eq', value: 'Accepted' }] }] }] } } } },
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 400));

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nK1. The grid: rows and a cell, the menu, the legend');
    win.location.hash = `#/all/table/${tFiles}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.findAll('.gridview tr.row').length === 3, 12000);
    const row = (name: string) => w.findAll('.gridview tr.row').find((r: any) => r.text().includes(name))!;
    check('the accepted file: a painted row in green', row('ep101_v2').classes('painted') && row('ep101_v2').classes('tint-green'), row('ep101_v2').classes().join());
    check('the QC file: amber', row('ep101_v1').classes('painted') && row('ep101_v1').classes('tint-amber'));
    const wild = row('ep101_wild');
    const cells = () => wild.findAll('td');
    check('the sent file with no deliverable: the row is NOT painted, its Deliverable cell is — red', !wild.classes('painted') && cells().some((c: any) => c.classes('cell-painted') && c.classes('tint-red')), wild.html().slice(0, 200));
    check('the bar: "colour · 3", and a legend chip per labelled rule', w.find('.colour-menu summary').text().replace(/\s+/g, ' ').trim() === 'colour · 3'
      && w.findAll('.context-bar .tint-legend span').map((s: any) => s.text()).join('|') === 'Accepted|In QC|No deliverable', w.find('.context-bar .tint-legend').text());

    // The menu: open it, drop the QC rule — saved to the view, the amber goes.
    await w.find('.colour-menu summary').trigger('click');
    await until(() => w.findAll('.colour-pop .cr-rule').length === 3);
    check('the menu lists the three rules, each with its tint lit', w.findAll('.colour-pop .cr-rule').map((r: any) => r.find('.cr-swatch.cr-on').attributes('title')).join() === 'green,amber,red');
    check('…the field rule says which field it paints', (w.findAll('.colour-pop .cr-rule')[2].find('.cr-paint').element as HTMLSelectElement).value === fDeliv);
    await w.findAll('.colour-pop .cr-rule')[1].find('.cr-x').trigger('click');
    check('removing a rule is saved to the view', (await untilDb(`select jsonb_array_length(config->'rules') as n from views where id = '${tFiles}'`, (r) => r[0]?.n === 2, 6000)).length === 1);
    check('…and the amber row is plain again at once', await until(() => !row('ep101_v1').classes('painted'), 4000));
    await w.find('.colour-pop .cr-add').trigger('click');
    check('+ rule adds a fresh rule with no conditions — a catch-all, said so', await until(() => w.findAll('.colour-pop .cr-rule').length === 3) && w.findAll('.colour-pop .cr-rule')[2].find('.cr-note').text().startsWith('No conditions'));
    check('…which paints whatever was left (the QC file, the sent file\'s row)', await until(() => row('ep101_v1').classes('painted') && wild.classes('painted'), 4000) && row('ep101_v2').classes('tint-green'), row('ep101_v1').classes().join());

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nK2. The canvas: glow per card, a tinted row, the mark setting');
    win.location.hash = `#/all/canvas/${board}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    const cardOf = (name: string) => w.findAll('.canvas-world .card').find((x: any) => x.find('.card-label').text() === name)!;
    await until(() => !!cardOf('ep101_v1.mov') && !!cardOf('ep101_v2.mov') && !!cardOf('ep101_wild.mov'), 12000);
    check('the accepted file\'s card is tinted green (the glow), the QC file\'s is not', cardOf('ep101_v2.mov').classes('tinted') && cardOf('ep101_v2.mov').classes('tint-green') && !cardOf('ep101_v1.mov').classes('tinted'), cardOf('ep101_v2.mov').classes().join());
    check('the card\'s header keeps the TABLE\'s colour — the tint is on the card, not in it', !cardOf('ep101_v2.mov').find('.card-head').classes().some((c: string) => c.startsWith('tint-')));
    check('the sent file: not tinted as a card, but its Deliverable ROW is, in red', !cardOf('ep101_wild.mov').classes('tinted') && cardOf('ep101_wild.mov').findAll('.card-field').some((f: any) => f.classes('tinted') && f.classes('tint-red')), cardOf('ep101_wild.mov').html().slice(0, 300));
    check('the mark is the default: glow, not ring', !cardOf('ep101_v2.mov').classes('ring'));
    check('the toolbar says how many rules the canvas has', w.find('.canvas-controls .colour').text().replace(/\s+/g, ' ').trim() === 'colour · 2');
    await w.find('.canvas-controls .colour').trigger('click');
    check('the colour menu opens on the Files tab (the only table here), with its two rules', await until(() => w.findAll('.colour-pop .cr-rule').length === 2) && w.find('.colour-tab.on').text().startsWith('Files'));
    await w.find('.colour-glow select').setValue('ring');
    check('"ring" is saved to the canvas…', (await untilDb(`select config->>'glow' as g from canvases where id = '${board}'`, (r) => r[0]?.g === 'ring', 6000)).length === 1);
    check('…and the cards wear it', await until(() => cardOf('ep101_v2.mov').classes('ring'), 4000));
    await w.findAll('.colour-pop .cr-rule')[0].find('.cr-x').trigger('click');
    check('a rule removed from the menu: gone from the config and from the card', (await untilDb(`select jsonb_array_length(config->'rules'->'${tFiles}') as n from canvases where id = '${board}'`, (r) => r[0]?.n === 1, 6000)).length === 1
      && await until(() => !cardOf('ep101_v2.mov').classes('tinted'), 4000));

    /* ───────────────────────────────────────────────────────────────────── */
    console.log('\nK3. The report: bands from a rollup, cells from a field, the legend');
    await nav.openReport(report);
    await until(() => w.findAll('.reportview .ro-band').length === 2, 12000);
    const band = (name: string) => w.findAll('.reportview .ro-band').find((b: any) => b.find('.ro-label').text() === name)!;
    check('the deliverable with an accepted file: a green band, labelled "satisfied"', band('ProRes 4444 texted').classes('painted') && band('ProRes 4444 texted').classes('tint-green') && band('ProRes 4444 texted').find('.ro-tint-label').text() === 'satisfied', band('ProRes 4444 texted').classes().join());
    check('the one with no files: red, "nothing yet"', band('DCP 2K Flat').classes('tint-red') && band('DCP 2K Flat').find('.ro-tint-label').text() === 'nothing yet');
    const leafRows = () => w.findAll('.reportview .ro-table-el tr.ro-row');
    check('in the leaf table, the Accepted file\'s Status CELL is green; the QC file\'s is not', leafRows().some((r: any) => r.text().includes('ep101_v2') && r.findAll('td.cell-painted.tint-green').length === 1)
      && leafRows().some((r: any) => r.text().includes('ep101_v1') && r.findAll('td.cell-painted').length === 0), leafRows().map((r: any) => r.html().slice(0, 120)).join('\n'));
    check('the report bar carries the legend', w.findAll('.rv-bar .tint-legend span').map((s: any) => s.text()).join('|') === 'satisfied|nothing yet', w.find('.rv-bar').text());
    await sleep(100);
  } finally {
    await ui.close();
  }
}

main().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); console.log(`\nSUITE ABORTED — an exception ended it early; the tally above is incomplete`); process.exit(1); });
