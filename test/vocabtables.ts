/**
 * Vocabulary tables (Oct 17): the lists that used to live in the code as bound
 * selects (contract/vocab.ts) kept as TABLES the owner maintains — Containers,
 * Codecs — one row per canonical name with an Aliases column, linked to from
 * Files and Deliverables alike.
 *
 *   U1  `tables.utility` (sql/018): stored by table.update, read back, folded away
 *       in the tree with the boards and junctions, ticked in Table settings
 *   V1  convert a select into a link: the field ⚙'s "convert to a link…" makes the
 *       table (Name, Aliases, one row per choice and per stored value), the link
 *       field in the select's place, links every record by its value, re-points the
 *       recipe — one Ctrl+Z; the old select stays, renamed, until deleted
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8851));
  const { w, win, pool, until, untilDb, post, nav } = ui;
  const rows = async (sql: string) => (await pool.query(sql)).rows;
  try {
    console.log('\nU1. A table ticked "utility" (sql/018)');
    const tFiles = randomUUID(), tCont = randomUUID();
    const f = { name: randomUUID(), container: randomUUID(), cName: randomUUID(), cAliases: randomUUID() };
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    let r = await post([
      { type: 'table.create', id: tFiles, name: 'Files' }, { type: 'table.create', id: tCont, name: 'Containers' },
      { type: 'field.create', id: f.name, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(f.name, 0),
      { type: 'field.create', id: f.cName, tableId: tCont, name: 'Name', key: 'name', fieldType: 'text' }, pos(f.cName, 0),
      { type: 'field.create', id: f.cAliases, tableId: tCont, name: 'Aliases', key: 'aliases', fieldType: 'long_text' }, pos(f.cAliases, 1),
      { type: 'table.update', id: tCont, utility: true },
    ]);
    check('table.update { utility: true } is accepted', r.status === 200, (await r.text()).slice(0, 200));
    check('…and stored', (await rows(`select utility from tables where id = '${tCont}'`))[0].utility === true && (await rows(`select utility from tables where id = '${tFiles}'`))[0].utility === false);
    const schema = await (await fetch(`${ui.API}/api/schema`)).json();
    check("the schema read carries it", schema.find((t: any) => t.id === tCont)?.utility === true && schema.find((t: any) => t.id === tFiles)?.utility === false, JSON.stringify(schema.map((t: any) => [t.name, t.utility])));
    await nav.section('all');
    await until(() => nav.tableNames().includes('Files') && w.find('.tree .show-utility').exists(), 8000);
    check('in the tree, Files is a data table and Containers is FOLDED away under "show 1 utility table"', nav.tableNames().includes('Files') && !nav.tableNames().includes('Containers') && /show 1 utility table/.test(w.find('.tree .show-utility').text()), nav.tableNames().join() + ' / ' + w.find('.tree .show-utility').text());
    await w.find('.tree .show-utility').trigger('click');
    check('unfolded, it shows with a "utility" tag', await until(() => w.find(`.tree [data-table="${tCont}"] .tag`).exists()) && w.find(`.tree [data-table="${tCont}"] .tag`).text() === 'utility');
    await nav.tableSettings(tCont);
    check('Table settings has the tick, on', await until(() => w.find('.ts .utility-tick input').exists()) && (w.find('.ts .utility-tick input').element as HTMLInputElement).checked);
    await w.find('.ts .utility-tick input').setValue(false);
    await untilDb(`select utility from tables where id = '${tCont}'`, (x) => x[0].utility === false);
    check('unticking it writes utility: false, and the table joins the data tables', await until(() => nav.tableNames().includes('Containers')) && !w.find('.tree .show-utility').exists());
    await w.find('.ts .utility-tick input').setValue(true);
    await untilDb(`select utility from tables where id = '${tCont}'`, (x) => x[0].utility === true);
    check('ticked again: back in the utility group (still unfolded from before, so its row shows there, greyed)', await until(() => w.find(`.tree [data-table="${tCont}"].utility`).exists() && w.find('.tree .show-utility').exists()));
    await w.find('.ts .x').trigger('click');
  } finally {
    await ui.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('SUITE ABORTED', e); process.exit(1); });
