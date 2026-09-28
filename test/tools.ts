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
import { ANALYZERS, MEDIA, TablesTools, Via, describe, resolveMap, stepApplies, toolsProblem } from '../src/contract/tools.js';
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
    console.log('\nT1. toolsProblem — the rule both sides run, on a RECIPE');
    const fPath = randomUUID(), fName = randomUUID(), fWidth = randomUUID(), fKind = randomUUID(), fManifest = randomUUID(), fLayout = randomUUID(), fNotes = randomUUID(), fHash = randomUUID();
    const fields = [
      { id: fPath, key: 'path', type: 'file_path', options: {} },
      { id: fName, key: 'name', type: 'text', options: {} },
      { id: fWidth, key: 'width', type: 'number', options: {} },
      { id: fKind, key: 'kind', type: 'select', options: { choices: ['file', 'bundle'] } },
      { id: fManifest, key: 'manifest', type: 'structured', options: { shape: 'manifest' } },
      { id: fLayout, key: 'audio_layout', type: 'structured', options: { shape: 'audio_layout' } },
      { id: fNotes, key: 'notes', type: 'rich_text', options: {} },
      { id: fHash, key: 'hash', type: 'text', options: {} },
    ];
    const fs = (map: Record<string, string>) => ({ analyzer: 'filesystem', map });
    const ff = (map: Record<string, string>, runs_on?: unknown) => ({ analyzer: 'ffprobe', map, ...(runs_on ? { runs_on } : {}) });
    const rcp = (...steps: unknown[]) => ({ file_drop: { steps } });
    const ok = rcp(fs({ path: fPath, name: fName, kind: fKind, manifest: fManifest }), ff({ width: fWidth, audio_layout: fLayout }), { analyzer: 'hash-xxh3', map: { hash: fHash } });
    check('a full, correct recipe passes', toolsProblem(ok, fields) === null, String(toolsProblem(ok, fields)));
    check('an empty config (no tools enabled) passes', toolsProblem({}, fields) === null);
    check('not an object is refused', toolsProblem('file_drop', fields) !== null);
    check('an unknown tool is refused', toolsProblem({ resolve_reader: { steps: [] } }, fields) !== null);
    check('the OLD flat shape (014) is refused — sql/015 rewrites it, nothing else should send it', toolsProblem({ file_drop: { map: { path: fPath } } }, fields) !== null);
    check('an unknown key inside a step is refused (strict — a typo must not be stored)', toolsProblem(rcp({ analyzer: 'filesystem', map: { path: fPath }, enabled: true }), fields) !== null);
    check('an unknown ANALYZER is refused by name and step number', /step 2: unknown analyzer "imagemagick"/.test(String(toolsProblem(rcp(fs({ path: fPath }), { analyzer: 'imagemagick', map: {} }), fields))));
    check('an unknown OUTPUT is refused by analyzer and name', /ffprobe: no output called "widht"/.test(String(toolsProblem(rcp(fs({ path: fPath }), ff({ widht: fWidth })), fields))));
    check('an output that belongs to ANOTHER analyzer is refused (width is ffprobe\'s, not the filesystem\'s)', /Filesystem: no output called "width"/.test(String(toolsProblem(rcp(fs({ path: fPath, width: fWidth })), fields))));
    check('a field id that is not a uuid is refused', toolsProblem(rcp(fs({ path: 'path' })), fields) !== null);
    check('a field that is not on this table is refused', /not on this table/.test(String(toolsProblem(rcp(fs({ path: randomUUID() })), fields))));
    check('a number output into a text field is refused, naming both', /"Width" \(number\) cannot be written to a text field/.test(String(toolsProblem(rcp(fs({ path: fPath }), ff({ width: fName })), fields))));
    check('a text output MAY go into a text or long_text field, not a rich_text one', toolsProblem(rcp(fs({ path: fPath, name: fNotes })), fields) !== null);
    check('a structured output must match the field\'s SHAPE (manifest ≠ audio_layout)', toolsProblem(rcp(fs({ path: fPath, manifest: fLayout })), fields) !== null);
    check('a select output may go into a select OR a text field', toolsProblem(rcp(fs({ path: fPath, kind: fName })), fields) === null);
    check('the required output (Path, from the filesystem) must be mapped', /needs "Path" \(Filesystem\) mapped/.test(String(toolsProblem(rcp(fs({ name: fName })), fields))));
    check('…mapping "path" on some OTHER analyzer would not count (there is none, and the rule names the analyzer)', /needs "Path"/.test(String(toolsProblem(rcp(ff({ width: fWidth })), fields))));
    check('two steps into ONE field is refused, naming both outputs', /two outputs \(filesystem.name and hash-xxh3.hash\)/.test(String(toolsProblem(rcp(fs({ path: fPath, name: fName }), { analyzer: 'hash-xxh3', map: { hash: fName } }), fields))));
    check('the SAME output twice (a repeated step) may write the same field — not a race, an idempotent re-run', toolsProblem(rcp(fs({ path: fPath }), ff({ width: fWidth }), ff({ width: fWidth })), fields) === null);
    check('runs_on is validated: an unknown media class is refused', toolsProblem(rcp(fs({ path: fPath }), ff({ width: fWidth }, { media: ['vidoe'] })), fields) !== null);
    check('runs_on with known classes passes', toolsProblem(rcp(fs({ path: fPath }), ff({ width: fWidth }, { media: ['video', 'other'], kind: ['file'] })), fields) === null);
    check('every analyzer\'s output types are ones the rule knows', ANALYZERS.every((a) => a.outputs.every((o) => ['text', 'number', 'date', 'checkbox', 'select', 'file_path', 'structured:manifest', 'structured:audio_layout'].includes(o.type))));
    check('output keys are unique within each analyzer', ANALYZERS.every((a) => new Set(a.outputs.map((o) => o.key)).size === a.outputs.length));
    check('every select output declares its choices (so the UI can make the field)', ANALYZERS.every((a) => a.outputs.filter((o) => o.type === 'select').every((o) => (o.choices?.length ?? 0) > 0)));
    check('every analyzer that runs a program offers its version as an output (provenance)', ANALYZERS.filter((a) => a.program).every((a) => a.outputs.some((o) => o.key === `${a.id}.version`)));
    check('`other` is a media class a step can target — the explicit fallback', MEDIA.includes('other') && toolsProblem(rcp(fs({ path: fPath }), ff({}, { media: ['other'] })), fields) === null);
    const rm = resolveMap(fs({ path: fPath, extension: randomUUID(), name: fName }), fields);
    check('resolveMap returns output key → field KEY and SKIPS a mapped field that no longer exists', rm.get('path') === 'path' && rm.get('name') === 'name' && !rm.has('extension'), JSON.stringify([...rm]));
    const u = { media: 'audio', kind: 'file' };
    check('stepApplies: ffprobe\'s DEFAULT is video or audio; an explicit runs_on replaces it; both lists must match', stepApplies(ff({}), u) && !stepApplies(ff({}), { media: 'document', kind: 'file' }) && !stepApplies(ff({}, { media: ['video'] }), u) && stepApplies({ analyzer: 'hash-xxh3', map: {} }, { media: 'other', kind: 'bundle' }) && !stepApplies(ff({}, { media: ['audio'], kind: ['sequence'] }), u));
    const lines = describe(ok.file_drop as never, [{ id: fPath, name: 'Path' }, { id: fName, name: 'Name' }, { id: fKind, name: 'Kind' }, { id: fManifest, name: 'Manifest' }, { id: fWidth, name: 'Width' }, { id: fLayout, name: 'Audio' }, { id: fHash, name: 'Hash' }], { ffprobe: '7.1' });
    check('describe() turns the recipe into checkable sentences, with the program version', lines.length === 3 && /^1\. For everything: Filesystem → Path → Path, File name → Name/.test(lines[0]) && /^2\. If video or audio: ffprobe 7\.1 → Width → Width, Audio layout → Audio\.$/.test(lines[1]) && /^3\. For everything: Hash \(xxh3\) → Hash → Hash\.$/.test(lines[2]), JSON.stringify(lines));
    check('…and says when the program is not on this machine', /ffprobe \(not on this machine\)/.test(describe(ok.file_drop as never, [], { ffprobe: null })[1]));
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

    const good = { file_drop: { steps: [{ analyzer: 'filesystem', map: { path: gPath } }, { analyzer: 'ffprobe', map: { width: gWidth } }] } };
    const widthOf = async (id: string) => (await dbTools(id))?.file_drop?.steps?.[1]?.map?.width;
    let r = await post([{ type: 'table.update', id: tFiles, tools: good }]);
    check('a valid recipe is accepted and stored', r.status === 200 && await widthOf(tFiles) === gWidth, await r.text());
    r = await post([{ type: 'table.update', id: tFiles, tools: { file_drop: { steps: [{ analyzer: 'filesystem', map: { path: gOtherPath } }] } } }]);
    check('a field from ANOTHER table is refused (400)', r.status === 400 && /not on this table/.test(await r.clone().text()), await r.text());
    r = await post([{ type: 'table.update', id: tFiles, tools: { file_drop: { steps: [{ analyzer: 'filesystem', map: { path: gPath } }, { analyzer: 'ffprobe', map: { width: gName } }] } } }]);
    check('a type mismatch is refused (400) with the rule\'s message', r.status === 400 && /cannot be written/.test(await r.clone().text()));
    r = await post([{ type: 'table.update', id: tFiles, tools: { file_drop: { steps: [{ analyzer: 'ffprobe', map: {} }] } } }]);
    check('a recipe without the required output is refused', r.status === 400 && /needs .*Path.* mapped/.test(await r.clone().text()));
    r = await post([{ type: 'table.update', id: tFiles, tools: { file_drop: { map: { path: gPath } } } }]);
    check('the old flat shape is refused (400)', r.status === 400);
    check('…and the stored recipe is unchanged by the refusals', await widthOf(tFiles) === gWidth);
    r = await post([{ type: 'table.update', id: tFiles, name: 'Files!' }]);
    check('a table.update WITHOUT tools leaves the recipe alone', r.status === 200 && await widthOf(tFiles) === gWidth);
    const schema = await (await fetch(`${API}/api/schema`)).json() as Array<{ id: string; tools: unknown }>;
    const same = (a: unknown, b: unknown) => JSON.stringify(a, Object.keys(JSON.parse(JSON.stringify(a))).sort()) === JSON.stringify(b, Object.keys(JSON.parse(JSON.stringify(b))).sort());
    const schemaTools = schema.find((t) => t.id === tFiles)?.tools as any;
    check('GET /api/schema returns tools on each table', schemaTools?.file_drop?.steps?.length === 2 && schemaTools.file_drop.steps[0].analyzer === 'filesystem' && schemaTools.file_drop.steps[1].map.width === gWidth);
    void same;
    r = await post([{ type: 'table.update', id: tFiles, tools: {} }]);
    check('`{}` disables everything', r.status === 200 && JSON.stringify(await dbTools(tFiles)) === '{}');
    await post([{ type: 'table.update', id: tFiles, tools: good }]);

    console.log('\nT2a. sql/015 rewrites a 014-shaped mapping into steps');
    const tOld = randomUUID(), oPath = randomUUID(), oWidth = randomUUID(), oHash = randomUUID(), oFirst = randomUUID();
    await post([{ type: 'table.create', id: tOld, name: 'Old' },
      { type: 'field.create', id: oPath, tableId: tOld, name: 'Path', key: 'path', fieldType: 'file_path' },
      { type: 'field.create', id: oWidth, tableId: tOld, name: 'Width', key: 'width', fieldType: 'number' },
      { type: 'field.create', id: oHash, tableId: tOld, name: 'Hash', key: 'hash', fieldType: 'text' },
      { type: 'field.create', id: oFirst, tableId: tOld, name: 'First', key: 'first_frame', fieldType: 'number' }]);
    // Plant the OLD shape directly (the API refuses it now) and re-run the migration's body.
    await pool.query(`update tables set tools = $2 where id = $1`, [tOld, JSON.stringify({ file_drop: { map: { path: oPath, width: oWidth, hash: oHash, first_frame: oFirst } } })]);
    const mig = (await import('node:fs')).readFileSync(new URL('../sql/015_recipes.sql', import.meta.url), 'utf8');
    await pool.query(mig);
    const migrated = await dbTools(tOld);
    check('…filesystem outputs, ffprobe outputs, the sequence output and the hash each land in their own step, in order',
      migrated.file_drop.steps.map((s: { analyzer: string }) => s.analyzer).join() === 'filesystem,sequence,ffprobe,hash-xxh3'
      && migrated.file_drop.steps[0].map.path === oPath && migrated.file_drop.steps[1].map.first_frame === oFirst
      && migrated.file_drop.steps[2].map.width === oWidth && migrated.file_drop.steps[3].map.hash === oHash, JSON.stringify(migrated));
    check('…and the result passes the current rule', toolsProblem(migrated, (await pool.query(`select id, type, options from fields where table_id = $1`, [tOld])).rows) === null, String(toolsProblem(migrated, (await pool.query(`select id, type, options from fields where table_id = $1`, [tOld])).rows)));
    const after = await dbTools(tFiles);
    check('a table already on the new shape is left alone by a re-run', after.file_drop.steps.length === 2 && after.file_drop.steps[1].map.width === gWidth && !('map' in after.file_drop));

    console.log('\nT2b. No foreign keys: a deleted field is skipped, an undone delete heals it');
    const delWidth = randomUUID();
    r = await fetch(`${API}/api/mutate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: randomUUID(), mutations: [{ id: delWidth, mutation: { type: 'field.delete', id: gWidth } }] }) });
    check('deleting a mapped field succeeds and does NOT rewrite the recipe', r.status === 200 && await widthOf(tFiles) === gWidth);
    const remaining = (await pool.query(`select id, key, type, options from fields where table_id = $1`, [tFiles])).rows;
    check('resolveMap then skips the dangling entry, keeps the rest', !resolveMap((await dbTools(tFiles)).file_drop.steps[1], remaining).has('width') && resolveMap((await dbTools(tFiles)).file_drop.steps[0], remaining).get('path') === 'path');
    const cap = await (await fetch(`${API}/api/mutations/${delWidth}/undo`)).json() as { rows: unknown };
    r = await post([{ type: 'restore', id: randomUUID(), undoOf: delWidth, rows: cap.rows }]);
    check('undoing the delete heals the mapping with no config change', r.status === 200 && resolveMap((await dbTools(tFiles)).file_drop.steps[1], (await pool.query(`select id, key, type, options from fields where table_id = $1`, [tFiles])).rows).get('width') === 'width');

    console.log('\nT2c. Deleting the table captures its tools; restore brings them back');
    const delTable = randomUUID();
    r = await fetch(`${API}/api/mutate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: randomUUID(), mutations: [{ id: delTable, mutation: { type: 'table.delete', id: tFiles } }] }) });
    check('table deleted', r.status === 200);
    const tcap = await (await fetch(`${API}/api/mutations/${delTable}/undo`)).json() as { rows: unknown };
    r = await post([{ type: 'restore', id: randomUUID(), undoOf: delTable, rows: tcap.rows }]);
    check('the restored table has its recipe (capture takes every column)', r.status === 200 && (await dbTools(tFiles))?.file_drop?.steps?.[0]?.map?.path === gPath, JSON.stringify(await dbTools(tFiles)));

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
    console.log('\nT5. Table settings → Desktop tools: the recipe editor');
    const tNew = randomUUID(), nName = randomUUID();
    await post([{ type: 'table.create', id: tNew, name: 'Assets' }, { type: 'field.create', id: nName, tableId: tNew, name: 'Title', key: 'title', fieldType: 'text' }, pos(nName, 0)]);
    win.location.hash = `#/all/table/${tNew}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await until(() => w.find(`[data-table="${tNew}"]`).exists(), 8000);
    await w.find(`[data-table="${tNew}"] .act[title="Table settings"]`).trigger('click');
    check('Table settings opens with a Desktop tools section, File drop OFF, no steps shown', await until(() => w.find('.ts .tools').exists()) && /File drop/.test(w.find('.ts .tools').text()) && !(w.find('.ts .tools input[type=checkbox]').element as HTMLInputElement).checked && !w.find('.ts .tools .step').exists());
    await w.find('.ts .tools input[type=checkbox]').setValue(true);
    check('turning it on gives the DEFAULT recipe — Filesystem then ffprobe — as two step cards', await until(() => w.findAll('.ts .tools .step').length === 2) && w.findAll('.ts .tools .step b').map((b: any) => b.text()).join() === 'Filesystem,ffprobe');
    check('…creates the field it cannot run without (Path)', (await ui.untilDb(`select 1 from fields where table_id = '${tNew}' and key = 'path' and type = 'file_path'`, (x) => x.length === 1)).length === 1);
    let cfg = await ui.untilDb(`select tools from tables where id = '${tNew}'`, (x) => !!x[0]?.tools?.file_drop);
    const pathRow = (await pool.query(`select id from fields where table_id = $1 and key = 'path'`, [tNew])).rows[0];
    const st = cfg[0].tools.file_drop.steps;
    check('…and the stored recipe maps path to that new field, nothing else', st.length === 2 && st[0].analyzer === 'filesystem' && JSON.stringify(st[0].map) === JSON.stringify({ path: pathRow.id }) && st[1].analyzer === 'ffprobe' && JSON.stringify(st[1].map) === '{}' && !st[0].runs_on, JSON.stringify(cfg[0].tools));
    const stepCard = (n: number) => w.findAll('.ts .tools .step')[n];
    const rowOf = (n: number, name: string) => stepCard(n).findAll('.row').find((x: any) => x.find('.oname').text().replace('*', '') === name);
    check('each step card says what it runs and how; the ffprobe card names the program', /built in/.test(stepCard(0).text()) && /runs ffprobe/.test(stepCard(1).text()) && /stat and directory listing/.test(stepCard(0).text()));
    check('the required output is starred, on the filesystem step', rowOf(0, 'Path').find('.req').exists());
    check('a step lists ONLY its own analyzer\'s outputs (Width is on the ffprobe card, not the filesystem one)', !rowOf(0, 'Width') && !!rowOf(1, 'Width') && !!rowOf(0, 'File name'));
    check('"runs on" chips: ffprobe defaults to video and audio, the filesystem to everything', stepCard(1).findAll('.chip.on').map((c: any) => c.text()).join() === 'video,audio,file,bundle,sequence,channel set' && stepCard(0).findAll('.chip.on').length === 9);
    await rowOf(0, 'File name').find('select').setValue(nName);
    cfg = await ui.untilDb(`select tools from tables where id = '${tNew}'`, (x) => x[0]?.tools?.file_drop?.steps?.[0]?.map?.name === nName);
    check('picking a field for an output writes the mapping into THAT step', cfg[0].tools.file_drop.steps[0].map.name === nName);
    await rowOf(0, 'Kind').find('button.mini').trigger('click');
    const kindField = await ui.untilDb(`select id, type, options from fields where table_id = '${tNew}' and key = 'kind'`, (x) => x.length === 1);
    check('"+ field" on a select output makes a select WITH the analyzer\'s choices…', kindField.length === 1 && kindField[0].type === 'select' && JSON.stringify(kindField[0].options.choices) === JSON.stringify(['file', 'bundle', 'sequence', 'channel_set']), JSON.stringify(kindField));
    cfg = await ui.untilDb(`select tools from tables where id = '${tNew}'`, (x) => x[0]?.tools?.file_drop?.steps?.[0]?.map?.kind === kindField[0]?.id);
    check('…and maps it', cfg[0].tools.file_drop.steps[0].map.kind === kindField[0].id);
    await stepCard(1).findAll('.chip').find((c: any) => c.text() === 'audio')!.trigger('click');
    cfg = await ui.untilDb(`select tools from tables where id = '${tNew}'`, (x) => !!x[0]?.tools?.file_drop?.steps?.[1]?.runs_on);
    check('clicking the "audio" chip on ffprobe writes an EXPLICIT runs_on of video only', JSON.stringify(cfg[0].tools.file_drop.steps[1].runs_on) === JSON.stringify({ media: ['video'] }), JSON.stringify(cfg[0].tools.file_drop.steps[1]));
    check('…and a "default" button appears to take it back', stepCard(1).findAll('button.mini').some((b: any) => b.text() === 'default'));
    await w.find('.ts .tools .add select').setValue('hash-xxh3');
    await w.find('.ts .tools .add button').trigger('click');
    cfg = await ui.untilDb(`select tools from tables where id = '${tNew}'`, (x) => x[0]?.tools?.file_drop?.steps?.length === 3);
    check('"Add a step" appends an analyzer with an empty map', cfg[0].tools.file_drop.steps[2].analyzer === 'hash-xxh3' && Object.keys(cfg[0].tools.file_drop.steps[2].map).length === 0);
    await stepCard(2).find('button[title="Run earlier"]').trigger('click');
    cfg = await ui.untilDb(`select tools from tables where id = '${tNew}'`, (x) => x[0]?.tools?.file_drop?.steps?.[1]?.analyzer === 'hash-xxh3');
    check('↑ moves a step earlier; the order IS the recipe', cfg[0].tools.file_drop.steps.map((s: any) => s.analyzer).join() === 'filesystem,hash-xxh3,ffprobe');
    await stepCard(1).find('button[title="Remove this step"]').trigger('click');
    cfg = await ui.untilDb(`select tools from tables where id = '${tNew}'`, (x) => x[0]?.tools?.file_drop?.steps?.length === 2);
    check('× removes it', cfg[0].tools.file_drop.steps.map((s: any) => s.analyzer).join() === 'filesystem,ffprobe');

    console.log('\nT5b. The Summary and JSON views of the same recipe');
    await w.findAll('.ts .tools .view').find((b: any) => b.text() === 'Summary')!.trigger('click');
    check('Summary is the recipe as sentences a reader can check against the table', await until(() => w.find('.ts .summary').exists()) && /1\. For everything: Filesystem → Path → Path, File name → Title, Kind → Kind\./.test(w.find('.ts .summary').text()) && /2\. If video: ffprobe → nothing mapped\./.test(w.find('.ts .summary').text()), w.find('.ts .summary').text());
    await w.findAll('.ts .tools .view').find((b: any) => b.text() === 'JSON')!.trigger('click');
    check('JSON shows the stored recipe verbatim, and says it is valid', await until(() => w.find('.ts .json textarea').exists()) && JSON.parse((w.find('.ts .json textarea').element as HTMLTextAreaElement).value).steps[0].map.name === nName && /valid/.test(w.find('.ts .json-foot').text()));
    const ta = w.find('.ts .json textarea');
    await ta.setValue(JSON.stringify({ steps: [{ analyzer: 'filesystem', map: { path: pathRow.id } }, { analyzer: 'ffprobe', map: { width: nName } }] }));
    await ta.trigger('input');
    check('a draft that breaks the rule is refused live, Save disabled', await until(() => /cannot be written/.test(w.find('.ts .json-foot').text())) && (w.find('.ts .json-foot button').element as HTMLButtonElement).disabled);
    await ta.setValue(JSON.stringify({ steps: [{ analyzer: 'filesystem', map: { path: pathRow.id } }, { analyzer: 'ffprobe', runs_on: { media: ['video', 'audio', 'other'] }, map: {} }] }, null, 2));
    await ta.trigger('input');
    check('a valid draft enables Save', await until(() => /valid/.test(w.find('.ts .json-foot').text())) && !(w.find('.ts .json-foot button').element as HTMLButtonElement).disabled);
    await w.find('.ts .json-foot button').trigger('click');
    cfg = await ui.untilDb(`select tools from tables where id = '${tNew}'`, (x) => JSON.stringify(x[0]?.tools?.file_drop?.steps?.[1]?.runs_on?.media) === JSON.stringify(['video', 'audio', 'other']));
    check('Save writes the JSON as the recipe — the escape hatch is real', !('name' in cfg[0].tools.file_drop.steps[0].map) && cfg[0].tools.file_drop.steps[1].runs_on.media.includes('other'));
    await w.findAll('.ts .tools .view').find((b: any) => b.text() === 'Steps')!.trigger('click');
    check('…and the Steps view reflects it: "other" is now lit on ffprobe', await until(() => stepCard(1).findAll('.chip.on').map((c: any) => c.text()).includes('other')));
    await w.find('.ts .tools input[type=checkbox]').setValue(false);
    cfg = await ui.untilDb(`select tools from tables where id = '${tNew}'`, (x) => JSON.stringify(x[0]?.tools) === '{}');
    check('turning it off removes the recipe; the fields stay', JSON.stringify(cfg[0].tools) === '{}' && (await pool.query(`select 1 from fields where table_id = $1 and key = 'kind'`, [tNew])).rowCount === 1);
    check('no error banner', !w.find('.banner.error').exists());
    await sleep(50);
  } finally {
    await ui.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('SUITE ABORTED', e); process.exit(1); });
