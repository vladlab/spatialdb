/**
 * "Created" and "Created by" (contract/systemFields.ts) are there on EVERY path a
 * record reaches the client by — the owner found them blank "anywhere" (Oct 17),
 * because he lives on canvases and a scene's records arrived without them,
 * overwriting what the table page had brought.
 *
 *   F1  the server: a scene, the boards list, the unplaced list and a search hit
 *       carry created_at + created_by_name, as a table page does
 *   F2  the UI: open the grid (values), then the canvas — the grid still has them;
 *       open the canvas FIRST — the card's record has them without the grid
 *   F3  a peer's record.create arrives with the truth on it
 */
import { randomUUID } from 'node:crypto';
import { mountApp } from './uiHarness.js';
import { boardsTableMutations } from './harness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8848));
  const { w, win, pool, until, post, API } = ui;
  try {
    const tF = randomUUID(), fN = randomUUID(), rec = randomUUID(), rec2 = randomUUID(), tB = randomUUID(), board = randomUUID();
    const setup = await post([{ type: 'table.create', id: tF, name: 'Files' }, ...boardsTableMutations(tB), { type: 'field.create', id: fN, tableId: tF, name: 'Name', key: 'name', fieldType: 'text' },
      { type: 'record.create', id: rec, tableId: tF, data: { name: 'a.mov' } }, { type: 'record.create', id: rec2, tableId: tF, data: { name: 'b.mov' } }, { type: 'record.create', id: board, tableId: tB, data: { name: 'Board' } },
      { type: 'placement.add', id: randomUUID(), canvasId: board, recordId: rec, x: 10, y: 10, w: null, h: null, z: 1 }]);
    check('fixture', setup.status === 200);
    const j = async (path: string) => (await fetch(`${API}${path}`)).json() as Promise<any>;
    // Whoever the harness signs in as — its name is read, not assumed (it has been renamed before).
    const me = (await pool.query(`select u.name from records r join users u on u.id = r.created_by where r.id = $1`, [rec])).rows[0].name as string;
    const has = (r: any) => !!r && typeof r.created_at === 'string' && r.created_by_name === me;

    console.log('\nF1. Every read carries the system fields');
    const scene = await j(`/api/canvases/${board}/scene`);
    check('a SCENE\'s records — and the board\'s own record', has(scene.records.find((r: any) => r.id === rec)) && has(scene.records.find((r: any) => r.id === board)), JSON.stringify(scene.records).slice(0, 300));
    const boards = await j('/api/canvases');
    check('the boards list', has(boards.find((b: any) => b.id === board)), JSON.stringify(boards).slice(0, 200));
    const unplaced = await j(`/api/canvases/${board}/unplaced?table=${tF}`);
    check('the unplaced list', has((unplaced.records ?? unplaced).find?.((r: any) => r.id === rec2)), JSON.stringify(unplaced).slice(0, 200));
    const hits = await j(`/api/search?q=b.mov&tables=${tF}&limit=5`);
    check('a search hit (what the palette adopts)', has(hits.results?.[0]?.record), JSON.stringify(hits).slice(0, 200));

    console.log('\nF2. The UI: the canvas no longer wipes them');
    const go = async (hash: string, ok: () => boolean) => { win.location.hash = hash; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange')); return until(ok, 8000); };
    const ths = () => w.findAll('.gridview thead .th-name').map((x: any) => x.text());
    const rowOf = (n: string) => w.findAll('.gridview tr.row').find((r: any) => r.text().includes(n));
    const cellOf = (n: string, col: string) => rowOf(n)?.findAll('td')[ths().indexOf(col) + 1]?.text() ?? '';
    const cardOf = (n: string) => w.findAll('.canvas-world .card').find((x: any) => x.find('.card-label').text() === n);
    await go(`#/all/table/${tF}`, () => !!rowOf('a.mov') && ths().includes('Created by'));
    check('the grid shows Created and Created by', /\d/.test(cellOf('a.mov', 'Created')) && cellOf('a.mov', 'Created by') === me, `${cellOf('a.mov', 'Created')} / ${cellOf('a.mov', 'Created by')}`);
    await go(`#/all/canvas/${board}`, () => !!cardOf('a.mov'));
    await go(`#/all/table/${tF}`, () => !!rowOf('a.mov') && ths().includes('Created by'));
    check('…and STILL does after a visit to a canvas the record is on (the scene used to overwrite it)', /\d/.test(cellOf('a.mov', 'Created')) && cellOf('a.mov', 'Created by') === me, `${cellOf('a.mov', 'Created')} / ${cellOf('a.mov', 'Created by')}`);
    await go(`#/all/table/${tB}`, () => !!rowOf('Board') && ths().includes('Created by'));
    check('the board\'s own row has them too', /\d/.test(cellOf('Board', 'Created')) && cellOf('Board', 'Created by') === me, `${cellOf('Board', 'Created')} / ${cellOf('Board', 'Created by')}`);
    // Canvas FIRST, then the tray — the record came from the scene alone.
    await go(`#/all/canvas/${board}`, () => !!cardOf('a.mov'));
    await cardOf('a.mov')!.trigger('dblclick');
    await until(() => w.find('.record-panel').exists());
    const pField = (label: string) => w.findAll('.record-panel .rp-field').find((f: any) => f.find('.rp-name').text().replace(/[★⚠✓]/g, '').trim() === label);
    check('the tray from the canvas shows them', /\d/.test(pField('Created')?.find('.rp-value').text() ?? '') && pField('Created by')?.find('.rp-value').text() === me, `${pField('Created')?.text()} / ${pField('Created by')?.text()}`);

    console.log('\nF3. A peer\'s record.create carries the truth');
    const peer = randomUUID();
    await post([{ type: 'record.create', id: peer, tableId: tF, data: { name: 'peer.mov', _created_by: 'Mallory', _created_at: '1999-01-01T00:00:00Z' } }]);
    await go(`#/all/table/${tF}`, () => !!rowOf('peer.mov') && ths().includes('Created by'));
    check('a record another client made shows who really made it, and when — not what that client claimed', cellOf('peer.mov', 'Created by') === me && !/1999/.test(cellOf('peer.mov', 'Created')) && /\d/.test(cellOf('peer.mov', 'Created')), `${cellOf('peer.mov', 'Created')} / ${cellOf('peer.mov', 'Created by')}`);
    const logged = (await pool.query(`select payload from mutations where id in (select id from mutations where payload->>'id' = $1 and type = 'record.create')`, [peer])).rows[0];
    check('…because the logged mutation carries them, as the server knows them', logged?.payload?.data?._created_by === me && !/1999/.test(String(logged?.payload?.data?._created_at)), JSON.stringify(logged?.payload));
    check('…and nothing reserved was stored in the row', !('_created_at' in (await pool.query(`select data from records where id = $1`, [peer])).rows[0].data));
  } finally {
    await ui.close();
  }
}

main().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); console.log(`\nSUITE ABORTED — an exception ended it early; the tally above is incomplete`); process.exit(1); });
