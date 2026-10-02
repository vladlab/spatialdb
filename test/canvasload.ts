/**
 * A canvas opened COLD — by a reload, or a link straight to it — shows what its
 * cards read, not only what the scene brings.
 *
 * A scene is the placed records and the links between them. A card also shows links
 * to records that are NOT placed, and a junction column's pairs, which live in a
 * third table. Those come with their tables, and the canvas has to ask for them: it
 * did not, so a reloaded canvas showed "—" in those rows until another view (the
 * tray, when you opened a card) happened to load the table.
 *
 * So this suite mounts the app AT the canvas, with nothing else ever opened.
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const PORT = Number(process.env.TEST_PORT ?? 8827);
  const tFiles = randomUUID(), tDeliv = randomUUID(), tWorks = randomUUID(), tJ = randomUUID(), tBoards = randomUUID();
  const fName = randomUUID(), fWork = randomUUID(), fDName = randomUUID(), fWName = randomUUID(), fBName = randomUUID();
  const ja = randomUUID(), jb = randomUUID(), jStatus = randomUUID();
  const a = randomUUID(), texted = randomUUID(), trailer = randomUUID(), ep1 = randomUUID(), board = randomUUID();
  const pair = randomUUID(), pair2 = randomUUID();
  const ui = await mountApp(PORT, `#/all/canvas/${board}`, {}, async (post) => {
    const res = await post([
      { type: 'table.create', id: tFiles, name: 'Files', singularName: 'File' },
      { type: 'table.create', id: tDeliv, name: 'Deliverables', singularName: 'Deliverable' },
      { type: 'table.create', id: tWorks, name: 'Works', singularName: 'Work' },
      { type: 'field.create', id: fWName, tableId: tWorks, name: 'Name', key: 'name', fieldType: 'text' },
      { type: 'field.create', id: fName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' },
      { type: 'field.create', id: fWork, tableId: tFiles, name: 'Work', key: 'work', fieldType: 'link', options: { target_table_id: tWorks } },
      { type: 'field.create', id: fDName, tableId: tDeliv, name: 'Name', key: 'name', fieldType: 'text' },
      // The junction, as the new-table dialog makes it (client/schemaActions.ts).
      { type: 'table.create', id: tJ, name: 'Delivery', kind: 'junction' },
      { type: 'field.create', id: jStatus, tableId: tJ, name: 'Status', key: 'status', fieldType: 'select', options: { choices: ['Uploaded', 'Accepted'] } },
      { type: 'field.create', id: ja, tableId: tJ, name: 'File', key: 'file', fieldType: 'link', options: { target_table_id: tFiles, single: true } },
      { type: 'field.create', id: jb, tableId: tJ, name: 'Deliverable', key: 'deliverable', fieldType: 'link', options: { target_table_id: tDeliv, single: true } },
      { type: 'table.update', id: tJ, junction: { a: ja, b: jb, status: jStatus } },
      { type: 'field.create', id: randomUUID(), tableId: tFiles, name: 'Delivery', key: 'delivery', fieldType: 'backlink', options: { source_field_id: ja } },
      { type: 'field.create', id: randomUUID(), tableId: tDeliv, name: 'Delivery', key: 'delivery', fieldType: 'backlink', options: { source_field_id: jb } },
      // A board, and two of the three records on it: the Work and the Trailer are NOT placed.
      { type: 'table.create', id: tBoards, name: 'Boards', kind: 'canvas' },
      { type: 'field.create', id: fBName, tableId: tBoards, name: 'Name', key: 'name', fieldType: 'text' },
      { type: 'record.create', id: board, tableId: tBoards, data: { name: 'Board' } },
      { type: 'record.create', id: ep1, tableId: tWorks, data: { name: 'Ep 101' } },
      { type: 'record.create', id: a, tableId: tFiles, data: { name: 'a.mov' } },
      { type: 'record.create', id: texted, tableId: tDeliv, data: { name: 'Texted Master' } },
      { type: 'record.create', id: trailer, tableId: tDeliv, data: { name: 'Trailer' } },
      { type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: a, toRecord: ep1 },
      { type: 'record.create', id: pair, tableId: tJ, data: { status: 'Uploaded' } },
      { type: 'link.add', id: randomUUID(), fieldId: ja, fromRecord: pair, toRecord: a },
      { type: 'link.add', id: randomUUID(), fieldId: jb, fromRecord: pair, toRecord: texted },
      { type: 'record.create', id: pair2, tableId: tJ, data: { status: 'Accepted' } },
      { type: 'link.add', id: randomUUID(), fieldId: ja, fromRecord: pair2, toRecord: a },
      { type: 'link.add', id: randomUUID(), fieldId: jb, fromRecord: pair2, toRecord: trailer },
      { type: 'placement.add', id: randomUUID(), canvasId: board, recordId: a, x: 40, y: 40, w: null, h: null, z: 1 },
      { type: 'placement.add', id: randomUUID(), canvasId: board, recordId: texted, x: 600, y: 40, w: null, h: null, z: 2 },
    ]);
    if (res.status !== 200) throw new Error(`fixture refused: ${(await res.text()).slice(0, 300)}`);
  });
  const { w, until } = ui;
  try {
    console.log('\nL1. A canvas opened cold');
    const cards = () => w.findAll('.canvas-container .card');
    const cardBy = (t: string) => cards().find((c: any) => c.find('.card-label').text() === t)!;
    const row = (card: string, key: string) => cardBy(card).findAll('.card-field').find((r: any) => r.find('.card-key').text() === key)!;
    check('the two placed cards are up, and nothing else was ever opened', await until(() => cards().length === 2, 8000) && !w.find('.record-panel').exists() && !w.find('.gridview').exists());
    check('a link to a record that is NOT on the canvas shows — its table came with the canvas',
      await until(() => !!row('a.mov', 'Work') && row('a.mov', 'Work').find('.pill').exists(), 8000) && row('a.mov', 'Work').find('.pill-text').text() === 'Ep 101', row('a.mov', 'Work')?.text());
    const pairs = () => row('a.mov', 'Delivery').findAll('.pill.junction').map((p: any) => p.find('.pill-text').text()).sort();
    check('a junction column shows its pairs — placed other end or not — without the card being opened',
      await until(() => !!row('a.mov', 'Delivery') && pairs().length === 2, 8000) && pairs().join() === 'Texted Master › Uploaded,Trailer › Accepted', row('a.mov', 'Delivery')?.text());
    check('…from the other end too', await until(() => row('Texted Master', 'Delivery').find('.pill.junction').exists(), 8000) && row('Texted Master', 'Delivery').find('.pill-text').text() === 'a.mov › Uploaded');
    check('the pair between the two cards is drawn as an arrow', await until(() => w.find(`.arrow-layer .arrow[data-key="${tJ}|${a}|${texted}"]`).exists(), 8000));
    check('still without a tray', !w.find('.record-panel').exists());
    await sleep(100);
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
