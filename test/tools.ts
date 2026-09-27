/**
 * The tools contract (contract/tools.ts, sql/014): validating a table's tool
 * config on both sides, storing it, reading it back, the `via` provenance tag on a
 * batch — in the log, on live and replayed events, in History — the store's rule
 * that a batch carries ONE tag and that a tool's follow-ups are not Ctrl+Z steps,
 * and the Table settings UI that configures it all.
 *
 * Nothing here runs a tool: the desktop client is the only thing that can, and
 * this suite is what it can rely on the server and the web app having done.
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';
import { FILE_DROP, TablesTools, Via, resolveMap, toolsProblem } from '../src/contract/tools.js';
import { MutationRequest } from '../src/contract/mutations.js';
import { StreamEvent } from '../src/contract/events.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8817));
  const { w, win, pool, until, post, API } = ui;
  try {
    /* ── T1. The rule, pure ─────────────────────────────────────────────── */
    console.log('\nT1. toolsProblem — the rule both sides run');
    const fPath = randomUUID(), fName = randomUUID(), fWidth = randomUUID(), fKind = randomUUID(), fManifest = randomUUID(), fLayout = randomUUID(), fNotes = randomUUID();
    const fields = [
      { id: fPath, key: 'path', type: 'file_path', options: {} },
      { id: fName, key: 'name', type: 'text', options: {} },
      { id: fWidth, key: 'width', type: 'number', options: {} },
      { id: fKind, key: 'kind', type: 'select', options: { choices: ['file', 'bundle'] } },
      { id: fManifest, key: 'manifest', type: 'structured', options: { shape: 'manifest' } },
      { id: fLayout, key: 'audio_layout', type: 'structured', options: { shape: 'audio_layout' } },
      { id: fNotes, key: 'notes', type: 'rich_text', options: {} },
    ];
    const ok = { file_drop: { map: { path: fPath, name: fName, width: fWidth, kind: fKind, manifest: fManifest, audio_layout: fLayout } } };
    check('a full, correct mapping passes', toolsProblem(ok, fields) === null, String(toolsProblem(ok, fields)));
    check('an empty config (no tools enabled) passes', toolsProblem({}, fields) === null);
    check('not an object is refused', toolsProblem('file_drop', fields) !== null);
    check('an unknown tool is refused BY NAME', /unknown tool: resolve_reader/.test(String(toolsProblem({ resolve_reader: { map: {} } }, fields))));
    check('an unknown key inside a tool config is refused (strict — a typo must not be stored)', toolsProblem({ file_drop: { map: {}, enabled: true } }, fields) !== null);
    check('an unknown OUTPUT is refused by name', /no output called "widht"/.test(String(toolsProblem({ file_drop: { map: { path: fPath, widht: fWidth } } }, fields))));
    check('a field id that is not a uuid is refused', toolsProblem({ file_drop: { map: { path: 'path' } } }, fields) !== null);
    check('a field that is not on this table is refused', /not on this table/.test(String(toolsProblem({ file_drop: { map: { path: randomUUID() } } }, fields))));
    check('a number output into a text field is refused, naming both', /"Width" \(number\) cannot be written to a text field/.test(String(toolsProblem({ file_drop: { map: { path: fPath, width: fName } } }, fields))));
    check('a text output MAY go into a text or long_text field, not a rich_text one', toolsProblem({ file_drop: { map: { path: fPath, name: fNotes } } }, fields) !== null);
    check('a structured output must match the field\'s SHAPE (manifest ≠ audio_layout)', toolsProblem({ file_drop: { map: { path: fPath, manifest: fLayout } } }, fields) !== null);
    check('a select output may go into a select OR a text field', toolsProblem({ file_drop: { map: { path: fPath, kind: fName } } }, fields) === null);
    check('the required output (path) must be mapped', /needs "Path" mapped/.test(String(toolsProblem({ file_drop: { map: { name: fName } } }, fields))));
    check('two outputs into ONE field is refused (they would race)', /same field/.test(String(toolsProblem({ file_drop: { map: { path: fPath, name: fName, extension: fName } } }, fields))));
    check('every output type the tool declares is one the rule knows', FILE_DROP.outputs.every((o) => ['text', 'number', 'date', 'checkbox', 'select', 'file_path', 'structured:manifest', 'structured:audio_layout'].includes(o.type)));
    check('output keys are unique', new Set(FILE_DROP.outputs.map((o) => o.key)).size === FILE_DROP.outputs.length);
    check('every select output declares its choices (so the UI can make the field)', FILE_DROP.outputs.filter((o) => o.type === 'select').every((o) => (o.choices?.length ?? 0) > 0));
    const rm = resolveMap({ map: { path: fPath, width: randomUUID(), name: fName } }, fields);
    check('resolveMap returns output key → field KEY and SKIPS a mapped field that no longer exists', rm.get('path') === 'path' && rm.get('name') === 'name' && !rm.has('width'), JSON.stringify([...rm]));
    check('Via: lowercase snake, 2–40 chars', Via.safeParse('file_drop').success && !Via.safeParse('File Drop').success && !Via.safeParse('x').success && !Via.safeParse('a'.repeat(41)).success);
    check('MutationRequest accepts `via` and refuses a bad one', MutationRequest.safeParse({ clientId: randomUUID(), via: 'file_drop', mutations: [{ id: randomUUID(), mutation: { type: 'record.delete', id: randomUUID() } }] }).success && !MutationRequest.safeParse({ clientId: randomUUID(), via: 'File drop', mutations: [{ id: randomUUID(), mutation: { type: 'record.delete', id: randomUUID() } }] }).success);
    check('TablesTools is the config\'s schema', TablesTools.safeParse(ok).success);

    /* ── T2. Storing it ─────────────────────────────────────────────────── */
    console.log('\nT2. tables.tools — written by table.update, validated against the table\'s fields');
    const tFiles = randomUUID(), tOther = randomUUID();
    const gPath = randomUUID(), gName = randomUUID(), gWidth = randomUUID(), gOtherPath = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const setup = await post([
      { type: 'table.create', id: tFiles, name: 'Files' }, { type: 'table.create', id: tOther, name: 'Other' },
      { type: 'field.create', id: gName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(gName, 0),
      { type: 'field.create', id: gPath, tableId: tFiles, name: 'Path', key: 'path', fieldType: 'file_path' }, pos(gPath, 1),
      { type: 'field.create', id: gWidth, tableId: tFiles, name: 'Width', key: 'width', fieldType: 'number' }, pos(gWidth, 2),
      { type: 'field.create', id: gOtherPath, tableId: tOther, name: 'Path', key: 'path', fieldType: 'file_path' }, pos(gOtherPath, 0),
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 200));
    const dbTools = async (id: string) => (await pool.query(`select tools from tables where id = $1`, [id])).rows[0]?.tools;
    check('a fresh table has an EMPTY tools config, not null', JSON.stringify(await dbTools(tFiles)) === '{}');

    let r = await post([{ type: 'table.update', id: tFiles, tools: { file_drop: { map: { path: gPath, width: gWidth } } } }]);
    check('a valid config is accepted and stored', r.status === 200 && (await dbTools(tFiles)).file_drop.map.width === gWidth, await r.text());
    r = await post([{ type: 'table.update', id: tFiles, tools: { file_drop: { map: { path: gOtherPath } } } }]);
    check('a field from ANOTHER table is refused (400)', r.status === 400 && /not on this table/.test(await r.clone().text()), await r.text());
    r = await post([{ type: 'table.update', id: tFiles, tools: { file_drop: { map: { path: gPath, width: gName } } } }]);
    check('a type mismatch is refused (400) with the rule\'s message', r.status === 400 && /cannot be written/.test(await r.clone().text()));
    r = await post([{ type: 'table.update', id: tFiles, tools: { file_drop: { map: {} } } }]);
    check('a config without the required output is refused', r.status === 400 && /needs .*Path.* mapped/.test(await r.clone().text()));
    check('…and the stored config is unchanged by the refusals', (await dbTools(tFiles)).file_drop.map.width === gWidth);
    r = await post([{ type: 'table.update', id: tFiles, name: 'Files!' }]);
    check('a table.update WITHOUT tools leaves the config alone', r.status === 200 && (await dbTools(tFiles)).file_drop.map.width === gWidth);
    const schema = await (await fetch(`${API}/api/schema`)).json() as Array<{ id: string; tools: unknown }>;
    check('GET /api/schema returns tools on each table', JSON.stringify(schema.find((t) => t.id === tFiles)?.tools) === JSON.stringify({ file_drop: { map: { path: gPath, width: gWidth } } }));
    r = await post([{ type: 'table.update', id: tFiles, tools: {} }]);
    check('`{}` disables everything', r.status === 200 && JSON.stringify(await dbTools(tFiles)) === '{}');
    await post([{ type: 'table.update', id: tFiles, tools: { file_drop: { map: { path: gPath, width: gWidth } } } }]);

    console.log('\nT2b. No foreign keys: a deleted field is skipped, an undone delete heals it');
    const delWidth = randomUUID();
    r = await fetch(`${API}/api/mutate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: randomUUID(), mutations: [{ id: delWidth, mutation: { type: 'field.delete', id: gWidth } }] }) });
    check('deleting a mapped field succeeds and does NOT rewrite the config', r.status === 200 && (await dbTools(tFiles)).file_drop.map.width === gWidth);
    const remaining = (await pool.query(`select id, key, type, options from fields where table_id = $1`, [tFiles])).rows;
    check('resolveMap then skips the dangling entry, keeps the rest', !resolveMap((await dbTools(tFiles)).file_drop, remaining).has('width') && resolveMap((await dbTools(tFiles)).file_drop, remaining).get('path') === 'path');
    const cap = await (await fetch(`${API}/api/mutations/${delWidth}/undo`)).json() as { rows: unknown };
    r = await post([{ type: 'restore', id: randomUUID(), undoOf: delWidth, rows: cap.rows }]);
    check('undoing the delete heals the mapping with no config change', r.status === 200 && resolveMap((await dbTools(tFiles)).file_drop, (await pool.query(`select id, key, type, options from fields where table_id = $1`, [tFiles])).rows).get('width') === 'width');

    console.log('\nT2c. Deleting the table captures its tools; restore brings them back');
    const delTable = randomUUID();
    r = await fetch(`${API}/api/mutate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: randomUUID(), mutations: [{ id: delTable, mutation: { type: 'table.delete', id: tFiles } }] }) });
    check('table deleted', r.status === 200);
    const tcap = await (await fetch(`${API}/api/mutations/${delTable}/undo`)).json() as { rows: unknown };
    r = await post([{ type: 'restore', id: randomUUID(), undoOf: delTable, rows: tcap.rows }]);
    check('the restored table has its tools config (capture takes every column)', r.status === 200 && (await dbTools(tFiles))?.file_drop?.map?.path === gPath, JSON.stringify(await dbTools(tFiles)));

    /* ── T3. via ────────────────────────────────────────────────────────── */
    console.log('\nT3. `via` — who wrote a batch, in the log and on every event');
    const me = randomUUID(), rec = randomUUID(), rec2 = randomUUID();
    const raw = (body: unknown) => fetch(`${API}/api/mutate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    r = await raw({ clientId: me, via: 'file_drop', mutations: [{ id: randomUUID(), mutation: { type: 'record.create', id: rec, tableId: tFiles, data: { name: 'a.mov', path: '/mnt/san/a.mov' } } }] });
    check('a tagged batch is accepted', r.status === 200, await r.text());
    check('…and the tag is on the LOG ROW', (await pool.query(`select via from mutations where payload->>'id' = $1`, [rec])).rows[0]?.via === 'file_drop');
    r = await raw({ clientId: me, mutations: [{ id: randomUUID(), mutation: { type: 'record.create', id: rec2, tableId: tFiles, data: { name: 'typed by hand' } } }] });
    check('an untagged batch stores NULL', r.status === 200 && (await pool.query(`select via from mutations where payload->>'id' = $1`, [rec2])).rows[0]?.via === null);
    const noop = () => [{ id: randomUUID(), mutation: { type: 'record.update', id: rec2, set: { name: 'typed by hand' }, unset: [] } }];
    r = await raw({ clientId: me, via: 'File Drop', mutations: noop() });
    check('a malformed tag is a 400 — the envelope is strict', r.status === 400);
    r = await raw({ clientId: me, via: 'not_a_tool_yet', mutations: noop() });
    check('an UNKNOWN tag is accepted: the tag is provenance, not a permission (a script may name itself)', r.status === 200);

    // Catch-up: the events for both records, read through the contract parser.
    const seqOf = async (id: string) => Number((await pool.query(`select seq from mutations where payload->>'id' = $1`, [id])).rows[0].seq);
    const since = (await seqOf(rec)) - 1;
    const res = await fetch(`${API}/api/stream?since=${since}`);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const events: any[] = [];
    const deadline = Date.now() + 4000;
    while (events.length < 2 && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = frame.split('\n').find((l) => l.startsWith('data: '));
        if (line) events.push(StreamEvent.parse(JSON.parse(line.slice(6))));
      }
    }
    await reader.cancel().catch(() => {});
    const evA = events.find((e) => e.kind === 'mutation' && e.mutation.id === rec);
    const evB = events.find((e) => e.kind === 'mutation' && e.mutation.id === rec2);
    check('the replayed event carries `via`', evA?.via === 'file_drop', JSON.stringify(evA));
    check('an untagged event has NO `via` key at all (absent, never null — an older strict parser must still pass)', evB && !('via' in evB), JSON.stringify(evB));

    console.log('\nT3b. History shows it');
    const delRec = randomUUID();
    r = await raw({ clientId: me, via: 'file_drop', mutations: [{ id: delRec, mutation: { type: 'record.delete', id: rec } }] });
    const undoable = await (await fetch(`${API}/api/undoable`)).json() as Array<{ id: string; via: string | null }>;
    check('GET /api/undoable reports via on a tool-written delete, null on a hand one', undoable.find((u) => u.id === delRec)?.via === 'file_drop' && undoable.find((u) => u.id === delTable)?.via === null);

    /* ── T4. The store ──────────────────────────────────────────────────── */
    console.log('\nT4. The store: one tag per batch; follow-ups are not Ctrl+Z steps');
    // Imported AFTER mountApp: @vue/runtime-dom captures `document` when it loads,
    // and it must load after the harness has made one.
    const { createStore } = await import('../src/client/store.js');
    const store = createStore({ baseUrl: API, debounceMs: 20 });
    await store.hydrate();
    const before = Number((await pool.query(`select count(*)::int n from mutations`)).rows[0].n);
    const s1 = randomUUID(), s2 = randomUUID(), s3 = randomUUID();
    // Separate synchronous runs, as separate user actions and a later probe would be
    // (a Ctrl+Z step is everything mutated in one run — store.ts).
    store.mutate({ type: 'record.create', id: s1, tableId: tFiles, data: { name: 'by hand' } });
    await sleep(0);
    store.mutate({ type: 'record.create', id: s2, tableId: tFiles, data: { name: 'dropped', path: '/x/b.mov' } }, { via: 'file_drop' });
    await sleep(0);
    store.mutate({ type: 'record.update', id: s2, set: { width: 1920 }, unset: [] }, { via: 'file_drop', undoable: false });
    await sleep(0);
    store.mutate({ type: 'record.create', id: s3, tableId: tFiles, data: { name: 'by hand again' } });
    await store.settled();
    const rows = (await pool.query(`select payload->>'id' as id, via from mutations where seq > (select max(seq) - 4 from mutations) order by seq`)).rows;
    check('all four landed, in order', rows.map((x) => x.id).join() === [s1, s2, s2, s3].join() && (Number((await pool.query(`select count(*)::int n from mutations`)).rows[0].n) - before) === 4, JSON.stringify(rows));
    check('the hand edits are untagged; the tool\'s are tagged — so they went as SEPARATE batches', rows.map((x) => x.via).join() === ',file_drop,file_drop,');
    check('undo has TWO steps for the two hand edits plus the drop, not a step for the follow-up', store.canUndo.value);
    await store.undoLast(); await store.settled();
    check('Ctrl+Z once undoes the last hand edit…', !store.state.records.has(s3) && store.state.records.has(s2));
    await store.undoLast(); await store.settled();
    check('…twice undoes the DROP — record and probe result together (the width update was never its own step)', !store.state.records.has(s2) && store.state.records.has(s1));
    await store.undoLast(); await store.settled();
    check('…three times, the first hand edit', !store.state.records.has(s1));

    /* ── T5. The UI ─────────────────────────────────────────────────────── */
    console.log('\nT5. Table settings → Desktop tools');
    const tNew = randomUUID(), nName = randomUUID();
    await post([{ type: 'table.create', id: tNew, name: 'Assets' }, { type: 'field.create', id: nName, tableId: tNew, name: 'Title', key: 'title', fieldType: 'text' }, pos(nName, 0)]);
    win.location.hash = `#/all/table/${tNew}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.find(`[data-table="${tNew}"]`).exists(), 8000);
    await w.find(`[data-table="${tNew}"] .act[title="Table settings"]`).trigger('click');
    check('Table settings opens with a Desktop tools section listing File drop, OFF', await until(() => w.find('.ts .tools').exists()) && /File drop/.test(w.find('.ts .tools').text()) && !(w.find('.ts .tools input[type=checkbox]').element as HTMLInputElement).checked);
    check('outputs are not listed while it is off', !w.find('.ts .tools select').exists());
    await w.find('.ts .tools input[type=checkbox]').setValue(true);
    check('turning it on CREATES the field it cannot run without (Path) and maps it — the table had none', await until(() => w.findAll('.ts .tools select').length > 10) && (await ui.untilDb(`select 1 from fields where table_id = '${tNew}' and key = 'path' and type = 'file_path'`, (x) => x.length === 1)).length === 1);
    let cfg = await ui.untilDb(`select tools from tables where id = '${tNew}'`, (x) => !!x[0]?.tools?.file_drop);
    const pathRow = (await pool.query(`select id from fields where table_id = $1 and key = 'path'`, [tNew])).rows[0];
    check('…and the stored config maps path to that new field, nothing else', cfg[0].tools.file_drop.map.path === pathRow.id && Object.keys(cfg[0].tools.file_drop.map).length === 1, JSON.stringify(cfg[0].tools));
    const rowOf = (name: string) => w.findAll('.ts .tools .row').find((x: any) => x.find('.oname').text().replace('*', '') === name);
    check('the required output is starred', rowOf('Path').find('.req').exists());
    check('a text output offers the text field; a number output does not', rowOf('File name').findAll('option').some((o: any) => o.text() === 'Title') && !rowOf('Width').findAll('option').some((o: any) => o.text() === 'Title'));
    await rowOf('File name').find('select').setValue(nName);
    cfg = await ui.untilDb(`select tools from tables where id = '${tNew}'`, (x) => x[0]?.tools?.file_drop?.map?.name === nName);
    check('picking a field for an output writes the mapping (table.update)', cfg[0].tools.file_drop.map.name === nName);
    await rowOf('Kind').find('button.mini').trigger('click');
    const kindField = await ui.untilDb(`select id, type, options from fields where table_id = '${tNew}' and key = 'kind'`, (x) => x.length === 1);
    check('"+ field" on a select output makes a select WITH the tool\'s choices…', kindField.length === 1 && kindField[0].type === 'select' && JSON.stringify(kindField[0].options.choices) === JSON.stringify(['file', 'bundle', 'sequence', 'channel_set']), JSON.stringify(kindField));
    cfg = await ui.untilDb(`select tools from tables where id = '${tNew}'`, (x) => x[0]?.tools?.file_drop?.map?.kind === kindField[0]?.id);
    check('…and maps it', cfg[0].tools.file_drop.map.kind === kindField[0].id);
    await rowOf('Total size').find('button.mini').trigger('click');
    const sizeField = await ui.untilDb(`select options from fields where table_id = '${tNew}' and key = 'total_size'`, (x) => x.length === 1);
    check('"+ field" on Total size makes a bytes-formatted number', sizeField[0]?.options?.format === 'bytes');
    check('once a same-key field exists the + button is gone for that output', !rowOf('Kind').find('button.mini').exists() && !rowOf('Total size').find('button.mini').exists());
    await rowOf('File name').find('select').setValue('');
    cfg = await ui.untilDb(`select tools from tables where id = '${tNew}'`, (x) => !('name' in (x[0]?.tools?.file_drop?.map ?? { name: 1 })));
    check('"(not written)" removes the mapping', !('name' in cfg[0].tools.file_drop.map));
    await w.find('.ts .tools input[type=checkbox]').setValue(false);
    cfg = await ui.untilDb(`select tools from tables where id = '${tNew}'`, (x) => JSON.stringify(x[0]?.tools) === '{}');
    check('turning it off removes the tool\'s entry; the fields stay', JSON.stringify(cfg[0].tools) === '{}' && (await pool.query(`select 1 from fields where table_id = $1 and key = 'kind'`, [tNew])).rowCount === 1);
    check('no error banner', !w.find('.banner.error').exists());
    await sleep(50);
  } finally {
    await ui.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('SUITE ABORTED', e); process.exit(1); });
