/**
 * Structured fields in the app: creating one, the grid summary, the audio layout
 * editor (presets, split, merge, copy/paste), compare-with-a-linked-record, the
 * manifest view, the JSON escape hatch, and "Add standard Files fields".
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
    const pField = (label: string) => w.findAll('.record-panel .rp-field').find((f: any) => f.find('.rp-name').text().replace('★', '').trim() === label);
    const dbLayout = async (id: string) => (await pool.query(`select data->'audio_layout' v from records where id = $1`, [id])).rows[0].v;
    const mutations = async () => Number((await pool.query(`select count(*)::int n from mutations`)).rows[0].n);

    console.log('\nT1. The grid');
    await go(tDel);
    check('a structured cell is a one-line SUMMARY of its value', await until(() => cellOf('Network master', 'Audio layout').text() === '2 tracks / 8 ch (5.1, 2.0)'), cellOf('Network master', 'Audio layout').text());
    await go(tFiles);
    check('a number field formatted as bytes reads as a size (the stored value is still a number)', cellOf('ep101.mov', 'Total size').text() === '120 GB', cellOf('ep101.mov', 'Total size').text());

    console.log('\nT1b. Following a link');
    const pill = () => cellOf('ep101.mov', 'Targets').find('.chip');
    check('a linked record\'s pill carries an "open" button (revealed on hover; its space is always reserved, so nothing shifts)',
      await until(() => pill().exists()) && pill().find('.chip-open').exists() && pill().text().includes('Network master'));
    await pill().find('.chip-open').trigger('click');
    check('clicking it opens THAT record in the tray — the deliverable, not the file', await until(() => w.find('.record-panel .rp-title').text() === 'Network master'));
    check('…without putting the cell into edit mode', !w.find('.gridview td.editing').exists());
    await w.find('.record-panel .rp-close').trigger('click');
    await openRecord('ep101.mov');
    await pField('Targets').find('.chip .chip-open').trigger('click');
    check('the same button on a pill INSIDE the tray walks the tray to the linked record', await until(() => w.find('.record-panel .rp-title').text() === 'Network master'));
    await w.find('.record-panel .rp-close').trigger('click');

    console.log('\nT2. Creating a structured field');
    await w.find('.gridview .th-add').trigger('click');
    const form = () => w.find('.gridview .popover');
    await form().find('input.name').setValue('Manifest');
    await form().find('select.type').setValue('structured');
    check('choosing "structured" asks for a SHAPE', form().find('select.shape').exists() && form().findAll('select.shape option').map((o: any) => o.text()).join() === 'shape…,File manifest,Audio layout,Generic JSON');
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
    check('the summary above the editor follows', await until(() => pField('Audio layout').find('.sf-summary').text() === '2 tracks / 8 ch (5.1, 2.0)'));

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
      && pField('Audio layout').find('.sf-summary').text() === '2 tracks / 8 ch (5.1, 2.0)', tracks().join(' | '));
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

    console.log('\nT6. "Add standard Files fields"');
    await nav.tableSettings(tFiles);
    await until(() => w.find('.ts .add-files-fields').exists());
    const fieldsBefore = Number((await pool.query(`select count(*)::int n from fields where table_id = $1`, [tFiles])).rows[0].n);
    await w.find('.ts .add-files-fields').trigger('click');
    const after = await untilDb(`select key, type, options from fields where table_id = '${tFiles}' order by position`, (r) => r.length === fieldsBefore + 5);
    const byKey = Object.fromEntries(after.map((f: any) => [f.key, f]));
    check('it adds only what is MISSING (manifest, audio_layout and total_size were already there)', after.length === fieldsBefore + 5
      && ['kind', 'path', 'file_count', 'hash', 'parent'].every((k) => byKey[k]), after.map((f: any) => f.key).join());
    check('with the right types: path is a file_path, kind a select of the four manifest kinds, parent a link to this same table',
      byKey.path?.type === 'file_path' && byKey.kind?.options.choices.join() === 'file,bundle,sequence,channel_set' && byKey.parent?.type === 'link' && byKey.parent.options.target_table_id === tFiles);
    await w.find('.ts .add-files-fields').trigger('click');
    await sleep(300);
    check('run again, it adds nothing and says so', /already has all/.test(w.find('.ts .std').text())
      && Number((await pool.query(`select count(*)::int n from fields where table_id = $1`, [tFiles])).rows[0].n) === fieldsBefore + 5, w.find('.ts .std').text());
    await w.find('.ts .x').trigger('click');
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    check('all five are ONE Ctrl+Z — the fields are REMOVED (creating schema had no inverse at all before this)', (await untilDb(`select count(*)::int n from fields where table_id = '${tFiles}'`, (r) => Number(r[0].n) === fieldsBefore))[0].n == fieldsBefore);
    const order = (await pool.query(`select key from fields where table_id = $1 order by position, key`, [tFiles])).rows.map((r: any) => r.key);
    check('…and the fields that were there keep their order — Name is still first, still the primary field', order[0] === 'name', order.join());
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
    check('Redo brings all five back', (await untilDb(`select count(*)::int n from fields where table_id = '${tFiles}'`, (r) => Number(r[0].n) === fieldsBefore + 5, 8000))[0].n == fieldsBefore + 5);
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
