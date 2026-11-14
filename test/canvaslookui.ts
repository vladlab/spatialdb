/**
 * The SHARED LOOK in the app (CANVAS-BRIEF.md Part A) — server, migration, canvas bar.
 * The pure rules are in test/canvaslook.ts.
 *
 *   S1  the server   table.update { canvasLook } stored, read back, cleared with null
 *   S2  migration    sql/023's update ticks ownLook on exactly the canvases that had a look
 *   S3  the app      a change on one Work's canvas shows on another; "use only on this
 *                    canvas" stops that; promote and attach; Ctrl+Z undoes promote whole
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mountApp, sleep } from './uiHarness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8863));
  const { w, win, pool, until, untilDb, post, nav } = ui;
  const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
  try {
    const tWorks = randomUUID(), tFiles = randomUUID(), sec = randomUUID();
    const fWorkName = randomUUID(), fFileName = randomUUID(), fCodec = randomUUID(), fNote = randomUUID();
    const ep101 = randomUUID(), ep102 = randomUUID(), ep103 = randomUUID(), fileA = randomUUID(), fileB = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const place = (canvasId: string, recordId: string) => ({ type: 'placement.add', id: randomUUID(), canvasId, recordId, x: 60, y: 60, w: null, h: null, z: 1 });

    const setup = await post([
      { type: 'table.create', id: tWorks, name: 'Works' }, { type: 'table.create', id: tFiles, name: 'Files' },
      { type: 'field.create', id: fWorkName, tableId: tWorks, name: 'Name', key: 'name', fieldType: 'text' }, pos(fWorkName, 0),
      { type: 'field.create', id: fFileName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(fFileName, 0),
      { type: 'field.create', id: fCodec, tableId: tFiles, name: 'Codec', key: 'codec', fieldType: 'text' }, pos(fCodec, 1),
      { type: 'field.create', id: fNote, tableId: tFiles, name: 'Note', key: 'note', fieldType: 'text' }, pos(fNote, 2),
      { type: 'table.update', id: tWorks, recordCanvases: true },
      { type: 'record.create', id: ep101, tableId: tWorks, data: { name: 'Ep 101' } },
      { type: 'record.create', id: ep102, tableId: tWorks, data: { name: 'Ep 102' } },
      { type: 'record.create', id: ep103, tableId: tWorks, data: { name: 'Ep 103' } },
      { type: 'record.create', id: fileA, tableId: tFiles, data: { name: 'a.mov', codec: 'ProRes' } },
      { type: 'record.create', id: fileB, tableId: tFiles, data: { name: 'b.mov', codec: 'ProRes' } },
      place(ep101, fileA), place(ep102, fileB), place(ep103, fileA),
      { type: 'section.create', id: sec, name: 'Projects', icon: '🎬' },
      { type: 'section.update', id: sec, tableIds: [tWorks, tFiles] },
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 300));

    console.log('\nS1. The server');
    const look = { cardFields: { [tFiles]: [fCodec] } };
    check('table.update { canvasLook } is stored', (await post([{ type: 'table.update', id: tWorks, canvasLook: look }])).status === 200
      && JSON.stringify((await one(`select canvas_look from tables where id = $1`, [tWorks])).canvas_look) === JSON.stringify(look));
    const schema = await (await fetch(`${ui.API}/api/schema`)).json();
    check('the schema read carries it', JSON.stringify(schema.find((t: any) => t.id === tWorks)?.canvas_look) === JSON.stringify(look));
    check('another table.update leaves it alone', (await post([{ type: 'table.update', id: tWorks, name: 'Works' }])).status === 200
      && (await one(`select canvas_look from tables where id = $1`, [tWorks])).canvas_look !== null);
    check('null clears it', (await post([{ type: 'table.update', id: tWorks, canvasLook: null }])).status === 200
      && (await one(`select canvas_look from tables where id = $1`, [tWorks])).canvas_look === null);
    const bad = await post([{ type: 'table.update', id: tWorks, canvasLook: { defaults: [] } }]);
    check('a look with per-canvas keys is refused', bad.status !== 200);

    console.log('\nS2. The migration');
    const configs: Record<string, unknown> = {
      [ep101]: { cardFields: { [tFiles]: [fCodec] } },                       // a look → own
      [ep102]: { cardFields: {}, defaults: [{ tableId: tWorks, recordId: ep101 }] }, // defaults only → shares
      [ep103]: { cardFields: {}, hideEmpty: true },                           // a look → own
    };
    for (const [id, c] of Object.entries(configs)) await pool.query(`update canvases set config = $2 where id = $1`, [id, c]);
    const update = readFileSync(new URL('../sql/023_canvas_look.sql', import.meta.url), 'utf8').split(/^update canvases/m)[1];
    await pool.query(`update canvases${update}`);
    const own = async (id: string) => (await one(`select config from canvases where id = $1`, [id])).config.ownLook === true;
    check('a canvas with card fields set keeps them: ownLook ticked', await own(ep101));
    check('a canvas with only defaults is left to share', !(await own(ep102)));
    check('hide-empty alone counts as a look', await own(ep103));
    // back to a clean start for S3: every canvas shares, the table has no look
    for (const id of [ep101, ep102, ep103]) await pool.query(`update canvases set config = '{}'::jsonb where id = $1`, [id]);

    console.log('\nS3. In the app');
    win.location.hash = `#/s/projects-${sec}/table/${tFiles}`;
    win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => nav.canvasNames().includes('Ep 101'), 8000);
    const chip = () => w.find('.look-chip');
    const hideBtn = () => w.find('.canvas-controls .hide-empty');
    await nav.openCanvas(ep101);
    check('the bar says the cards are shared, and by which table', await until(() => chip().exists() && chip().text() === 'cards: shared · Works', 8000), chip().exists() ? chip().text() : 'no chip');

    await hideBtn().trigger('click');
    check('hide-empty on a sharing canvas is written to the TABLE', (await untilDb(`select canvas_look from tables where id = '${tWorks}'`, (r) => r[0].canvas_look?.hideEmpty === true))[0].canvas_look?.hideEmpty === true);
    check('…and not to the canvas', !(await one(`select config from canvases where id = $1`, [ep101])).config.hideEmpty);

    await nav.openCanvas(ep102);
    check('another Work\'s canvas wears it at once', await until(() => hideBtn().exists() && hideBtn().classes().includes('active'), 8000));

    await chip().trigger('click');
    await w.findAll('.look-pop .look-act').find((b: any) => b.text() === 'Use only on this canvas')!.trigger('click');
    check('"use only on this canvas": the chip says so', await until(() => chip().text() === 'cards: this canvas only'));
    const c102 = (await untilDb(`select config from canvases where id = '${ep102}'`, (r) => r[0]?.config?.ownLook === true))[0].config;
    check('…the shared look was copied in, so nothing on the cards changed', c102.ownLook === true && c102.hideEmpty === true && hideBtn().classes().includes('active'));
    await hideBtn().trigger('click');
    check('now hide-empty changes only this canvas', (await untilDb(`select config from canvases where id = '${ep102}'`, (r) => !r[0].config.hideEmpty)).length === 1
      && (await one(`select canvas_look from tables where id = $1`, [tWorks])).canvas_look?.hideEmpty === true);

    await chip().trigger('click');
    await w.findAll('.look-pop .look-act').find((b: any) => b.text() === 'Make these the shared settings')!.trigger('click');
    await untilDb(`select canvas_look from tables where id = '${tWorks}'`, (r) => r[0].canvas_look === null);
    check('promote: the table takes this canvas\'s look (none: hide-empty off)', (await one(`select canvas_look from tables where id = $1`, [tWorks])).canvas_look === null);
    check('…and the canvas goes back to sharing', await until(() => chip().text() === 'cards: shared · Works') && !(await one(`select config from canvases where id = $1`, [ep102])).config.ownLook);

    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await sleep(300);
    const after = await untilDb(`select (select canvas_look from tables where id = '${tWorks}') look, (select config from canvases where id = '${ep102}') config`,
      (r) => r[0].look?.hideEmpty === true && r[0].config?.ownLook === true);
    check('ONE Ctrl+Z undoes the promote whole: the table look and the canvas\'s own look are both back', after[0].look?.hideEmpty === true && after[0].config.ownLook === true);

    await chip().trigger('click');
    await w.findAll('.look-pop .look-act').find((b: any) => b.text() === 'Use the shared settings')!.trigger('click');
    check('"use the shared settings" (after asking): back to the table\'s look', await until(() => chip().text() === 'cards: shared · Works' && hideBtn().classes().includes('active'))
      && nav.dialogs.seen.some((t) => t.startsWith('Use the shared card settings')));
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
