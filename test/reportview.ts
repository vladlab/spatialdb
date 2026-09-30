/**
 * A report, OPEN, in the app (REPORTS-BRIEF.md §2 — the first rendering): the
 * tree's Reports list, ReportView, the outline drawn by ReportOutline, its
 * addresses, and "+ report". The walk itself is test/reports.ts (pure); the kind
 * and the server's checks are test/structured.ts T9. V6 is the same report with
 * Files reached THROUGH A JUNCTION: accepted by the server, drawn with the pair's
 * status beside each file, and built in the level editor (the ⇄ via, the pair block).
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

    console.log('\nV5. The level editor (step 4): a definition built without typing an id');
    const ed = () => w.find('.record-panel .re');
    check('the tray shows the report field as an EDITOR, with "edit as JSON…" still underneath', ed().exists() && w.find('.record-panel .edit-json').exists());
    const rootEd = () => ed().find('.rl.root');
    await rootEd().find('select.rl-table').setValue(tFiles);
    await until(() => rootEd().findAll('.rl-field').length === 7);
    check('picking the root table lists its fields to show — the system fields Created / Created by included — and gives the level an id from the table\'s name', rootEd().findAll('.rl-field').map((x: any) => x.text().trim()).join() === 'Name,Path,Status,Work,Deliverable,Created,Created by' && rootEd().find('.rl-id').text() === 'files');
    const tick = async (scope: any, label: string, on = true) => { const l = scope.findAll('.rl-field, .rl-via').find((x: any) => x.find('.rl-via-name').exists() ? x.find('.rl-via-name').text() === label : x.text().trim() === label)!; await l.find('input[type="checkbox"]').setValue(on); };
    await tick(rootEd(), 'Path'); await tick(rootEd(), 'Status');
    await rootEd().find('.add-filter').trigger('click');
    await until(() => rootEd().findAll('.rl-line').length >= 1);
    const filterLine = () => rootEd().findAll('.rl-block').find((b: any) => b.find('.rl-label').text() === 'filter')!.find('.rl-line');
    await filterLine().findAll('select')[0].setValue(fDeliv);
    await filterLine().findAll('select')[1].setValue('notEmpty');
    check('a filter row offers the ops for the field\'s TYPE (a link: contains / is empty / is not empty)', filterLine().findAll('select')[1].findAll('option').map((o: any) => o.attributes('value')).join() === 'contains,empty,notEmpty');
    await rootEd().find('.add-level').trigger('click');
    await until(() => ed().findAll('.rl:not(.root)').length === 1);
    const child = () => ed().find('.rl:not(.root)');
    check('"+ descend into…" adds a level offering every link that connects to Files — forward and back — landing table shown',
      child().findAll('.rl-via .rl-via-name').map((x: any) => x.text()).sort().join() === 'Deliverable,Work', child().findAll('.rl-via').map((x: any) => x.text()).join('|'));
    check('save is disabled while the draft is incomplete (a level with no via), and says why', ed().find('.save-report').attributes('disabled') !== undefined && /via/.test(ed().find('.re-error').text()), ed().find('.re-error').exists() ? ed().find('.re-error').text() : '(no error shown)');
    await tick(child(), 'Deliverable');
    await until(() => child().find('.rl-id').text() === 'deliverables');
    check('ticking a via names the level after the table it lands in, and the other link (to Works) is now disabled — different table',
      child().findAll('.rl-via').find((x: any) => x.find('.rl-via-name').text() === 'Work')!.classes('off'));
    await child().find('.rl-role').setValue('target');
    await tick(child(), 'Codec');
    await rootEd().find('.add-rollup').trigger('click');
    await until(() => rootEd().find('.rl-rollup').exists());
    await rootEd().find('.rl-rollup .rl-rlabel').setValue('specs');
    check('the error is gone and save is enabled', !ed().find('.re-error').exists() && ed().find('.save-report').attributes('disabled') === undefined, ed().find('.re-error').exists() ? ed().find('.re-error').text() : '');
    await ed().find('.save-report').trigger('click');
    const savedRows = await ui.untilDb(`select data->'report' d from records where id = '${made[0].id}'`, (r) => r[0]?.d?.root?.table === tFiles, 8000);
    const saved = savedRows[0].d;
    const canon = (v: any): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));   // jsonb reorders keys
    check('save writes the definition ONCE — ids from table names, explicit fields, the filter, the via with its role, the rollup',
      canon(saved) === canon({ v: 1, root: { id: 'files', fields: [fPath, fStatus], filters: [{ fieldId: fDeliv, op: 'notEmpty' }], sort: [], rollups: [{ id: 'deliverables', label: 'specs', op: 'count', over: 'deliverables' }], table: tFiles,
        children: [{ id: 'deliverables', fields: [fDCodec], filters: [], sort: [], rollups: [], via: [{ fieldId: fDeliv, role: 'target' }], children: [] }] } }), canon(saved));
    check('…and the open report draws it: three files, each with its deliverable beneath', await until(() => w.findAll('.reportview .ro.root > table > tbody > .ro-row').length === 3 && w.findAll('.reportview .ro-role').length === 3, 8000));
    check('after saving, the editor is clean (no unsaved changes)', ed().find('.save-report').attributes('disabled') !== undefined && !/unsaved/.test(ed().text()));

    console.log('\nV6. Through a junction: Files reached by the Delivery column, the pair beside the file');
    const tJ = randomUUID(), jStatus = randomUUID(), jFile = randomUUID(), jDel = randomUUID(), jNotes = randomUUID(), blFiles = randomUUID(), blDeliv = randomUUID();
    const pr1 = randomUUID(), pr2 = randomUUID(), pr3 = randomUUID(), through = randomUUID();
    const pairRow = (id: string, file: string, status: string) => [
      { type: 'record.create', id, tableId: tJ, data: { status } },
      { type: 'link.add', id: randomUUID(), fieldId: jFile, fromRecord: id, toRecord: file }, { type: 'link.add', id: randomUUID(), fieldId: jDel, fromRecord: id, toRecord: prores },
    ];
    const filesLevel = (pair: unknown) => ({ id: 'files', via: [{ fieldId: blDeliv }], pins: [{ fieldId: fWork, levelId: 'works' }], pair, fields: [fPath], sort: [{ fieldId: fFName, dir: 'desc' }], children: [] });
    const throughDef = (pair: unknown, delivPair?: unknown) => ({ v: 1, root: { id: 'works', table: tWorks, sort: [{ fieldId: fWName, dir: 'asc' }],
      rollups: [{ id: 'satisfied', label: 'satisfied', op: 'countWhere', over: 'delivs', where: { rollup: 'accepted', op: 'gt', value: 0 } }],
      children: [{ id: 'delivs', via: [{ fieldId: fBid }, { fieldId: fAdded }], ...(delivPair ? { pair: delivPair } : {}), sort: [{ fieldId: fDName, dir: 'asc' }],
        rollups: [{ id: 'files', label: 'files', op: 'count', over: 'files' }, { id: 'accepted', label: 'accepted', op: 'countWhere', over: 'files', where: [{ fieldId: jStatus, op: 'eq', value: 'Accepted' }] }],
        children: [filesLevel(pair)] }] } });
    const jSetup = await post([
      // The junction, wired the way schemaActions.createJunction does it (test/junction.ts).
      { type: 'table.create', id: tJ, name: 'Delivery', singularName: 'Delivery', kind: 'junction' },
      { type: 'field.create', id: jStatus, tableId: tJ, name: 'Status', key: 'status', fieldType: 'select', options: { choices: ['Uploaded', 'Rejected', 'Accepted'] } }, pos(jStatus, 0),
      { type: 'field.create', id: jFile, tableId: tJ, name: 'File', key: 'file', fieldType: 'link', options: { target_table_id: tFiles, single: true } }, pos(jFile, 1),
      { type: 'field.create', id: jDel, tableId: tJ, name: 'Deliverable', key: 'deliverable', fieldType: 'link', options: { target_table_id: tDel, single: true } }, pos(jDel, 2),
      { type: 'field.create', id: jNotes, tableId: tJ, name: 'Notes', key: 'notes', fieldType: 'long_text' }, pos(jNotes, 3),
      { type: 'table.update', id: tJ, junction: { a: jFile, b: jDel, status: jStatus } },
      { type: 'field.create', id: blFiles, tableId: tFiles, name: 'Delivery', key: 'delivery', fieldType: 'backlink', options: { source_field_id: jFile } },
      { type: 'field.create', id: blDeliv, tableId: tDel, name: 'Delivery', key: 'delivery', fieldType: 'backlink', options: { source_field_id: jDel } },
      ...pairRow(pr1, v1, 'Rejected'), ...pairRow(pr2, v2, 'Accepted'), ...pairRow(pr3, other, 'Uploaded'),
      { type: 'record.create', id: through, tableId: tRep, data: { name: 'Delivered', report: throughDef({ fields: [jStatus] }) } },
    ]);
    check('the server accepts a via that is a junction column, pair fields, and a rollup testing the pair', jSetup.status === 200, (await jSetup.text()).slice(0, 300));
    const refused = await post([{ type: 'record.update', id: through, set: { report: throughDef({ fields: [jStatus] }, { fields: [jStatus] }) } }]);
    check('…and refuses pair fields on a level reached by a plain link', refused.status === 400 && /go through one junction/.test(await refused.text()));

    await nav.openReport(through);
    await until(() => w.find('.reportview .rv-title').text() === 'Delivered' && w.findAll('.reportview .ro-row').length >= 4, 8000);
    const rowOf = (id: string) => w.findAll('.reportview .ro-row').find((r: any) => r.attributes('data-record') === id);
    const under = (row: any) => { const el = row.element.nextElementSibling as HTMLElement; return w.findAll('.reportview .ro-row').filter((r: any) => el.contains(r.element)); };
    const proresOf = (work: string) => under(rowOf(work)).find((r: any) => r.attributes('data-record') === prores)!;
    const e1Files = () => under(proresOf(ep1));
    check('no warning: the definition is valid on the client too', !w.find('.reportview .rv-warning').exists(), w.find('.reportview .rv-warning').exists() ? w.find('.reportview .rv-warning').text() : '');
    check('Ep 101 › ProRes › its two files — ONE level, no pair rows in between, Ep 102\'s file pinned out', await until(() => e1Files().map(labelOf).join('|') === 'ep101_prores_v2.mov|ep101_prores_v1.mov', 6000), e1Files().map((r: any) => r.text()).join('|'));
    const filesTable = e1Files()[0].element.closest('table') as HTMLElement;
    check('the Files section\'s header: File, the PAIR\'s Status, then the file\'s own Path', [...filesTable.querySelectorAll(':scope > thead th')].map((t) => t.textContent!.trim()).join('|') === 'File|Status|Path');
    check('each file shows its pair\'s status beside it', e1Files().map((r: any) => r.find('.c-pair').text()).join() === 'Accepted,Rejected');
    check('the rollups read the pair: ProRes on 101 has 2 files, 1 accepted; 101 has 1 satisfied, 102 none', proresOf(ep1).findAll('.c-rollup').map((c: any) => c.text()).join() === '2,1'
      && rowOf(ep1)!.findAll('.c-rollup')[0].text() === '1' && rowOf(ep2)!.findAll('.c-rollup')[0].text() === '0');
    const accept = await post([{ type: 'record.update', id: pr3, set: { status: 'Accepted' } }]);
    check('a peer accepts Ep 102\'s file (the pair row\'s status)…', accept.status === 200);
    check('…and the report follows: 102 is satisfied, its file says Accepted', await until(() => rowOf(ep2)!.findAll('.c-rollup')[0].text() === '1' && under(proresOf(ep2))[0]?.find('.c-pair').text() === 'Accepted', 6000));

    await w.find('.reportview .rv-def').trigger('click');
    await until(() => w.find('.record-panel .rp-title').text() === 'Delivered' && ed().findAll('.rl').length === 3);
    const filesEd = () => ed().findAll('.rl')[2];
    const throughVia = () => filesEd().find(`.rl-via[data-via="${blDeliv}"]`);
    check('the editor offers the junction column as a via — "Delivery ⇄ Files · through Delivery" — and it is the one ticked',
      throughVia().exists() && throughVia().classes('through') && throughVia().find('.rl-via-name').text() === 'Delivery' && /⇄ Files · through Delivery/.test(throughVia().text())
      && (throughVia().find('input[type="checkbox"]').element as HTMLInputElement).checked, filesEd().findAll('.rl-via').map((x: any) => x.text()).join('|'));
    check('…beside the endpoint link, which still leads to the pair rows themselves', filesEd().findAll('.rl-via').some((x: any) => x.find('.rl-via-name').text() === 'Delivery.Deliverable' && /← Delivery/.test(x.text())));
    check('the level is still pinned to the Work through Files.Work', filesEd().findAll('.rl-block').find((b: any) => b.find('.rl-label').text() === 'pinned to')!.findAll('input:checked').length === 1);
    const pairBlock = () => filesEd().find('.rl-pair');
    check('a "pair" block lists the junction\'s OWN fields (not its two endpoint links), Status ticked',
      pairBlock().exists() && pairBlock().findAll('.pair-field').map((x: any) => x.text().trim()).join().startsWith('Status,Notes') && !/File|Deliverable/.test(pairBlock().findAll('.pair-field').map((x: any) => x.text()).join())
      && pairBlock().findAll('.pair-field input:checked').length === 1, pairBlock().exists() ? pairBlock().text() : '(no pair block)');
    check('the deliverables level — reached by plain links — has no pair block', !ed().findAll('.rl')[1].find(':scope > .rl-pair').exists());
    const delivRollups = () => ed().findAll('.rl')[1].findAll(':scope > .rl-block').find((b: any) => b.find('.rl-label').text() === 'rollups')!;
    check('a rollup over that level offers the pair\'s fields, named by the junction', delivRollups().findAll('.rl-where select')[1].findAll('option').some((o: any) => o.text() === 'Delivery › Status'));
    await pairBlock().find('.add-pair-filter').trigger('click');
    await until(() => pairBlock().find('.pair-filter').exists());
    const pf = () => pairBlock().find('.pair-filter');
    check('"+ pair filter" starts on the junction\'s status with its choices', (pf().findAll('select')[0].element as HTMLSelectElement).value === jStatus
      && pf().findAll('select')[2].findAll('option').map((o: any) => o.text()).join() === ',Uploaded,Rejected,Accepted');
    await pf().findAll('select')[2].setValue('Rejected');
    await ed().find('.save-report').trigger('click');
    const savedPair = await ui.untilDb(`select data->'report'->'root'->'children'->0->'children'->0->'pair' p from records where id = '${through}'`, (r) => r[0]?.p?.filters?.length === 1, 8000);
    check('save writes the pair: its fields and the filter', savedPair[0].p.fields.join() === jStatus && savedPair[0].p.filters[0].fieldId === jStatus && savedPair[0].p.filters[0].op === 'eq' && savedPair[0].p.filters[0].value === 'Rejected', JSON.stringify(savedPair[0].p));
    check('…and the outline keeps only the files whose pair passes: 101\'s rejected v1; 102\'s section is empty but drawn',
      await until(() => e1Files().map(labelOf).join() === 'ep101_prores_v1.mov' && under(proresOf(ep2)).length === 0 && /— nothing —/.test((proresOf(ep2).element.nextElementSibling as HTMLElement).textContent ?? ''), 6000), e1Files().map((r: any) => r.text()).join('|'));
    await throughVia().find('input[type="checkbox"]').setValue(false);
    check('unticking the junction via takes the pair block (and its picks) with it; revert brings them back', await until(() => !filesEd().find('.rl-pair').exists())
      && await (async () => { await ed().find('.revert-report').trigger('click'); return until(() => ed().findAll('.rl').length === 3 && filesEd().find('.rl-pair .pair-filter').exists()); })());
    await w.find('.record-panel .rp-close').trigger('click');

    check('the grid of a reports table offers "open" on each row', await (async () => { await nav.openTable(tRep); await until(() => w.findAll('.gridview tr.row').length === 4); return w.find('.gridview .open-report').exists(); })());
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
