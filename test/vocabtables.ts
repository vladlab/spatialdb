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
import { mountApp } from './uiHarness.js';

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

    console.log('\nV1. Convert a select into a link — the field ⚙\'s "convert to a link…"');
    const tMasters = randomUUID();
    const m = { name: randomUUID(), container: randomUUID(), width: randomUUID(), codec: randomUUID(), path: randomUUID() };
    const sec = randomUUID();
    const recs = [randomUUID(), randomUUID(), randomUUID()];
    r = await post([
      { type: 'table.create', id: tMasters, name: 'Masters' },
      { type: 'field.create', id: m.name, tableId: tMasters, name: 'Name', key: 'name', fieldType: 'text' }, pos(m.name, 0),
      { type: 'field.create', id: m.path, tableId: tMasters, name: 'Path', key: 'path', fieldType: 'file_path' }, pos(m.path, 1),
      { type: 'field.create', id: m.container, tableId: tMasters, name: 'Container', key: 'container', fieldType: 'select', options: { vocabulary: 'container' } }, pos(m.container, 2),
      { type: 'field.create', id: m.width, tableId: tMasters, name: 'Width', key: 'width', fieldType: 'number' }, pos(m.width, 3),
      { type: 'field.create', id: m.codec, tableId: tMasters, name: 'Codec', key: 'codec', fieldType: 'select', options: { vocabulary: 'video_codec' } }, pos(m.codec, 4),
      { type: 'table.update', id: tMasters, fieldSections: [{ id: sec, name: 'Video', fields: [m.container, m.width, m.codec] }] },
      { type: 'table.update', id: tMasters, tools: { file_drop: { steps: [{ analyzer: 'filesystem', map: { path: m.path } }, { analyzer: 'ffprobe', map: { container: m.container, width: m.width } }] } } },
      { type: 'record.create', id: recs[0], tableId: tMasters, data: { name: 'a.mov', container: 'QuickTime' } },
      { type: 'record.create', id: recs[1], tableId: tMasters, data: { name: 'b.mxf', container: 'MXF' } },
      { type: 'record.create', id: recs[2], tableId: tMasters, data: { name: 'c.avi', container: 'AVI' } },
    ]);
    check('a Masters table: a Container select bound to the built-in list, in a "Video" section with Width, and mapped from ffprobe', r.status === 200, (await r.text()).slice(0, 200));
    // A value that is NOT a choice any more (a list that shrank — put there behind the validator's back): it gets a row too, so no link is lost.
    await pool.query(`update records set data = data || '{"container": "AVI (legacy)"}' where id = $1`, [recs[2]]);
    const nChoices = (await import('../src/contract/vocab.js')).VOCABULARIES.container.choices.length;
    const go = async (tableId: string) => { win.location.hash = `#/all/table/${tableId}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange')); await until(() => w.find('.gridview').exists() && w.findAll('.gridview tr.row').length > 0, 8000); };
    const th = (name: string) => w.findAll('.gridview thead th').find((t: any) => t.find('.th-name').exists() && t.find('.th-name').text() === name)!;
    const gridPop = () => w.find('.gridview .popover');
    await go(tMasters);
    await th('Container').find('.th-menu').trigger('click');
    check('a select\'s ⚙ offers "convert to a link…"; a text field\'s does not', await until(() => gridPop().find('.convert-link').exists()) && gridPop().find('.convert-link').text() === 'convert to a link…');
    nav.dialogs.text = 'Containers';
    await gridPop().find('.convert-link').trigger('click');
    const newT = await untilDb(`select id, name, utility from tables where name = 'Containers' and id <> '${tCont}'`, (x) => x.length === 1, 8000);
    check('the dialog asked for the table\'s name (the field\'s, suggested) — and a Containers table exists, ticked utility', newT.length === 1 && newT[0].utility === true, JSON.stringify(newT));
    const nf = await untilDb(`select name, key, type, position from fields where table_id = '${newT[0]?.id}' order by position`, (x) => x.length >= 3);
    check('…with Name, Aliases (key "aliases", long text), and the backlink face "Masters"', nf.map((f) => `${f.name}:${f.key}:${f.type}`).join() === 'Name:name:text,Aliases:aliases:long_text,Masters:masters:backlink', JSON.stringify(nf));
    const nrows = await rows(`select data->>'name' n from records where table_id = '${newT[0].id}' order by created_at`);
    check('one row per choice of the built-in list, in its order, then the stored value that was not a choice', nrows.length === nChoices + 1 && nrows[0].n === 'QuickTime' && nrows[1].n === 'MP4' && nrows[nChoices].n === 'AVI (legacy)', JSON.stringify(nrows.map((x) => x.n)));
    const mf = await untilDb(`select id, name, key, type, options, position from fields where table_id = '${tMasters}' order by position`, (x) => x.some((f) => f.type === 'link'));
    const link = mf.find((f) => f.type === 'link')!;
    check('on Masters, a SINGLE link "Container" (key container_2) to the new table stands right after the select, which is now "Container (old select)"', link.name === 'Container' && link.key === 'container_2' && link.options.target_table_id === newT[0].id && link.options.single === true
      && mf.map((f) => f.name).join() === 'Name,Path,Container (old select),Container,Width,Codec', mf.map((f) => f.name).join());
    const secs = (await rows(`select field_sections from tables where id = '${tMasters}'`))[0].field_sections;
    check('…and in the same section, the "Video" one, after it', secs[0].fields.join() === [m.container, link.id, m.width, m.codec].join(), JSON.stringify(secs));
    const ml = await rows(`select l.from_record, r.data->>'name' n from links l join records r on r.id = l.to_record where l.field_id = '${link.id}' order by n`);
    check('every record is linked to the row of its value — the legacy one included', ml.length === 3 && ml.map((x) => x.n).join() === 'AVI (legacy),MXF,QuickTime' && ml.find((x) => x.n === 'QuickTime')?.from_record === recs[0], JSON.stringify(ml));
    const tools = (await rows(`select tools from tables where id = '${tMasters}'`))[0].tools;
    check('the recipe\'s Container output writes the LINK now; Width is untouched', tools.file_drop.steps[1].map.container === link.id && tools.file_drop.steps[1].map.width === m.width, JSON.stringify(tools));
    check('the old select still holds its values (nothing was rewritten)', (await rows(`select data->>'container' c from records where id = '${recs[2]}'`))[0].c === 'AVI (legacy)');
    check('the grid shows the link column with pills, beside the old select', await until(() => th('Container') !== undefined && w.findAll('.gridview tr.row')[0].text().includes('QuickTime')));
    check('a notice said what happened', await until(() => /is a link to Containers now \(\d+ rows\)/.test(w.findAll('.desk-notice').map((n: any) => n.text()).join(' '))), w.findAll('.desk-notice').map((n: any) => n.text()).join(' | '));

    console.log('\nV1b. One Ctrl+Z');
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    const gone = await untilDb(`select id from tables where id = '${newT[0].id}'`, (x) => x.length === 0, 8000);
    check('Ctrl+Z ONCE: the table is gone…', gone.length === 0);
    const undone = { field: (await rows(`select id from fields where id = '${link.id}'`)).length, name: (await rows(`select name from fields where id = '${m.container}'`))[0].name,
      tools: (await rows(`select tools from tables where id = '${tMasters}'`))[0].tools.file_drop.steps[1].map.container, secs: (await rows(`select field_sections from tables where id = '${tMasters}'`))[0].field_sections[0].fields.join() };
    check('…the link field and the links with it, the select has its name back, the recipe points at the select again', undone.field === 0 && undone.name === 'Container' && undone.tools === m.container && undone.secs === [m.container, m.width, m.codec].join(), JSON.stringify(undone));
  } finally {
    await ui.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('SUITE ABORTED', e); process.exit(1); });
