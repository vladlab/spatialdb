/**
 * Records that HAVE a canvas (sql/022) — "a Work is its canvas".
 *
 *   K1  the server   the tick is stored and read back; a card can be placed on such
 *                    a record; /api/canvases and the scene read know it
 *   K2  the app      Works stays a DATA table; every work is listed with the
 *                    canvases, after the scope; its canvas links new records to it
 *                    without anything being set; a double-click on a work's card
 *                    opens the tray, not the canvas; unticking hides, never deletes
 *
 * The delete-and-undo cascade is in test/undo.ts (section 9), beside the boards'.
 */

import { randomUUID } from 'node:crypto';
import { boardsTableMutations } from './harness.js';
import { mountApp, sleep } from './uiHarness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8862));
  const { w, win, pool, until, untilDb, post, nav } = ui;
  const rows = async (sql: string) => (await pool.query(sql)).rows;
  try {
    const tProj = randomUUID(), tWorks = randomUUID(), tFiles = randomUUID(), tBoards = randomUUID(), sec = randomUUID();
    const fProjName = randomUUID(), fWorkName = randomUUID(), fWorkProj = randomUUID(), fFileName = randomUUID(), fFileWork = randomUUID(), fFileProj = randomUUID();
    const duke = randomUUID(), elvis = randomUUID(), ep101 = randomUUID(), ep102 = randomUUID(), elvisFeature = randomUUID(), boardFree = randomUUID(), fileA = randomUUID();
    const link = (fieldId: string, fromRecord: string, toRecord: string) => ({ type: 'link.add', id: randomUUID(), fieldId, fromRecord, toRecord });
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const place = (canvasId: string, recordId: string, x = 60) => ({ type: 'placement.add', id: randomUUID(), canvasId, recordId, x, y: 60, w: null, h: null, z: 1 });

    console.log('\nK1. The server');
    const setup = await post([
      { type: 'table.create', id: tProj, name: 'Projects' }, { type: 'table.create', id: tWorks, name: 'Works' }, { type: 'table.create', id: tFiles, name: 'Files' },
      { type: 'field.create', id: fProjName, tableId: tProj, name: 'Name', key: 'name', fieldType: 'text' }, pos(fProjName, 0),
      { type: 'field.create', id: fWorkName, tableId: tWorks, name: 'Name', key: 'name', fieldType: 'text' }, pos(fWorkName, 0),
      { type: 'field.create', id: fWorkProj, tableId: tWorks, name: 'Project', key: 'project', fieldType: 'link', options: { target_table_id: tProj, membership: true } }, pos(fWorkProj, 1),
      { type: 'field.create', id: fFileName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(fFileName, 0),
      { type: 'field.create', id: fFileWork, tableId: tFiles, name: 'Work', key: 'work', fieldType: 'link', options: { target_table_id: tWorks } }, pos(fFileWork, 1),
      { type: 'field.create', id: fFileProj, tableId: tFiles, name: 'Project', key: 'project', fieldType: 'link', options: { target_table_id: tProj, membership: true } }, pos(fFileProj, 2),
      ...boardsTableMutations(tBoards),
      { type: 'record.create', id: duke, tableId: tProj, data: { name: 'Duke' } }, { type: 'record.create', id: elvis, tableId: tProj, data: { name: 'Elvis' } },
      { type: 'record.create', id: ep101, tableId: tWorks, data: { name: 'Ep 101' } }, link(fWorkProj, ep101, duke),
      { type: 'record.create', id: ep102, tableId: tWorks, data: { name: 'Ep 102' } }, link(fWorkProj, ep102, duke),
      { type: 'record.create', id: elvisFeature, tableId: tWorks, data: { name: 'Elvis feature' } }, link(fWorkProj, elvisFeature, elvis),
      { type: 'record.create', id: fileA, tableId: tFiles, data: { name: 'a.mov' } },
      { type: 'record.create', id: boardFree, tableId: tBoards, data: { name: 'Machine room' } },
      { type: 'section.create', id: sec, name: 'Projects', icon: '🎬' },
      { type: 'section.update', id: sec, tableIds: [tProj, tWorks, tFiles, tBoards], scopeTableId: tProj },
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 300));

    const early = await post([place(ep101, fileA)]);
    check('before the tick, a Work is an ordinary record: nothing can be placed "on" it', early.status !== 200 && /not a board/.test(await early.text()));
    const onBoards = await post([{ type: 'table.update', id: tBoards, recordCanvases: true }]);
    check('the tick is for ORDINARY tables: a boards table is refused it', onBoards.status !== 200 && /only an ordinary table/.test(await onBoards.text()));
    const tick = await post([{ type: 'table.update', id: tWorks, recordCanvases: true }]);
    check('table.update { recordCanvases: true } is accepted, and stored', tick.status === 200
      && (await rows(`select record_canvases from tables where id = '${tWorks}'`))[0].record_canvases === true && (await rows(`select kind from tables where id = '${tWorks}'`))[0].kind === 'records');
    const schema = await (await fetch(`${ui.API}/api/schema`)).json();
    check('the schema read carries it', schema.find((t: any) => t.id === tWorks)?.record_canvases === true && schema.find((t: any) => t.id === tFiles)?.record_canvases === false);
    const placed = await post([place(ep101, fileA), place(ep101, ep102, 400)]);
    check('now cards can be placed on a Work — its state row made lazily, as a board\'s is', placed.status === 200
      && (await rows(`select count(*)::int n from canvases where id = '${ep101}'`))[0].n === 1 && (await rows(`select count(*)::int n from canvases where id = '${ep102}'`))[0].n === 0, (await placed.text()).slice(0, 200));
    const listed = (await (await fetch(`${ui.API}/api/canvases`)).json()).map((b: any) => b.id);
    check('/api/canvases lists every Work beside the boards — placed-on or not', [ep101, ep102, elvisFeature, boardFree].every((id) => listed.includes(id)) && !listed.includes(fileA), String(listed.length));
    check('and a Work\'s scene reads like any board\'s', (await fetch(`${ui.API}/api/canvases/${ep101}/scene`)).status === 200 && (await fetch(`${ui.API}/api/canvases/${fileA}/scene`)).status === 404);

    console.log('\nK2. In the app');
    win.location.hash = `#/s/projects-${sec}/table/${tFiles}`;
    win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => nav.tableNames().includes('Works'), 8000);
    check('Works is still a DATA table in the tree — not folded away with the boards — and says "canvases"',
      nav.tableNames().includes('Works') && w.findAll(`.tree [data-table="${tWorks}"] .tag`).some((t: any) => t.text() === 'canvases'), nav.tableNames().join());
    await nav.scope('');
    const canv = () => nav.canvasNames().slice().sort().join();
    check('under All, the canvases are EVERY work and the board', await until(() => canv() === 'Elvis feature,Ep 101,Ep 102,Machine room', 8000), canv());
    await nav.scope(duke);
    check('…and after the scope: Duke\'s works (and the board, which belongs to no project table link) — not Elvis\'s',
      await until(() => canv() === 'Ep 101,Ep 102,Machine room'), canv());

    await nav.openCanvas(ep101);
    const bar = () => w.find('.defaults-bar');
    const cardOf = (name: string) => w.findAll('.canvas-world .card').find((c: any) => c.find('.card-label').text() === name);
    check('a Work opens as a canvas, with what was placed on it', await until(() => !!cardOf('a.mov') && !!cardOf('Ep 102'), 8000));
    check('its bar says new records are linked to THIS work — nothing was set, and nothing is saved',
      await until(() => bar().find('.dchip.self').exists()) && /Works\s*Ep 101/.test(bar().find('.dchip.self').text().replace('this canvas', ''))
      && !bar().find('.dchip.self .dchip-x').exists() && bar().find('.defaults-switch input').attributes('disabled') === undefined
      && !((await rows(`select config from canvases where id = '${ep101}'`))[0].config.defaults), bar().text());
    const linksOf = async (recId: string) => (await pool.query(`select f.key, l.to_record from links l join fields f on f.id = l.field_id where l.from_record = $1 order by f.key`, [recId])).rows.map((r: any) => `${r.key}:${r.to_record}`);
    const createOnCanvas = async (tableName: string, x: number) => {
      const before = new Set((await pool.query(`select id from records`)).rows.map((r) => r.id as string));
      await w.find('.canvas-container').trigger('dblclick', { clientX: x, clientY: 420, altKey: true });
      await until(() => w.find('.canvas-container .ctx').exists());
      await w.findAll('.canvas-container .ctx button').find((b: any) => b.text().trim().startsWith(tableName)).trigger('click');
      const made = await untilDb(`select id from records`, (r) => r.some((x2: any) => !before.has(x2.id)));
      await sleep(500);
      return made.find((x2: any) => !before.has(x2.id)).id as string;
    };
    const f1 = await createOnCanvas('Files', 700);
    check('a file made on Ep 101\'s canvas is linked to Ep 101 — and to Duke, by the scope', (await linksOf(f1)).join() === `project:${duke},work:${ep101}`, (await linksOf(f1)).join());
    await bar().find('.defaults-switch input').setValue(false);
    const f2 = await createOnCanvas('Files', 760);
    check('switched off, it is not linked to the work (the scope still applies)', (await linksOf(f2)).join() === `project:${duke}`, (await linksOf(f2)).join());
    await bar().find('.defaults-switch input').setValue(true);

    await cardOf('Ep 102').trigger('dblclick');
    check('double-click on a WORK\'s card opens the tray — the canvas stays where it is (a board\'s card would have opened the board)',
      await until(() => w.find('.record-panel').exists() && w.find('.record-panel .rp-title').text() === 'Ep 102') && nav.currentCanvas() === ep101, nav.currentCanvas());
    check('and the tray offers no "open board": the canvas is opened from the sidebar', !w.find('.record-panel .rp-open-board').exists());
    await w.find('.record-panel .rp-close').trigger('click');

    await nav.tableSettings(tWorks);
    check('Table settings has the tick, on', await until(() => w.find('.ts .canvases-tick input').exists()) && (w.find('.ts .canvases-tick input').element as HTMLInputElement).checked);
    await w.find('.ts .canvases-tick input').setValue(false);
    await untilDb(`select record_canvases from tables where id = '${tWorks}'`, (x) => x[0].record_canvases === false);
    check('unticked: the works leave the canvas list — and what was placed is still in the database', await until(() => canv() === 'Machine room')
      && (await rows(`select count(*)::int n from placements where canvas_id = '${ep101}'`))[0].n >= 2, canv());
    await w.find('.ts .canvases-tick input').setValue(true);
    await untilDb(`select record_canvases from tables where id = '${tWorks}'`, (x) => x[0].record_canvases === true);
    check('ticked again: they are back', await until(() => canv() === 'Ep 101,Ep 102,Machine room'), canv());
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    check('the tick is an undo step like any table setting', (await untilDb(`select record_canvases from tables where id = '${tWorks}'`, (x) => x[0].record_canvases === false))[0].record_canvases === false);
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
