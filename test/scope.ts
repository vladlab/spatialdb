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
import { mountApp } from './uiHarness.js';

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

    console.log('\nC3b2. A record made ON a board joins whatever the board belongs to');
    // Works: the level below a project. Files and Boards each get a MEMBERSHIP link to
    // Works (a table may have one membership link per TARGET table — Projects and Works
    // are different targets). No nested scope, no canvas setting: a canvas is a record,
    // and you say what a board is about by filling in its fields.
    const tWorks = randomUUID(), fWorkName = randomUUID(), fFileWork = randomUUID(), fBoardWork = randomUUID(), ep101 = randomUUID();
    const worksSetup = await post([
      { type: 'table.create', id: tWorks, name: 'Works' },
      { type: 'field.create', id: fWorkName, tableId: tWorks, name: 'Name', key: 'name', fieldType: 'text' },
      { type: 'field.create', id: fFileWork, tableId: tFiles, name: 'Work', key: 'work', fieldType: 'link', options: { target_table_id: tWorks, membership: true } },
      { type: 'field.create', id: fBoardWork, tableId: tBoards, name: 'Work', key: 'work', fieldType: 'link', options: { target_table_id: tWorks, membership: true } },
      { type: 'record.create', id: ep101, tableId: tWorks, data: { name: 'Ep 101' } },
      link(fBoardWork, boardDuke, ep101),
      { type: 'section.update', id: sec, tableIds: [tProj, tFiles, tSpecs, tBoards, tWorks] },
    ]);
    check('fixture: a second membership link on Files (to Works) is allowed — it is a different TARGET', worksSetup.status === 200, (await worksSetup.text()).slice(0, 200));

    await nav.scope('');                                   // scope: ALL — so what follows cannot be scope's doing
    await nav.openCanvas(boardDuke);
    await until(() => w.find('.canvas-container').exists());
    const filesBeforeBoard = new Set((await pool.query(`select id from records where table_id = $1`, [tFiles])).rows.map((r) => r.id as string));
    await w.find('.canvas-container').trigger('dblclick', { clientX: 400, clientY: 300 });
    // (double-click on empty canvas offers the tables to create in)
    await until(() => w.find('.canvas-container .ctx').exists());
    await w.findAll('.canvas-container .ctx button').find((b: any) => b.text().trim().startsWith('Files')).trigger('click');
    const onBoard = (await untilDb(`select r.id,
        (select count(*)::int from links l where l.from_record = r.id and l.field_id = '${fFileWork}' and l.to_record = '${ep101}') work,
        (select count(*)::int from links l where l.from_record = r.id and l.field_id = '${fMember}' and l.to_record = '${duke}') project
      from records r where r.table_id = '${tFiles}'`, (r) => r.some((x: any) => !filesBeforeBoard.has(x.id) && x.work === 1))).filter((x: any) => !filesBeforeBoard.has(x.id));
    check('a file created on the "Duke flow" board is linked to the board\'s WORK (Ep 101)…', onBoard.length === 1 && onBoard[0].work === 1, JSON.stringify(onBoard));
    check('…and to the board\'s PROJECT (Duke) — with the scope on "All", so this came from the board', onBoard[0]?.project === 1, JSON.stringify(onBoard));
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    check('record, both inherited links and its card are ONE Ctrl+Z', (await untilDb(`select 1 from records where id = '${onBoard[0]?.id}'`, (r) => r.length === 0)).length === 0);

    // A table with NO membership link to Works inherits nothing from that link — silently.
    // (the canvas remembers the last table you created in; Alt+double-click asks again)
    await w.find('.canvas-container').trigger('dblclick', { clientX: 420, clientY: 320, altKey: true });
    await until(() => w.find('.canvas-container .ctx').exists());
    await w.findAll('.canvas-container .ctx button').find((b: any) => b.text().trim().startsWith('Specs')).trigger('click');
    const specMade = await untilDb(`select r.id, (select count(*)::int from links l where l.from_record = r.id) nl from records r where r.table_id = '${tSpecs}' and r.data = '{}'::jsonb`, (r) => r.length === 1);
    check('a table that does not belong to works or projects is created on the board with NO links, and no error',
      specMade[0]?.nl === 0 && !w.find('.errors').exists(), JSON.stringify(specMade));
    await nav.scope(duke);

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
