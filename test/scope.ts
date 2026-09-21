/**
 * Scope — "I am working on Duke".
 *
 *   C1  contract/scope.ts   pure: the membership rule
 *   C2  the server          the membership flag; search ranks by scope, drops archived
 *   C3  the app             breadcrumb, grid, auto-link, pickers, palette, URLs
 *
 * The fixture is built to hit every rule at once: two live projects and an
 * ARCHIVED one; a file in each, one SHARED by two, one in NONE; a table with no
 * membership link at all; and a table of boards, which is scoped like any other.
 */

import { randomUUID } from 'node:crypto';
import { ALL, formatScope, inScope, membershipError, membershipFieldOf, parseScope } from '../src/contract/scope.js';
import { boardsTableMutations } from './harness.js';
import { mountApp, sleep } from './uiHarness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

function pure() {
  console.log('\nC1. The membership rule (contract/scope.ts)');
  const duke = 'd', elvis = 'e', old = 'o';
  const arch = new Set([old]);
  const rec = (id: string) => ({ kind: 'record' as const, id });
  check('in a project: records that belong to it — including ones shared with another',
    inScope(rec(duke), [duke], arch, false) && inScope(rec(duke), [elvis, duke], arch, false) && !inScope(rec(duke), [elvis], arch, false) && !inScope(rec(duke), [], arch, false));
  check('Unassigned: exactly the records that belong to nothing', inScope({ kind: 'unassigned' }, [], arch, false) && !inScope({ kind: 'unassigned' }, [duke], arch, false));
  check('All: everything live, and everything unassigned', inScope(ALL, [duke], arch, false) && inScope(ALL, [], arch, false));
  check('All HIDES a record whose every project is archived…', !inScope(ALL, [old], arch, false));
  check('…but not one that is also in a live project', inScope(ALL, [old, duke], arch, false));
  check('…and shows it again when archived projects are being shown', inScope(ALL, [old], arch, true));
  check('an archived project can still be entered directly', inScope(rec(old), [old], arch, false));

  const F = (id: string, table_id: string, type: string, options: Record<string, unknown>) => ({ id, table_id, type, options });
  const fields = [F('a', 'files', 'link', { target_table_id: 'projects' }), F('b', 'files', 'link', { target_table_id: 'projects', membership: true }),
    F('c', 'files', 'link', { target_table_id: 'clients', membership: true }), F('d', 'specs', 'text', { membership: true })];
  check('only a FLAGGED link to the scope table counts — not any link to it',
    membershipFieldOf(fields, 'files', 'projects')?.id === 'b' && membershipFieldOf(fields, 'files', 'clients')?.id === 'c');
  check('a table with no flagged link is not scoped', membershipFieldOf(fields, 'specs', 'projects') === undefined);
  check('the flag is only meaningful on a link field', membershipError('link', { membership: true }) === null
    && /only a link/.test(membershipError('text', { membership: true }) ?? '') && /true or false/.test(membershipError('link', { membership: 'yes' }) ?? ''));
  const id = randomUUID();
  check('a scope round-trips through a URL', formatScope(parseScope(id)) === id && formatScope(parseScope('none')) === 'none'
    && parseScope('').kind === 'all' && parseScope('garbage').kind === 'all');
}

async function main() {
  pure();
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8808));
  const { w, win, pool, until, untilDb, post, nav } = ui;
  try {
    const tProj = randomUUID(), tFiles = randomUUID(), tSpecs = randomUUID(), tBoards = randomUUID(), sec = randomUUID();
    const fProjName = randomUUID(), fArch = randomUUID(), fFileName = randomUUID(), fMember = randomUUID(), fOrig = randomUUID(),
      fSpecName = randomUUID(), fExample = randomUUID(), fBoardProj = randomUUID();
    const duke = randomUUID(), elvis = randomUUID(), old = randomUUID();
    const file: Record<string, string> = Object.fromEntries(['duke_a', 'duke_b', 'elvis_a', 'shared', 'orphan', 'old_a'].map((n) => [n, randomUUID()]));
    const spec1 = randomUUID(), boardDuke = randomUUID(), boardElvis = randomUUID();
    const link = (fieldId: string, fromRecord: string, toRecord: string) => ({ type: 'link.add', id: randomUUID(), fieldId, fromRecord, toRecord });
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });

    console.log('\nC2. The server');
    const setup = await post([
      { type: 'table.create', id: tProj, name: 'Projects' }, { type: 'table.create', id: tFiles, name: 'Files' }, { type: 'table.create', id: tSpecs, name: 'Specs' },
      { type: 'field.create', id: fProjName, tableId: tProj, name: 'Name', key: 'name', fieldType: 'text' }, pos(fProjName, 0),
      { type: 'field.create', id: fArch, tableId: tProj, name: 'Archived', key: 'archived', fieldType: 'checkbox' }, pos(fArch, 1),
      { type: 'field.create', id: fFileName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(fFileName, 0),
      { type: 'field.create', id: fMember, tableId: tFiles, name: 'Project', key: 'project', fieldType: 'link', options: { target_table_id: tProj, membership: true } }, pos(fMember, 1),
      { type: 'field.create', id: fOrig, tableId: tFiles, name: 'Originally for', key: 'originally_for', fieldType: 'link', options: { target_table_id: tProj } }, pos(fOrig, 2),
      { type: 'field.create', id: fSpecName, tableId: tSpecs, name: 'Name', key: 'name', fieldType: 'text' }, pos(fSpecName, 0),
      { type: 'field.create', id: fExample, tableId: tSpecs, name: 'Example file', key: 'example', fieldType: 'link', options: { target_table_id: tFiles } }, pos(fExample, 1),
      ...boardsTableMutations(tBoards),
      { type: 'field.create', id: fBoardProj, tableId: tBoards, name: 'Project', key: 'project', fieldType: 'link', options: { target_table_id: tProj, membership: true } }, pos(fBoardProj, 5),
      { type: 'record.create', id: duke, tableId: tProj, data: { name: 'Duke' } },
      { type: 'record.create', id: elvis, tableId: tProj, data: { name: 'Elvis' } },
      { type: 'record.create', id: old, tableId: tProj, data: { name: 'Old show', archived: true } },
      ...Object.entries(file).map(([name, id]) => ({ type: 'record.create', id, tableId: tFiles, data: { name } })),
      link(fMember, file.duke_a, duke), link(fMember, file.duke_b, duke), link(fMember, file.elvis_a, elvis),
      link(fMember, file.shared, duke), link(fMember, file.shared, elvis), link(fMember, file.old_a, old),
      // A NON-membership link to Duke: it must not make elvis_a a Duke file.
      link(fOrig, file.elvis_a, duke),
      { type: 'record.create', id: spec1, tableId: tSpecs, data: { name: 'Netflix IMF' } },
      { type: 'record.create', id: boardDuke, tableId: tBoards, data: { name: 'Duke flow' } }, link(fBoardProj, boardDuke, duke),
      { type: 'record.create', id: boardElvis, tableId: tBoards, data: { name: 'Elvis flow' } }, link(fBoardProj, boardElvis, elvis),
      { type: 'section.create', id: sec, name: 'Projects', icon: '🎬' },
      { type: 'section.update', id: sec, tableIds: [tProj, tFiles, tSpecs, tBoards], scopeTableId: tProj, archivedFieldId: fArch },
    ]);
    check('fixture: accepted', setup.status === 200, (await setup.text()).slice(0, 300));

    const second = await post([{ type: 'field.create', id: randomUUID(), tableId: tFiles, name: 'Also project', key: 'also_project', fieldType: 'link', options: { target_table_id: tProj, membership: true } }]);
    check('a SECOND membership link from one table to the same target is refused — new records need one answer', second.status === 400 && /ONE field/.test(await second.text()));
    const onText = await post([{ type: 'field.create', id: randomUUID(), tableId: tFiles, name: 'Bad', key: 'bad_member', fieldType: 'text', options: { membership: true } }]);
    check('the flag on a non-link field is refused', onText.status === 400);
    const viaUpdate = await post([{ type: 'field.update', id: fOrig, options: { target_table_id: tProj, membership: true } }]);
    check('…and cannot be slipped in by an UPDATE either', viaUpdate.status === 400, `${viaUpdate.status}`);

    const search = async (q: string, params: string) => (await (await fetch(`${ui.API}/api/search?q=${q}&tables=${tFiles}${params}`)).json()) as { results: Array<{ label: string; inScope?: boolean }> };
    const base = `&scopeTable=${tProj}&archived=${old}`;
    const inDuke = await search('_a', `${base}&scope=${duke}`);
    check('search in a scope RANKS that project first, flags it — and still returns the others',
      inDuke.results[0].label === 'duke_a' && inDuke.results[0].inScope === true && inDuke.results.some((r) => r.label === 'elvis_a' && r.inScope === false),
      JSON.stringify(inDuke.results.map((r) => [r.label, r.inScope])));
    check('a record whose only project is ARCHIVED is left out of search', !inDuke.results.some((r) => r.label === 'old_a'));
    check('…and is back when archived projects are being shown', (await search('_a', `${base}&scope=${duke}&showArchived=1`)).results.some((r) => r.label === 'old_a'));
    const plain = await search('_a', '');
    check('without a scope table, search is exactly as before — nothing flagged, nothing left out',
      plain.results.length === 3 && plain.results.some((r) => r.label === 'old_a') && plain.results.every((r) => r.inScope === undefined), JSON.stringify(plain.results));

    console.log('\nC3. In the app');
    win.location.hash = `#/s/projects-${sec}/table/${tFiles}`;
    win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    // The SCOPE list is the tree's second level (it was a dropdown in the header).
    const crumbOptions = () => nav.scopeNames();
    const showArchived = () => w.find('.tree .show-archived');
    const names = () => w.findAll('.gridview tr.row').map((r: any) => r.findAll('td')[1].text()).sort();
    check('a scoped section grows a second level in the tree', await until(() => crumbOptions().includes('Duke'), 8000), crumbOptions().join());
    const tagged = () => w.findAll('.tree .table-row').filter((r: any) => r.find('.tag.scoped').exists()).map((r: any) => r.find('.name').text()).sort();
    check('the tree marks which tables are SCOPED — Files and the boards table, not Specs or Projects itself',
      await until(() => tagged().length === 2) && tagged().join() === [w.findAll('.tree .table-row').map((r: any) => r.find('.name').text()).find((n: string) => n.startsWith('Boards')), 'Files'].sort().join(), tagged().join());
    check('listing live projects, Unassigned, and an offer to show the archived one — which is NOT listed',
      crumbOptions().includes('Elvis') && crumbOptions().includes('Unassigned') && !crumbOptions().some((t: string) => t.startsWith('Old show')) && /show 1 archived/.test(showArchived().text()), crumbOptions().join(' | '));
    check('under All: every file EXCEPT the one whose only project is archived',
      await until(() => names().join() === 'duke_a,duke_b,elvis_a,orphan,shared'), names().join());

    await nav.scope(duke);
    check('narrowed to Duke: its files and the shared one — not the file that merely LINKS to Duke some other way',
      await until(() => names().join() === 'duke_a,duke_b,shared'), names().join());
    check('the grid says why it looks like this', /in Duke/.test(w.find('.gridview .scope-note').text()));
    check('the breadcrumb names the scope too', /Duke/.test(w.find('.scope-crumb').text()) && w.find('.scope-crumb').classes('narrowed'), w.find('.crumbs').text());
    check('the address carries the scope, so it can be sent to someone', win.location.hash.includes(`sc=${duke}`), win.location.hash);
    check('the count is of the SCOPE', await until(() => /^\s*3 records/.test(w.find('.gridview .count').text()), 8000), w.find('.gridview .count').text());

    await nav.scope('none');
    check('Unassigned: the file that belongs to nothing — never invisible', await until(() => names().join() === 'orphan'), names().join());

    await nav.scope(duke);
    await nav.openTable(tSpecs);
    check('a table with NO membership link is shown whole, and SAYS it is not scoped',
      await until(() => names().join() === 'Netflix IMF') && /not scoped/.test(w.find('.gridview .scope-note').text()) && w.find('.gridview .scope-note').classes('unscoped'));
    await nav.openTable(tProj);
    check('the scope table itself is never filtered by its own scope', await until(() => names().length === 3), names().join());

    console.log('\nC3b. Making things inside a scope');
    await nav.openTable(tFiles);
    await until(() => names().length === 3);
    const before = Number((await pool.query(`select count(*)::int n from records where table_id = $1`, [tFiles])).rows[0].n);
    await w.find('.gridview .foot button').trigger('click');
    const made = await untilDb(`select r.id, (select count(*)::int from links l where l.from_record = r.id and l.field_id = '${fMember}' and l.to_record = '${duke}') n
                                  from records r where r.table_id = '${tFiles}' and r.data = '{}'::jsonb`, (r) => r.length === 1 && r[0].n === 1);
    check('a record added while in Duke is made a MEMBER of Duke, through the membership field', made[0]?.n === 1, JSON.stringify(made));
    check('and stays visible in the scoped grid', w.findAll('.gridview tr.row').length === 4);
    if (w.find('.gridview td.editing input').exists()) await w.find('.gridview td.editing input').trigger('keydown', { key: 'Escape' });
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    const gone = await untilDb(`select count(*)::int n from records where table_id = '${tFiles}'`, (r) => r[0].n === before);
    check('record + membership link are ONE Ctrl+Z', gone[0].n === before
      && (await pool.query(`select count(*)::int n from links where field_id = $1 and to_record = $2`, [fMember, duke])).rows[0].n === 3);

    await nav.tab('canvas');
    const boards = () => nav.canvasNames();
    check('boards are records: the canvas picker is scoped too — Duke\'s board, not Elvis\'s', await until(() => boards().some((b: string) => b.startsWith('Duke flow')) && !boards().some((b: string) => b.startsWith('Elvis flow'))), boards().join());
    await nav.newCanvas('Duke conform');
    const newBoard = await untilDb(`select (select count(*)::int from links l where l.from_record = r.id and l.to_record = '${duke}') n from records r where r.data->>'name' = 'Duke conform'`, (r) => r[0]?.n === 1);
    check('a canvas made while in Duke belongs to Duke — no canvas-specific mechanism involved', newBoard[0]?.n === 1);

    console.log('\nC3b2. Canvas defaults: what a record made HERE starts out linked to');
    // Replaced "a board inherits from its record's membership links" — which needed a
    // link field on the boards table, ticked as membership, filled in on the board. Now
    // it is set ON the canvas, by pointing, and shown in a bar at the top.
    const tWorks = randomUUID(), fWorkName = randomUUID(), fFileWork = randomUUID(), ep101 = randomUUID(), ep102 = randomUUID();
    const worksSetup = await post([
      { type: 'table.create', id: tWorks, name: 'Works' },
      { type: 'field.create', id: fWorkName, tableId: tWorks, name: 'Name', key: 'name', fieldType: 'text' },
      { type: 'field.create', id: fFileWork, tableId: tFiles, name: 'Work', key: 'work', fieldType: 'link', options: { target_table_id: tWorks } },   // NOT ticked membership: one link needs no flag
      { type: 'record.create', id: ep101, tableId: tWorks, data: { name: 'Ep 101' } },
      { type: 'record.create', id: ep102, tableId: tWorks, data: { name: 'Ep 102' } },
      { type: 'placement.add', id: randomUUID(), canvasId: boardDuke, recordId: ep101, x: 60, y: 60, w: null, h: null, z: 1 },
      { type: 'section.update', id: sec, tableIds: [tProj, tFiles, tSpecs, tBoards, tWorks] },
    ]);
    check('fixture accepted', worksSetup.status === 200, (await worksSetup.text()).slice(0, 200));

    await nav.scope('');                                   // scope: ALL — so nothing below can be the scope's doing
    await nav.openCanvas(boardDuke);
    const bar = () => w.find('.defaults-bar');
    // "<table> <record>", read from the chip's two parts (the DOM text has no space between them)
    const chips = () => bar().findAll('.dchip:not(.scope)').map((c: any) => `${c.find('.dchip-table').text()} ${c.text().replace(c.find('.dchip-table').text(), '').replace('×', '').trim()}`);
    const cardOf = (name: string) => w.findAll('.canvas-world .card').find((c: any) => c.find('.card-label').text() === name);
    const configOf = async () => (await pool.query(`select config from canvases where id = $1`, [boardDuke])).rows[0]?.config ?? {};
    const linksOf = async (recId: string) => (await pool.query(`select f.key, l.to_record from links l join fields f on f.id = l.field_id where l.from_record = $1 order by f.key`, [recId])).rows.map((r: any) => `${r.key}:${r.to_record}`);
    const createOnCanvas = async (tableName: string, x: number) => {
      const before = new Set((await pool.query(`select id from records`)).rows.map((r) => r.id as string));
      await w.find('.canvas-container').trigger('dblclick', { clientX: x, clientY: 420, altKey: true });     // Alt: always ask which table
      await until(() => w.find('.canvas-container .ctx').exists());
      await w.findAll('.canvas-container .ctx button').find((b: any) => b.text().trim().startsWith(tableName)).trigger('click');
      const rows = await untilDb(`select id from records`, (r) => r.some((x2: any) => !before.has(x2.id)));
      await sleep(500);                                                                                     // let its links land too
      return rows.find((x2: any) => !before.has(x2.id)).id as string;
    };

    check('the canvas says what new records will be linked to — here, nothing yet', await until(() => bar().exists() && !!cardOf('Ep 101'), 8000)
      && /nothing/.test(bar().text()) && bar().find('.defaults-switch input').attributes('disabled') !== undefined, bar().text());
    await cardOf('Ep 101').trigger('contextmenu', { clientX: 80, clientY: 80 });
    check('right-click a card: "Link new records here to this"', w.find('.canvas-container .ctx .set-default').exists());
    await w.find('.canvas-container .ctx .set-default').trigger('click');
    const cfg1 = await untilDb(`select config from canvases where id = '${boardDuke}'`, (r) => r[0]?.config?.defaults?.length === 1);
    check('it is saved WITH THE CANVAS (its settings, not a new field on the boards table) — for everyone',
      cfg1[0].config.defaults[0].recordId === ep101 && cfg1[0].config.defaults[0].tableId === tWorks && (await pool.query(`select count(*)::int n from fields where table_id = $1`, [tBoards])).rows[0].n === 2);
    check('and the bar shows it', await until(() => chips().join() === 'Works Ep 101'), chips().join());

    const f1 = await createOnCanvas('Files', 400);
    check('a file made here is linked to Ep 101 — through Files\' only link to Works; no "membership" tick was needed', (await linksOf(f1)).join() === `work:${ep101}`, (await linksOf(f1)).join());
    check('…and NOT to the board\'s project: the old "inherit from the board\'s record" behaviour is gone, so there is ONE mechanism', !(await linksOf(f1)).some((l: string) => l.startsWith('project:')));
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    check('record, link and card are ONE Ctrl+Z', (await untilDb(`select 1 from records where id = '${f1}'`, (r) => r.length === 0)).length === 0);

    const s1 = await createOnCanvas('Specs', 440);
    check('a table with no link to Works is created untouched, without complaint', (await linksOf(s1)).length === 0 && !w.find('.errors').exists());

    await bar().find('.defaults-switch input').setValue(false);
    const f2 = await createOnCanvas('Files', 480);
    check('SWITCHED OFF: a new file is not linked, and the chip shows as inactive', (await linksOf(f2)).length === 0 && bar().classes('off'));
    check('…the switch is yours (this browser): the saved list is untouched', (await configOf()).defaults.length === 1);
    await bar().find('.defaults-switch input').setValue(true);

    // "+ add": pick a record without knowing anything about the schema.
    await bar().find('.defaults-add').trigger('click');
    check('"+ add" offers only tables that something LINKS TO', await until(() => bar().find('.defaults-table').exists())
      && bar().findAll('.defaults-table option').map((o: any) => o.text()).filter((t: string) => !t.startsWith('link new')).sort().join() === 'Files,Projects,Works', bar().find('.defaults-table').text());
    await bar().find('.defaults-table').setValue(tProj);
    await until(() => bar().findAll('.picker .list li .name').some((x: any) => x.text() === 'Duke'), 8000);
    await bar().findAll('.picker .list li').find((li: any) => li.find('.name').text() === 'Duke').trigger('mousedown');
    await untilDb(`select config from canvases where id = '${boardDuke}'`, (r) => r[0].config.defaults?.length === 2);
    check('…and adds the chosen record', await until(() => chips().join() === 'Works Ep 101,Projects Duke'), chips().join());
    await bar().find('.defaults-add').trigger('click');
    const f3 = await createOnCanvas('Files', 520);
    check('Files has TWO links to Projects — the one ticked "membership" is used; the other is left alone', (await linksOf(f3)).join() === `project:${duke},work:${ep101}`, (await linksOf(f3)).join());

    // Ambiguity is reported, never guessed.
    const fAltWork = randomUUID();
    await post([{ type: 'field.create', id: fAltWork, tableId: tFiles, name: 'Alt work', key: 'alt_work', fieldType: 'link', options: { target_table_id: tWorks } }]);
    check('a second, unflagged link to Works makes it AMBIGUOUS — the bar says so, in words an admin can act on', await until(() => /Files has 2 links to Works/.test(bar().find('.defaults-warn').text())), bar().text());
    const f4 = await createOnCanvas('Files', 560);
    check('…and the file is linked to the project but NOT to a guessed Work field', (await linksOf(f4)).join() === `project:${duke}`, (await linksOf(f4)).join());
    await post([{ type: 'field.update', id: fFileWork, options: { target_table_id: tWorks, membership: true } }]);
    check('tick "membership" on one of them and the warning goes', await until(() => !bar().find('.defaults-warn').exists()));
    const f5 = await createOnCanvas('Files', 600);
    check('…and that field is used', (await linksOf(f5)).join() === `project:${duke},work:${ep101}`, (await linksOf(f5)).join());

    // The trap this build had to avoid: canvas.update REPLACES the config.
    // (a Files card: Works has only its name field, so its cards have no fields to choose)
    const aFileCard = w.findAll('.canvas-world .card').find((c: any) => /^File/.test(c.find('.card-table').text()));
    await aFileCard.trigger('contextmenu', { clientX: 80, clientY: 80 });
    await w.findAll('.canvas-container .ctx button').find((b: any) => /^Fields on/.test(b.text())).trigger('click');
    await until(() => w.find('.canvas-container .ctx input[type="checkbox"]').exists());
    await w.find('.canvas-container .ctx input[type="checkbox"]').trigger('change');
    const cfg2 = await untilDb(`select config from canvases where id = '${boardDuke}'`, (r) => Object.keys(r[0].config.cardFields ?? {}).length > 0);
    check('choosing a card\'s fields does NOT wipe the defaults (both live in the same settings, and a write replaces them whole)', cfg2[0].config.defaults?.length === 2, JSON.stringify(cfg2[0].config));
    await w.find('.canvas-container').trigger('pointerdown', { button: 0, clientX: 5, clientY: 5 });

    await post([{ type: 'record.delete', id: ep101 }]);
    check('a default whose record was deleted shows as such, to be removed', await until(() => bar().find('.dchip.missing').exists() && /\(deleted\)/.test(bar().find('.dchip.missing').text()), 8000), bar().text());
    const f6 = await createOnCanvas('Files', 640);
    check('…and creating still works: the dead default is skipped, the live one applies', (await linksOf(f6)).join() === `project:${duke}` && !w.find('.errors').exists(), (await linksOf(f6)).join());
    await bar().find('.dchip.missing .dchip-x').trigger('click');
    check('× removes a default', await until(() => chips().join() === 'Projects Duke') && (await untilDb(`select config from canvases where id = '${boardDuke}'`, (r) => r[0].config.defaults.length === 1)).length === 1);

    // Leave the fixture as the later sections expect it: this block's records go.
    await post([f2, f3, f4, f5, f6, s1].map((id) => ({ type: 'record.delete', id })));

    await nav.scope(duke);
    await nav.openCanvas(boardDuke);
    check('with a project scope on, the bar shows THAT too — it is the whole answer to "what will this be linked to"',
      await until(() => bar().find('.dchip.scope').exists() && /Duke/.test(bar().find('.dchip.scope').text())), bar().text());

    console.log('\nC3c. Pickers and the palette lean towards the scope, with a way out');
    await nav.openTable(tSpecs);
    await until(() => names().join() === 'Netflix IMF');
    const exampleCol = w.findAll('.gridview thead th .th-name').map((x: any) => x.text()).indexOf('Example file');
    await w.findAll('.gridview tr.row')[0].findAll('td')[exampleCol + 1].trigger('mousedown');
    await w.find('.gridview .scroller').trigger('keydown', { key: 'Enter' });
    const candidates = () => w.findAll('.gridview .picker .list li .name').map((x: any) => x.text()).sort();
    check('the link picker offers THIS project\'s files first', await until(() => candidates().join() === 'duke_a,duke_b,shared', 8000), candidates().join());
    await w.find('.gridview .picker .scope-toggle input').setValue(true);
    check('— and every file, one tick away (reusing a file from another show is legitimate)', await until(() => candidates().includes('elvis_a') && candidates().includes('orphan')), candidates().join());
    await w.find('.gridview .picker input.q').trigger('keydown', { key: 'Escape' });

    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    await until(() => w.find('.palette').exists());
    await w.find('.palette input.pq').setValue('file:_a');
    const pal = () => w.findAll('.palette .presults li').map((r: any) => ({ label: r.find('.plabel').text(), here: r.find('.in-scope').exists() }));
    check('the palette puts Duke\'s match first and marks it, shows Elvis\'s too, and leaves the archived one out',
      await until(() => pal().length === 2) && pal()[0].label === 'duke_a' && pal()[0].here && pal()[1].label === 'elvis_a' && !pal()[1].here, JSON.stringify(pal()));
    await w.find('.palette input.pq').trigger('keydown', { key: 'Escape' });

    console.log('\nC3d. Archived, deleted, and linked-to');
    await nav.openTable(tFiles);
    await nav.scope('');
    await until(() => names().length === 5);
    await showArchived().trigger('click');
    check('"show archived" brings the archived project into the tree, marked', await until(() => crumbOptions().some((t: string) => /Old show\s*archived/.test(t))), crumbOptions().join(' | '));
    check('and its records back into All', await until(() => names().includes('old_a')), names().join());
    await showArchived().trigger('click');
    await until(() => !names().includes('old_a'));

    await nav.scope(elvis);
    await until(() => names().join() === 'elvis_a,shared');
    await post([{ type: 'record.delete', id: elvis }]);
    check('the scoped project is DELETED by someone else: you fall back to All, not into an empty room',
      await until(() => nav.currentScope() === '' && names().length >= 4, 8000), `${nav.currentScope()} / ${names().join()}`);
    check('its files are now Unassigned — visible, not lost', (await nav.scope('none'), await until(() => names().includes('elvis_a') && names().includes('orphan'))), names().join());

    win.location.hash = `#/s/x-${sec}/table/${tFiles}?sc=${duke}`;
    win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    check('a link that names a scope opens IN that scope', await until(() => nav.currentScope() === duke && names().join() === 'duke_a,duke_b,shared', 8000), names().join());

    win.location.hash = '#/'; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.find('.home').exists());
    const homeScopes = () => w.findAll('.home .scope-link').map((a: any) => a.text());
    check('Home offers each live project as a way straight in — not the archived one', await until(() => homeScopes().includes('Duke')) && !homeScopes().includes('Old show'), homeScopes().join());
    check('…as real links', (w.find('.home .scope-link').attributes('href') ?? '').includes(`sc=`));

    console.log('\nC3e. Setting the membership flag');
    win.location.hash = `#/s/x-${sec}/table/${tFiles}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.find('.gridview').exists() && w.findAll('.gridview thead .th-name').length >= 3);
    const th = (name: string) => w.findAll('.gridview thead th').find((t: any) => t.find('.th-name').exists() && t.find('.th-name').text() === name);
    const pop = () => w.find('.gridview .popover');
    await th('Project').find('.th-menu').trigger('click');
    check('a link field\'s settings (⚙ on its column) carry a "membership" tick box; the current one is ticked',
      (pop().find('.membership input').element as HTMLInputElement).checked);
    await pop().trigger('keydown', { key: 'Escape' });
    await th('Originally for').find('.th-menu').trigger('click');
    check('…and the other link to Projects is not', !(pop().find('.membership input').element as HTMLInputElement).checked);
    await pop().find('.membership input').setValue(true);
    // The tick box itself must be a normal-sized box beside its label — a leftover
    // global rule once stretched it to the popover's full width.
    check('no stylesheet rule makes a popover checkbox full-width any more', !/\.grid input\s*\{/.test(win.document.documentElement.outerHTML));
    const flags = await untilDb(`select name, options->>'membership' m from fields where table_id = '${tFiles}' and type = 'link' order by name`, (r) => r.find((x: any) => x.name === 'Originally for')?.m === 'true');
    check('ticking another MOVES the flag (one per table per target) — no server refusal, no error banner',
      flags.find((x: any) => x.name === 'Originally for')?.m === 'true' && flags.find((x: any) => x.name === 'Project')?.m !== 'true' && !w.find('.errors').exists(), JSON.stringify(flags));
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}

// A throw ends the suite EARLY: the tally above then says "N passed, 0 failed" for the
// checks that ran, which reads as success. Say plainly that it is not.
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
