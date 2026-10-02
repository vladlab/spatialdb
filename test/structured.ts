/**
 * Structured fields in the app: creating one, the grid summary, the audio layout
 * editor (presets, split, merge, copy/paste), compare-with-a-linked-record, the
 * manifest view and the JSON escape hatch.
 * The shapes themselves — validation, summaries, the diff — are in test/grid.ts.
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8813));
  const { w, win, pool, until, untilDb, post, nav } = ui;
  try {
    const tDel = randomUUID(), tFiles = randomUUID();
    const fDelName = randomUUID(), fDelLayout = randomUUID(), fFileName = randomUUID(), fTargets = randomUUID(), fFileLayout = randomUUID(), fSize = randomUUID();
    const spec = randomUUID(), file1 = randomUUID(), file2 = randomUUID(), dcp = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const specLayout = { tracks: [{ name: 'Full mix', channels: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'] }, { name: 'Stereo', channels: ['L', 'R'] }] };
    const setup = await post([
      { type: 'table.create', id: tDel, name: 'Deliverables' }, { type: 'table.create', id: tFiles, name: 'Files' },
      { type: 'field.create', id: fDelName, tableId: tDel, name: 'Name', key: 'name', fieldType: 'text' }, pos(fDelName, 0),
      { type: 'field.create', id: fDelLayout, tableId: tDel, name: 'Audio layout', key: 'audio_layout', fieldType: 'structured', options: { shape: 'audio_layout' } }, pos(fDelLayout, 1),
      { type: 'field.create', id: fFileName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(fFileName, 0),
      { type: 'field.create', id: fTargets, tableId: tFiles, name: 'Targets', key: 'targets', fieldType: 'link', options: { target_table_id: tDel } }, pos(fTargets, 1),
      { type: 'field.create', id: fFileLayout, tableId: tFiles, name: 'Audio layout', key: 'audio_layout', fieldType: 'structured', options: { shape: 'audio_layout' } }, pos(fFileLayout, 2),
      { type: 'field.create', id: fSize, tableId: tFiles, name: 'Total size', key: 'total_size', fieldType: 'number', options: { format: 'bytes' } }, pos(fSize, 3),
      { type: 'record.create', id: spec, tableId: tDel, data: { name: 'Network master', audio_layout: specLayout } },
      { type: 'record.create', id: file1, tableId: tFiles, data: { name: 'ep101.mov', total_size: 128849018880 } },
      { type: 'record.create', id: file2, tableId: tFiles, data: { name: 'ep102.mov' } },
      { type: 'record.create', id: dcp, tableId: tFiles, data: { name: 'EP101_DCP' } },
      { type: 'link.add', id: randomUUID(), fieldId: fTargets, fromRecord: file1, toRecord: spec },
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 200));

    const go = async (tableId: string) => { win.location.hash = `#/all/table/${tableId}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange')); await until(() => w.find('.gridview').exists() && w.findAll('.gridview tr.row').length > 0, 8000); };
    const ths = () => w.findAll('.gridview thead .th-name').map((x: any) => x.text());
    const rowNamed = (name: string) => w.findAll('.gridview tr.row').find((r: any) => r.findAll('td')[1].text() === name);
    const cellOf = (name: string, col: string) => rowNamed(name).findAll('td')[ths().indexOf(col) + 1];
    const openRecord = async (name: string) => { await rowNamed(name).find('.expand').trigger('click'); await until(() => w.find('.record-panel .rp-title').text() === name); };
    const pField = (label: string) => w.findAll('.record-panel .rp-field').find((f: any) => f.find('.rp-name').text().replace(/[★⚠✓]/g, '').trim() === label);
    const dbLayout = async (id: string) => (await pool.query(`select data->'audio_layout' v from records where id = $1`, [id])).rows[0].v;
    const mutations = async () => Number((await pool.query(`select count(*)::int n from mutations`)).rows[0].n);

    console.log('\nT1. The grid');
    await go(tDel);
    check('a structured cell is a one-line SUMMARY of its value — the counts, without the list of each track\'s format', await until(() => cellOf('Network master', 'Audio layout').text() === '2 tracks / 8 ch'), cellOf('Network master', 'Audio layout').text());
    await go(tFiles);
    check('a number field formatted as bytes reads as a size (the stored value is still a number)', cellOf('ep101.mov', 'Total size').text() === '120 GB', cellOf('ep101.mov', 'Total size').text());

    console.log('\nT1b. Following a link');
    const pill = () => cellOf('ep101.mov', 'Targets').find('.pill');
    check('a linked record\'s pill has no ⤢ — and says how it opens',
      await until(() => pill().exists()) && !pill().find('.pill-open').exists() && pill().text().includes('Network master') && /Double-click opens Network master/.test(pill().attributes('title') ?? ''), pill().attributes('title'));
    // A SINGLE click on the pill does nothing: it is text you might be selecting or dragging.
    await pill().trigger('pointerdown'); await pill().trigger('mousedown'); await pill().trigger('click');
    await new Promise((r) => setTimeout(r, 150));
    check('a click on the name itself opens nothing', !w.find('.record-panel').exists() || w.find('.record-panel .rp-title').text() !== 'Network master');
    await pill().trigger('dblclick');
    check('a double-click opens THAT record in the tray — the deliverable, not the file', await until(() => w.find('.record-panel .rp-title').text() === 'Network master'));
    check('…and stops at the pill: the cell under it does not open its link picker', !w.find('.gridview td.editing').exists() && !w.find('.picker').exists());
    await w.find('.record-panel .rp-close').trigger('click');
    await openRecord('ep101.mov');
    // In the tray a pill is DRAGGABLE (onto a canvas); a double-click walks the tray.
    await pField('Targets').find('.pill').trigger('dblclick');
    check('a double-click on a pill INSIDE the tray walks the tray to the linked record — and does not open the field\'s picker', !w.find('.picker').exists() && await until(() => w.find('.record-panel .rp-title').text() === 'Network master'));
    await w.find('.record-panel .rp-close').trigger('click');

    console.log('\nT1c. "Created" and "Created by": system fields on every table');
    check('the grid has Created and Created by columns, LAST, on a table nobody added them to', ths().slice(-2).join() === 'Created,Created by', ths().join());
    check('Created reads as a date-time, Created by as a name', /\d{4}/.test(cellOf('ep101.mov', 'Created').text()) && cellOf('ep101.mov', 'Created by').text().length > 0, `${cellOf('ep101.mov', 'Created').text()} | ${cellOf('ep101.mov', 'Created by').text()}`);
    check('they have no ⚙ — nothing about them is editable', !w.findAll('.gridview thead th').find((t: any) => t.find('.th-name').exists() && t.find('.th-name').text() === 'Created')!.find('.th-menu').exists());
    await cellOf('ep101.mov', 'Created').trigger('mousedown'); await cellOf('ep101.mov', 'Created').trigger('dblclick');
    check('…and a double-click does not open an editor', !w.find('.gridview td.editing').exists());
    await w.findAll('.gridview thead th').find((t: any) => t.find('.th-name').exists() && t.find('.th-name').text() === 'Created')!.find('.th-sort').trigger('click');
    const sortedBy = await untilDb(`select id, config from views where table_id = '${tFiles}' and id = '${tFiles}'`, (r) => r[0]?.config.sort?.length === 1);
    check('sorting by Created saves to the view like any field (its id is derived from the table\'s, so it is stable)', sortedBy[0].config.sort[0].fieldId.endsWith('00000000c7ea') && sortedBy[0].config.sort[0].fieldId.startsWith(tFiles.slice(0, 24)));
    await w.findAll('.gridview thead th').find((t: any) => t.find('.th-name').exists() && t.find('.th-name').text() === 'Created')!.find('.th-sort').trigger('click');
    await w.findAll('.gridview thead th').find((t: any) => t.find('.th-name').exists() && t.find('.th-name').text() === 'Created')!.find('.th-sort').trigger('click');   // asc → desc → off
    await w.findAll('.gridview button.ghost').find((b: any) => /add record/.test(b.text()))!.trigger('click');
    const mine = await untilDb(`select id from records where table_id = '${tFiles}' and not (data ? 'name')`, (r) => r.length === 1);
    const newRow = () => w.findAll('.gridview tr.row').find((r: any) => r.findAll('td')[1].text().trim() === '')!;
    check('a record you just made shows Created = now and Created by = YOU, before any reload', await until(() => !!newRow() && /\d{4}/.test(newRow().findAll('td')[ths().indexOf('Created') + 1].text()))
      && newRow().findAll('td')[ths().indexOf('Created by') + 1].text().length > 0, newRow()?.text());
    if (w.find('.gridview td.editing input').exists()) await w.find('.gridview td.editing input').trigger('keydown', { key: 'Escape' });
    await post([{ type: 'record.delete', id: mine[0].id }]);
    await until(() => !newRow());

    console.log('\nT1d. The select picker in the TRAY, and a multi-select');
    const fTags = randomUUID();
    await post([{ type: 'field.create', id: fTags, tableId: tFiles, name: 'Tags', key: 'tags', fieldType: 'multi_select', options: { choices: ['alpha', 'beta', 'gamma', 'delta'] } }, pos(fTags, 5)]);
    await until(() => ths().includes('Tags'));
    await openRecord('ep101.mov');
    const tagsField = () => pField('Tags');
    await tagsField().find('.rp-value').trigger('click');
    await until(() => tagsField().classes('editing') || tagsField().find('.cp').exists());
    check('a multi-select in the tray opens the same picker (over the choices not yet picked)', tagsField().find('.cp').exists()
      && tagsField().findAll('.cp-item').map((i: any) => i.text()).join() === 'alpha,beta,gamma,delta', tagsField().text());
    await tagsField().find('.cp-input').setValue('gam');
    await tagsField().find('.cp-input').trigger('keydown', { key: 'Enter' });
    check('typing + Enter TICKS a choice, writes it, and the picker stays open minus that choice',
      (await untilDb(`select data->'tags' t from records where id = '${file1}'`, (r) => JSON.stringify(r[0].t) === '["gamma"]')).length === 1
      && await until(() => tagsField().findAll('.chip').some((c: any) => c.text().includes('gamma')))
      && tagsField().find('.cp').exists() && !tagsField().findAll('.cp-item').some((i: any) => i.text() === 'gamma'), tagsField().text());
    await tagsField().find('.cp-input').setValue('a');
    check('"a" fuzzily matches alpha, beta, delta (in that order: prefix first, then substring)', tagsField().findAll('.cp-item').map((i: any) => i.text()).join() === 'alpha,beta,delta', tagsField().findAll('.cp-item').map((i: any) => i.text()).join());
    await tagsField().find('.cp-input').trigger('keydown', { key: 'Escape' });
    check('Escape closes it; what was ticked stays — as a capsule', await until(() => !tagsField().find('.cp').exists()) && tagsField().findAll('.choice').length === 1 && tagsField().find('.choice').text() === 'gamma');
    await w.find('.record-panel .rp-close').trigger('click');

    console.log('\nT2. Creating a structured field');
    await w.find('.gridview .th-add').trigger('click');
    const form = () => w.find('.gridview .popover');
    await form().find('input.name').setValue('Manifest');
    await form().find('select.type').setValue('structured');
    check('choosing "structured" asks for a SHAPE', form().find('select.shape').exists() && form().findAll('select.shape option').map((o: any) => o.text()).join() === 'shape…,File manifest,Audio layout,Video layout,Generic JSON');
    await form().find('button.add').trigger('click');
    check('…and will not create the field without one', await until(() => /needs a shape/.test(form().text())) && (await pool.query(`select 1 from fields where key = 'manifest'`)).rowCount === 0, form().text());
    await form().find('select.shape').setValue('manifest');
    await form().find('button.add').trigger('click');
    const made = await untilDb(`select options from fields where key = 'manifest'`, (r) => r.length === 1);
    check('with one, it is created — the shape recorded in the field\'s options', made[0]?.options.shape === 'manifest', JSON.stringify(made[0]?.options));
    await form().trigger('keydown', { key: 'Escape' });

    console.log('\nT2b. Undoing the creation of a field, and of a table');
    // The bug this guards: adding a field is a create + a position update, and only the
    // second had an inverse — so Ctrl+Z sent the new field to the FIRST column, where it
    // became the primary field and renamed every record in the table.
    await w.find('.gridview .th-add').trigger('click');
    await form().find('input.name').setValue('Scratch');
    await form().find('button.add').trigger('click');
    await untilDb(`select 1 from fields where key = 'scratch'`, (r) => r.length === 1);
    await form().trigger('keydown', { key: 'Escape' });
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    check('Ctrl+Z after adding a field REMOVES the field', (await untilDb(`select 1 from fields where key = 'scratch'`, (r) => r.length === 0)).length === 0);
    check('…and the first column — the primary field, every record\'s name — is untouched', await until(() => !ths().includes('Scratch')) && ths()[0] === 'Name' && !!rowNamed('ep101.mov'), ths().join());
    await nav.newTable('Throwaway');
    await untilDb(`select 1 from tables where name = 'Throwaway'`, (r) => r.length === 1);
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    check('Ctrl+Z after making a table removes the table', (await untilDb(`select 1 from tables where name = 'Throwaway'`, (r) => r.length === 0)).length === 0
      && await until(() => !nav.tableNames().includes('Throwaway')), nav.tableNames().join());
    await go(tFiles);

    console.log('\nT3. The audio layout editor');
    await openRecord('ep101.mov');
    const al = () => pField('Audio layout').find('.al');
    const tracks = () => al().findAll('.al-track').map((t: any) => `${t.find('.al-fmt').text()}:${(t.find('.al-name input').element as HTMLInputElement).value}`);
    check('the editor is simply there (no edit mode), with presets', await until(() => al().exists()) && al().findAll('.add-preset').map((b: any) => b.attributes('data-preset')).join() === 'mono,2.0,5.1,7.1');
    const before = await mutations();
    await al().find('[data-preset="5.1"]').trigger('click');
    await al().find('[data-preset="2.0"]').trigger('click');
    await untilDb(`select data->'audio_layout' v from records where id = '${file1}'`, (r) => r[0].v?.tracks?.length === 2);
    check('adding presets writes the layout — one mutation per action', (await dbLayout(file1)).tracks[0].channels.join(' ') === 'L R C LFE Ls Rs' && await mutations() === before + 2, `${await mutations() - before}`);
    check('the summary above the editor follows', await until(() => pField('Audio layout').find('.sf-summary').text() === '2 tracks / 8 ch'));

    check('there is NO compare in the cell — validation will get its own place (the owner\'s call); the diff lives on in the contract and the endpoint',
      !al().find('.al-compare').exists() && !/compare/i.test(al().text()));

    await al().findAll('.al-track')[0].find('.split').trigger('click');
    check('SPLIT the 5.1: six mono tracks, same channels', await until(() => tracks().length === 7 && tracks().slice(0, 6).every((t: string) => t.startsWith('mono:'))), tracks().join(' | '));
    for (let i = 0; i < 6; i++) await al().findAll('.al-track')[i].find('.al-pick input').setValue(true);
    check('selecting tracks enables merge', al().find('.merge').attributes('disabled') === undefined && /merge 6/.test(al().find('.merge').text()));
    await al().find('.merge').trigger('click');
    await until(() => tracks().length === 2);
    const nameIn = (i: number) => al().findAll('.al-track')[i].find('.al-name input');
    await nameIn(0).setValue('Full mix');            // (setValue fires `change` itself)
    await until(() => tracks()[0] === '5.1:Full mix');
    await nameIn(1).setValue('stereo ');
    await until(() => tracks()[1] === '2.0:stereo');
    await sleep(700);                                 // let every earlier write land, so the count below is settled
    const afterRename = await mutations();
    await nameIn(1).trigger('change');               // the same name again: must write NOTHING
    check('MERGE them back and name the tracks: a 5.1 and a stereo again', await until(() => tracks().join(' | ') === '5.1:Full mix | 2.0:stereo')
      && pField('Audio layout').find('.sf-summary').text() === '2 tracks / 8 ch', tracks().join(' | '));
    await sleep(300);
    check('re-entering the same name writes nothing — no log row, no empty undo step', await mutations() === afterRename, `${await mutations() - afterRename} extra`);
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    check('every editor action is one Ctrl+Z', await until(() => tracks()[1] === '2.0:')
      && (await untilDb(`select data->'audio_layout'->'tracks'->1->>'name' n from records where id = '${file1}'`, (r) => r[0].n === ''))[0].n === '', tracks().join(' | '));

    console.log('\nT4. Copy a spec\'s layout onto a file');
    await w.find('.record-panel .rp-close').trigger('click');
    await go(tDel);
    await openRecord('Network master');
    await until(() => al().exists());
    check('nothing to paste before anything is copied', al().find('.paste').attributes('disabled') !== undefined);
    await al().find('.copy').trigger('click');
    await w.find('.record-panel .rp-close').trigger('click');
    await go(tFiles);
    await openRecord('ep102.mov');
    await until(() => al().exists());
    check('the copy survives moving to another record and table', al().find('.paste').attributes('disabled') === undefined && /2 tracks \/ 8 ch/.test(al().find('.paste').attributes('title') ?? ''));
    await al().find('.paste').trigger('click');
    const pasted = await untilDb(`select data->'audio_layout' v from records where id = '${file2}'`, (r) => r[0].v?.tracks?.length === 2);
    check('paste writes the whole layout — the spec\'s, exactly', JSON.stringify(pasted[0].v) === JSON.stringify(specLayout), JSON.stringify(pasted[0].v));
    for (const _ of [0, 1]) await al().findAll('.al-track')[0].find('.x').trigger('click');
    check('removing the last track clears the FIELD (no empty {tracks: []} left behind)', (await untilDb(`select data from records where id = '${file2}'`, (r) => !('audio_layout' in r[0].data)))[0].data.audio_layout === undefined);

    console.log('\nT5. Manifests: read-only, with a JSON escape hatch');
    await post([{ type: 'record.update', id: dcp, set: { manifest: { kind: 'bundle', source: 'ASSETMAP.xml',
      members: [{ path: 'ASSETMAP.xml', size: 900 }, { path: 'video/reel1.mxf', size: 53687091200 }, { path: 'audio/reel1_51.mxf', size: 1073741824 }] } }, unset: [] }]);
    await w.find('.record-panel .rp-close').trigger('click');
    await until(() => cellOf('EP101_DCP', 'Manifest').text().startsWith('3 files'));
    check('the grid summarises a bundle', cellOf('EP101_DCP', 'Manifest').text() === '3 files, 51.0 GB (ASSETMAP.xml)', cellOf('EP101_DCP', 'Manifest').text());
    await openRecord('EP101_DCP');
    const mf = () => pField('Manifest');
    check('the tray lists its members with sizes — and offers no way to type into them', await until(() => mf().findAll('.mv-table tr').length === 3)
      && mf().findAll('.mv-table tr')[1].text().includes('video/reel1.mxf') && /50\.0 GB/.test(mf().findAll('.mv-table tr')[1].text()) && !mf().find('.mv input').exists(), mf().text());
    await mf().find('.edit-json').trigger('click');
    const area = () => mf().find('textarea.sf-json');
    await area().setValue('{ not json');
    await mf().find('.save-json').trigger('click');
    check('"edit as JSON": malformed JSON is refused, with the parser\'s reason', /not valid JSON/.test(mf().find('.sf-error').text()), mf().find('.sf-error').text());
    await area().setValue(JSON.stringify({ kind: 'bundle', members: [{ path: '/mnt/san/reel1.mxf', size: 1 }] }));
    await mf().find('.save-json').trigger('click');
    check('…valid JSON that breaks the SHAPE is refused by the same rule the server uses — nothing is sent', /relative/.test(mf().find('.sf-error').text())
      && (await pool.query(`select data->'manifest'->'members' m from records where id = $1`, [dcp])).rows[0].m.length === 3, mf().find('.sf-error').text());
    await area().setValue(JSON.stringify({ kind: 'sequence', pattern: 'ep101.%07d.exr', first: 1001, last: 1100, count: 98, gaps: [[1050, 1051]] }));
    await mf().find('.save-json').trigger('click');
    check('a valid one is saved, and renders as a frame range with its gap', await until(() => /frames 1001–1100/.test(mf().text()) && /missing: 1050–1051/.test(mf().text())), mf().text());
    await w.find('.record-panel .rp-close').trigger('click');

    console.log('\nT9. A table of reports (sql/013, REPORTS-BRIEF.md §4)');
    const bogus = await post([{ type: 'table.create', id: randomUUID(), name: 'Nope', kind: 'ledger' }]);
    check('an unknown table kind is refused by the contract', bogus.status === 400);
    await nav.newTable('Reports', 'report');
    const rep = await untilDb(`select t.id, t.kind, (select json_agg(json_build_object('key', key, 'type', type, 'shape', options->>'shape') order by position) from fields where table_id = t.id) fs from tables t where name = 'Reports'`, (r) => r.length === 1 && r[0].fs?.length === 2);
    const tRep = rep[0].id;
    check('the new-table dialog makes a table of REPORTS: kind report, with a Name and a structured "report" field', rep[0].kind === 'report' && JSON.stringify(rep[0].fs) === JSON.stringify([{ key: 'name', type: 'text', shape: null }, { key: 'report', type: 'structured', shape: 'report' }]), JSON.stringify(rep[0]));
    // Reports tables live under the tree's folded "utility" group (sql/016): unfold it.
    await until(() => w.find('.tree .show-utility').exists());
    if (!w.find('.tree').text().includes('reports')) await w.find('.tree .show-utility').trigger('click');
    await until(() => w.find('.tree').text().includes('reports'));
    check('the tree tags it "reports", as it tags boards', w.findAll('.tree .tag').some((t: any) => t.text() === 'reports'));
    const refused = async (data: Record<string, unknown>) => { const r = await post([{ type: 'record.create', id: randomUUID(), tableId: tRep, data }]); return `${r.status} ${await r.text()}`; };
    const badShape = await refused({ name: 'bad', report: { v: 1 } });
    check('a definition of the wrong SHAPE is refused, naming the field and the path', /^400 .*'report' \(report\)/.test(badShape), badShape);
    const ghost = randomUUID();
    const badRef = await refused({ name: 'bad', report: { v: 1, root: { id: 'r', table: ghost, children: [] } } });
    check('a definition naming a table that does not EXIST is refused (the server checks the schema)', /^400 .*does not exist/.test(badRef), badRef);
    const badField = await refused({ name: 'bad', report: { v: 1, root: { id: 'r', table: tFiles, fields: [fDelName], children: [] } } });
    check('…or a field of the wrong table', /^400 .*not a field of this level/.test(badField), badField);
    const good = randomUUID();
    const def = { v: 1, root: { id: 'files', table: tFiles, fields: [fFileName, fSize], sort: [{ fieldId: fFileName, dir: 'asc' }],
      rollups: [{ id: 'n', label: 'targets', op: 'count', over: 'specs' }],
      children: [{ id: 'specs', via: [{ fieldId: fTargets, role: 'target' }], fields: [fDelName], children: [] }] } };
    const ok = await post([{ type: 'record.create', id: good, tableId: tRep, data: { name: 'Files by spec', report: def } }]);
    check('a sound definition is accepted', ok.status === 200, (await ok.text()).slice(0, 200));
    await go(tRep);
    check('the grid cell summarises it structurally: "2 levels, 1 rollup"', await until(() => cellOf('Files by spec', 'Report').text() === '2 levels, 1 rollup'), cellOf('Files by spec', 'Report').text());
    await openRecord('Files by spec');
    check('the tray shows the report field with "edit as JSON…" (the editor is a later step)', !!pField('Report') && pField('Report').find('.edit-json').exists());
    const ts = (await pool.query(`select options from fields where id = $1`, [fDelName])).rows;
    check('the field form does not offer "report" as a shape — only a table of reports makes one', ts.length === 1 && !w.findAll('.gridview select.shape option').some((o: any) => o.text() === 'Report definition'));
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
