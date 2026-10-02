/**
 * A lookup that follows a BACKLINK (contract/lookups.ts) — "on the deliverable, the
 * status of every file made for it". The rule and the server's check are in
 * test/grid.ts (G1e, G5); this is the app:
 *
 *   B0  opened COLD on a REPORT whose only level shows such a column: the report
 *       loads what its columns read, not only the tables its walk lands in
 *   B1  then the Deliverables grid — the Files table still never opened — the column
 *       is filled: the grid loads the table the backlink's links come from
 *   B2  it is live: a far value changes, a link is added, a link is removed
 *   B3  the add-field form offers backlinks beside links, each saying where it leads,
 *       and then the far table's fields
 *   B4  a JUNCTION column is a backlink too: its far end is the pair rows — their status
 *   B5  what describes it: the field's ⚙ and Table settings read "Files ← Status"
 *   B6  the record tray shows it
 *   B7  deleting the link the backlink mirrors breaks the lookup — shown, not blank —
 *       and undoing the delete repairs it
 */
import { randomUUID } from 'node:crypto';
import { mountApp } from './uiHarness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const PORT = Number(process.env.TEST_PORT ?? 8843);
  const tFiles = randomUUID(), tDeliv = randomUUID(), tJ = randomUUID();
  const fName = randomUUID(), fStatus = randomUUID(), fTarget = randomUUID();
  const fDName = randomUUID(), fDFiles = randomUUID(), fDLook = randomUUID(), fDSends = randomUUID(), fDSendStatus = randomUUID();
  const ja = randomUUID(), jb = randomUUID(), jStatus = randomUUID();
  const tRep = randomUUID(), fRName = randomUUID(), fRDef = randomUUID(), report = randomUUID();
  const a = randomUUID(), b = randomUUID(), c = randomUUID(), texted = randomUUID(), textless = randomUUID(), trailer = randomUUID(), pair = randomUUID();
  const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
  const link = (fieldId: string, fromRecord: string, toRecord: string) => ({ type: 'link.add', id: randomUUID(), fieldId, fromRecord, toRecord });

  const ui = await mountApp(PORT, `#/all/report/${report}`, {}, async (post) => {
    const res = await post([
      { type: 'table.create', id: tDeliv, name: 'Deliverables', singularName: 'Deliverable' },
      { type: 'table.create', id: tFiles, name: 'Files', singularName: 'File' },
      { type: 'field.create', id: fName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(fName, 0),
      { type: 'field.create', id: fStatus, tableId: tFiles, name: 'Status', key: 'status', fieldType: 'select', options: { choices: ['Uploaded', 'QC Rejected', 'Accepted'] } }, pos(fStatus, 1),
      // The fact lives on the FILE: "this file is made for that deliverable".
      { type: 'field.create', id: fTarget, tableId: tFiles, name: 'Target', key: 'target', fieldType: 'link', options: { target_table_id: tDeliv, single: true } }, pos(fTarget, 2),
      { type: 'field.create', id: fDName, tableId: tDeliv, name: 'Name', key: 'name', fieldType: 'text' }, pos(fDName, 0),
      // …and Deliverables reads it from the other end, then looks THROUGH that.
      { type: 'field.create', id: fDFiles, tableId: tDeliv, name: 'Files', key: 'files', fieldType: 'backlink', options: { source_field_id: fTarget } }, pos(fDFiles, 1),
      { type: 'field.create', id: fDLook, tableId: tDeliv, name: 'File status', key: 'file_status', fieldType: 'lookup', options: { via_field_id: fDFiles, target_field_id: fStatus } }, pos(fDLook, 2),
      // A junction between the same two tables, for B4.
      { type: 'table.create', id: tJ, name: 'Sends', kind: 'junction' },
      { type: 'field.create', id: jStatus, tableId: tJ, name: 'Status', key: 'status', fieldType: 'select', options: { choices: ['Sent', 'Received'] } },
      { type: 'field.create', id: ja, tableId: tJ, name: 'File', key: 'file', fieldType: 'link', options: { target_table_id: tFiles, single: true } },
      { type: 'field.create', id: jb, tableId: tJ, name: 'Deliverable', key: 'deliverable', fieldType: 'link', options: { target_table_id: tDeliv, single: true } },
      { type: 'table.update', id: tJ, junction: { a: ja, b: jb, status: jStatus } },
      { type: 'field.create', id: fDSends, tableId: tDeliv, name: 'Sends', key: 'sends', fieldType: 'backlink', options: { source_field_id: jb } }, pos(fDSends, 3),
      // Through the junction column: the pair rows' own status (B0, B4).
      { type: 'field.create', id: fDSendStatus, tableId: tDeliv, name: 'Send status', key: 'send_status', fieldType: 'lookup', options: { via_field_id: fDSends, target_field_id: jStatus } }, pos(fDSendStatus, 4),
      // A report of ONE level — Deliverables — showing that column: its walk never lands in Sends.
      { type: 'table.create', id: tRep, name: 'Reports', singularName: 'Report', kind: 'report' },
      { type: 'field.create', id: fRName, tableId: tRep, name: 'Name', key: 'name', fieldType: 'text' }, pos(fRName, 0),
      { type: 'field.create', id: fRDef, tableId: tRep, name: 'Report', key: 'report', fieldType: 'structured', options: { shape: 'report' } }, pos(fRDef, 1),
      { type: 'record.create', id: report, tableId: tRep, data: { name: 'Sends by deliverable', report: { v: 1, root: { id: 'delivs', table: tDeliv, fields: [fDSendStatus], sort: [{ fieldId: fDName, dir: 'asc' }], children: [] } } } },
      ...[[texted, 'Texted Master'], [textless, 'Textless Master'], [trailer, 'Trailer']].map(([id, name]) => ({ type: 'record.create', id, tableId: tDeliv, data: { name } })),
      { type: 'record.create', id: a, tableId: tFiles, data: { name: 'a.mov', status: 'Accepted' } },
      { type: 'record.create', id: b, tableId: tFiles, data: { name: 'b.mov', status: 'QC Rejected' } },
      { type: 'record.create', id: c, tableId: tFiles, data: { name: 'c.mov' } },
      link(fTarget, a, texted), link(fTarget, b, texted),          // c.mov targets nothing yet
      { type: 'record.create', id: pair, tableId: tJ, data: { status: 'Received' } }, link(ja, pair, a), link(jb, pair, trailer),
    ]);
    if (res.status !== 200) throw new Error(`fixture refused: ${await res.text()}`);
  });
  const { w, win, pool, until, untilDb, post, nav } = ui;
  try {
    const ths = () => w.findAll('.gridview thead .th-name').map((x: any) => x.text());
    const th = (name: string) => w.findAll('.gridview thead th').find((t: any) => t.find('.th-name').exists() && t.find('.th-name').text() === name)!;
    const rowNamed = (name: string) => w.findAll('.gridview tr.row').find((r: any) => r.findAll('td')[1].text() === name)!;
    const cellOf = (name: string, col: string) => rowNamed(name).findAll('td')[ths().indexOf(col) + 1];
    const looked = (name: string, col = 'File status') => cellOf(name, col).find('.looked-up').exists() ? cellOf(name, col).find('.looked-up').text() : `(${cellOf(name, col).text()})`;
    const gridPop = () => w.find('.gridview .popover');

    console.log('\nB0. Opened cold on a report that shows a lookup through a (junction) backlink');
    await until(() => w.findAll('.reportview .ro-row').length === 3, 8000);
    const repRow = (id: string) => w.findAll('.reportview .ro-row').find((r: any) => r.attributes('data-record') === id)!;
    check('the report\'s column is filled — it loaded the table the lookup reads, which its walk never lands in',
      await until(() => /Received/.test(repRow(trailer).text()), 8000) && !/Received/.test(repRow(texted).text()), repRow(trailer).text());

    console.log('\nB1. Then the table that looks through its backlink — Files still never opened');
    await nav.openTable(tDeliv);
    await until(() => w.findAll('.gridview tr.row').length === 3 && ths().includes('File status'), 8000);
    check('the column is filled without the Files table ever being opened', await until(() => looked('Texted Master') === 'Accepted, QC Rejected', 8000), looked('Texted Master'));
    check('…in link order, one value per file that targets the deliverable; none where no file does', looked('Textless Master') === '' && looked('Trailer') === '');
    check('the cell is a looked-up value: read-only, not a broken one', !cellOf('Texted Master', 'File status').find('.broken').exists());

    console.log('\nB2. It is live');
    await post([{ type: 'record.update', id: b, set: { status: 'Accepted' }, unset: [] }]);
    check('a far value changes: the cell follows', await until(() => looked('Texted Master') === 'Accepted, Accepted'), looked('Texted Master'));
    await post([link(fTarget, c, textless), { type: 'record.update', id: c, set: { status: 'Uploaded' }, unset: [] }]);
    check('a file is pointed at a deliverable: its status appears there', await until(() => looked('Textless Master') === 'Uploaded'), looked('Textless Master'));
    await post([{ type: 'link.remove', fieldId: fTarget, fromRecord: b, toRecord: texted }]);
    check('a link is removed: its value goes', await until(() => looked('Texted Master') === 'Accepted'), looked('Texted Master'));
    await post([{ type: 'record.update', id: a, set: {}, unset: ['status'] }]);
    check('linked, but the far cell is empty: nothing shown (and not "broken")', await until(() => looked('Texted Master') === ''), looked('Texted Master'));
    await post([{ type: 'record.update', id: a, set: { status: 'Accepted' }, unset: [] }]);
    await until(() => looked('Texted Master') === 'Accepted');

    console.log('\nB3. The add-field form');
    await w.find('.gridview .th-add').trigger('click');
    await until(() => gridPop().find('select.type').exists());
    await gridPop().find('input.name').setValue('File names');
    await gridPop().find('select.type').setValue('lookup');
    const vias = () => gridPop().find('select.via').findAll('option').map((o: any) => o.text());
    check('"follow which…" offers the table\'s BACKLINKS, each saying where it leads', await until(() => vias().includes('Files ← Files (backlink)')) && /link or backlink/.test(vias()[0]), vias().join(' | '));
    check('…the junction column among them, leading to its pair rows', vias().includes('Sends ← Sends (backlink)'), vias().join(' | '));
    await gridPop().find('select.via').setValue(fDFiles);
    const shows = () => gridPop().find('select.show').findAll('option').map((o: any) => o.text());
    check('"show which field" then offers the FILES table\'s plain fields — not its links', await until(() => shows().includes('Name') && shows().includes('Status')) && !shows().includes('Target'), shows().join(' | '));
    await gridPop().find('select.show').setValue(fName);
    await gridPop().find('button.add').trigger('click');
    const made = await untilDb(`select options from fields where table_id = '${tDeliv}' and name = 'File names'`, (r) => r.length === 1);
    check('the field is stored as an ordinary lookup: the backlink to follow, the field to show', made[0].options.via_field_id === fDFiles && made[0].options.target_field_id === fName, JSON.stringify(made[0].options));
    await gridPop().trigger('keydown', { key: 'Escape' });
    check('its column shows the names of the files that target each deliverable', await until(() => ths().includes('File names') && looked('Texted Master', 'File names') === 'a.mov' && looked('Textless Master', 'File names') === 'c.mov'),
      ths().includes('File names') ? `${looked('Texted Master', 'File names')} / ${looked('Textless Master', 'File names')}` : ths().join());

    console.log('\nB4. Through a junction column: the pair rows');
    check('the deliverable shows the status of its pair (the field was accepted by the server in the fixture)', await until(() => ths().includes('Send status') && looked('Trailer', 'Send status') === 'Received', 8000), ths().includes('Send status') ? looked('Trailer', 'Send status') : ths().join());
    const wrong = await post([{ type: 'field.create', id: randomUUID(), tableId: tDeliv, name: 'Bad', key: 'bad', fieldType: 'lookup', options: { via_field_id: fDSends, target_field_id: fStatus } }]);
    check('…but not a field of the FILE at its other end — that would be a second hop', wrong.status === 400 && /links come from/.test(await wrong.text()));

    console.log('\nB5. What describes it');
    await th('File status').find('.th-menu').trigger('click');
    await until(() => gridPop().find('.field-settings').exists());
    check('the ⚙ reads "Files ← Status": the arrow says which way the relationship is read', gridPop().find('.field-settings .meta.lookup').text() === 'Files ← Status', gridPop().find('.field-settings .meta.lookup').text());
    await gridPop().trigger('keydown', { key: 'Escape' });
    await nav.tableSettings(tDeliv);
    const sumOf = (id: string) => w.find(`.fitem[data-field="${id}"] .fsum`);
    check('Table settings says the same in its one-line summary', await until(() => sumOf(fDLook).exists()) && sumOf(fDLook).text() === 'Files ← Status', sumOf(fDLook).exists() ? sumOf(fDLook).text() : 'no row');
    if (w.find('.settings .x').exists()) await w.find('.settings .x').trigger('click');
    await nav.openTable(tDeliv);
    await until(() => w.findAll('.gridview tr.row').length === 3);

    console.log('\nB6. The record tray');
    await cellOf('Texted Master', 'Name').trigger('mousedown');
    await w.find('.gridview .scroller').trigger('keydown', { key: ' ' });
    const panel = () => w.find('.record-panel');
    const pField = (name: string) => panel().findAll('.rp-field').find((f: any) => f.find('.rp-name').text().replace(/[★⚠✓]/g, '').trim() === name)!;
    check('the looked-up value is in the tray too', await until(() => panel().exists() && !!pField('File status') && /Accepted/.test(pField('File status').text())), panel().exists() && pField('File status') ? pField('File status').text() : 'no field');
    await panel().find('.rp-close').trigger('click');

    console.log('\nB7. Breaking and repairing');
    // Deleted in the app (Files → Target's ⚙), so that Ctrl+Z is this client's to give.
    await nav.openTable(tFiles);
    await until(() => ths().includes('Target') && w.findAll('.gridview tr.row').length === 3);
    await th('Target').find('.th-menu').trigger('click');
    await until(() => gridPop().find('.field-settings').exists());
    await gridPop().find('.field-settings button.delete').trigger('click');   // the dialog pilot confirms
    await untilDb(`select count(*)::int n from fields where id = '${fTarget}'`, (r) => r[0].n === 0, 8000);
    check('the link the backlink mirrors is deleted', (await pool.query(`select count(*)::int n from links where field_id = $1`, [fTarget])).rows[0].n === 0);
    await nav.openTable(tDeliv);
    await until(() => ths().includes('File status') && w.findAll('.gridview tr.row').length === 3);
    check('the lookup shows as BROKEN, not as an empty cell', await until(() => cellOf('Texted Master', 'File status').find('.broken').exists()), cellOf('Texted Master', 'File status').text());
    await th('File status').find('.th-menu').trigger('click');
    await until(() => gridPop().find('.field-settings').exists());
    check('…and its ⚙ says why: the backlink it follows is itself broken', /broken — “Files” is itself broken/.test(gridPop().find('.field-settings .meta.lookup').text()), gridPop().find('.field-settings .meta.lookup').text());
    await gridPop().trigger('keydown', { key: 'Escape' });
    check('the lookup through the junction column is untouched', looked('Trailer', 'Send status') === 'Received');
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await untilDb(`select count(*)::int n from links where field_id = '${fTarget}'`, (r) => r[0].n === 2, 8000);
    check('Ctrl+Z repairs it: the link field, its links, and so the looked-up values', await until(() => looked('Texted Master') === 'Accepted' && looked('Textless Master') === 'Uploaded', 8000), `${looked('Texted Master')} / ${looked('Textless Master')}`);
  } finally {
    await ui.close();
  }
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete'); process.exit(1); });
