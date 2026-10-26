/**
 * The Resolve timeline tool in the app (RESOLVE-BRIEF.md R3 + R5, and the R2
 * wire): Table settings' second switch and its one-step mapping editor, the
 * "Ingest info from Resolve…" item on a grid row, a canvas card and a kanban card,
 * the timeline picker, and the read-only readout this build stops at — all
 * through the real app and server, with the desktop shell FAKED (`__TAURI__`),
 * as test/filedrop.ts does.
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
        case 'resolve_read': return readOf(args.timeline);
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
    const fName = randomUUID(), fRate = randomUUID(), fTracks = randomUUID(), fStatus = randomUUID(), fPath = randomUUID(), fFName = randomUUID(), fPlain = randomUUID();
    const oev3 = randomUUID(), oev2 = randomUUID(), plainRec = randomUUID();
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const setup = await post([
      { type: 'table.create', id: tEdits, name: 'Edits' }, { type: 'table.create', id: tFiles, name: 'Files' }, { type: 'table.create', id: tPlain, name: 'Notes' },
      { type: 'field.create', id: fName, tableId: tEdits, name: 'Name', key: 'name', fieldType: 'text' }, pos(fName, 0),
      { type: 'field.create', id: fRate, tableId: tEdits, name: 'FPS', key: 'frame_rate', fieldType: 'number' }, pos(fRate, 1),
      { type: 'field.create', id: fTracks, tableId: tEdits, name: 'Audio tracks', key: 'audio_tracks', fieldType: 'structured', options: { shape: 'timeline_audio' } }, pos(fTracks, 2),
      { type: 'field.create', id: fStatus, tableId: tEdits, name: 'Status', key: 'status', fieldType: 'select', options: { choices: ['cutting', 'locked'] } }, pos(fStatus, 3),
      { type: 'field.create', id: fFName, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(fFName, 0),
      { type: 'field.create', id: fPath, tableId: tFiles, name: 'Path', key: 'path', fieldType: 'file_path' }, pos(fPath, 1),
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
    check('switching it on stores its ONE step, mapped by key to the fields that accept it (FPS ← frame_rate, Audio tracks ← audio_tracks)', cfg[0].tools.resolve.steps.length === 1 && map.frame_rate === fRate && map.audio_tracks === fTracks && Object.keys(map).length === 2, JSON.stringify(cfg[0].tools));
    check('…and creates NO field (nothing is required of this tool)', (await pool.query(`select count(*)::int n from fields where table_id = $1`, [tEdits])).rows[0].n === 4);
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
    await post([{ type: 'field.create', id: fLink, tableId: tEdits, name: 'Mix files', key: 'mix_files', fieldType: 'link', options: { target_table_id: tFiles } }]);
    check('once a link field exists, Audio files offers it, saying where it leads', await until(() => outRow('Audio files').findAll('option').some((o: any) => o.text() === 'Mix files (link → Files)')), outRow('Audio files').text());
    check('…while the other outputs do not offer the link field', !outRow('Project').findAll('option').some((o: any) => /Mix files/.test(o.text())));
    await sec().findAll('.view').find((b: any) => b.text() === 'Summary')!.trigger('click');
    check('the Summary says it in a sentence', await until(() => /^1\. For the timeline picked, when asked from the record: python3 3\.11\.5 → Timeline name → Name, Frame rate → FPS, Duration → Duration, Audio tracks → Audio tracks\.$/.test(sec().find('.summary p').text())), sec().find('.summary p').text());
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

    console.log('\nRU3. The picker, then the readout — nothing written');
    await go(tEdits, 2);
    const before = await mutations();
    calls.length = 0; dialogs.seen.length = 0; dialogs.bodies.length = 0;
    menu = await rowMenuFor('EP101_OEV3');
    await menu.find('.resolve-ingest').trigger('click');
    check('the shell is asked for the timelines first', await until(() => calls.some((c) => c.cmd === 'resolve_timelines')));
    check('a picker asks which timeline, naming the record, the project and the Resolve version', await until(() => dialogs.seen.includes('Ingest info from Resolve')) && /Onto “EP101_OEV3”/.test(dialogs.bodies[0]) && /from project “Duke” · Resolve 20\.1\.0/.test(dialogs.bodies[0]), dialogs.bodies[0]);
    check('left as it was, it reads the CURRENT timeline', await until(() => calls.some((c) => c.cmd === 'resolve_read')) && calls.find((c) => c.cmd === 'resolve_read')!.args.timeline === 'EP101_OEV3', JSON.stringify(calls));
    check('the readout opens, titled with the timeline', await until(() => dialogs.seen.includes('Read from Resolve: “EP101_OEV3”')), dialogs.seen.join(' | '));
    const body = dialogs.bodies[dialogs.seen.indexOf('Read from Resolve: “EP101_OEV3”')] ?? '';
    check('…each output with its value and where it is mapped', /Timeline name: EP101_OEV3 +→ Name/.test(body) && /Frame rate: 23\.976 +→ FPS/.test(body) && /Start timecode: 00:59:30:00 +\(not mapped\)/.test(body) && /Audio files: 2 file paths +\(not mapped\)/.test(body), body);
    check('…the tracks summarised, and the derived layout', /Audio tracks: A1 stereo · A2 5\.1 \(2\) +→ Audio tracks/.test(body) && /Audio layout: 2 tracks \/ 8 ch \(2\.0, 5\.1\)/.test(body), body);
    check('…every clip with its in and out, and its file or "no file"', /tone +00:58:30:00 – 00:59:30:00 +\(1440 fr\) +· no file/.test(body) && /\/mnt\/post\/EP101_Mix_51\.wav/.test(body), body);
    check('…the raw numbers as Resolve said them, and the reader\'s warnings', /start frame 85680, end frame 161656, rate "23\.976", drop "0"/.test(body) && /⚠ 1 clip\(s\): Resolve's GetEnd/.test(body), body);
    check('…and that nothing was written', /Nothing was written/.test(body));
    await sleep(300);
    check('nothing WAS written: no mutation, the record unchanged', (await mutations()) === before && (await pool.query(`select data from records where id = $1`, [oev3])).rows[0].data.audio_tracks === undefined);

    calls.length = 0;
    dialogs.choice = 'EP102_OEV1';
    menu = await rowMenuFor('EP101_OEV3');
    await menu.find('.resolve-ingest').trigger('click');
    check('picking another timeline reads THAT one', await until(() => calls.some((c) => c.cmd === 'resolve_read')) && calls.find((c) => c.cmd === 'resolve_read')!.args.timeline === 'EP102_OEV1', JSON.stringify(calls));
    await until(() => !w.find('.dlg').exists(), 3000);

    calls.length = 0;
    dialogs.cancelNext = true;
    menu = await rowMenuFor('EP101_OEV3');
    await menu.find('.resolve-ingest').trigger('click');
    await until(() => calls.some((c) => c.cmd === 'resolve_timelines'));
    await sleep(300);
    check('Cancel on the picker reads nothing', !calls.some((c) => c.cmd === 'resolve_read'));

    timelinesError = 'Resolve did not answer. Is it running? External scripting must be on';
    menu = await rowMenuFor('EP101_OEV3');
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
    ]);
    win.location.hash = `#/all/canvas/${board}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    const card = () => w.findAll('.card').find((c: any) => /EP101_OEV3/.test(c.text()));
    if (await until(() => !!card(), 8000)) {
      await card()!.trigger('contextmenu', { clientX: 120, clientY: 120 });
      check('the canvas card menu offers it', await until(() => w.find('.ctx .resolve-ingest').exists()));
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
    const kcard = () => w.findAll('.kanban .kcard').find((k: any) => /EP101_OEV3/.test(k.find('.kcard-title').text()));
    if (await until(() => !!kcard(), 8000)) {
      await kcard()!.trigger('contextmenu', { clientX: 60, clientY: 60 });
      check('a kanban card has a menu now, with the item', await until(() => w.find('.kcard-menu .resolve-ingest').exists()));
      calls.length = 0;
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
