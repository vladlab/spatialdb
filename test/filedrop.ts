/**
 * File drop, the client side (client/tools/fileDrop.ts, client/desktop.ts), with
 * the native shell FAKED: `window.__TAURI__` here is a stub whose `classify`,
 * `probe`, `fingerprint` and `reveal` return canned answers and record what they
 * were asked. What is real: the app, the store, the server, the database — so the
 * three stages, the matching rule, the tagging, and one-Ctrl+Z-per-drop are
 * verified end to end. What no test here can verify: the actual Tauri window, its
 * drag-drop stream, and everything in src-tauri/ (cargo's own tests cover the pure
 * bits of probe.rs).
 */
import { randomUUID } from 'node:crypto';
import { mountApp, sleep } from './uiHarness.js';
import { boardsTableMutations } from './harness.js';
import type { Unit } from '../src/client/tools/fileDrop.js';
import { resolveMap } from '../src/contract/tools.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/* ── the fake shell ─────────────────────────────────────────────────────── */
const unit = (path: string, extra: Partial<Unit> = {}): Unit => ({
  kind: 'file', path, name: path.split('/').pop()!, extension: path.split('.').pop()!, media: 'video',
  manifest: { kind: 'file', size: 1000 }, file_count: 1, total_size: 1000, modified: '2026-09-27',
  probe_target: path, members: [], bundle_type: null, cpl_title: null, ...extra,
});
const calls: Array<{ cmd: string; args: any }> = [];
let probeDelay = 0;
let dropCb: ((e: { payload: any }) => void) | null = null;
const shell = {
  core: {
    async invoke(cmd: string, args: any = {}) {
      calls.push({ cmd, args });
      switch (cmd) {
        case 'tools_available': return { version: '0.1.0-test', tools: ['file_drop', 'reveal'], ffprobe: '7.1', ffmpeg: '7.1', platform: 'linux' };
        case 'classify': return (args.paths as string[]).map((p) => p.endsWith('.exr')
          ? unit(p.replace(/\/[^/]+$/, ''), { kind: 'sequence', name: 'plate', extension: 'exr', media: 'image', manifest: { kind: 'sequence', pattern: 'plate.%04d.exr', first: 1001, last: 1010, count: 8, gaps: [[1004, 1005]] }, file_count: 8, total_size: 8000, probe_target: p, members: [p] })
          : p.endsWith('.wav') ? unit(p, { media: 'audio' }) : unit(p));
        case 'probe':
          if (probeDelay) await sleep(probeDelay);
          if (args.unit.path.includes('broken')) throw 'ffprobe: Invalid data found when processing input';
          return { outputs: args.unit.media === 'audio'
            ? { container: 'wav', audio_codec: 'pcm_s24le', audio_channels: 2, audio_layout: { tracks: [{ name: 'A1', channels: ['L', 'R'] }] } }
            : { container: 'mov', video_codec: 'prores', width: 1920, height: 1080, frame_rate: 23.976, scan: 'progressive', color_range: 'tv' } };
        case 'fingerprint': return `xxh3:${'ab'.repeat(8)}`;
        case 'reveal': return null;
        default: throw new Error(`fake shell: unknown command ${cmd}`);
      }
    },
  },
  webview: { getCurrentWebview: () => ({ onDragDropEvent: async (cb: any) => { dropCb = cb; return () => { dropCb = null; }; } }) },
};
const drop = (paths: string[], x = 300, y = 200) => dropCb!({ payload: { type: 'drop', paths, position: { x, y } } });
const enter = (paths: string[]) => dropCb!({ payload: { type: 'enter', paths, position: { x: 10, y: 10 } } });

async function main() {
  // The app decides "desktop or browser" by this global, at mount.
  (globalThis as any).__TAURI__ = shell;
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8818));
  const { w, win, pool, until, untilDb, post, nav } = ui;
  try {
    // Imported AFTER mountApp: @vue/runtime-dom captures `document` when it loads.
    const { outputsOf, mappedData } = await import('../src/client/tools/fileDrop.js');
    console.log('\nF1. The pure parts');
    const seq = unit('/mnt/san/plates', { kind: 'sequence', manifest: { kind: 'sequence', pattern: 'plate.%04d.exr', first: 1001, last: 1010, count: 8, gaps: [[1004, 1005]] }, file_count: 8 });
    const o = outputsOf(seq);
    check('a sequence yields first/last/frame_count and the COUNT of missing frames', o.first_frame === 1001 && o.last_frame === 1010 && o.frame_count === 8 && o.gaps === 2, JSON.stringify(o));
    const b = outputsOf(unit('/mnt/san/EP101_IMF', { kind: 'bundle', bundle_type: 'imf', cpl_title: 'EP101 UHD', extension: 'imf' }));
    check('a bundle yields its type and CPL title', b.bundle_type === 'imf' && b.cpl_title === 'EP101 UHD' && b.kind === 'bundle');
    const fields = [
      { id: 'a', table_id: 't', name: 'Path', key: 'path', type: 'file_path', options: {}, position: 0, required: false },
      { id: 'b', table_id: 't', name: 'Width', key: 'width', type: 'number', options: {}, position: 1, required: false },
      { id: 'c', table_id: 't', name: 'Media', key: 'media', type: 'select', options: { choices: ['video'] }, position: 2, required: false },
    ];
    const map = resolveMap({ map: { path: 'a', width: 'b', media: 'c', height: 'zz' } }, fields);
    const m = mappedData({ path: '/x/a.wav', width: 1920, media: 'audio', height: 1080, name: 'a.wav' }, map, fields as any);
    check('mapped + valid values are written; unmapped (name) and dangling (height) are dropped silently', JSON.stringify(m.data) === JSON.stringify({ path: '/x/a.wav', width: 1920 }), JSON.stringify(m.data));
    check('a select value that is not a choice is SKIPPED and named — never written, never a schema change', m.skipped.length === 1 && /^Media: /.test(m.skipped[0]), JSON.stringify(m.skipped));

    console.log('\nF2. Setup: a Files table with File drop mapped');
    const tFiles = randomUUID(), tPlain = randomUUID(), tBoards = randomUUID();
    const f = { name: randomUUID(), path: randomUUID(), kind: randomUUID(), manifest: randomUUID(), size: randomUUID(), width: randomUUID(), rate: randomUUID(), layout: randomUUID(), hash: randomUUID(), media: randomUUID(), plainName: randomUUID() };
    const pos = (id: string, position: number) => ({ type: 'field.update', id, position });
    const r = await post([
      { type: 'table.create', id: tFiles, name: 'Files' }, { type: 'table.create', id: tPlain, name: 'Notes' }, ...boardsTableMutations(tBoards),
      { type: 'field.create', id: f.name, tableId: tFiles, name: 'Name', key: 'name', fieldType: 'text' }, pos(f.name, 0),
      { type: 'field.create', id: f.path, tableId: tFiles, name: 'Path', key: 'path', fieldType: 'file_path' }, pos(f.path, 1),
      { type: 'field.create', id: f.kind, tableId: tFiles, name: 'Kind', key: 'kind', fieldType: 'select', options: { choices: ['file', 'bundle', 'sequence', 'channel_set'] } }, pos(f.kind, 2),
      { type: 'field.create', id: f.manifest, tableId: tFiles, name: 'Manifest', key: 'manifest', fieldType: 'structured', options: { shape: 'manifest' } }, pos(f.manifest, 3),
      { type: 'field.create', id: f.size, tableId: tFiles, name: 'Size', key: 'total_size', fieldType: 'number', options: { format: 'bytes' } }, pos(f.size, 4),
      { type: 'field.create', id: f.width, tableId: tFiles, name: 'Width', key: 'width', fieldType: 'number' }, pos(f.width, 5),
      { type: 'field.create', id: f.rate, tableId: tFiles, name: 'Rate', key: 'frame_rate', fieldType: 'number' }, pos(f.rate, 6),
      { type: 'field.create', id: f.layout, tableId: tFiles, name: 'Audio', key: 'audio_layout', fieldType: 'structured', options: { shape: 'audio_layout' } }, pos(f.layout, 7),
      { type: 'field.create', id: f.hash, tableId: tFiles, name: 'Hash', key: 'hash', fieldType: 'text' }, pos(f.hash, 8),
      { type: 'field.create', id: f.media, tableId: tFiles, name: 'Media', key: 'media', fieldType: 'select', options: { choices: ['video', 'image'] } }, pos(f.media, 9),
      { type: 'field.create', id: f.plainName, tableId: tPlain, name: 'Name', key: 'name', fieldType: 'text' }, pos(f.plainName, 0),
      { type: 'table.update', id: tFiles, tools: { file_drop: { map: { path: f.path, name: f.name, kind: f.kind, manifest: f.manifest, total_size: f.size, width: f.width, frame_rate: f.rate, audio_layout: f.layout, hash: f.hash, media: f.media } } } },
    ]);
    check('fixture accepted', r.status === 200, (await r.text()).slice(0, 300));
    check('the app did the handshake with the shell at mount', await until(() => calls.some((c) => c.cmd === 'tools_available')));
    check('…and subscribed to the drag-drop stream', dropCb !== null);

    const go = async (tableId: string) => { win.location.hash = `#/all/table/${tableId}`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange')); await until(() => w.find('.gridview').exists(), 8000); };
    const rows = async (sql: string) => (await pool.query(sql)).rows;
    const filesRows = () => rows(`select id, data from records where table_id = '${tFiles}' order by created_at`);
    const noticesText = () => w.findAll('.desk-notice').map((n: any) => n.text()).join(' | ');

    console.log('\nF3. Dropping on a table');
    await go(tPlain);
    enter(['/mnt/san/a.mov']);
    check('while files are over a table WITHOUT File drop, the overlay says so BEFORE the release, not in the accent colour', await until(() => w.find('.file-drop').exists()) && /not enabled on Notes/.test(w.find('.file-drop').text()) && !w.find('.file-drop').classes('ok'), w.find('.file-drop').text());
    drop(['/mnt/san/a.mov']);
    check('a table WITHOUT File drop refuses, with a notice pointing at Table settings', await until(() => /not enabled on this table/.test(noticesText())) && (await filesRows()).length === 0 && (await rows(`select 1 from records where table_id = '${tPlain}'`)).length === 0);
    check('…and the overlay is gone', !w.find('.file-drop').exists());
    await w.find('.desk-notice').trigger('click');

    await go(tFiles);
    enter(['/mnt/san/a.mov']);
    check('over a table WITH File drop it says "Drop to add to Files", in the accent colour', await until(() => /Drop to add to Files/.test(w.find('.file-drop').text())) && w.find('.file-drop').classes('ok'), w.find('.file-drop').text());
    dropCb!({ payload: { type: 'leave' } });
    calls.length = 0;
    const before = Number((await rows(`select coalesce(max(seq), 0) n from mutations`))[0].n);
    drop(['/mnt/san/a.mov', '/mnt/san/mix.wav']);
    let fr = await untilDb(`select id, data from records where table_id = '${tFiles}' order by created_at`, (x) => x.length === 2);
    check('two files → two records AT ONCE with path, name, kind, manifest, size', fr.length === 2 && fr[0].data.path === '/mnt/san/a.mov' && fr[0].data.name === 'a.mov' && fr[0].data.kind === 'file' && fr[0].data.manifest.kind === 'file' && fr[0].data.total_size === 1000, JSON.stringify(fr.map((x) => x.data)));
    check('the shell was asked to classify exactly the dropped paths', calls.find((c) => c.cmd === 'classify')?.args.paths.join() === '/mnt/san/a.mov,/mnt/san/mix.wav');
    fr = await untilDb(`select id, data from records where table_id = '${tFiles}' order by created_at`, (x) => x.length === 2 && x[0].data.width === 1920 && x[1].data.audio_layout);
    check('ffprobe facts ARRIVE AFTERWARDS: width and rate on the movie, an audio layout on the wav', fr[0].data.width === 1920 && fr[0].data.frame_rate === 23.976 && fr[1].data.audio_layout?.tracks?.[0]?.channels?.join() === 'L,R', JSON.stringify(fr.map((x) => x.data)));
    fr = await untilDb(`select id, data from records where table_id = '${tFiles}' order by created_at`, (x) => x.length === 2 && x[0].data.hash && x[1].data.hash);
    check('then the hash, last, because it is mapped', fr[0].data.hash === 'xxh3:abababababababab' && calls.filter((c) => c.cmd === 'fingerprint').length === 2);
    check('the probe never waited for the hash (probe calls precede fingerprint calls per file)', calls.findIndex((c) => c.cmd === 'probe') < calls.findIndex((c) => c.cmd === 'fingerprint'));
    check('the wav\'s "media: audio" was NOT written (not a choice on that select) and the notice says which field', fr[1].data.media === undefined && fr[0].data.media === 'video' && /not written — Media/.test(noticesText()), noticesText());
    const tagged = await rows(`select type, via from mutations where seq > ${before} order by seq`);
    check('EVERY write of the drop is tagged via file_drop — creates, follow-ups, all', tagged.length >= 6 && tagged.every((m) => m.via === 'file_drop'), JSON.stringify(tagged));
    check('a notice summarised the drop', /Files: 2 new/.test(noticesText()), noticesText());

    console.log('\nF4. One Ctrl+Z');
    await w.find('.canvas-container, .gridview').trigger('keydown', { key: 'z', ctrlKey: true });
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    fr = await untilDb(`select id from records where table_id = '${tFiles}'`, (x) => x.length === 0);
    check('Ctrl+Z ONCE removes both records — the probe and hash updates were not steps of their own', fr.length === 0);
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
    fr = await untilDb(`select id, data from records where table_id = '${tFiles}' order by created_at`, (x) => x.length === 2);
    check('redo brings both back, with everything the probe wrote', fr.length === 2 && fr[0].data.width === 1920 && fr[0].data.hash);

    console.log('\nF5. The same file again');
    calls.length = 0;
    const idA = fr[0].id;
    drop(['/mnt/san/a.mov']);
    check('a path already in the table UPDATES that record — no duplicate — and the notice says so', await until(() => /1 updated/.test(noticesText())) && (await filesRows()).length === 2 && calls.some((c) => c.cmd === 'probe' && c.args.unit.path === '/mnt/san/a.mov'), noticesText());
    check('…same record id', (await filesRows())[0].id === idA);
    await sleep(100);

    console.log('\nF6. A probe that fails');
    drop(['/mnt/san/broken.mov']);
    fr = await untilDb(`select id, data from records where table_id = '${tFiles}' and data->>'name' = 'broken.mov'`, (x) => x.length === 1);
    check('the record is still created (path, size) and the failure is a notice about THAT file', fr.length === 1 && fr[0].data.total_size === 1000 && await until(() => /broken\.mov: ffprobe/.test(noticesText())), noticesText());
    fr = await untilDb(`select data from records where table_id = '${tFiles}' and data->>'name' = 'broken.mov'`, (x) => !!x[0]?.data.hash);
    check('…and the hash still ran after the failed probe', !!fr[0]?.data.hash);
    check('no connection-error banner: a bad file is not a store error', !w.find('.errors').exists());

    console.log('\nF7. Dropping on a canvas');
    win.location.hash = `#/all/canvas`; win.dispatchEvent(new (win as any).HashChangeEvent('hashchange'));
    await nav.newCanvas('Board A');
    check('a canvas is open', await until(() => w.find('.canvas-container').exists(), 8000));
    const boardId = (await untilDb(`select id from records where table_id = '${tBoards}'`, (x) => x.length === 1))[0].id;
    enter(['/mnt/san/plates/plate.1001.exr']);
    check('over a canvas the overlay names the canvas', await until(() => /Board A/.test(w.find('.file-drop').text())), w.find('.file-drop').text());
    drop(['/mnt/san/plates/plate.1001.exr'], 400, 300);
    const seqRows = await untilDb(`select r.id, r.data, p.x, p.y from records r left join placements p on p.record_id = r.id and p.canvas_id = '${boardId}' where r.table_id = '${tFiles}' and r.data->>'kind' = 'sequence'`, (x) => x.length === 1 && x[0].x !== null);
    check('a dropped frame becomes ONE sequence record, PLACED on the canvas', seqRows.length === 1 && seqRows[0].data.manifest.count === 8 && seqRows[0].data.path === '/mnt/san/plates' && seqRows[0].x !== null, JSON.stringify(seqRows));
    check('the placement is tagged too (one batch, one transaction with the create)', (await rows(`select via from mutations where type = 'placement.add' and payload->>'recordId' = '${seqRows[0].id}'`))[0]?.via === 'file_drop');
    check('a card for it is on screen', await until(() => w.findAll('.canvas-world .card').some((c: any) => /plate/.test(c.text()))));

    console.log('\nF8. Show in folder');
    const card = w.findAll('.canvas-world .card').find((c: any) => /plate/.test(c.text()))!;
    await card.trigger('dblclick');
    check('the record panel of a file record has a "show" button on its Path field', await until(() => w.find('.record-panel .reveal').exists()));
    calls.length = 0;
    await w.find('.record-panel .reveal').trigger('click');
    check('…which asks the shell to reveal exactly that path', await until(() => calls.some((c) => c.cmd === 'reveal')) && calls.find((c) => c.cmd === 'reveal')?.args.path === '/mnt/san/plates');
  } finally {
    await ui.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('SUITE ABORTED', e); process.exit(1); });
