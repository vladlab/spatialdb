/**
 * Junctions in the app (sql/016): the new-table dialog wires a junction between two
 * tables; the column it puts on Files is WRITABLE — "+" opens the pair editor, the
 * picker offers the deliverables that share the file's Work first, a status is
 * picked, and the row lands with its two links in one batch. Chips read
 * "Texted Master › Uploaded", change status in place, × deletes; the junction
 * table sits under the tree's folded utility group. Server rules: test/junction.ts.
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const PORT = Number(process.env.TEST_PORT ?? 8821);
  const ui = await mountApp(PORT);
  const { w, win, pool, until, untilDb, post, nav } = ui;
  const nodeFetchCompare = (linkFieldId: string, ownerId: string, targetId: string) =>
    fetch(`http://localhost:${PORT}/api/compare`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ linkFieldId, ownerId, targetId }) });
  try {
    const tWorks = randomUUID(), tFiles = randomUUID(), tDeliv = randomUUID();
    const fWName = randomUUID(), fName = randomUUID(), fWork = randomUUID(), fDName = randomUUID(), fDWorks = randomUUID();
    const ep1 = randomUUID(), ep2 = randomUUID(), a = randomUUID(), b = randomUUID();
    const texted = randomUUID(), textless = randomUUID(), trailer = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const setup = await post([
      // Files and Deliverables FIRST: the new-table dialog's two table pickers default
      // to the first two data tables in order, which is what the pilot leaves them on.
      { type: 'table.create', id: tFiles, name: 'Files', singularName: 'File' }, { type: 'table.update', id: tFiles, position: 1 },
      { type: 'table.create', id: tDeliv, name: 'Deliverables', singularName: 'Deliverable' }, { type: 'table.update', id: tDeliv, position: 2 },
      { type: 'table.create', id: tWorks, name: 'Works', singularName: 'Work' }, { type: 'table.update', id: tWorks, position: 3 },
      { type: 'field.create', id: fWName, tableId: tWorks, name: 'Name', key: 'name', fieldType: 'text' }, pos(fWName, 0),
      { type: 'field.create', id: fName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(fName, 0),
      { type: 'field.create', id: fWork, tableId: tFiles, name: 'Work', key: 'work', fieldType: 'link', options: { target_table_id: tWorks } }, pos(fWork, 1),
      { type: 'field.create', id: fDName, tableId: tDeliv, name: 'Name', key: 'name', fieldType: 'text' }, pos(fDName, 0),
      { type: 'field.create', id: fDWorks, tableId: tDeliv, name: 'Works', key: 'works', fieldType: 'link', options: { target_table_id: tWorks } }, pos(fDWorks, 1),
      { type: 'record.create', id: ep1, tableId: tWorks, data: { name: 'Ep 101' } }, { type: 'record.create', id: ep2, tableId: tWorks, data: { name: 'Ep 102' } },
      { type: 'record.create', id: a, tableId: tFiles, data: { name: 'a.mov' } }, { type: 'record.create', id: b, tableId: tFiles, data: { name: 'b.mov' } },
      { type: 'record.create', id: texted, tableId: tDeliv, data: { name: 'Texted Master' } },
      { type: 'record.create', id: textless, tableId: tDeliv, data: { name: 'Textless Master' } },
      { type: 'record.create', id: trailer, tableId: tDeliv, data: { name: 'Trailer' } },
      { type: 'link.add', id: randomUUID(), fieldId: fWork, fromRecord: a, toRecord: ep1 },
      { type: 'link.add', id: randomUUID(), fieldId: fDWorks, fromRecord: texted, toRecord: ep1 },
      { type: 'link.add', id: randomUUID(), fieldId: fDWorks, fromRecord: texted, toRecord: ep2 },
      { type: 'link.add', id: randomUUID(), fieldId: fDWorks, fromRecord: textless, toRecord: ep2 },
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 200));
    win.location.hash = `#/all/table/${tFiles}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.findAll('.tree .table-row').length === 3, 8000);

    console.log('\nJ1. The new-table dialog makes a junction');
    // Three dialogs: name + kind, then the two tables — the pilot answers the first
    // with our choice and leaves the next two on their defaults (Files, Deliverables).
    await nav.newTable('Delivery', 'junction');
    const made = await untilDb(`select id, kind, junction from tables where name = 'Delivery'`, (r) => r.length === 1 && r[0].junction?.a, 8000);
    const tJ = made[0].id, cfg = made[0].junction;
    check('kind junction, with a config', made[0].kind === 'junction' && !!cfg.a && !!cfg.b && !!cfg.status, JSON.stringify(made[0]));
    const jf = (await pool.query(`select id, key, type, options from fields where table_id = $1 order by position`, [tJ])).rows;
    check('fields: Status (empty select), File, Deliverable (single links), Notes',
      jf.map((f: any) => `${f.key}:${f.type}`).join() === 'status:select,file:link,deliverable:link,notes:long_text'
        && jf[1].options.single === true && jf[1].options.target_table_id === tFiles && jf[2].options.target_table_id === tDeliv
        && (jf[0].options.choices ?? []).length === 0, JSON.stringify(jf));
    const cols = (await pool.query(`select table_id, name, type, options->>'source_field_id' src from fields where type = 'backlink' order by name`)).rows;
    check('a "Delivery" backlink column on Files and on Deliverables', cols.length === 2
      && cols.some((c: any) => c.table_id === tFiles && c.src === cfg.a) && cols.some((c: any) => c.table_id === tDeliv && c.src === cfg.b), JSON.stringify(cols));
    await until(() => w.find('.tree .show-utility').exists(), 4000);
    check('the tree folds it under utility', w.find('.tree .show-utility').text().includes('1 utility table') && !w.find(`.tree [data-table="${tJ}"]`).exists());
    await w.find('.tree .show-utility').trigger('click');
    check('…and shows it on request, tagged', await until(() => w.find(`.tree [data-table="${tJ}"]`).exists()) && w.find(`.tree [data-table="${tJ}"] .tag`).text() === 'junction');

    // The vocabulary is the owner's: give the status some choices, and a match.
    await post([
      { type: 'field.update', id: cfg.status, options: { choices: ['Uploaded', 'Rejected', 'Accepted'] } },
      { type: 'table.update', id: tJ, junction: { ...cfg, match: [[fWork, fDWorks]] } },
    ]);
    await untilDb(`select junction from tables where id = '${tJ}'`, (r) => !!r[0]?.junction?.match, 4000);

    console.log('\nJ2. The column on Files is writable');
    win.location.hash = `#/all/table/${tFiles}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.findAll('.gridview tr.row').length === 2, 8000);
    const rowOf = (name: string) => w.findAll('.gridview tr.row').find((r: any) => r.text().includes(name))!;
    const cellOf = (name: string) => rowOf(name).findAll('td').find((td: any) => td.find('.junc-add').exists())!;
    check('each row has a + in the Delivery column', !!cellOf('a.mov') && !!cellOf('b.mov'));
    const open = async (name: string) => cellOf(name).find('.junc-add').trigger('click');
    await open('a.mov');
    check('+ opens the pair editor with the picker', await until(() => w.find('.je .picker').exists()));
    const listed = () => w.findAll('.je .picker .list li').map((li: any) => li.find('.name').text());
    check('deliverables sharing a.mov\'s Work (Ep 101) come first and alone', await until(() => listed().length === 1) && listed().join() === 'Texted Master', listed().join());
    check('with a way out', w.find('.je .picker .scope-toggle').text().includes('show all Deliverables'));
    await w.find('.je .picker .scope-toggle input').setValue(true);
    check('show all: every deliverable', await until(() => listed().length === 3), listed().join());
    await w.findAll('.je .picker .list li').find((li: any) => li.text().includes('Texted Master')).trigger('mousedown');
    check('then the status buttons', await until(() => w.findAll('.je .st').length >= 3), w.find('.je').text());
    check('nothing written yet', (await pool.query(`select count(*)::int n from records where table_id = $1`, [tJ])).rows[0].n === 0);
    await w.findAll('.je .st').find((b: any) => b.text() === 'Uploaded').trigger('click');
    await w.find('.je .act.primary').trigger('click');
    const rows = await untilDb(`select r.id, r.data->>'status' s, (select count(*)::int from links where from_record = r.id) n from records r where r.table_id = '${tJ}'`, (r) => r.length === 1 && r[0].n === 2, 8000);
    check('one row, status Uploaded, both links — one batch', rows[0].s === 'Uploaded' && rows[0].n === 2, JSON.stringify(rows));
    const chip = () => cellOf('a.mov').find('.pill.junction');
    check('the chip reads "Texted Master › Uploaded"', await until(() => chip().exists() && chip().find('.pill-text').text() === 'Texted Master › Uploaded'), chip().exists() ? chip().text() : 'no chip');
    check('…drawn as two parts: the other end as the pill, the status beside it (the "›" stays in the text, undrawn)',
      chip().classes('paired') && chip().find('.pill-main').text() === 'Texted Master' && chip().find('.pill-status').text() === 'Uploaded');

    console.log('\nJ3. Same pair again lands on the row; status changes in place');
    await w.find('.je .act:not(.primary):not(.danger)').trigger('click');   // Done
    await until(() => !w.find('.je').exists());
    await open('a.mov');
    await until(() => w.find('.je .picker').exists());
    await w.find('.je .picker .scope-toggle input').setValue(true);
    await w.findAll('.je .picker .list li').find((li: any) => li.text().includes('Texted Master')).trigger('mousedown');
    check('picking the same deliverable edits the existing row (Delete offered, not Add)', await until(() => w.find('.je .act.danger').exists()) && !w.find('.je .act.primary').exists());
    await w.findAll('.je .st').find((b: any) => b.text() === 'Accepted').trigger('click');
    await untilDb(`select data->>'status' s from records where id = '${rows[0].id}'`, (r) => r[0]?.s === 'Accepted', 4000);
    check('status Accepted, still one row', (await pool.query(`select count(*)::int n from records where table_id = $1`, [tJ])).rows[0].n === 1);
    check('the chip follows', await until(() => chip().text().includes('Texted Master › Accepted')), chip().text());
    await w.find('.je .act.danger').trigger('click');
    await untilDb(`select count(*)::int n from records where table_id = '${tJ}'`, (r) => r[0].n === 0, 4000);
    check('Delete removes the pair; the chip goes', await until(() => !chip().exists()));

    console.log('\nJ4. Chips × and the endpoint cascade reach the screen');
    await open('b.mov');
    await until(() => w.find('.je .picker').exists());
    check('b.mov has no Work: no narrowing offered, everything listed', await until(() => listed().length === 3) && !w.find('.je .picker .scope-toggle').exists());
    await w.findAll('.je .picker .list li').find((li: any) => li.text().includes('Trailer')).trigger('mousedown');
    await until(() => w.find('.je .act.primary').exists());
    await w.find('.je .act.primary').trigger('click');
    const r2 = await untilDb(`select id from records where table_id = '${tJ}'`, (r) => r.length === 1, 8000);
    const chipB = () => cellOf('b.mov').find('.pill.junction');
    check('a row with no status reads just "Trailer"', await until(() => chipB().exists() && chipB().find('.pill-text').text() === 'Trailer'), chipB().exists() ? chipB().text() : 'no chip');
    check('…as an ordinary pill: no status segment', !chipB().classes('paired') && !chipB().find('.pill-status').exists());
    await chipB().find('.pill-x').trigger('click');
    await untilDb(`select count(*)::int n from records where id = '${r2[0].id}'`, (r) => r[0].n === 0, 4000);
    check('× deletes the row', await until(() => !chipB().exists()));
    // Make a pair from the server side, then delete the file: the client mirrors the cascade.
    const r3 = randomUUID();
    await post([
      { type: 'record.create', id: r3, tableId: tJ, data: { status: 'Uploaded' } },
      { type: 'link.add', id: randomUUID(), fieldId: cfg.a, fromRecord: r3, toRecord: b },
      { type: 'link.add', id: randomUUID(), fieldId: cfg.b, fromRecord: r3, toRecord: textless },
    ]);
    check('a peer\'s pair arrives as a chip', await until(() => chipB().exists() && chipB().text().includes('Textless Master › Uploaded'), 8000));
    await post([{ type: 'record.delete', id: b }]);
    await untilDb(`select count(*)::int n from records where id = '${r3}'`, (r) => r[0].n === 0, 4000);
    check('deleting the file took the pair on the server', true);
    await until(() => w.findAll('.gridview tr.row').length === 1, 8000);
    check('and the client dropped the junction row with it', await until(() => !w.findAll('.pill.junction').length) && !w.find('.errors').exists());

    console.log('\nJ5. On the canvas: a pair is dragged out of a port, drawn as an arrow, and worked from it');
    // a.mov and Texted Master on a board. Texted Master's card must show its Delivery
    // row (the port); it is the deliverables table's third field, within the default five.
    await nav.newCanvas('Board');
    const board = (await untilDb(`select id from records where data->>'name' = 'Board'`, (r) => r.length === 1))[0].id as string;
    await post([
      { type: 'placement.add', id: randomUUID(), canvasId: board, recordId: a, x: 40, y: 40, w: null, h: null, z: 1 },
      { type: 'placement.add', id: randomUUID(), canvasId: board, recordId: texted, x: 600, y: 40, w: null, h: null, z: 2 },
      { type: 'placement.add', id: randomUUID(), canvasId: board, recordId: trailer, x: 600, y: 400, w: null, h: null, z: 3 },
    ]);
    await nav.openCanvas(board);
    const cards = () => w.findAll('.canvas-container .card');
    const cardBy = (t: string) => cards().find((c: any) => c.find('.card-label').text() === t)!;
    check('the cards are up', await until(() => cards().length === 3, 8000));
    const portRow = (t: string) => cardBy(t).findAll('.card-field').find((r: any) => r.find('.card-key').text() === 'Delivery')!;
    check('a.mov\'s Delivery row is a PORT, like a link row', await until(() => !!portRow('a.mov') && portRow('a.mov').find('.port-handle').exists()));
    const PE = (win as any).PointerEvent ?? (win as any).MouseEvent;
    const winEv = (type: string, init: Record<string, unknown>) => win.dispatchEvent(new PE(type, { bubbles: true, ...init }));
    const toClient = (wx: number, wy: number) => {
      const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(w.find('.canvas-world').attributes('style') ?? '')!;
      return { clientX: wx * Number(m[3]) + Number(m[1]), clientY: wy * Number(m[3]) + Number(m[2]) };
    };
    await portRow('a.mov').find('.port-handle').trigger('pointerdown', { button: 0, ...toClient(300, 80) });
    winEv('pointermove', toClient(630, 60));
    check('dragging from it draws the rubber line; the deliverable cards light up, the file does not',
      await until(() => w.find('.arrow-layer .rubber').exists() && cardBy('Texted Master').classes('link-over')) && cardBy('Trailer').classes('link-ok') && !cardBy('a.mov').classes('link-ok'));
    winEv('pointerup', toClient(630, 60));
    check('dropped on Texted Master: the pair editor opens, other end already chosen, asking for the status',
      await until(() => w.find('.junction-anchor .je').exists()) && !w.find('.je .picker').exists() && w.find('.je .head').text().includes('Texted Master') && w.find('.je .act.primary').exists(), w.find('.je').exists() ? w.find('.je').text() : 'no editor');
    check('nothing written until Add', (await pool.query(`select count(*)::int n from records where table_id = '${tJ}'`)).rows[0].n === 0);
    await w.findAll('.je .st').find((b: any) => b.text() === 'Uploaded').trigger('click');
    await w.find('.je .act.primary').trigger('click');
    const pair = await untilDb(`select r.id, r.data->>'status' s, (select count(*)::int from links where from_record = r.id) n from records r where r.table_id = '${tJ}'`, (r) => r.length === 1 && r[0].n === 2, 8000);
    check('the pair exists — status Uploaded, both links, one batch', pair[0]?.s === 'Uploaded');
    const arrow = () => w.find(`.arrow-layer .arrow[data-key="${tJ}|${a}|${texted}"]`);
    check('and is drawn as an arrow a.mov → Texted Master, keyed by the junction', await until(() => arrow().exists()));
    await w.find('.je .act:not(.primary):not(.danger)').trigger('click');   // Done
    await until(() => !w.find('.je').exists());
    await w.find('.arrows-legend').trigger('click');
    check('the legend names it', await until(() => /Delivery \(pairs\)/.test(w.find('.legend').text())), w.find('.legend').exists() ? w.find('.legend').text() : 'no legend');
    await w.find('.arrows-legend').trigger('click');

    await arrow().find('.arrow-hit').trigger('pointerdown', { button: 0 });
    check('selected, the arrow is labelled with its STATUS, not a field name', await until(() => w.find('.arrow-layer .arrow-label text').exists() && w.find('.arrow-layer .arrow-label text').text() === 'Uploaded'), w.find('.arrow-layer .arrow-label').exists() ? w.find('.arrow-layer .arrow-label text').text() : 'no label');
    await arrow().find('.arrow-hit').trigger('contextmenu', { clientX: 300, clientY: 200 });
    check('right-click: the pair\'s menu — its statuses, open, delete', await until(() => w.find('.ctx .junction-status').exists()) && w.find('.ctx .open-junction').exists() && /Delete this pair/.test(w.find('.ctx .remove-link').text()));
    await w.findAll('.ctx .junction-status').find((b: any) => b.text() === 'Accepted').trigger('click');
    await untilDb(`select data->>'status' s from records where id = '${pair[0].id}'`, (r) => r[0]?.s === 'Accepted', 4000);
    await arrow().find('.arrow-hit').trigger('pointerdown', { button: 0 });
    check('status changed from the menu; the label follows', await until(() => w.find('.arrow-layer .arrow-label text').text() === 'Accepted'));

    // The pair's pill on the CARD: ✎ opens the editor on that row, ⤢ opens the row itself.
    const cardPill = () => portRow('a.mov').find('.pill.junction');
    check('the card row shows the pair as a pill "Texted Master › Accepted" with a ✎ — and no ⤢: a double-click opens', await until(() => cardPill().exists() && cardPill().find('.pill-text').text() === 'Texted Master › Accepted') && cardPill().find('.pill-edit').exists() && !cardPill().find('.pill-open').exists(), cardPill().exists() ? cardPill().text() : 'no pill');
    check('…in a BLOCK row: the field\'s name on its own line, the pairs under it with a slot for the other end',
      portRow('a.mov').classes('block') && portRow('a.mov').find('.card-list').classes('pairs') && /--pair-slot:\s*\d+px/.test(portRow('a.mov').find('.card-list').attributes('style') ?? ''), portRow('a.mov').html().slice(0, 300));
    await cardPill().find('.pill-edit').trigger('click');
    check('✎ opens the pair editor on the existing row', await until(() => w.find('.junction-anchor .je').exists()) && w.find('.je .act.danger').exists() && !w.find('.je .picker').exists());
    await w.findAll('.je .st').find((b: any) => b.text() === 'Rejected').trigger('click');
    await untilDb(`select data->>'status' s from records where id = '${pair[0].id}'`, (r) => r[0]?.s === 'Rejected', 4000);
    check('…and changes it', await until(() => cardPill().find('.pill-text').text() === 'Texted Master › Rejected'));
    await w.find('.je .act:not(.primary):not(.danger)').trigger('click');
    await until(() => !w.find('.je').exists());

    // Same pair again from the port: lands on the existing row.
    await portRow('a.mov').find('.port-handle').trigger('pointerdown', { button: 0, ...toClient(300, 80) });
    winEv('pointermove', toClient(630, 60));
    check('the pair already exists: Texted Master no longer lights up', await until(() => w.find('.rubber').exists()) && !cardBy('Texted Master').classes('link-over') && cardBy('Trailer').classes('link-ok'));
    winEv('pointerup', toClient(630, 60));
    await sleep(100);
    check('dropping there does nothing', !w.find('.je').exists() && (await pool.query(`select count(*)::int n from records where table_id = '${tJ}'`)).rows[0].n === 1);

    // Delete from the arrow: asks, then the ROW goes.
    await arrow().find('.arrow-hit').trigger('pointerdown', { button: 0 });
    nav.dialogs.cancelNext = true;
    const seen0 = nav.dialogs.seen.length;
    await w.find('.canvas-container').trigger('keydown', { key: 'Delete' });
    check('Delete with the arrow selected ASKS', await until(() => nav.dialogs.seen.length > seen0) && /Delete this Delivery/.test(nav.dialogs.seen.slice(-1)[0]));
    await sleep(250);
    check('Cancel keeps it', (await pool.query(`select count(*)::int n from records where table_id = '${tJ}'`)).rows[0].n === 1);
    await arrow().find('.arrow-hit').trigger('contextmenu', { clientX: 300, clientY: 200 });
    await until(() => w.find('.ctx .remove-link').exists());
    await w.find('.ctx .remove-link').trigger('click');
    check('confirmed: the pair row is deleted and the arrow gone', (await untilDb(`select count(*)::int n from records where table_id = '${tJ}'`, (r) => r[0].n === 0, 4000))[0].n === 0 && await until(() => !arrow().exists()));
    check('both cards stay', cards().length === 3);

    console.log('\nJ6. The comparison engine runs through the junction column');
    const fFileCodec = randomUUID(), fDelCodec = randomUUID();
    const colFiles = cols.find((c: any) => c.table_id === tFiles)!;
    const colFilesRow = (await pool.query(`select id from fields where table_id = $1 and type = 'backlink'`, [tFiles])).rows[0];
    await post([
      { type: 'field.create', id: fFileCodec, tableId: tFiles, name: 'Codec', key: 'codec', fieldType: 'text' },
      { type: 'field.create', id: fDelCodec, tableId: tDeliv, name: 'Codec', key: 'codec', fieldType: 'text' },
      { type: 'record.update', id: a, set: { codec: 'ProRes 422 HQ' }, unset: [] },
      { type: 'record.update', id: texted, set: { codec: 'ProRes 4444' }, unset: [] },
      { type: 'field.update', id: colFilesRow.id, options: { source_field_id: cfg.a, compare: { pairs: [{ from: fFileCodec, to: fDelCodec, rule: 'equals' }] } } },
    ]);
    void colFiles;
    const r4 = randomUUID();
    await post([
      { type: 'record.create', id: r4, tableId: tJ, data: { status: 'Uploaded' } },
      { type: 'link.add', id: randomUUID(), fieldId: cfg.a, fromRecord: r4, toRecord: a },
      { type: 'link.add', id: randomUUID(), fieldId: cfg.b, fromRecord: r4, toRecord: texted },
    ]);
    win.location.hash = `#/all/table/${tFiles}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.findAll('.gridview tr.row').length === 1, 8000);
    const codecCell = () => rowOf('a.mov').findAll('td').find((td: any) => td.text().includes('ProRes 422 HQ'))!;
    check('the file\'s Codec cell gets a ⚠: it differs from the deliverable it is paired with',
      await until(() => !!codecCell() && codecCell().find('.cell-verdict').exists() && !codecCell().find('.cell-verdict').classes('ok'), 8000)
        && /Delivery → Texted Master/.test(codecCell().find('.cell-verdict').attributes('title') ?? ''), codecCell()?.find('.cell-verdict').attributes('title'));
    await post([{ type: 'record.update', id: a, set: { codec: 'ProRes 4444' }, unset: [] }]);
    const codecCell2 = () => rowOf('a.mov').findAll('td').find((td: any) => td.text().includes('ProRes 4444'))!;
    check('fixed, it turns ✓', await until(() => !!codecCell2() && codecCell2().find('.cell-verdict').classes('ok'), 8000));
    await post([{ type: 'record.delete', id: r4 }]);
    check('no pair, no verdict', await until(() => !codecCell2().find('.cell-verdict').exists(), 8000));
    // The API agrees, through the column.
    const api = await (await nodeFetchCompare(colFilesRow.id, a, texted)).json();
    check('/api/compare accepts the junction column and reports the pair', api.same === true && api.results?.length === 1, JSON.stringify(api).slice(0, 200));

    console.log('\nJ7. The pairs as a table: one line in the grid, the nested table in the tray');
    const p1 = randomUUID(), p2 = randomUUID();
    await post([
      { type: 'record.create', id: p1, tableId: tJ, data: { status: 'Uploaded' } },
      { type: 'link.add', id: randomUUID(), fieldId: cfg.a, fromRecord: p1, toRecord: a },
      { type: 'link.add', id: randomUUID(), fieldId: cfg.b, fromRecord: p1, toRecord: texted },
      { type: 'record.create', id: p2, tableId: tJ, data: { status: 'Rejected', notes: 'reel 3 audio drift' } },
      { type: 'link.add', id: randomUUID(), fieldId: cfg.a, fromRecord: p2, toRecord: a },
      { type: 'link.add', id: randomUUID(), fieldId: cfg.b, fromRecord: p2, toRecord: trailer },
    ]);
    const line = () => cellOf('a.mov').find('.pairline');
    check('the grid cell stays ONE line: the first pair, and "+1" for the other', await until(() => line().exists() && line().findAll('.pill.junction').length === 1 && line().find('.more-pairs').exists(), 8000)
      && line().find('.pill-text').text() === 'Texted Master › Uploaded' && line().find('.more-pairs').text() === '+1', line().exists() ? line().html().slice(0, 300) : 'no line');
    check('…with the same slot for the other end in every row, so statuses line up down the column', /--pair-slot:\s*\d+px/.test(line().attributes('style') ?? ''), line().attributes('style'));
    await line().find('.pill.junction').trigger('dblclick');
    check('a double-click on the pair\'s pill opens the record it NAMES (the deliverable) — not the pair row, and not the cell\'s "add a pair" popup',
      await until(() => w.find('.record-panel .rp-title').exists() && w.find('.record-panel .rp-title').text() === 'Texted Master') && !w.find('.je').exists(), w.find('.record-panel').exists() ? w.find('.record-panel .rp-title').text() : 'no tray');
    await w.find('.record-panel .rp-close').trigger('click');

    win.location.hash = `#/all/table/${tFiles}?r=${a}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    const jt = () => w.find('.record-panel .jt');
    const jrow = (i: number) => jt().findAll('.jt-row')[i];
    check('the tray shows the column as a NESTED TABLE: the other end, then the pair\'s own fields',
      await until(() => jt().exists() && jt().findAll('.jt-row').length === 2, 8000) && jt().findAll('th').map((h: any) => h.text()).join('|') === 'Deliverable|Status|Notes|', jt().exists() ? jt().findAll('th').map((h: any) => h.text()).join('|') : 'no table');
    check('each field is drawn as what it is: a pill for the record, a capsule for the status, text for the note',
      jrow(0).find('td.other .pill').text().includes('Texted Master') && !jrow(0).find('td.other .pill').classes('junction') && jrow(0).findAll('td')[1].find('.choice').text() === 'Uploaded'
        && jrow(1).findAll('td')[1].find('.choice').text() === 'Rejected' && jrow(1).findAll('td')[2].find('.value').text() === 'reel 3 audio drift', jt().html().slice(0, 400));
    await jrow(0).findAll('td')[1].trigger('click');
    check('a click on the status edits it IN PLACE — the grid\'s picker, no popup', await until(() => jrow(0).find('td.editing .cp').exists()) && !w.find('.je').exists());
    await jrow(0).find('td.editing .cp-input').setValue('Acc');
    await jrow(0).find('td.editing .cp-input').trigger('keydown', { key: 'Enter' });
    await untilDb(`select data->>'status' s from records where id = '${p1}'`, (r) => r[0]?.s === 'Accepted', 4000);
    check('…and writes the pair row; the capsule follows', await until(() => jrow(0).findAll('td')[1].find('.choice').text() === 'Accepted' && !jt().find('td.editing').exists()));
    await jrow(0).findAll('td')[2].trigger('click');
    await until(() => jrow(0).find('td.editing textarea').exists());
    await jrow(0).find('td.editing textarea').setValue('client approved');
    await jrow(0).find('td.editing textarea').trigger('keydown', { key: 'Enter' });
    check('a note is typed in its cell', (await untilDb(`select data->>'notes' n from records where id = '${p1}'`, (r) => r[0]?.n === 'client approved', 4000))[0]?.n === 'client approved');
    check('Enter moves DOWN the column, to the next pair\'s note', await until(() => jrow(1).find('td.editing textarea').exists()));
    await jrow(1).find('td.editing textarea').trigger('keydown', { key: 'Escape' });
    check('Escape leaves the cell and keeps the tray open', await until(() => !jt().find('td.editing').exists()) && w.find('.record-panel').exists());
    await w.find('.record-panel .jt-add').trigger('click');
    check('the line under the table adds a pair, through the junction popup', await until(() => w.find('.je .picker').exists()));
    await w.find('.je .picker input').trigger('keydown', { key: 'Escape' });
    await until(() => !w.find('.je').exists());
    await jrow(1).find('.act.del').trigger('click');
    check('× at a row\'s end deletes that pair', (await untilDb(`select count(*)::int n from records where id = '${p2}'`, (r) => r[0].n === 0, 4000))[0].n === 0 && await until(() => jt().findAll('.jt-row').length === 1));
    await jrow(0).find('td.other .pill').trigger('dblclick');
    check('a double-click on the pill opens the OTHER record', await until(() => w.find('.record-panel .rp-title').text() === 'Texted Master'), w.find('.record-panel .rp-title').text());
    check('…where the same pair is a row too, seen from its other end', await until(() => jt().exists() && jt().findAll('th')[0].text() === 'File' && jrow(0).find('td.other .pill').text().includes('a.mov')), jt().exists() ? jt().html().slice(0, 200) : 'no table');
    await jrow(0).find('.act.open').trigger('click');
    check('⤢ at the row\'s end opens the pair row itself', await until(() => w.find('.record-panel .rp-table').text() === 'Delivery'), w.find('.record-panel .rp-table').text());
    await sleep(100);
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
