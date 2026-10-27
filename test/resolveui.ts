/**
 * The Resolve timeline tool in the app (RESOLVE-BRIEF.md R3 + R5, and the R2
 * wire): Table settings' second switch and its one-step mapping editor, the
 * "Ingest info from Resolve…" item on a grid row, a canvas card and a kanban card,
 * the timeline picker, the WRITE (R4: the values, the derived layout, the files
 * linked by path into the general Inputs link — added, never removed — and the
 * overwrite dialog), and the live warning on an audio input that is not on the
 * timeline (contract/resolveLinks.ts) — all through the real app and server, with
 * the desktop shell FAKED (`__TAURI__`), as test/filedrop.ts does.
 *
 * What the fake cannot tell: whether the real script's API calls are right for
 * the owner's Resolve. That is src-tauri/src/tools/resolve.rs's fake-module tests
 * plus his eyes (RESOLVE-BRIEF.md R6).
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const calls: Array<{ cmd: string; args: any }> = [];
let timelinesError = '';
let readDelay = 0;
const project = { version: '20.1.0', project: 'Duke', timelines: ['EP101_OEV2', 'EP101_OEV3', 'EP102_OEV1'], current: 'EP101_OEV3' };
const readOf = (name: string) => ({
  outputs: {
    'resolve.version': '20.1.0', project: 'Duke', timeline_name: name, dimensions: '1920×1080', width: 1920, height: 1080,
    frame_rate: 23.976, drop_frame: false, start_timecode: '00:59:30:00', end_timecode: '01:52:15:16', duration: '00:52:45:16', duration_frames: 75976,
    audio_tracks: { tracks: [
      { index: 1, name: 'A1', format: 'stereo', clips: [{ name: 'EP101_Mix_ST.wav', path: '/mnt/post/EP101_Mix_ST.wav', start: '00:59:30:00', end: '01:52:15:16', frames: 75976 }] },
      { index: 2, name: 'A2', format: '5.1', clips: [{ name: 'tone', start: '00:58:30:00', end: '00:59:30:00', frames: 1440 }, { name: 'EP101_Mix_51.wav', path: '/mnt/post/EP101_Mix_51.wav', start: '00:59:30:00', end: '01:52:15:16', frames: 75976 }] },
    ] },
  },
  problems: ['1 clip(s): Resolve\'s GetEnd is not start + duration; the ends written are start + duration'],
  raw: { start_frame: 85680, end_frame: 161656, rate: '23.976', drop: '0' },
});
const shell = {
  core: {
    async invoke(cmd: string, args: any = {}) {
      calls.push({ cmd, args });
      switch (cmd) {
        case 'tools_available': return { version: '0.1.0-test', tools: ['file_drop', 'reveal', 'resolve'], analyzers: { filesystem: '0.1.0-test', ffprobe: '7.1', resolve: '3.11.5' }, platform: 'linux' };
        case 'resolve_timelines': if (timelinesError) throw timelinesError; return project;
        case 'resolve_read': if (readDelay) await sleep(readDelay); return readOf(args.timeline);
        default: throw new Error(`fake shell: unknown command ${cmd}`);
      }
    },
  },
  webview: { getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) },
};

async function main() {
  (globalThis as any).__TAURI__ = shell;
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8823));
  const { w, win, pool, until, untilDb, post, nav } = ui;
  const dialogs = nav.dialogs;
  try {
    const tEdits = randomUUID(), tFiles = randomUUID(), tPlain = randomUUID();
    const fName = randomUUID(), fRate = randomUUID(), fTracks = randomUUID(), fLayout = randomUUID(), fStatus = randomUUID(), fPath = randomUUID(), fFName = randomUUID(), fMedia = randomUUID(), fPlain = randomUUID();
    const oev3 = randomUUID(), oev2 = randomUUID(), plainRec = randomUUID();
    const fileST = randomUUID(), fileV2 = randomUUID(), fileTexted = randomUUID(), fileNoPath = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const setup = await post([
      { type: 'table.create', id: tEdits, name: 'Edits' }, { type: 'table.create', id: tFiles, name: 'Files' }, { type: 'table.create', id: tPlain, name: 'Notes' },
      { type: 'field.create', id: fName, tableId: tEdits, name: 'Name', key: 'name', fieldType: 'text' }, pos(fName, 0),
      { type: 'field.create', id: fRate, tableId: tEdits, name: 'FPS', key: 'frame_rate', fieldType: 'number' }, pos(fRate, 1),
      { type: 'field.create', id: fTracks, tableId: tEdits, name: 'Audio tracks', key: 'audio_tracks', fieldType: 'structured', options: { shape: 'timeline_audio' } }, pos(fTracks, 2),
      { type: 'field.create', id: fStatus, tableId: tEdits, name: 'Status', key: 'status', fieldType: 'select', options: { choices: ['cutting', 'locked'] } }, pos(fStatus, 3),
      { type: 'field.create', id: fLayout, tableId: tEdits, name: 'Audio layout', key: 'audio_layout', fieldType: 'structured', options: { shape: 'audio_layout' } }, pos(fLayout, 4),
      { type: 'field.create', id: fFName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(fFName, 0),
      { type: 'field.create', id: fPath, tableId: tFiles, name: 'Path', key: 'path', fieldType: 'file_path' }, pos(fPath, 1),
      { type: 'field.create', id: fMedia, tableId: tFiles, name: 'Media', key: 'media', fieldType: 'select', options: { choices: ['video', 'audio', 'image', 'document', 'other'] } }, pos(fMedia, 2),
      // Files has File drop, mapping Path and Media: the columns the Resolve tool matches and checks by.
      { type: 'table.update', id: tFiles, tools: { file_drop: { steps: [{ analyzer: 'filesystem', map: { path: fPath, media: fMedia } }] } } },
      { type: 'record.create', id: fileST, tableId: tFiles, data: { name: 'EP101_Mix_ST.wav', path: '/mnt/post/EP101_Mix_ST.wav', media: 'audio' } },
      { type: 'record.create', id: fileV2, tableId: tFiles, data: { name: 'EP101_Mix_v2.wav', path: '/mnt/post/EP101_Mix_v2.wav', media: 'audio' } },
      { type: 'record.create', id: fileTexted, tableId: tFiles, data: { name: 'EP101_Texted.mov', path: '/mnt/post/EP101_Texted.mov', media: 'video' } },
      { type: 'record.create', id: fileNoPath, tableId: tFiles, data: { name: 'EP101_ME.wav', media: 'audio' } },
      { type: 'field.create', id: fPlain, tableId: tPlain, name: 'Name', key: 'name', fieldType: 'text' }, pos(fPlain, 0),
      { type: 'record.create', id: oev3, tableId: tEdits, data: { name: 'EP101_OEV3', status: 'locked' } },
      { type: 'record.create', id: oev2, tableId: tEdits, data: { name: 'EP101_OEV2', status: 'cutting' } },
      { type: 'record.create', id: plainRec, tableId: tPlain, data: { name: 'a note' } },
    ]);
    check('fixture accepted', setup.status === 200, (await setup.text()).slice(0, 200));

    const go = async (tableId: string, rows: number) => { win.location.hash = `#/all/table/${tableId}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange')); await until(() => w.find('.gridview').exists() && w.findAll('.gridview tr.row').length === rows, 8000); };
    const rowNamed = (name: string) => w.findAll('.gridview tr.row').find((r: any) => r.findAll('td')[1].text() === name);
    const rowMenuFor = async (name: string) => { await rowNamed(name).trigger('contextmenu', { clientX: 50, clientY: 50 }); await until(() => w.find('.row-menu').exists()); return w.find('.row-menu'); };
    const closeMenus = async () => { win.document.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(50); };
    const noticesText = () => w.findAll('.desk-notice').map((n: any) => n.text()).join(' | ');
    const mutations = async () => Number((await pool.query(`select count(*)::int n from mutations`)).rows[0].n);

    /* ── R3: Table settings ─────────────────────────────────────────────── */
    console.log('\nRU1. Table settings: the second switch');
    await go(tEdits, 2);
    await w.find(`[data-table="${tEdits}"] .act[title="Table settings"]`).trigger('click');
    await until(() => w.findAll('.ts .tools').length === 2);
    const sec = () => w.find('.ts .tools.tool-resolve');
    check('Desktop tools has TWO switches, File drop then Resolve timeline, both off', w.findAll('.ts .tools b').map((b: any) => b.text()).slice(0, 2).join() === 'File drop,Resolve timeline'
      && w.findAll('.ts .tools > label.on input').every((i: any) => !(i.element as HTMLInputElement).checked), w.findAll('.ts .tools b').map((b: any) => b.text()).join());
    check('one "Desktop tools" heading, not one per tool', w.findAll('.ts .tools h4').length === 1);
    check('the hint says how it is used: right-click a record in the desktop app', /right-click a record → “Ingest info from Resolve…”/.test(sec().find('.hint').text()));
    await sec().find('label.on input').setValue(true);
    const cfg = await untilDb(`select tools from tables where id = '${tEdits}'`, (x) => !!x[0]?.tools?.resolve);
    const map = cfg[0].tools.resolve.steps[0].map;
    check('switching it on stores its ONE step, mapped by key to the fields that accept it (FPS ← frame_rate, Audio tracks, Audio layout)', cfg[0].tools.resolve.steps.length === 1 && map.frame_rate === fRate && map.audio_tracks === fTracks && map.audio_layout === fLayout && Object.keys(map).length === 3, JSON.stringify(cfg[0].tools));
    check('…and creates NO field (nothing is required of this tool)', (await pool.query(`select count(*)::int n from fields where table_id = $1`, [tEdits])).rows[0].n === 5);
    check('File drop stays off', !cfg[0].tools.file_drop);
    await until(() => sec().find('.step').exists());
    check('one step card: "Resolve timeline", runs python3 3.11.5 (the version the handshake reported)', sec().findAll('.step').length === 1 && sec().find('.step b').text() === 'Resolve timeline' && sec().find(".prog code").text() === "python3" && sec().find(".prog .ver").text() === "3.11.5", sec().find('.prog').text());
    check('…with NO reorder/remove buttons, no "runs on" or "when", and no "Add a step"', !sec().find('.step-head button').exists() && !sec().find('.runs-on').exists() && !sec().find('.add').exists());
    check('File drop\'s section is untouched by any of that', !w.find('.ts .tools.tool-file_drop .step').exists());
    const outRow = (name: string) => sec().findAll('.row').find((r: any) => r.find('.oname').text() === name)!;
    check('every output has a row, and no field is starred required', sec().findAll('.row').length === 15 && !sec().find('.req').exists(), String(sec().findAll('.row').length));
    check('Audio files (a link output) has no "+ field" — it says to make a link field first', !outRow('Audio files').find('button').exists() && /make a link field first/.test(outRow('Audio files').text()));
    await outRow('Timeline name').find('select').setValue(fName);
    check('mapping an output writes the recipe', (await untilDb(`select tools from tables where id = '${tEdits}'`, (x) => x[0]?.tools?.resolve?.steps[0].map.timeline_name === fName))[0].tools.resolve.steps[0].map.timeline_name === fName);
    await outRow('Duration').find('button').trigger('click');
    const made = await untilDb(`select id, type from fields where table_id = '${tEdits}' and key = 'duration'`, (x) => x.length === 1);
    check('"+ field" makes a field for an output and maps it', made[0]?.type === 'text' && (await untilDb(`select tools from tables where id = '${tEdits}'`, (x) => !!x[0]?.tools?.resolve?.steps[0].map.duration))[0].tools.resolve.steps[0].map.duration === made[0].id);
    const fLink = randomUUID();
    await post([{ type: 'field.create', id: fLink, tableId: tEdits, name: 'Inputs', key: 'inputs', fieldType: 'link', options: { target_table_id: tFiles } }]);
    check('once a link field exists, Audio files offers it, saying where it leads', await until(() => outRow('Audio files').findAll('option').some((o: any) => o.text() === 'Inputs (link → Files)')), outRow('Audio files').text());
    check('…while the other outputs do not offer the link field', !outRow('Project').findAll('option').some((o: any) => /Inputs/.test(o.text())));
    await outRow('Audio files').find('select').setValue(fLink);
    check('Audio files → Inputs: the owner\'s general inputs link, not a field of its own (Oct 26)', (await untilDb(`select tools from tables where id = '${tEdits}'`, (x) => x[0]?.tools?.resolve?.steps[0].map.audio_files === fLink))[0].tools.resolve.steps[0].map.audio_files === fLink);
    await sec().findAll('.view').find((b: any) => b.text() === 'Summary')!.trigger('click');
    check('the Summary says it in a sentence', await until(() => /^1\. For the timeline picked, when asked from the record: python3 3\.11\.5 → Timeline name → Name, Frame rate → FPS, Duration → Duration, Audio tracks → Audio tracks, Audio layout → Audio layout, Audio files → Inputs\.$/.test(sec().find('.summary p').text())), sec().find('.summary p').text());
    await sec().findAll('.view').find((b: any) => b.text() === 'JSON')!.trigger('click');
    await sec().find('textarea').setValue(JSON.stringify({ steps: [{ analyzer: 'resolve', map: {} }, { analyzer: 'resolve', map: {} }] }));
    check('the JSON view refuses a second step, by the shared rule', /exactly one step/.test(sec().find('.problem').text()), sec().find('.problem').text());
    await sec().findAll('.view').find((b: any) => b.text() === 'Steps')!.trigger('click');
    await w.find('.ts .close, .ts button[title="Close"]').exists() && await w.find('.ts .close, .ts button[title="Close"]').trigger('click');

    /* ── R5: the menu item ──────────────────────────────────────────────── */
    console.log('\nRU2. "Ingest info from Resolve…" on a grid row');
    await go(tEdits, 2);
    let menu = await rowMenuFor('EP101_OEV3');
    check('the row menu offers it', menu.find('.resolve-ingest').exists() && menu.find('.resolve-ingest').text() === 'Ingest info from Resolve…');
    await closeMenus();
    (globalThis as any).__TAURI__ = undefined;
    menu = await rowMenuFor('EP101_OEV3');
    check('in a BROWSER it is not there (only the desktop app can talk to Resolve)', !menu.find('.resolve-ingest').exists());
    await closeMenus();
    (globalThis as any).__TAURI__ = shell;
    await go(tPlain, 1);
    menu = await rowMenuFor('a note');
    check('on a table without the tool it is not there', !menu.find('.resolve-ingest').exists());
    await closeMenus();

    console.log('\nRU3. The picker, then the WRITE: an empty record just imports');
    await go(tEdits, 2);
    const ths = () => w.findAll('.gridview thead .th-name').map((x: any) => x.text());
    const cellOf = (name: string, col: string) => rowNamed(name).findAll('td')[ths().indexOf(col) + 1];
    const lastVia = async () => (await pool.query(`select via from mutations order by seq desc limit 1`)).rows[0]?.via;
    const linksOf = async (id: string) => (await pool.query(`select to_record from links where field_id = $1 and from_record = $2`, [fLink, id])).rows.map((r) => r.to_record).sort();
    // Linked BY HAND before any ingest: a video input, an audio mix that is NOT on the timeline, and an audio file with no path.
    await post([
      { type: 'link.add', id: randomUUID(), fieldId: fLink, fromRecord: oev3, toRecord: fileTexted },
      { type: 'link.add', id: randomUUID(), fieldId: fLink, fromRecord: oev3, toRecord: fileV2 },
      { type: 'link.add', id: randomUUID(), fieldId: fLink, fromRecord: oev3, toRecord: fileNoPath },
    ]);
    await until(() => cellOf('EP101_OEV3', 'Inputs').findAll('.pill').length === 3);
    check('before an ingest there is NO warning on the hand-made links — nothing to check against yet', !cellOf('EP101_OEV3', 'Inputs').find('.cell-verdict').exists() && !cellOf('EP101_OEV3', 'Inputs').find('.pill.warned').exists());
    calls.length = 0; dialogs.seen.length = 0; dialogs.bodies.length = 0;
    menu = await rowMenuFor('EP101_OEV3');
    await menu.find('.resolve-ingest').trigger('click');
    check('the shell is asked for the timelines first', await until(() => calls.some((c) => c.cmd === 'resolve_timelines')));
    check('a picker asks which timeline, naming the record, the project and the Resolve version', await until(() => dialogs.seen.includes('Ingest info from Resolve')) && /Onto “EP101_OEV3”/.test(dialogs.bodies[0]) && /from project “Duke” · Resolve 20\.1\.0/.test(dialogs.bodies[0]), dialogs.bodies[0]);
    check('left as it was, it reads the CURRENT timeline', await until(() => calls.some((c) => c.cmd === 'resolve_read')) && calls.find((c) => c.cmd === 'resolve_read')!.args.timeline === 'EP101_OEV3', JSON.stringify(calls));
    const row3 = await untilDb(`select data from records where id = '${oev3}'`, (r) => r[0]?.data?.audio_tracks !== undefined);
    const d3 = row3[0].data;
    check('the mapped values are written: name, FPS, duration, the tracks, and the layout DERIVED from them', d3.name === 'EP101_OEV3' && d3.frame_rate === 23.976 && d3.duration === '00:52:45:16' && d3.audio_tracks.tracks.length === 2
      && JSON.stringify(d3.audio_layout) === JSON.stringify({ tracks: [{ name: 'A1', channels: ['L', 'R'] }, { name: 'A2', channels: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'] }] }), JSON.stringify(d3));
    check('…and nothing unmapped (no start timecode, no project) and nothing untouched (Status stays)', d3.start_timecode === undefined && d3.project === undefined && d3.status === 'locked');
    check('no overwrite dialog on an empty record', !dialogs.seen.some((t) => /Overwrite/.test(t)), dialogs.seen.join(' | '));
    check('the batch is tagged via resolve', (await lastVia()) === 'resolve', String(await lastVia()));
    check('the mix on the timeline WITH a File record is linked into Inputs; the hand-made links are all still there', (await untilDb(`select count(*)::int n from links where field_id = '${fLink}' and from_record = '${oev3}'`, (r) => r[0]?.n === 4))[0].n === 4 && JSON.stringify(await linksOf(oev3)) === JSON.stringify([fileST, fileV2, fileTexted, fileNoPath].sort()), JSON.stringify(await linksOf(oev3)));
    check('a notice sums it up, and one names the clip path that has no File record (never created)', await until(() => /EP101_OEV3: Resolve done — 5 fields, 1 file linked/.test(noticesText()) && /not linked — no record of Files at \/mnt\/post\/EP101_Mix_51\.wav/.test(noticesText())), noticesText());
    check('…and the reader\'s own warning was passed on', /GetEnd/.test(noticesText()));
    check('no File record was created for it', (await pool.query(`select count(*)::int n from records where table_id = $1`, [tFiles])).rows[0].n === 4);

    console.log('\nRU3b. The warning on the Inputs that are not on the timeline');
    const inputsCell = () => cellOf('EP101_OEV3', 'Inputs');
    const pillOf = (name: string) => inputsCell().findAll('.pill').find((p: any) => p.text().includes(name));
    check('the Inputs CELL wears a ⚠, listing every reason', await until(() => inputsCell().find('.cell-verdict').exists()) && inputsCell().find('.cell-verdict').classes('warn') && /EP101_Mix_v2\.wav is an audio input but is not on the timeline as last read from Resolve/.test(inputsCell().find('.cell-verdict').attributes('title') ?? '') && /EP101_ME\.wav is an audio input with no path/.test(inputsCell().find('.cell-verdict').attributes('title') ?? ''), inputsCell().find('.cell-verdict').attributes('title'));
    check('the PILL of the mix not on the timeline is marked, with its reason first in the tooltip', pillOf('EP101_Mix_v2.wav')!.classes('warned') && /^⚠ EP101_Mix_v2\.wav is an audio input but is not on the timeline/.test(pillOf('EP101_Mix_v2.wav')!.attributes('title') ?? ''), pillOf('EP101_Mix_v2.wav')!.attributes('title'));
    check('…so is the audio input with no path', pillOf('EP101_ME.wav')!.classes('warned'));
    check('the PICTURE input is not marked, nor is the mix that IS on the timeline', !pillOf('EP101_Texted.mov')!.classes('warned') && !pillOf('EP101_Mix_ST.wav')!.classes('warned'));
    await post([{ type: 'link.remove', fieldId: fLink, fromRecord: oev3, toRecord: fileV2 }, { type: 'link.remove', fieldId: fLink, fromRecord: oev3, toRecord: fileNoPath }]);
    check('unlink them and the marks go — nothing was stored, it is computed', await until(() => !inputsCell().find('.cell-verdict').exists() && inputsCell().findAll('.pill').length === 2));
    await post([{ type: 'link.add', id: randomUUID(), fieldId: fLink, fromRecord: oev3, toRecord: fileV2 }]);
    await until(() => inputsCell().find('.pill.warned').exists());
    await rowNamed('EP101_OEV3').find('.expand').trigger('click');
    await until(() => w.find('.record-panel .rp-title').text() === 'EP101_OEV3');
    const pField = (label: string) => w.findAll('.record-panel .rp-field').find((f: any) => f.find('.rp-name').text().replace(/[★⚠✓]/g, '').trim() === label);
    check('the tray shows the same: a ⚠ on the Inputs row and on the one pill', await until(() => !!pField('Inputs')?.find('.cmp-badge').exists()) && pField('Inputs').find('.cmp-badge').classes('warn') && pField('Inputs').findAll('.pill.warned').length === 1 && /Mix_v2/.test(pField('Inputs').find('.pill.warned').text()));

    console.log('\nRU3c. A second ingest onto a filled record asks before overwriting');
    calls.length = 0; dialogs.seen.length = 0; dialogs.bodies.length = 0;
    const mBefore = await mutations();
    dialogs.choice = 'EP102_OEV1';
    dialogs.cancelNext = false;
    readDelay = 300;                                 // room to arm the cancel for the SECOND dialog once the picker is answered
    menu = await rowMenuFor('EP101_OEV3');
    await menu.find('.resolve-ingest').trigger('click');
    // The autopilot answers the picker (with the choice) and then the overwrite confirm — we cancel that one.
    await until(() => calls.some((c) => c.cmd === 'resolve_read'));
    dialogs.cancelNext = true;
    readDelay = 0;
    check('picking another timeline reads THAT one', calls.find((c) => c.cmd === 'resolve_read')!.args.timeline === 'EP102_OEV1', JSON.stringify(calls));
    check('the overwrite dialog lists the ONE field that differs — the name — old → new, and says Cancel writes nothing', await until(() => dialogs.seen.some((t) => t === 'Overwrite 1 field on “EP101_OEV3”?')) && /Name · EP101_OEV3 → EP102_OEV1/.test(dialogs.bodies[dialogs.seen.findIndex((t) => /Overwrite/.test(t))]) && /Cancel writes nothing/.test(dialogs.bodies[dialogs.seen.findIndex((t) => /Overwrite/.test(t))]), dialogs.bodies.join(' || '));
    await until(() => !w.find('.dlg').exists(), 3000);
    await sleep(300);
    check('Cancel: nothing written, not even the equal fields, and a notice says so', (await mutations()) === mBefore && (await pool.query(`select data->>'name' n from records where id = $1`, [oev3])).rows[0].n === 'EP101_OEV3' && /EP101_OEV3: nothing written/.test(noticesText()), noticesText());
    dialogs.cancelNext = false;
    dialogs.choice = 'EP102_OEV1';
    menu = await rowMenuFor('EP101_OEV3');
    await menu.find('.resolve-ingest').trigger('click');
    check('Overwrite: written, in one batch via resolve', (await untilDb(`select data->>'name' n from records where id = '${oev3}'`, (r) => r[0]?.n === 'EP102_OEV1'))[0].n === 'EP102_OEV1' && (await lastVia()) === 'resolve');
    check('re-ingesting removed no link (the tool adds, never removes)', JSON.stringify(await linksOf(oev3)) === JSON.stringify([fileST, fileV2, fileTexted].sort()), JSON.stringify(await linksOf(oev3)));
    dialogs.choice = '';

    calls.length = 0;
    dialogs.cancelNext = true;
    menu = await rowMenuFor('EP101_OEV2');
    await menu.find('.resolve-ingest').trigger('click');
    await until(() => calls.some((c) => c.cmd === 'resolve_timelines'));
    await sleep(300);
    check('Cancel on the picker reads nothing', !calls.some((c) => c.cmd === 'resolve_read'));
    dialogs.cancelNext = false;

    timelinesError = 'Resolve did not answer. Is it running? External scripting must be on';
    menu = await rowMenuFor('EP101_OEV2');
    await menu.find('.resolve-ingest').trigger('click');
    check('when Resolve is not there, a notice says what the shell said', await until(() => /Resolve — Resolve did not answer/.test(noticesText())), noticesText());
    timelinesError = '';

    /* ── the canvas card and the kanban card ─────────────────────────────── */
    console.log('\nRU4. The same item on a canvas card and a kanban card');
    // The canvas: a board with the record placed on it.
    const tBoards = randomUUID(), fBoardName = randomUUID(), board = randomUUID();
    await post([
      { type: 'table.create', id: tBoards, name: 'Boards', kind: 'canvas' },
      { type: 'field.create', id: fBoardName, tableId: tBoards, name: 'Name', key: 'name', fieldType: 'text' },
      { type: 'record.create', id: board, tableId: tBoards, data: { name: 'EP101 board' } },
      { type: 'placement.add', id: randomUUID(), canvasId: board, recordId: oev3, x: 100, y: 100, w: null, h: null, z: 1 },
      // Cards show their first few fields by default; Inputs was added later, so put it on the card.
      { type: 'canvas.update', id: board, config: { cardFields: { [tEdits]: [fRate, fTracks, fLink] } } },
    ]);
    dialogs.choice = 'EP102_OEV1';                   // the record already holds EP102_OEV1: no overwrite dialog on these ingests
    win.location.hash = `#/all/canvas/${board}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    const card = () => w.findAll('.card').find((c: any) => /EP102_OEV1/.test(c.text()));
    if (await until(() => !!card(), 8000)) {
      await card()!.trigger('contextmenu', { clientX: 120, clientY: 120 });
      check('the canvas card menu offers it', await until(() => w.find('.ctx .resolve-ingest').exists()));
      check('the card wears the warning too: on the Inputs row, and inside the one pill', card()!.find('.card-warn').exists() && card()!.findAll('.pill.warned').length === 1, card()!.text());
      calls.length = 0;
      await w.find('.ctx .resolve-ingest').trigger('click');
      check('…and it runs the same picker and read', await until(() => calls.some((c) => c.cmd === 'resolve_read')));
      await until(() => !w.find('.dlg').exists(), 3000);
    } else check('the canvas card appears', false, w.find('.canvas').text().slice(0, 200));

    await go(tEdits, 2);
    const viewMenu = () => w.find('.gridview .view-menu');
    (viewMenu().element as HTMLDetailsElement).open = true;
    dialogs.text = 'By status';
    await viewMenu().find('.new-board').trigger('click');
    const kcard = () => w.findAll('.kanban .kcard').find((k: any) => /EP102_OEV1/.test(k.find('.kcard-title').text()));
    if (await until(() => !!kcard(), 8000)) {
      await kcard()!.trigger('contextmenu', { clientX: 60, clientY: 60 });
      check('a kanban card has a menu now, with the item', await until(() => w.find('.kcard-menu .resolve-ingest').exists()));
      calls.length = 0;
      dialogs.choice = 'EP102_OEV1';               // (set here, not earlier: the new-board dialog has a select of its own that would eat it)
      await w.find('.kcard-menu .resolve-ingest').trigger('click');
      check('…which runs the same picker and read', await until(() => calls.some((c) => c.cmd === 'resolve_read')));
      check('…and the menu closes', !w.find('.kcard-menu').exists());
      await until(() => !w.find('.dlg').exists(), 3000);
      (globalThis as any).__TAURI__ = undefined;
      await kcard()!.trigger('contextmenu', { clientX: 60, clientY: 60 });
      await sleep(100);
      check('in a browser a kanban card has no menu (the right-click is left alone)', !w.find('.kcard-menu').exists());
      (globalThis as any).__TAURI__ = shell;
      // On Linux the menu opens on the PRESS; the pointer then travels to the menu
      // with the button still down — which must not drag the card off its stack.
      const PE = (win as any).PointerEvent ?? (win as any).MouseEvent;
      await kcard()!.trigger('pointerdown', { button: 2, clientX: 60, clientY: 60 });
      win.dispatchEvent(new PE('pointermove', { bubbles: true, buttons: 2, clientX: 90, clientY: 90 }));
      win.dispatchEvent(new PE('pointermove', { bubbles: true, buttons: 2, clientX: 200, clientY: 160 }));
      await sleep(50);
      // (recordDrag.ts ignores any button but the left — this holds that in place for the menu.)
      check('a RIGHT-button press, then a move, does not lift the card for a drag', !w.find('.kanban.dragging').exists() && !w.find('.kcard.lifted').exists());
      win.dispatchEvent(new PE('pointerup', { bubbles: true, clientX: 200, clientY: 160 }));
      await sleep(50);
    } else check('the kanban board appears', false);
  } finally {
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await ui.close();
  }
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
