/**
 * A report, OPEN, in the app (REPORTS-BRIEF.md §2 — the first rendering): the
 * tree's Reports list, ReportView, the outline drawn by ReportOutline, its
 * addresses, and "+ report". The walk itself is test/reports.ts (pure); the kind
 * and the server's checks are test/structured.ts T9.
 */
import { randomUUID } from 'node:crypto';
import { mountApp } from './uiHarness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8816));
  const { w, win, pool, until, post, nav } = ui;
  try {
    const tWorks = randomUUID(), tDel = randomUUID(), tFiles = randomUUID(), tRep = randomUUID();
    const fWName = randomUUID(), fBid = randomUUID(), fAdded = randomUUID();
    const fDName = randomUUID(), fDCodec = randomUUID();
    const fFName = randomUUID(), fPath = randomUUID(), fStatus = randomUUID(), fWork = randomUUID(), fDeliv = randomUUID();
    const fRName = randomUUID(), fRDef = randomUUID();
    const ep1 = randomUUID(), ep2 = randomUUID(), prores = randomUUID(), dcp = randomUUID();
    const v1 = randomUUID(), v2 = randomUUID(), other = randomUUID(), report = randomUUID(), blank = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const setup = await post([
      { type: 'table.create', id: tWorks, name: 'Works', singularName: 'Work' }, { type: 'table.create', id: tDel, name: 'Deliverables', singularName: 'Deliverable' },
      { type: 'table.create', id: tFiles, name: 'Files', singularName: 'File' }, { type: 'table.create', id: tRep, name: 'Reports', singularName: 'Report', kind: 'report' },
      { type: 'field.create', id: fWName, tableId: tWorks, name: 'Name', key: 'name', fieldType: 'text' }, pos(fWName, 0),
      { type: 'field.create', id: fBid, tableId: tWorks, name: 'Deliverables (bid)', key: 'bid', fieldType: 'link', options: { target_table_id: tDel } }, pos(fBid, 1),
      { type: 'field.create', id: fAdded, tableId: tWorks, name: 'Deliverables (added)', key: 'added', fieldType: 'link', options: { target_table_id: tDel } }, pos(fAdded, 2),
      { type: 'field.create', id: fDName, tableId: tDel, name: 'Name', key: 'name', fieldType: 'text' }, pos(fDName, 0),
      { type: 'field.create', id: fDCodec, tableId: tDel, name: 'Codec', key: 'codec', fieldType: 'text' }, pos(fDCodec, 1),
      { type: 'field.create', id: fFName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(fFName, 0),
      { type: 'field.create', id: fPath, tableId: tFiles, name: 'Path', key: 'path', fieldType: 'text' }, pos(fPath, 1),
      { type: 'field.create', id: fStatus, tableId: tFiles, name: 'Status', key: 'status', fieldType: 'select', options: { choices: ['superseded', 'accepted'] } }, pos(fStatus, 2),
      { type: 'field.create', id: fWork, tableId: tFiles, name: 'Work', key: 'work', fieldType: 'link', options: { target_table_id: tWorks } }, pos(fWork, 3),
      { type: 'field.create', id: fDeliv, tableId: tFiles, name: 'Deliverable', key: 'deliverable', fieldType: 'link', options: { target_table_id: tDel } }, pos(fDeliv, 4),
      { type: 'field.create', id: fRName, tableId: tRep, name: 'Name', key: 'name', fieldType: 'text' }, pos(fRName, 0),
      { type: 'field.create', id: fRDef, tableId: tRep, name: 'Report', key: 'report', fieldType: 'structured', options: { shape: 'report' } }, pos(fRDef, 1),
      { type: 'record.create', id: ep1, tableId: tWorks, data: { name: 'Ep 101' } }, { type: 'record.create', id: ep2, tableId: tWorks, data: { name: 'Ep 102' } },
      { type: 'record.create', id: prores, tableId: tDel, data: { name: 'ProRes 4444 texted', codec: 'ProRes 4444' } },
      { type: 'record.create', id: dcp, tableId: tDel, data: { name: 'DCP 2K Flat', codec: 'JPEG 2000' } },
      { type: 'record.create', id: v1, tableId: tFiles, data: { name: 'ep101_prores_v1.mov', path: '/vol/ep101_v1.mov', status: 'superseded' } },
      { type: 'record.create', id: v2, tableId: tFiles, data: { name: 'ep101_prores_v2.mov', path: '/vol/ep101_v2.mov', status: 'accepted' } },
      { type: 'record.create', id: other, tableId: tFiles, data: { name: 'ep102_prores_v1.mov', path: '/vol/ep102_v1.mov', status: 'accepted' } },
      { type: 'link.add', id: randomUUID(), fieldId: fBid, fromRecord: ep1, toRecord: prores }, { type: 'link.add', id: randomUUID(), fieldId: fAdded, fromRecord: ep1, toRecord: dcp },
      { type: 'link.add', id: randomUUID(), fieldId: fBid, fromRecord: ep2, toRecord: prores },
      { type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: v1, toRecord: ep1 }, { type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: v2, toRecord: ep1 },
      { type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: other, toRecord: ep2 },
      { type: 'link.add', id: randomUUID(), fieldId: fDeliv, fromRecord: v1, toRecord: prores }, { type: 'link.add', id: randomUUID(), fieldId: fDeliv, fromRecord: v2, toRecord: prores },
      { type: 'link.add', id: randomUUID(), fieldId: fDeliv, fromRecord: other, toRecord: prores },
      { type: 'record.create', id: report, tableId: tRep, data: { name: 'Deliverables status', report: {
        v: 1, root: { id: 'works', table: tWorks, sort: [{ fieldId: fWName, dir: 'asc' }],
          rollups: [{ id: 'expected', label: 'expected', op: 'count', over: 'delivs' }, { id: 'delivered', label: 'delivered', op: 'countWhere', over: 'delivs', where: { rollup: 'files', op: 'gt', value: 0 } }],
          children: [{ id: 'delivs', via: [{ fieldId: fBid, role: 'bid' }, { fieldId: fAdded, role: 'added' }], fields: [fDCodec], sort: [{ fieldId: fDName, dir: 'asc' }],
            rollups: [{ id: 'files', label: 'files', op: 'count', over: 'files' }],
            children: [{ id: 'files', via: [{ fieldId: fDeliv }], pins: [{ fieldId: fWork, levelId: 'works' }], fields: [fPath, fStatus], sort: [{ fieldId: fFName, dir: 'desc' }], children: [] }] }] } } } },
      { type: 'record.create', id: blank, tableId: tRep, data: { name: 'Empty one' } },
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 300));

    console.log('\nV1. The tree lists reports, and opens one');
    win.location.hash = `#/all/table/${tWorks}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.findAll('.tree .report-row').length === 2, 8000);
    check('under Tables and Canvases, a "Reports" subheader with the two report records, by name', /Reports/.test(w.find('.tree').text())
      && w.findAll('.tree .report-row .name').map((x: any) => x.text()).join('|') === 'Deliverables status|Empty one');
    await nav.openReport(report);
    await until(() => w.find('.reportview .ro-row').exists(), 8000);
    check('clicking one opens the report view, with the report\'s name in its bar', w.find('.reportview .rv-title').text() === 'Deliverables status');
    check('…and gives it an address: #/all/report/<id>', win.location.hash === `#/all/report/${report}`, win.location.hash);
    check('the tree marks it as open', w.find(`.tree .report-row.on[data-report="${report}"]`).exists());

    console.log('\nV2. The outline');
    const root = w.find('.reportview .ro.root');
    const rows = () => root.findAll('.ro-row');
    const labelOf = (r: any) => r.find('.ro-label').text();
    check('root section: "Works", count 2, one row per work, sorted', root.find('.ro-head .ro-table').text() === 'Works' && root.find('.ro-head .ro-count').text() === '2'
      && rows().filter((r: any) => r.attributes('data-record') === ep1 || r.attributes('data-record') === ep2).map(labelOf).join('|') === 'Ep 101|Ep 102');
    check('the header names the record column by the table\'s SINGULAR name and the rollups by label', root.find('thead').findAll('th').map((t: any) => t.text()).join(' ') === 'Work expected delivered', root.find('thead').findAll('th').map((t: any) => t.text()).join(' '));
    const ep1Row = rows().find((r: any) => r.attributes('data-record') === ep1)!;
    check('Ep 101: expected 2, delivered 1', ep1Row.findAll('.c-rollup').map((c: any) => c.text()).join() === '2,1', ep1Row.text());
    const ep1Children = ep1Row.element.nextElementSibling as HTMLElement;
    const delivs = w.findAll('.ro-row').filter((r: any) => ep1Children.contains(r.element) && (r.attributes('data-record') === prores || r.attributes('data-record') === dcp));
    check('under Ep 101, its deliverables in their own section, sorted, with ROLE chips: DCP (added), ProRes (bid)', delivs.map((r: any) => `${labelOf(r)} [${r.findAll('.ro-role').map((x: any) => x.text()).join(',')}]`).join('|') === 'DCP 2K Flat [added]|ProRes 4444 texted [bid]', delivs.map((r: any) => r.text()).join('|'));
    check('a deliverable\'s cells come from its fields list (Codec), its files count from the rollup — zero is marked', delivs[0].find('.c-field').text() === 'JPEG 2000' && delivs[0].find('.c-rollup').text() === '0' && delivs[0].find('.c-rollup').classes('zero'));
    const dcpChildren = delivs[0].element.nextElementSibling as HTMLElement;
    check('the DCP has no files: an EMPTY section is drawn, saying so', /— nothing —/.test(dcpChildren.textContent ?? ''));
    const proresChildren = delivs[1].element.nextElementSibling as HTMLElement;
    const files = w.findAll('.ro-row').filter((r: any) => proresChildren.contains(r.element));
    check('the ProRes has the two ep101 files, sorted desc, with Path and Status — and NOT ep102\'s file (pinned to the work)', files.map(labelOf).join('|') === 'ep101_prores_v2.mov|ep101_prores_v1.mov'
      && files[0].findAll('.c-field').map((c: any) => c.text()).join() === '/vol/ep101_v2.mov,accepted', files.map((r: any) => r.text()).join('|'));

    console.log('\nV3. Live, and connected to the rest of the app');
    await files[0].trigger('click');
    await until(() => w.find('.record-panel .rp-title').text() === 'ep101_prores_v2.mov');
    check('clicking a row opens that record in the tray, beside the report', w.find('.reportview').exists() && w.find('.record-panel').exists());
    await w.find('.record-panel .rp-close').trigger('click');
    const moved = await post([{ type: 'link.add', id: randomUUID(), fieldId: fBid, fromRecord: ep2, toRecord: dcp }]);
    check('a peer links the DCP to Ep 102…', moved.status === 200);
    check('…and the outline updates in place — the walk is derived from the store, never stored', await until(() => {
      const ep2Row = w.findAll('.reportview .ro-row').find((r: any) => r.attributes('data-record') === ep2);
      return !!ep2Row && ep2Row.findAll('.c-rollup').map((c: any) => c.text()).join() === '2,1';
    }, 6000));
    await w.find('.reportview .rv-def').trigger('click');
    await until(() => w.find('.record-panel .rp-title').text() === 'Deliverables status');
    check('"definition…" opens the report\'s own record, where the Report field is edited', w.find('.record-panel .edit-json').exists());
    check('…and that record offers "open report", as a board offers "open board"', w.find('.record-panel .rp-open-report').exists());
    await w.find('.record-panel .rp-close').trigger('click');

    console.log('\nV4. A report with no definition, and a new one');
    await nav.openReport(blank);
    await until(() => w.find('.reportview .rv-title').text() === 'Empty one');
    check('a report without a definition says so and points at the record', /No definition yet/.test(w.find('.reportview .hint').text()));
    await nav.newReport('Manifest');
    await until(() => w.findAll('.tree .report-row').length === 3, 8000);
    const made = await ui.untilDb(`select r.id from records r join tables t on t.id = r.table_id where t.kind = 'report' and r.data->>'name' = 'Manifest'`, (r) => r.length === 1);
    check('"+ report" makes a record in the existing reports table (no second table)', made.length === 1 && (await pool.query(`select count(*)::int n from tables where kind = 'report'`)).rows[0].n === 1);
    check('…opens it, with its record in the tray ready for the definition', await until(() => w.find('.reportview .rv-title').text() === 'Manifest' && w.find('.record-panel .rp-title').text() === 'Manifest'));
    check('the grid of a reports table offers "open" on each row', await (async () => { await nav.openTable(tRep); await until(() => w.findAll('.gridview tr.row').length === 3); return w.find('.gridview .open-report').exists(); })());
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
