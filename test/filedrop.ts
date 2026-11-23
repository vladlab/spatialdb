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
import { resolveMap, stepApplies } from '../src/contract/tools.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/* ── the fake shell ─────────────────────────────────────────────────────── */
/** When every fake file was last modified (unix seconds) — except a path with "later" in it: an hour after. */
const T0 = 1_795_000_000;
const mtimeOf = (path: string) => (/later/.test(path) ? T0 + 3600 : T0);
/** A file that has CHANGED ON DISK since it was dropped: path → its size now. */
const changedOnDisk = new Map<string, number>();
/** As classify.rs writes it: the manifest carries its `stat` — count, bytes, newest modified time. */
const fileManifest = (path: string, size: number) => ({ kind: 'file', size, stat: { files: 1, bytes: size, modified: mtimeOf(path) } });
/** A stat as the database gives it back (jsonb does not keep key order): compared by its three values. */
const statIs = (st: any, files: number, bytes: number, modified: number) => !!st && st.files === files && st.bytes === bytes && st.modified === modified && Object.keys(st).length === 3;
const unit = (path: string, extra: Partial<Unit> = {}): Unit => { const size = changedOnDisk.get(path) ?? 1000; return {
  kind: 'file', path, name: path.split('/').pop()!, extension: path.split('.').pop()!, media: 'video',
  manifest: fileManifest(path, size), file_count: 1, total_size: size, modified: '2026-09-27', mtime: mtimeOf(path),
  probe_target: path, members: [], bundle_type: null, cpl_title: null, ...extra,
}; };
/** Six mono WAVs classified as one 5.1 channel set: its path is their FOLDER. */
const mix51 = (dir: string): Unit => unit(dir, { kind: 'channel_set', name: 'mix51', extension: 'wav', media: 'audio',
  manifest: { kind: 'channel_set', members: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'].map((ch) => ({ path: `mix51_${ch}.wav`, channel: ch })), stat: { files: 6, bytes: 6000, modified: T0 } },
  file_count: 6, total_size: 6000, probe_target: `${dir}/mix51_L.wav`, members: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'].map((ch) => `${dir}/mix51_${ch}.wav`) });
/** Per FILE, as hash.rs does it: a single file's hash, or one per member of a set. */
const hashOutputs = (u: Unit, analyzer: string) => {
  const algo = analyzer.replace('hash-', '');
  if (!['xxh3', 'sha256', 'md5'].includes(algo)) throw new Error(`fake shell: no analyzer ${analyzer}`);
  const hex = (seed: string) => (algo === 'md5' ? 'cd'.repeat(16) : 'ab'.repeat(8)).replace(/^../, seed.length.toString(16).padStart(2, '0'));
  if (u.kind === 'sequence') throw 'a sequence is not hashed: its manifest lists a frame range, never its files';
  if (!u.members.length) return { outputs: { hash: `${algo}:${hex(u.name)}` } };
  return { outputs: { member_hashes: u.members.map((m) => ({ path: m.slice(u.path.length + 1), hash: `${algo}:${hex(m)}` })) } };
};
let allowPath = true;
/** A desktop build from before `expect`: it reads the file whatever the record holds. */
let ignoreExpect = false;
let manualDelay = 0;
const calls: Array<{ cmd: string; args: any }> = [];
let probeDelay = 0;
let dropCb: ((e: { payload: any }) => void) | null = null;
const shell = {
  core: {
    async invoke(cmd: string, args: any = {}) {
      calls.push({ cmd, args });
      switch (cmd) {
        case 'tools_available': return { version: '0.1.0-test', tools: ['file_drop', 'reveal'], analyzers: { filesystem: '0.1.0-test', sequence: '0.1.0-test', imf: '0.1.0-test', ffprobe: '7.1', 'hash-xxh3': '0.1.0-test', 'hash-sha256': '0.1.0-test', 'hash-md5': '0.1.0-test' }, platform: 'linux' };
        case 'classify': return (args.paths as string[]).map((p) => p.endsWith('.exr')
          ? unit(p.replace(/\/[^/]+$/, ''), { kind: 'sequence', name: 'plate', extension: 'exr', media: 'image', manifest: { kind: 'sequence', pattern: 'plate.%04d.exr', first: 1001, last: 1010, count: 8, gaps: [[1004, 1005]], stat: { files: 8, bytes: 8000, modified: T0 } }, file_count: 8, total_size: 8000, probe_target: p, members: [p] })
          : p.endsWith('/mix51') ? mix51(p)
          : p.includes('big') ? unit(p, { total_size: 2000, manifest: fileManifest(p, 2000) })
          : p.endsWith('.wav') ? unit(p, { media: 'audio' }) : p.endsWith('.pdf') ? unit(p, { media: 'document' }) : unit(p));
        case 'hash_cancel': return undefined;
        case 'allow_paths': return allowPath;
        case 'analyze':
          if (args.analyzer === 'ffprobe') {
            if (probeDelay) await sleep(probeDelay);
            if (args.unit.path.includes('broken')) throw 'ffprobe: Invalid data found when processing input';
            return { outputs: args.unit.media === 'audio'
              ? { 'ffprobe.version': '7.1', container_raw: 'wav', audio_codec_raw: 'pcm_s24le', audio_channels: 2, audio_layout: { tracks: [{ name: 'A1', channels: ['L', 'R'] }] } }
              : args.unit.path.includes('weird')
                ? { 'ffprobe.version': '7.1', container_raw: 'mov,mp4,m4a,3gp,3g2,mj2', major_brand: 'qt  ', video_codec: 'prores', codec_profile: 'Something New', width: 1920 }
                : { 'ffprobe.version': '7.1', raw_dump: '{\n  "streams": [\n    { "codec_name": "prores" }\n  ]\n}', container_raw: 'mov,mp4,m4a,3gp,3g2,mj2', major_brand: 'qt  ', video_codec: 'prores', codec_profile: 'XQ', width: 1920, height: 1080, frame_rate: 23.976, scan: 'progressive', color_range: 'legal', color_primaries_raw: 'bt709', color_transfer_raw: 'bt709', color_matrix_raw: 'bt709' } };
          }
          return hashOutputs(args.unit, args.analyzer);
        case 'analyze_path': {
          // The desktop asks in a NATIVE dialog for a path not dropped this session; the fake answers `allowPath`.
          if (!allowPath) throw `${args.path}: not read — you did not allow it`;
          if (manualDelay) await sleep(manualDelay);
          const u = args.path.endsWith('/mix51') ? mix51(args.path) : unit(args.path);
          // As lib.rs does with `expect`: a file that is no longer the one recorded is refused BEFORE it is read.
          if (args.expect && !ignoreExpect) {
            const st = (u.manifest as any).stat, what: string[] = [];
            if (args.expect.files != null && args.expect.files !== st.files) what.push('file count');
            if (args.expect.bytes !== st.bytes) what.push('size');
            if (args.expect.modified != null && Math.abs(args.expect.modified - st.modified) > 2) what.push('modified date');
            if (what.length) throw `${args.path}: its ${what.join(' and ')} ${what.length === 1 ? 'has' : 'have'} changed since it was recorded`;
          }
          return { unit: u, outputs: hashOutputs(u, args.analyzer).outputs };
        }
        case 'reveal': return null;
        default: throw new Error(`fake shell: unknown command ${cmd}`);
      }
    },
  },
  webview: { getCurrentWebview: () => ({ onDragDropEvent: async (cb: any) => { dropCb = cb; return () => { dropCb = null; }; } }) },
};
const drop = (paths: string[], x = 300, y = 200) => dropCb!({ payload: { type: 'drop', paths, position: { x, y } } });
const enter = (paths: string[], x = 10, y = 10) => dropCb!({ payload: { type: 'enter', paths, position: { x, y } } });
const over = (x: number, y: number) => dropCb!({ payload: { type: 'over', position: { x, y } } });
/**
 * happy-dom lays nothing out, so the GRID's row-under-the-pointer (GridView
 * `recordAtClient`, through `document.elementsFromPoint`) is stubbed here: while
 * `ontoRow` is set, every point is "over" that row. The canvas needs no stub —
 * its cards are geometry in the store (`cardAtClient`).
 */
let ontoRow: Element | null = null;

async function main() {
  // The app decides "desktop or browser" by this global, at mount.
  (globalThis as any).__TAURI__ = shell;
  const ui = await mountApp(Number(process.env.TEST_PORT ?? 8818));
  const { w, win, pool, until, untilDb, post, nav } = ui;
  try {
    // Imported AFTER mountApp: @vue/runtime-dom captures `document` when it loads.
    const { immediateOutputs, mappedData, withHashes } = await import('../src/client/tools/fileDrop.js');
    console.log('\nF1. The pure parts');
    const seq = unit('/mnt/san/plates', { kind: 'sequence', manifest: { kind: 'sequence', pattern: 'plate.%04d.exr', first: 1001, last: 1010, count: 8, gaps: [[1004, 1005]], stat: { files: 8, bytes: 8000, modified: T0 } }, file_count: 8, media: 'image' });
    const o = immediateOutputs('sequence', seq);
    check('the sequence analyzer yields first/last/frame_count and the COUNT of missing frames', o.first_frame === 1001 && o.last_frame === 1010 && o.frame_count === 8 && o.gaps === 2, JSON.stringify(o));
    check('…and nothing for a plain file', Object.keys(immediateOutputs('sequence', unit('/x/a.mov'))).length === 0);
    const b = immediateOutputs('imf', unit('/mnt/san/EP101_IMF', { kind: 'bundle', bundle_type: 'imf', cpl_title: 'EP101 UHD', extension: 'imf' }));
    check('the package analyzer yields its type and CPL title', b.bundle_type === 'imf' && b.cpl_title === 'EP101 UHD');
    const fsOut = immediateOutputs('filesystem', seq);
    check('the filesystem analyzer yields path, name, kind, media, manifest, counts', fsOut.path === '/mnt/san/plates' && fsOut.kind === 'sequence' && fsOut.media === 'image' && fsOut.file_count === 8);
    const fields = [
      { id: 'a', table_id: 't', name: 'Path', key: 'path', type: 'file_path', options: {}, position: 0, required: false },
      { id: 'b', table_id: 't', name: 'Width', key: 'width', type: 'number', options: {}, position: 1, required: false },
      { id: 'c', table_id: 't', name: 'Media', key: 'media', type: 'select', options: { choices: ['video'] }, position: 2, required: false },
    ];
    const map = resolveMap({ analyzer: 'ffprobe', map: { path: 'a', width: 'b', media: 'c', height: 'zz' } }, fields);
    const m = mappedData({ path: '/x/a.wav', width: 1920, media: 'audio', height: 1080, name: 'a.wav' }, map, fields as any);
    check('mapped + valid values are written; unmapped (name) and dangling (height) are dropped silently', JSON.stringify(m.data) === JSON.stringify({ path: '/x/a.wav', width: 1920 }), JSON.stringify(m.data));
    check('a select value that is not a choice is SKIPPED and named — never written, never a schema change', m.skipped.length === 1 && /^Media: /.test(m.skipped[0]), JSON.stringify(m.skipped));

    const h1 = withHashes({ hash: 'md5:' + 'cd'.repeat(16) }, unit('/x/a.mov'), undefined);
    check('withHashes: a single file\'s hash goes into its manifest too, under its algorithm', h1.hash === 'md5:' + 'cd'.repeat(16) && (h1.manifest as any).hashes.md5 === h1.hash && (h1.manifest as any).size === 1000, JSON.stringify(h1));
    const set = mix51('/x/mix51');
    const h2 = withHashes({ member_hashes: [{ path: 'mix51_L.wav', hash: 'md5:' + '11'.repeat(16) }, { path: 'mix51_Rs.wav', hash: 'md5:' + '22'.repeat(16) }] }, set, { ...set.manifest, members: (set.manifest as any).members.map((m: any) => ({ ...m, hashes: { xxh3: 'xxh3:' + 'ab'.repeat(8) } })) });
    const mem = (h2.manifest as any).members;
    check('…a set\'s member hashes land beside the members of the record\'s CURRENT manifest — BESIDE the other algorithm\'s, never replacing it — and no hash of the whole', h2.hash === undefined && !('member_hashes' in h2) && mem[0].hashes.md5 === 'md5:' + '11'.repeat(16) && mem[0].hashes.xxh3 === 'xxh3:' + 'ab'.repeat(8) && mem[5].hashes.md5 === 'md5:' + '22'.repeat(16) && mem[1].hashes.md5 === undefined && mem[1].hashes.xxh3 === 'xxh3:' + 'ab'.repeat(8) && mem[0].channel === 'L', JSON.stringify(mem));

    console.log('\nF2. Setup: a Files table with File drop mapped');
    const tFiles = randomUUID(), tPlain = randomUUID(), tBoards = randomUUID();
    const f = { name: randomUUID(), path: randomUUID(), kind: randomUUID(), manifest: randomUUID(), size: randomUUID(), width: randomUUID(), rate: randomUUID(), layout: randomUUID(), hash: randomUUID(), media: randomUUID(), codec: randomUUID(), rawCodec: randomUUID(), container: randomUUID(), audioCodec: randomUUID(), primaries: randomUUID(), dump: randomUUID(), plainName: randomUUID() };
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
      { type: 'field.create', id: f.codec, tableId: tFiles, name: 'Codec', key: 'codec', fieldType: 'select', options: { vocabulary: 'video_codec' } }, pos(f.codec, 10),
      { type: 'field.create', id: f.rawCodec, tableId: tFiles, name: 'Raw codec', key: 'video_codec', fieldType: 'text' }, pos(f.rawCodec, 11),
      { type: 'field.create', id: f.container, tableId: tFiles, name: 'Container', key: 'container', fieldType: 'select', options: { vocabulary: 'container' } }, pos(f.container, 12),
      { type: 'field.create', id: f.audioCodec, tableId: tFiles, name: 'Audio codec', key: 'audio_codec', fieldType: 'select', options: { vocabulary: 'audio_codec' } }, pos(f.audioCodec, 13),
      { type: 'field.create', id: f.primaries, tableId: tFiles, name: 'Primaries', key: 'color_primaries', fieldType: 'text' }, pos(f.primaries, 14),
      { type: 'field.create', id: f.dump, tableId: tFiles, name: 'ffprobe', key: 'raw_dump', fieldType: 'long_text' }, pos(f.dump, 15),
      { type: 'field.create', id: f.plainName, tableId: tPlain, name: 'Name', key: 'name', fieldType: 'text' }, pos(f.plainName, 0),
      // The recipe: filesystem for everything; ffprobe on video and audio (its default);
      // no hash is a step, and none runs at the drop (Nov 23): md5 / xxh3 / sha256 are asked for from the record.
      { type: 'table.update', id: tFiles, tools: { file_drop: { steps: [
        { analyzer: 'filesystem', map: { path: f.path, name: f.name, kind: f.kind, manifest: f.manifest, total_size: f.size, media: f.media } },
        { analyzer: 'ffprobe', map: { width: f.width, frame_rate: f.rate, audio_layout: f.layout, codec: f.codec, video_codec: f.rawCodec, container: f.container, audio_codec: f.audioCodec, color_primaries: f.primaries, raw_dump: f.dump } },
      ] } } },
    ]);
    check('fixture accepted', r.status === 200, (await r.text()).slice(0, 300));
    check('the app did the handshake with the shell at mount', await until(() => calls.some((c) => c.cmd === 'tools_available')));
    check('…and subscribed to the drag-drop stream', dropCb !== null);

    (win.document as any).elementsFromPoint = () => (ontoRow ? [ontoRow] : []);
    /** Drop files ONTO a grid row: drag in, move over the row, let go. */
    const dropOntoRow = async (recordId: string, paths: string[]) => {
      ontoRow = w.find(`.gridview tr.row[data-record-id="${recordId}"]`).element;
      enter(paths, 300, 200); over(301, 201);
      await until(() => w.find('.gridview tr.row.drop-target').exists());
      drop(paths, 301, 201);
      ontoRow = null;
    };
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
    check('the CANONICAL codec is written from the raw pair through the vocabulary, beside the raw name', fr[0].data.codec === 'ProRes 4444 XQ' && fr[0].data.video_codec === 'prores' && fr[1].data.codec === undefined, JSON.stringify(fr[0].data));
    check('the RAW DUMP — everything ffprobe said, pretty-printed JSON — lands in the long-text field for the single file; the wav\'s fake reports none', fr[0].data.raw_dump?.startsWith('{\n  "streams"') && fr[1].data.raw_dump === undefined, JSON.stringify(fr[0].data.raw_dump));
    check('…and so are the container (the QuickTime family + the "qt  " brand → QuickTime; wav → WAV), the audio codec (pcm_s24le → PCM) and the primaries (bt709 → Rec. 709, into a plain text field)',
      fr[0].data.container === 'QuickTime' && fr[1].data.container === 'WAV' && fr[1].data.audio_codec === 'PCM' && fr[0].data.audio_codec === undefined && fr[0].data.color_primaries === 'Rec. 709' && fr[1].data.color_primaries === undefined, JSON.stringify(fr.map((x) => x.data)));
    await sleep(300);
    fr = await rows(`select id, data from records where table_id = '${tFiles}' order by created_at`);
    const analyzeCalls = () => calls.filter((c) => c.cmd === 'analyze').map((c) => `${c.args.analyzer}:${c.args.unit.name}`);
    check('NOTHING is hashed at a drop (Nov 23): only ffprobe was asked, and no manifest carries a hash', analyzeCalls().join() === 'ffprobe:a.mov,ffprobe:mix.wav' && fr.every((x) => x.data.manifest.hashes === undefined && x.data.manifest.hash === undefined), `${analyzeCalls().join()} | ${JSON.stringify(fr.map((x) => x.data.manifest))}`);
    check('the manifest carries the file\'s STAT instead — count, bytes, modified time: the fingerprint a later drop is compared by (contract/fingerprint.ts)', fr[0].data.manifest.kind === 'file' && fr[0].data.manifest.size === 1000 && statIs(fr[0].data.manifest.stat, 1, 1000, T0), JSON.stringify(fr[0].data.manifest));
    check('no hash has a column: the Hash text field on this table was never written', fr.every((x) => !('hash' in x.data)), JSON.stringify(fr.map((x) => Object.keys(x.data))));
    check('the wav\'s "media: audio" was NOT written (not a choice on that select) and the notice says which field', fr[1].data.media === undefined && fr[0].data.media === 'video' && /not written — Media/.test(noticesText()), noticesText());
    const tagged = await rows(`select type, via from mutations where seq > ${before} order by seq`);
    check('EVERY write of the drop is tagged via file_drop — creates, follow-ups, all', tagged.length >= 4 && tagged.every((m) => m.via === 'file_drop'), JSON.stringify(tagged));
    check('a notice summarised the drop', /Files: 2 new/.test(noticesText()), noticesText());

    console.log('\nF4. One Ctrl+Z');
    await w.find('.canvas-container, .gridview').trigger('keydown', { key: 'z', ctrlKey: true });
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    fr = await untilDb(`select id from records where table_id = '${tFiles}'`, (x) => x.length === 0);
    check('Ctrl+Z ONCE removes both records — the probe updates were not steps of their own', fr.length === 0);
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
    fr = await untilDb(`select id, data from records where table_id = '${tFiles}' order by created_at`, (x) => x.length === 2);
    check('redo brings both back, with everything the probe wrote', fr.length === 2 && fr[0].data.width === 1920 && fr[0].data.manifest?.stat?.modified === T0);

    console.log('\nF5. The same file again, on empty space: NOT touched, OFFERED (Oct 18 — nothing invisible)');
    calls.length = 0;
    const idA = fr[0].id;
    const seenBefore = nav.dialogs.seen.length;
    // The harness's autopilot answers every in-app dialog with its OK — here "Open".
    drop(['/mnt/san/a.mov']);
    check('ONE file whose path is already a record: a dialog says so, names the record and its path, offers Open / Close', await until(() => nav.dialogs.seen.length > seenBefore) && /Already in Files/.test(nav.dialogs.seen.at(-1)!) && /a\.mov is already a record of Files/.test(nav.dialogs.bodies.at(-1)!) && /\/mnt\/san\/a\.mov/.test(nav.dialogs.bodies.at(-1)!) && /drop the file onto it/.test(nav.dialogs.bodies.at(-1)!), nav.dialogs.bodies.at(-1));
    check('Open puts THAT record in the tray, without leaving the grid', await until(() => w.find('.record-panel').exists()) && w.find('.gridview').exists() && w.find('.gridview tr.row.opened').attributes('data-record-id') === idA, w.find('.gridview tr.row.opened').attributes('data-record-id'));
    await sleep(100);
    check('nothing was written and nothing was read: no duplicate, no update, no analyzer', (await filesRows()).length === 2 && !calls.some((c) => c.cmd === 'analyze'), calls.map((c) => c.cmd).join());
    await w.find('.record-panel .rp-close, .record-panel button[title="Close"]').trigger('click').catch(() => {});
    calls.length = 0;
    drop(['/mnt/san/a.mov', '/mnt/san/new1.mov']);
    fr = await untilDb(`select id, data from records where table_id = '${tFiles}' order by created_at`, (x) => x.length === 3);
    check('in a BATCH the new ones are created and the known one is skipped: "1 new", and a warning naming the record with a pill to open it', await until(() => /Files: 1 new/.test(noticesText()) && /a\.mov is already in Files — not added again/.test(noticesText())) && fr[2].data.name === 'new1.mov' && w.find('.desk-notice .notice-pill').exists() && !calls.some((c) => c.cmd === 'analyze' && c.args.unit.name === 'a.mov'), noticesText());
    await w.find('.desk-notice .notice-pill').trigger('click');
    check('the pill opens that record in the tray', await until(() => w.find('.gridview tr.row.opened').attributes('data-record-id') === idA));
    for (const n of w.findAll('.desk-notice')) await n.trigger('click');
    await sleep(100);

    console.log('\nF6. A probe that fails');
    drop(['/mnt/san/broken.mov']);
    fr = await untilDb(`select id, data from records where table_id = '${tFiles}' and data->>'name' = 'broken.mov'`, (x) => x.length === 1);
    check('the record is still created (path, size) and the failure is a notice about THAT file', fr.length === 1 && fr[0].data.total_size === 1000 && await until(() => /broken\.mov: ffprobe/.test(noticesText())), noticesText());

    console.log('\nF6a. A codec the vocabulary does not know');
    drop(['/mnt/san/weird.mov']);
    fr = await untilDb(`select data from records where table_id = '${tFiles}' and data->>'name' = 'weird.mov'`, (x) => x.length === 1 && x[0].data.width === 1920);
    check('the raw name is written, the canonical cell stays EMPTY, and the notice names the pair so the table can learn it', fr[0].data.video_codec === 'prores' && fr[0].data.codec === undefined && await until(() => /weird\.mov: not written — Codec: codec prores \/ profile Something New is not in the video_codec vocabulary/.test(noticesText())), noticesText());

    console.log('\nF6b. runs_on is obeyed: a document goes to no ffprobe');
    calls.length = 0;
    drop(['/mnt/san/spec.pdf']);
    fr = await untilDb(`select id, data from records where table_id = '${tFiles}' and data->>'name' = 'spec.pdf'`, (x) => x.length === 1);
    await sleep(200);
    check('a PDF is a record with its filesystem facts, and NO analyzer was asked: ffprobe\'s default is video or audio, and nothing is hashed', fr[0].data.media === undefined /* not a choice */ && fr[0].data.manifest?.stat?.bytes === 1000 && analyzeCalls().length === 0, analyzeCalls().join());
    check('stepApplies agrees, from the contract alone', !stepApplies({ analyzer: 'ffprobe', map: {} }, { media: 'document', kind: 'file' }));
    check('no connection-error banner: a bad file is not a store error', !w.find('.errors').exists());

    console.log('\nF6c. A channel set is ONE record, with one stat for the set; nothing is hashed until asked');
    calls.length = 0;
    drop(['/mnt/san/mix51']);
    fr = await untilDb(`select data from records where table_id = '${tFiles}' and data->>'name' = 'mix51'`, (x) => x.length === 1 && x[0].data.audio_layout);
    check('six mono WAVs → one record whose manifest lists the six members and carries the SET\'s stat (count + total + newest date); no member is hashed',
      fr[0].data.manifest.kind === 'channel_set' && fr[0].data.manifest.members.length === 6 && fr[0].data.manifest.members.every((m: any) => m.hashes === undefined) && fr[0].data.manifest.members[3].channel === 'LFE'
      && statIs(fr[0].data.manifest.stat, 6, 6000, T0) && !analyzeCalls().some((x) => x.startsWith('hash')), JSON.stringify(fr[0].data.manifest));
    check('a sequence is not hashed: the hash step runs on files, bundles and channel sets by default', !stepApplies({ analyzer: 'hash-md5', map: {} }, { media: 'image', kind: 'sequence' }) && stepApplies({ analyzer: 'hash-md5', map: {} }, { media: 'audio', kind: 'channel_set' }));

    console.log('\nF6d. A CHECKSUM: md5 / xxh3 / sha256 when asked for, never at the drop — on every File-drop table, nothing to enable (Nov 10, Nov 23)');
    check('a hash step in a recipe is refused by the server: hashes are not steps', (await post([{ type: 'table.update', id: tFiles, tools: { file_drop: { steps: [{ analyzer: 'filesystem', map: { path: f.path, manifest: f.manifest } }, { analyzer: 'hash-md5', when: 'manual', map: {} }] } } }])).status === 400);
    check('…and when: "sometimes" is refused on any step', (await post([{ type: 'table.update', id: tFiles, tools: { file_drop: { steps: [{ analyzer: 'filesystem', map: { path: f.path, manifest: f.manifest } }, { analyzer: 'ffprobe', when: 'sometimes', map: {} }] } } }])).status === 400);
    calls.length = 0;
    drop(['/mnt/san/final.mov']);
    fr = await untilDb(`select id, data from records where table_id = '${tFiles}' and data->>'name' = 'final.mov'`, (x) => x.length === 1 && x[0].data.width === 1920);
    await sleep(150);
    check('at the drop NO hash runs — not the md5, not the xxh3', fr[0].data.manifest.hashes === undefined && !analyzeCalls().some((x) => x.startsWith('hash-')), analyzeCalls().join());
    await go(tFiles);
    await until(() => w.findAll('.gridview tr.row').some((row: any) => /final\.mov/.test(row.text())));
    await w.findAll('.gridview tr.row').find((row: any) => /final\.mov/.test(row.text()))!.find('.expand').trigger('click');
    const fieldNamed = (label: string) => w.findAll('.record-panel .rp-field').find((x: any) => { const t = x.find('.rp-name').text().replace(/^★/, '').trim(); return t === label || t.startsWith(label + ' ') || /^[⚠✓▶⤴]/.test(t.slice(label.length).trim()) && t.startsWith(label); })!;
    check('the record tray offers ▶ md5, ▶ xxh3 and ▶ sha256 on the MANIFEST field (where a hash lands), not on the path; "show" stays on the path', await until(() => w.find('.record-panel .run-step').exists()) && w.findAll('.record-panel .run-step').map((b: any) => b.text()).join() === '▶ md5,▶ xxh3,▶ sha256'
      && fieldNamed('Manifest').find('.run-step').exists() && !fieldNamed('Path').find('.run-step').exists() && fieldNamed('Path').find('.reveal').exists() && !fieldNamed('Manifest').find('.reveal:not(.run-step)').exists());
    const seqBefore = Number((await rows(`select coalesce(max(seq), 0) n from mutations`))[0].n);
    calls.length = 0;
    manualDelay = 400;
    await w.find('.record-panel .run-step').trigger('click');
    check('WHILE it runs, "Hash (md5)…" shows once — on the Manifest, where the ▶ was — not on the Path as well; the ▶ is hidden meanwhile',
      await until(() => w.findAll('.record-panel .job').length > 0) && w.findAll('.record-panel .job').length === 1 && fieldNamed('Manifest').find('.job').exists()
      && /Hash \(md5\)…/.test(fieldNamed('Manifest').find('.job').text()) && !fieldNamed('Path').find('.job').exists() && !w.find('.record-panel .run-step').exists(),
      w.findAll('.record-panel .rp-name').map((x: any) => x.text()).join(' | '));
    manualDelay = 0;
    fr = await untilDb(`select id, data from records where id = '${fr[0].id}'`, (x) => !!x[0].data.manifest?.hashes?.md5);
    check('clicking it asks the shell to run that analyzer on THE RECORD\'S PATH (analyze_path — the native "read this file?" dialog is the shell\'s), and the md5 is written into the manifest — and into no column',
      calls.some((c) => c.cmd === 'analyze_path' && c.args.path === '/mnt/san/final.mov' && c.args.analyzer === 'hash-md5') && /^md5:[0-9a-f]{32}$/.test(fr[0].data.manifest.hashes.md5) && !('md5' in fr[0].data) && !('hash' in fr[0].data), JSON.stringify(fr[0].data));
    check('…with what the record HOLDS about the file (`expect`: its count, size and date), so the shell can refuse before reading a file that has changed', (() => { const e = calls.find((c) => c.cmd === 'analyze_path')?.args.expect; return e?.files === 1 && e?.bytes === 1000 && e?.modified === T0; })(), JSON.stringify(calls.find((c) => c.cmd === 'analyze_path')?.args));
    check('…the md5 went through the hash line (hashJobs.ts) with a job id, so the shell could report progress', calls.some((c) => c.cmd === 'analyze_path' && c.args.analyzer === 'hash-md5' && typeof c.args.job === 'number'));
    check('…and the click did NOT also "show in folder" (the tab is no longer a <label>, which activated its first button on any click inside)', !calls.some((c) => c.cmd === 'reveal'));
    const seqAfter = Number((await rows(`select coalesce(max(seq), 0) n from mutations`))[0].n);
    check('…as ONE mutation of its own, tagged file_drop (a hash asked for by hand is a deliberate change, so Ctrl+Z takes it alone)', seqAfter === seqBefore + 1 && (await rows(`select via, payload from mutations where seq = ${seqAfter}`))[0].via === 'file_drop');
    allowPath = false;
    await w.find('.record-panel .run-step').trigger('click');
    check('when the person declines the native dialog nothing is written and the refusal is a notice about that file', await until(() => /you did not allow it/.test(noticesText())) && (await rows(`select coalesce(max(seq), 0) n from mutations`))[0].n == seqAfter, noticesText());
    allowPath = true;
    probeDelay = 400;
    drop(['/mnt/san/final2.mov']);   // a NEW file, its ffprobe slow, while final.mov's tray is open
    fr = await untilDb(`select id, data from records where table_id = '${tFiles}' and data->>'name' = 'final2.mov'`, (x) => x.length === 1);
    await w.findAll('.gridview tr.row').find((row: any) => /final2\.mov/.test(row.text()))!.find('.expand').trigger('click');
    check('a DROP\'s follow-up steps still show their progress on the Path — and only there', await until(() => fieldNamed('Path').find('.job').exists()) && /ffprobe…/.test(fieldNamed('Path').find('.job').text())
      && w.findAll('.record-panel .job').length === 1 && !fieldNamed('Manifest').find('.job').exists(), w.findAll('.record-panel .rp-name').map((x: any) => x.text()).join(' | '));
    probeDelay = 0;
    await until(() => !w.find('.record-panel .job').exists());

    console.log('\nF6e. Hashes in the tray: sha256 too, and a set shows each member\'s');
    await w.findAll('.record-panel .run-step').find((b: any) => b.text() === '▶ sha256')!.trigger('click');
    // The tray is on final2.mov (opened just above).
    const sha = await untilDb(`select data from records where table_id = '${tFiles}' and data->>'name' = 'final2.mov'`, (x) => !!x[0]?.data.manifest?.hashes?.sha256);
    check('▶ sha256 runs the same way, into the manifest', sha[0]?.data.manifest.hashes.sha256?.startsWith('sha256:') && sha[0].data.manifest.hashes.xxh3 === undefined, JSON.stringify(sha[0]?.data.manifest));
    await until(() => w.findAll('.record-panel .run-step').some((b: any) => b.text() === '▶ xxh3'));
    await w.findAll('.record-panel .run-step').find((b: any) => b.text() === '▶ xxh3')!.trigger('click');
    const xx = await untilDb(`select data from records where table_id = '${tFiles}' and data->>'name' = 'final2.mov'`, (x) => !!x[0]?.data.manifest?.hashes?.xxh3);
    check('▶ xxh3 is a button like the others now (kept, but by hand): it sits BESIDE the sha256, replacing nothing', /^xxh3:[0-9a-f]{16}$/.test(xx[0]?.data.manifest.hashes.xxh3) && xx[0].data.manifest.hashes.sha256 === sha[0].data.manifest.hashes.sha256 && xx[0].data.manifest.stat.modified === T0, JSON.stringify(xx[0]?.data.manifest));
    await go(tFiles);
    await until(() => w.findAll('.gridview tr.row').some((row: any) => row.findAll('td')[1]?.text().startsWith('mix51')));
    await w.findAll('.gridview tr.row').find((row: any) => row.findAll('td')[1]?.text().startsWith('mix51'))!.find('.expand').trigger('click');
    check('a set that was never hashed shows no hash column — and its stat line: 6 files, the total, the newest date', await until(() => w.find('.record-panel .mv-stat').exists()) && !w.find('.record-panel .mv-member-hash').exists() && /6 files · .* · newest modified \d{4}-\d\d-\d\d \d\d:\d\d:\d\d/.test(w.find('.record-panel .mv-stat').text()), w.find('.record-panel .mv-stat').exists() ? w.find('.record-panel .mv-stat').text() : 'no stat line');
    calls.length = 0;
    await w.findAll('.record-panel .run-step').find((b: any) => b.text() === '▶ md5')!.trigger('click');
    check('▶ md5 on a channel set: the shell is told the SET\'s count, total and date; then the tray\'s manifest SHOWS each member\'s hash beside its channel (short, the full value on hover)', await until(() => w.findAll('.record-panel .mv-member-hash').length === 6)
      && w.findAll('.record-panel .mv-member-hash').every((c: any) => /^md5:/.test(c.text()) && /^md5:[0-9a-f]{32}$/.test(c.attributes('title') ?? ''))
      && (() => { const e = calls.find((c) => c.cmd === 'analyze_path')?.args.expect; return e?.files === 6 && e?.bytes === 6000 && e?.modified === T0; })(), w.findAll('.record-panel .mv-member-hash').map((c: any) => c.text()).join('|'));

    console.log('\nF6f. Vocabulary outputs into LINK fields — a table of the owner\'s rows (Oct 17)');
    // Containers (Name, Aliases) and Codecs (Name, Aliases) are the owner's vocabulary
    // tables; Masters links into both. The code still normalises raw → canonical; the
    // rows are found by that name, else by an alias on a row.
    const tCont = randomUUID(), tCodecs = randomUUID(), tMasters = randomUUID();
    const g = { cName: randomUUID(), cAliases: randomUUID(), kName: randomUUID(), kAliases: randomUUID(), path: randomUUID(), name: randomUUID(), container: randomUUID(), codec: randomUUID(), rawCodec: randomUUID(), manifest: randomUUID() };
    const rowQt = randomUUID(), rowOp1a = randomUUID(), rowXq = randomUUID(), rowMystery = randomUUID();
    const r6f = await post([
      { type: 'table.create', id: tCont, name: 'Containers' }, { type: 'table.create', id: tCodecs, name: 'Codecs' }, { type: 'table.create', id: tMasters, name: 'Masters' },
      { type: 'field.create', id: g.cName, tableId: tCont, name: 'Name', key: 'name', fieldType: 'text' }, pos(g.cName, 0),
      { type: 'field.create', id: g.cAliases, tableId: tCont, name: 'Aliases', key: 'aliases', fieldType: 'long_text' }, pos(g.cAliases, 1),
      { type: 'field.create', id: g.kName, tableId: tCodecs, name: 'Name', key: 'name', fieldType: 'text' }, pos(g.kName, 0),
      { type: 'field.create', id: g.kAliases, tableId: tCodecs, name: 'Aliases', key: 'aliases', fieldType: 'text' }, pos(g.kAliases, 1),
      { type: 'record.create', id: rowQt, tableId: tCont, data: { name: 'QuickTime' } },
      { type: 'record.create', id: rowOp1a, tableId: tCont, data: { name: 'MXF OP1a', aliases: 'MXF' } },
      { type: 'record.create', id: rowXq, tableId: tCodecs, data: { name: 'Apple ProRes 4444 XQ', aliases: 'ProRes 4444 XQ, PR4444XQ' } },
      { type: 'record.create', id: rowMystery, tableId: tCodecs, data: { name: 'Mystery codec' } },
      { type: 'field.create', id: g.path, tableId: tMasters, name: 'Path', key: 'path', fieldType: 'file_path' }, pos(g.path, 0),
      { type: 'field.create', id: g.name, tableId: tMasters, name: 'Name', key: 'name', fieldType: 'text' }, pos(g.name, 1),
      { type: 'field.create', id: g.container, tableId: tMasters, name: 'Container', key: 'container', fieldType: 'link', options: { target_table_id: tCont, single: true } }, pos(g.container, 2),
      { type: 'field.create', id: g.codec, tableId: tMasters, name: 'Codec', key: 'codec', fieldType: 'link', options: { target_table_id: tCodecs } }, pos(g.codec, 3),
      { type: 'field.create', id: g.rawCodec, tableId: tMasters, name: 'Raw codec', key: 'video_codec', fieldType: 'text' }, pos(g.rawCodec, 4),
      { type: 'field.create', id: g.manifest, tableId: tMasters, name: 'Manifest', key: 'manifest', fieldType: 'structured', options: { shape: 'manifest' } },
      { type: 'table.update', id: tMasters, tools: { file_drop: { steps: [
        { analyzer: 'filesystem', map: { path: g.path, name: g.name, manifest: g.manifest } },
        { analyzer: 'ffprobe', map: { container: g.container, codec: g.codec, video_codec: g.rawCodec } },
      ] } } },
    ]);
    check('the server accepts a recipe mapping the Container and Codec outputs to LINK fields', r6f.status === 200, (await r6f.text()).slice(0, 300));
    const { routeLinks: route } = await import('../src/client/tools/fileDrop.js');
    const mfields = [{ id: g.container, table_id: tMasters, name: 'Container', key: 'container', type: 'link', options: { target_table_id: tCont }, position: 0, required: false }, { id: g.name, table_id: tMasters, name: 'Name', key: 'name', type: 'text', options: {}, position: 1, required: false }] as any;
    const rowsOf = (id: string) => (id === tCont ? [{ id: rowQt, name: 'QuickTime' }, { id: rowOp1a, name: 'MXF OP1a', aliases: 'MXF' }] : []);
    const rt = route({ container: 'QuickTime', name: 'a.mov', codec: 'MXF' }, { container: ['mov,mp4,m4a,3gp,3g2,mj2', 'qt  ', 'mov'] }, new Map([['container', 'container'], ['name', 'name']]), mfields, rowsOf, () => 'Containers');
    check('routeLinks (pure): a link-mapped canonical output becomes a link to the row of that name and LEAVES the values; an unmapped one is untouched', rt.links.length === 1 && rt.links[0].toRecord === rowQt && rt.links[0].fieldId === g.container && rt.outputs.container === undefined && rt.outputs.name === 'a.mov' && rt.outputs.codec === 'MXF' && rt.unresolved.length === 0, JSON.stringify(rt));
    const rt2 = route({}, { container: ['wav'] }, new Map([['container', 'container']]), mfields, rowsOf, () => 'Containers');
    check('…no canonical name and no alias: no link, and the message names the raw spelling to add', rt2.links.length === 0 && /wav is not in the built-in container list, and no Containers row has it as an alias — add a row with the alias “wav”/.test(rt2.unresolved[0]?.message ?? ''), JSON.stringify(rt2.unresolved));
    const rt3 = route({ container: 'MP4' }, { container: ['mov,mp4,m4a,3gp,3g2,mj2', 'isom', 'mp4'] }, new Map([['container', 'container']]), mfields, rowsOf, () => 'Containers');
    check('…a canonical name with no row: the message says which row to add', /Containers has no row named “MP4” — add one, or give a row the alias “MP4”/.test(rt3.unresolved[0]?.message ?? ''), JSON.stringify(rt3.unresolved));

    await sleep(500);   // the recipe just posted reaches the page over the stream; a drop before it lands says "File drop is not enabled"
    await go(tMasters);
    const mlinks = (name: string) => rows(`select l.field_id, l.to_record from links l join records r on r.id = l.from_record where r.table_id = '${tMasters}' and r.data->>'name' = '${name}'`);
    drop(['/mnt/san/b.mov', '/mnt/san/mix2.wav']);
    let ml = await untilDb(`select l.field_id, l.to_record from links l join records r on r.id = l.from_record where r.table_id = '${tMasters}' and r.data->>'name' = 'b.mov'`, (x) => x.length === 2);
    check('dropping a QuickTime ProRes 4444 XQ links Container → the "QuickTime" row (by name) and Codec → "Apple ProRes 4444 XQ" (by its ALIAS "ProRes 4444 XQ")', ml.some((l) => l.field_id === g.container && l.to_record === rowQt) && ml.some((l) => l.field_id === g.codec && l.to_record === rowXq), JSON.stringify(ml));
    check('the raw codec is still written as a value beside the link; the canonical name is NOT written anywhere as text', (await rows(`select data from records where table_id = '${tMasters}' and data->>'name' = 'b.mov'`))[0].data.video_codec === 'prores' && JSON.stringify((await rows(`select data from records where table_id = '${tMasters}' and data->>'name' = 'b.mov'`))[0].data).includes('QuickTime') === false);
    check('the wav: WAV has no row in Containers — not linked, and the notice says which row to add', await until(() => /mix2\.wav: not linked — Container: Containers has no row named “WAV” — add one, or give a row the alias “WAV”/.test(noticesText())) && (await mlinks('mix2.wav')).length === 0, noticesText());
    check('the grid shows the linked rows as pills', await until(() => w.findAll('.gridview tr.row').some((r: any) => /b\.mov/.test(r.text()) && /QuickTime/.test(r.text()) && /Apple ProRes 4444 XQ/.test(r.text()))));
    check('every link of the drop is tagged via file_drop and is NOT its own undo step', (await rows(`select via from mutations where type = 'link.add' and (payload->>'fromRecord')::uuid in (select id from records where table_id = '${tMasters}')`)).every((m) => m.via === 'file_drop'));

    // What the code does not know, an alias teaches: "prores / Something New" on the Mystery row.
    drop(['/mnt/san/weird.mov']);
    check('an unknown profile with no alias: not linked, and the notice gives the exact spelling to paste into Aliases', await until(() => /weird\.mov: not linked — Codec: prores \/ Something New is not in the built-in video_codec list, and no Codecs row has it as an alias — add a row with the alias “prores \/ Something New”/.test(noticesText())), noticesText());
    check('…and no separate "not in the vocabulary" notice for the same output — one message, the link\'s', !/weird\.mov: not written — Codec/.test(noticesText()));
    await post([{ type: 'record.update', id: rowMystery, set: { aliases: 'prores / Something New' }, unset: [] }]);
    await sleep(300);
    for (const n of w.findAll('.desk-notice')) await n.trigger('click');
    // Re-running the recipe on a record is a drop ONTO it (Oct 18): the file again, on its row.
    const weirdId = (await rows(`select id from records where table_id = '${tMasters}' and data->>'name' = 'weird.mov'`))[0].id;
    await until(() => w.find(`.gridview tr.row[data-record-id="${weirdId}"]`).exists());
    // A record with no manifest (made by hand, or before the table kept one) has nothing to compare a drop against.
    await post([{ type: 'record.update', id: weirdId, set: {}, unset: ['manifest'] }]);
    await sleep(300);
    const seen6f = nav.dialogs.seen.length;
    await dropOntoRow(weirdId, ['/mnt/san/weird.mov']);   // the autopilot answers Replace
    check('a file dropped ONTO a record with nothing to compare against (it has no manifest) ASKS: "Replace file info?", naming both files and saying why',
      await until(() => nav.dialogs.seen.length > seen6f) && /Replace file info\?/.test(nav.dialogs.seen.at(-1)!) && /This record \| Dropped/.test(nav.dialogs.bodies.at(-1)!)
      && (nav.dialogs.bodies.at(-1)!.match(/\/mnt\/san\/weird\.mov/g) ?? []).length === 2 && /no manifest to compare with/.test(nav.dialogs.bodies.at(-1)!) && /keeps everything else/.test(nav.dialogs.bodies.at(-1)!), nav.dialogs.bodies.at(-1));
    ml = await untilDb(`select l.field_id, l.to_record from links l join records r on r.id = l.from_record where r.table_id = '${tMasters}' and r.data->>'name' = 'weird.mov'`, (x) => x.some((l) => l.field_id === g.codec));
    check('Replace re-ran the recipe: the SAME record gets Codec → Mystery codec (the alias added meanwhile), no duplicate', ml.find((l) => l.field_id === g.codec)?.to_record === rowMystery && (await rows(`select id from records where table_id = '${tMasters}' and data->>'name' = 'weird.mov'`)).length === 1, JSON.stringify(ml));

    // Replace REPLACES a link the way it overwrites a select: set Container to OP1a by hand, drop b.mov onto its row, Replace.
    const bId = (await rows(`select id from records where table_id = '${tMasters}' and data->>'name' = 'b.mov'`))[0].id;
    await post([{ type: 'link.remove', fieldId: g.container, fromRecord: bId, toRecord: rowQt }, { type: 'link.add', id: randomUUID(), fieldId: g.container, fromRecord: bId, toRecord: rowOp1a }, { type: 'record.update', id: bId, set: {}, unset: ['manifest'] }]);
    await untilDb(`select to_record from links where field_id = '${g.container}' and from_record = '${bId}'`, (x) => x.length === 1 && x[0].to_record === rowOp1a);
    nav.dialogs.cancelNext = true;
    const seenB = nav.dialogs.seen.length;
    await dropOntoRow(bId, ['/mnt/san/b.mov']);
    await until(() => nav.dialogs.seen.length > seenB);
    await sleep(200);
    check('Cancel leaves the record exactly as it was', (await rows(`select to_record from links where field_id = '${g.container}' and from_record = '${bId}'`))[0].to_record === rowOp1a && !w.find('.dlg').exists());
    await dropOntoRow(bId, ['/mnt/san/b.mov']);
    ml = await untilDb(`select to_record from links where field_id = '${g.container}' and from_record = '${bId}'`, (x) => x.length === 1 && x[0].to_record === rowQt);
    check('Replace puts the hand-set Container back to what the file is (QuickTime) — one link, not two', ml.length === 1 && ml[0].to_record === rowQt);

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

    console.log('\nF9. Dropping ONTO a record: size and date decide, and the person confirms (Oct 18; Nov 23 — never a hash)');
    // final.mov (from F6d: an md5 in its manifest) gets a card at (100, 100).
    const finalId = (await rows(`select id from records where table_id = '${tFiles}' and data->>'name' = 'final.mov'`))[0].id;
    await post([{ type: 'placement.add', id: randomUUID(), canvasId: boardId, recordId: finalId, x: 100, y: 100, w: null, h: null, z: 5 }]);
    await until(() => w.findAll('.canvas-world .card').some((c: any) => /final\.mov/.test(c.text())));
    const finalCard = () => w.findAll('.canvas-world .card').find((c: any) => /final\.mov/.test(c.text()))!;
    // The recipe for this section: the filesystem and ffprobe. (No hash is a step.)
    await post([{ type: 'table.update', id: tFiles, tools: { file_drop: { steps: [
      { analyzer: 'filesystem', map: { path: f.path, name: f.name, kind: f.kind, manifest: f.manifest, total_size: f.size, media: f.media } },
      { analyzer: 'ffprobe', map: { width: f.width, frame_rate: f.rate, audio_layout: f.layout, codec: f.codec, video_codec: f.rawCodec, container: f.container, audio_codec: f.audioCodec, color_primaries: f.primaries, raw_dump: f.dump } },
    ] } } }]);
    await sleep(300);
    const finalData = async () => (await rows(`select data from records where id = '${finalId}'`))[0].data;
    const hashCalls = () => calls.filter((c) => (c.cmd === 'analyze' || c.cmd === 'analyze_path') && c.args.analyzer.startsWith('hash-'));

    enter(['/mnt/san/x.mov', '/mnt/san/y.mov'], 110, 110); over(112, 112);
    check('TWO files over a card: the card wears the drop ring, the overlay goes clear, and the label says only one file can replace a record — before letting go', await until(() => finalCard().classes('drop-target')) && w.find('.file-drop').classes('onto') && /Only one file can replace a record — 2/.test(w.find('.file-drop-msg').text()) && !w.find('.file-drop').classes('ok'), w.find('.file-drop').text());
    calls.length = 0;
    drop(['/mnt/san/x.mov', '/mnt/san/y.mov'], 112, 112);
    check('…letting go: the card flashes refused, nothing is created, nothing is read', await until(() => finalCard().classes('refused')) && await until(() => /Only one file can replace a record — 2 were dropped/.test(noticesText())) && (await rows(`select 1 from records where table_id = '${tFiles}' and data->>'name' in ('x.mov', 'y.mov')`)).length === 0 && !calls.some((c) => c.cmd === 'analyze'), noticesText());
    await sleep(100);
    check('…and the ring is gone', !finalCard().classes('drop-target'));
    for (const n of w.findAll('.desk-notice')) await n.trigger('click');

    enter(['/mnt/san/final.mov'], 110, 110); over(112, 112);
    check('ONE file over the card: the label names the record — "Update final.mov with this file"', await until(() => /Update final\.mov with this file/.test(w.find('.file-drop-msg').text())) && w.find('.file-drop').classes('ok'), w.find('.file-drop').text());
    calls.length = 0;
    const was = await finalData();
    const seenSame = nav.dialogs.seen.length;
    drop(['/mnt/san/final.mov'], 112, 112);
    check('the SAME file (same path, same size, same modified date): "nothing to update" — a notice, no dialog, and NOTHING is read', await until(() => /final\.mov: nothing to update — same path, size and modified date as this record/.test(noticesText())) && hashCalls().length === 0 && nav.dialogs.seen.length === seenSame, `${noticesText()} | ${calls.map((c) => c.cmd).join()}`);
    await sleep(150);
    check('…no recipe ran (no ffprobe), nothing changed — the manifest\'s md5 is as it was', !calls.some((c) => c.cmd === 'analyze') && JSON.stringify(await finalData()) === JSON.stringify(was) && /^md5:/.test(was.manifest.hashes.md5));
    for (const n of w.findAll('.desk-notice')) await n.trigger('click');

    // The same size and date at ANOTHER path: it looks like a move — and it ASKS, both sides on screen.
    calls.length = 0;
    enter(['/mnt/san/moved/final.mov'], 110, 110); over(112, 112);
    await until(() => finalCard().classes('drop-target'));
    nav.dialogs.cancelNext = true;
    let seenMove = nav.dialogs.seen.length;
    drop(['/mnt/san/moved/final.mov'], 112, 112);
    check('same size and date at ANOTHER path: never silent — "Update path?" with a verdict line and a before / after table',
      await until(() => nav.dialogs.seen.length > seenMove) && nav.dialogs.seen.at(-1) === 'Update path?' && /^Same size and modified date — this looks like the same file, moved or renamed\./.test(nav.dialogs.bodies.at(-1)!)
      && / \| This record \| Dropped/.test(nav.dialogs.bodies.at(-1)!), nav.dialogs.bodies.at(-1));
    check('…the table: the Path row differs and is MARKED; Name, Size and Modified agree and are not; the date is a local date-time',
      /Path \| \/mnt\/san\/final\.mov \| \/mnt\/san\/moved\/final\.mov \[differs\]/.test(nav.dialogs.bodies.at(-1)!) && /Name \| final\.mov \| final\.mov\n/.test(nav.dialogs.bodies.at(-1)!)
      && /Size \| 1000 B \| 1000 B\n/.test(nav.dialogs.bodies.at(-1)!) && /Modified \| (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) \| \1\n/.test(nav.dialogs.bodies.at(-1)!) && !/Files \|/.test(nav.dialogs.bodies.at(-1)!), nav.dialogs.bodies.at(-1));
    check('…and it says what Update path does: name and path only, details and hashes kept', /changes this record's name and path\. Its details and hashes are kept/.test(nav.dialogs.bodies.at(-1)!));
    await sleep(200);
    check('Cancel: nothing changed, nothing read', (await finalData()).path === '/mnt/san/final.mov' && hashCalls().length === 0 && !calls.some((c) => c.cmd === 'analyze'));
    const seqBefore9 = Number((await rows(`select coalesce(max(seq), 0) n from mutations`))[0].n);
    seenMove = nav.dialogs.seen.length;
    enter(['/mnt/san/moved/final.mov'], 110, 110); over(112, 112);
    await until(() => finalCard().classes('drop-target'));
    drop(['/mnt/san/moved/final.mov'], 112, 112);   // the autopilot answers Update path
    const moved = await untilDb(`select data from records where id = '${finalId}'`, (x) => x[0].data.path === '/mnt/san/moved/final.mov');
    check('Update path: the path follows, and a notice says so', moved[0].data.path === '/mnt/san/moved/final.mov' && await until(() => /path updated to \/mnt\/san\/moved\/final\.mov/.test(noticesText())), noticesText());
    await sleep(150);
    check('…the manifest KEEPS its md5 and its stat, the details stay, no recipe ran, nothing was read, and it was ONE undoable mutation', moved[0].data.manifest.hashes.md5 === was.manifest.hashes.md5 && statIs(moved[0].data.manifest.stat, 1, 1000, T0) && moved[0].data.width === was.width
      && !calls.some((c) => c.cmd === 'analyze') && hashCalls().length === 0 && Number((await rows(`select coalesce(max(seq), 0) n from mutations`))[0].n) === seqBefore9 + 1, JSON.stringify(moved[0].data));
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    check('Ctrl+Z puts the old path back', (await untilDb(`select data from records where id = '${finalId}'`, (x) => x[0].data.path === '/mnt/san/final.mov')).length === 1);
    for (const n of w.findAll('.desk-notice')) await n.trigger('click');

    calls.length = 0;
    enter(['/mnt/san/big_final.mov'], 110, 110); over(112, 112);
    await until(() => finalCard().classes('drop-target'));
    nav.dialogs.cancelNext = true;
    const seenBig = nav.dialogs.seen.length;
    drop(['/mnt/san/big_final.mov'], 112, 112);   // 2000 bytes against 1000; the autopilot cancels this one
    check('a file of ANOTHER SIZE: "Replace file info?" — the verdict names what differs, and the Size row is marked, to the byte', await until(() => nav.dialogs.seen.length > seenBig) && nav.dialogs.seen.at(-1) === 'Replace file info?' && /^A different file: the size differs\./.test(nav.dialogs.bodies.at(-1)!)
      && /Size \| 1000 B \(1,000 bytes\) \| 1\.95 KB \(2,000 bytes\) \[differs\]/.test(nav.dialogs.bodies.at(-1)!) && /Name \| final\.mov \| big_final\.mov \[differs\]/.test(nav.dialogs.bodies.at(-1)!)
      && /Path \| \/mnt\/san\/final\.mov \| \/mnt\/san\/big_final\.mov \[differs\]/.test(nav.dialogs.bodies.at(-1)!) && !/Modified \|.*\[differs\]/.test(nav.dialogs.bodies.at(-1)!) && hashCalls().length === 0, nav.dialogs.bodies.at(-1));
    check('…and it says what Replace does to hashes: cleared, they describe the old file', /Hashes are cleared/.test(nav.dialogs.bodies.at(-1)!) && /keeps everything else/.test(nav.dialogs.bodies.at(-1)!));
    await sleep(200);
    check('Cancel: nothing changed', (await finalData()).path === '/mnt/san/final.mov' && (await finalData()).total_size === 1000);

    calls.length = 0;
    enter(['/mnt/san/later_final.mov'], 110, 110); over(112, 112);
    await until(() => finalCard().classes('drop-target'));
    const seenOther = nav.dialogs.seen.length;
    drop(['/mnt/san/later_final.mov'], 112, 112);   // the same size, modified an HOUR later; the autopilot answers Replace
    check('the same size but ANOTHER DATE: a different file — the Modified row is marked, the Size row is not — and still nothing is read to find out', await until(() => nav.dialogs.seen.length > seenOther) && nav.dialogs.seen.at(-1) === 'Replace file info?' && /^A different file: the modified date differs\./.test(nav.dialogs.bodies.at(-1)!)
      && /Modified \| \d{4}-\d\d-\d\d \d\d:\d\d:\d\d \| \d{4}-\d\d-\d\d \d\d:\d\d:\d\d \[differs\]/.test(nav.dialogs.bodies.at(-1)!) && /Size \| 1000 B \| 1000 B\n/.test(nav.dialogs.bodies.at(-1)!) && hashCalls().length === 0, nav.dialogs.bodies.at(-1));
    const replaced = await untilDb(`select data from records where id = '${finalId}'`, (x) => x[0].data.path === '/mnt/san/later_final.mov' && x[0].data.width === 1920);
    await sleep(200);
    check('Replace: path and name are the new file\'s, the recipe ran again (ffprobe — and no hash), and the manifest is the new file\'s: its stat, and the old file\'s md5 GONE',
      replaced[0].data.name === 'later_final.mov' && replaced[0].data.manifest.hashes === undefined && replaced[0].data.manifest.stat.modified === T0 + 3600
      && calls.some((c) => c.cmd === 'analyze' && c.args.analyzer === 'ffprobe' && c.args.unit.name === 'later_final.mov') && hashCalls().length === 0, JSON.stringify(replaced[0].data));
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    const undone = await untilDb(`select data from records where id = '${finalId}'`, (x) => x[0].data.path === '/mnt/san/final.mov');
    check('…the replace was ONE undo step: Ctrl+Z brings back the old path and the old manifest, md5 included — the follow-ups were not steps of their own', undone[0].data.path === '/mnt/san/final.mov' && undone[0].data.manifest.hashes.md5 === was.manifest.hashes.md5 && undone[0].data.manifest.stat.modified === T0, JSON.stringify(undone[0].data));
    win.dispatchEvent(new (win as any).KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
    await untilDb(`select data from records where id = '${finalId}'`, (x) => x[0].data.path === '/mnt/san/later_final.mov');
    for (const n of w.findAll('.desk-notice')) await n.trigger('click');

    // A path that ALREADY belongs to another record: refused, with that record to open.
    const aId2 = (await rows(`select id from records where table_id = '${tFiles}' and data->>'path' = '/mnt/san/a.mov'`))[0].id;
    calls.length = 0;
    enter(['/mnt/san/a.mov'], 110, 110); over(112, 112);
    await until(() => finalCard().classes('drop-target'));
    drop(['/mnt/san/a.mov'], 112, 112);
    check('a file whose path is ANOTHER record\'s, dropped onto this one: refused — a path belongs to one record — with a pill to open that record; nothing read, nothing written', await until(() => /a\.mov is already the file of another Files record/.test(noticesText())) && w.find('.desk-notice .notice-pill').exists() && !calls.some((c) => c.cmd === 'analyze') && (await finalData()).path === '/mnt/san/later_final.mov', noticesText());
    await w.find('.desk-notice .notice-pill').trigger('click');
    check('…the pill opens that record in the tray, the canvas still open', await until(() => w.find('.record-panel').exists() && finalCard().exists()) && (await rows(`select id from records where id = '${aId2}'`)).length === 1);

    console.log('\nF10. The hash strip: progress for a checksum asked for by hand — nothing offers to hash on its own (Nov 23)');
    const strip = () => w.find('.tree-foot .fp');
    // Records made BY HAND (no drop): a path with no manifest, a manifest with no hashes and no stat, a sequence.
    const handA = randomUUID(), handB = randomUUID(), handSeq = randomUUID();
    calls.length = 0;
    await post([
      { type: 'record.create', id: handA, tableId: tFiles, data: { name: 'hand.mov', path: '/mnt/san/hand.mov' } },
      { type: 'record.create', id: handB, tableId: tFiles, data: { name: 'typed.wav', path: '/mnt/san/typed.wav', manifest: { kind: 'file', size: 1000 }, total_size: 1000 } },
      { type: 'record.create', id: handSeq, tableId: tFiles, data: { name: 'frames', path: '/mnt/san/frames', manifest: { kind: 'sequence', pattern: 'f.%04d.exr', first: 1, last: 3, count: 3, gaps: [] } } },
    ]);
    await sleep(500);
    check('records with no hash bring up NO strip and no offer: nothing says "no fingerprint", nothing asks to read them', !strip().exists() && !/fingerprint/i.test(w.find('.tree-foot').text()) && !calls.some((c) => c.cmd === 'allow_paths' || c.cmd === 'analyze_path'), w.find('.tree-foot').text());
    await go(tFiles);
    const openRow = async (name: string) => { await until(() => w.findAll('.gridview tr.row').some((row: any) => row.findAll('td')[1]?.text().startsWith(name))); await w.findAll('.gridview tr.row').find((row: any) => row.findAll('td')[1]?.text().startsWith(name))!.find('.expand').trigger('click'); await until(() => w.findAll('.record-panel .run-step').some((b: any) => b.text() === '▶ md5')); };
    const runMd5 = () => w.findAll('.record-panel .run-step').find((b: any) => b.text() === '▶ md5')!.trigger('click');
    await openRow('hand.mov');
    manualDelay = 300;
    await runMd5();
    check('▶ md5 on a record: WHILE it reads, the strip is the progress line — "Hash (md5) · hand.mov" with a bar', await until(() => strip().exists() && /Hash \(md5\) · hand\.mov/.test(strip().text())) && strip().find('.fp-bar').exists() && !strip().find('.fp-run').exists(), strip().exists() ? strip().text() : 'no strip');
    await strip().find('.fp-head').trigger('click');
    check('…clicked open, it lists the job — running, with its state and a × to cancel', await until(() => strip().find('.fp-list').exists()) && /hand\.mov/.test(strip().find('.fp-job').text()) && strip().find('.fp-job').classes('running') && strip().find('.fp-job .fp-x').exists(), strip().text());
    manualDelay = 0;
    const hand = await untilDb(`select data from records where id = '${handA}'`, (x) => !!x[0].data.manifest?.hashes?.md5, 8000);
    check('a hand-made record with NO manifest gets one from its path (classified afresh) — with its stat — and the md5 in it; a record with no size was sent no `expect`', hand[0].data.manifest.kind === 'file' && hand[0].data.manifest.size === 1000 && hand[0].data.manifest.stat.modified === T0 && /^md5:/.test(hand[0].data.manifest.hashes.md5)
      && calls.filter((c) => c.cmd === 'analyze_path').length === 1 && calls.find((c) => c.cmd === 'analyze_path')?.args.expect === undefined, JSON.stringify(hand[0].data.manifest));
    check('the strip is gone once the line is empty', await until(() => !strip().exists(), 4000));
    calls.length = 0;
    await openRow('typed.wav');
    await runMd5();
    const typed = await untilDb(`select data from records where id = '${handB}'`, (x) => !!x[0].data.manifest?.hashes?.md5, 8000);
    check('a record from BEFORE dates were kept (a size, no stat): the shell is told the size alone, and the md5 is stored together with the stat it was read at — so the hash is tied to a date from now on', JSON.stringify(calls.find((c) => c.cmd === 'analyze_path')?.args.expect) === JSON.stringify({ files: 1, bytes: 1000, modified: null })
      && statIs(typed[0].data.manifest.stat, 1, 1000, T0) && /^md5:/.test(typed[0].data.manifest.hashes.md5), JSON.stringify(typed[0].data.manifest));
    for (const n of w.findAll('.desk-notice')) await n.trigger('click');

    console.log('\nF11. A checksum is only stored while the file is still the one the record describes');
    drop(['/mnt/san/render.mov']);
    const render = await untilDb(`select id, data from records where table_id = '${tFiles}' and data->>'name' = 'render.mov'`, (x) => x.length === 1 && x[0].data.width === 1920);
    changedOnDisk.set('/mnt/san/render.mov', 1234);   // re-exported over the same name: another size at the same path
    await openRow('render.mov');
    calls.length = 0;
    const seq11 = Number((await rows(`select coalesce(max(seq), 0) n from mutations`))[0].n);
    await runMd5();
    check('the file CHANGED on disk since it was recorded: the shell refuses BEFORE reading (a stat, not ten minutes), and the notice says what changed and what to do — with the record to open',
      await until(() => /render\.mov: Hash \(md5\) not run — the file at this record's path is not the one recorded \(its size has changed since it was recorded\)\. Drop the file onto the record to refresh its file info, then run it again\./.test(noticesText())) && w.find('.desk-notice .notice-pill').exists(), noticesText());
    await sleep(200);
    check('…nothing was written', Number((await rows(`select coalesce(max(seq), 0) n from mutations`))[0].n) === seq11 && (await rows(`select data from records where id = '${render[0].id}'`))[0].data.manifest.hashes === undefined);
    for (const n of w.findAll('.desk-notice')) await n.trigger('click');
    ignoreExpect = true;   // a desktop build from before `expect`: it reads the whole file
    await until(() => w.findAll('.record-panel .run-step').some((b: any) => b.text() === '▶ md5'));
    await runMd5();
    check('a desktop build that does not know `expect` reads the file — and the page still does NOT store the hash: it would describe a file the record does not',
      await until(() => /render\.mov: Hash \(md5\) not stored — the file at this record's path is not the one recorded \(its size has changed since it was recorded\)/.test(noticesText())) && (await rows(`select data from records where id = '${render[0].id}'`))[0].data.manifest.hashes === undefined
      && Number((await rows(`select coalesce(max(seq), 0) n from mutations`))[0].n) === seq11, noticesText());
    ignoreExpect = false;
    for (const n of w.findAll('.desk-notice')) await n.trigger('click');
    // …and dropping the file onto the record is how it is refreshed: same path, another size → Replace.
    const seen11 = nav.dialogs.seen.length;
    await dropOntoRow(render[0].id, ['/mnt/san/render.mov']);   // the autopilot answers Replace
    const refreshed = await untilDb(`select data from records where id = '${render[0].id}'`, (x) => x[0].data.total_size === 1234);
    check('the SAME path with another size (a re-export over the same name): "Replace file info?" — the Path row is not marked, the Size row is — and Replace takes the new size', nav.dialogs.seen.length > seen11 && nav.dialogs.seen.at(-1) === 'Replace file info?' && /Path \| \/mnt\/san\/render\.mov \| \/mnt\/san\/render\.mov\n/.test(nav.dialogs.bodies.at(-1)!)
      && /Size \| .* \[differs\]/.test(nav.dialogs.bodies.at(-1)!) && refreshed[0].data.manifest.stat.bytes === 1234, nav.dialogs.bodies.at(-1));
    await until(() => w.findAll('.record-panel .run-step').some((b: any) => b.text() === '▶ md5'));
    await runMd5();
    check('…after which the md5 runs and is stored', !!(await untilDb(`select data from records where id = '${render[0].id}'`, (x) => !!x[0].data.manifest?.hashes?.md5, 8000))[0].data.manifest.hashes.md5);
    changedOnDisk.clear();

    console.log('\nF12. A multi-file drop: details for every file, in the order dropped — and no file is read (Nov 23)');
    await go(tFiles);
    for (const n of w.findAll('.desk-notice')) await n.trigger('click');
    calls.length = 0;
    drop(['/mnt/san/bigA.mov', '/mnt/san/smallB.mov', '/mnt/san/smallC.mov']);   // "big" is 2000 bytes in the fake, the others 1000
    const multi = await untilDb(`select data from records where table_id = '${tFiles}' and data->>'name' in ('bigA.mov', 'smallB.mov', 'smallC.mov')`, (x) => x.length === 3 && x.every((r) => r.data.width === 1920), 8000);
    await sleep(200);
    check('all three are records with their details and their stat; none carries a hash', multi.length === 3 && multi.every((r) => r.data.width === 1920 && r.data.manifest.stat.bytes === r.data.total_size && r.data.manifest.hashes === undefined), JSON.stringify(multi.map((r) => r.data.manifest)));
    check('ffprobe ran on each, and that is ALL the shell was asked to analyze', analyzeCalls().join() === 'ffprobe:bigA.mov,ffprobe:smallB.mov,ffprobe:smallC.mov' && !calls.some((c) => c.cmd === 'analyze_path'), analyzeCalls().join());

    console.log('\nF13. A hash that cannot be put into the manifest says WHY (it used to say "nowhere to keep it")');
    const { hashPlacementProblem: hpp, withHashes: wh } = await import('../src/client/tools/fileDrop.js');
    const fileUnit = { path: '/mnt/san/x.mov', name: 'x.mov', kind: 'file', manifest: { kind: 'file', size: 10 } } as any;
    const placedOk = wh({ hash: 'xxh3:00' }, fileUnit, { kind: 'file', size: 10 });
    check('a file\'s hash into a file manifest: placed, no problem', hpp(placedOk, fileUnit, { kind: 'file', size: 10 }) === null && (placedOk.manifest as any).hashes.xxh3 === 'xxh3:00');
    const stale = { kind: 'bundle', members: [{ path: 'a.mxf', size: 1 }] };
    const placedBad = wh({ hash: 'xxh3:00' }, fileUnit, stale);
    check('the record\'s manifest says BUNDLE but the path is now a single FILE: not placed, and the reason names both and what to do',
      placedBad.manifest === undefined && /the record's manifest describes a bundle, but what is at its path now is a file — drop the file onto the record to replace its file info/.test(String(hpp(placedBad, fileUnit, stale))), String(hpp(placedBad, fileUnit, stale)));
    const setUnit = { path: '/mnt/san/mix', name: 'mix', kind: 'channel_set', manifest: { kind: 'channel_set', members: [] } } as any;
    check('…and the other way round (a file manifest, a channel set on disk) reads the same way', /describes a file, but what is at its path now is a channel set/.test(String(hpp(wh({ member_hashes: [{ path: 'L.wav', hash: 'xxh3:01' }] }, setUnit, { kind: 'file', size: 10 }), setUnit, { kind: 'file', size: 10 }))));
    const { comparisonTable, changedSinceRecorded } = await import('../src/client/tools/fileDrop.js');
    const { compareFingerprints: cf, fingerprintOf: fo } = await import('../src/contract/fingerprint.js');
    const oldSeq = { kind: 'sequence', pattern: 'p.%04d.exr', first: 1, last: 10, count: 10, gaps: [] } as any, newSeq = { ...oldSeq, last: 12, count: 12, stat: { files: 12, bytes: 1200, modified: T0 } };
    const tSeq = comparisonTable({ name: 'plate', path: '/a', print: fo(oldSeq) }, { name: 'plate', path: '/a', print: fo(newSeq) }, cf(oldSeq, newSeq));
    check('the table for a SET shows a Files row; a record with no size says "not recorded"; the verdict lists what differs', tSeq.rows.map((r: any) => r.label).join() === 'Name,Path,Files,Size,Modified' && tSeq.rows[2].cells.join() === '10,12' && tSeq.rows[2].differs === true
      && tSeq.rows[3].cells[0] === 'not recorded' && tSeq.rows[4].cells[0] === 'not recorded' && tSeq.verdict?.text === 'A different file: the file count differs.' && tSeq.verdict?.tone === 'differs', JSON.stringify(tSeq));
    const noDate = { kind: 'file', size: 1000 } as any, dated = { kind: 'file', size: 1000, stat: { files: 1, bytes: 1000, modified: T0 } } as any;
    const tOld = comparisonTable({ name: 'a.mov', path: '/a/a.mov', print: fo(noDate) }, { name: 'a.mov', path: '/b/a.mov', print: fo(dated) }, cf(noDate, dated));
    check('a record from before dates were kept: matched by size ALONE, and the verdict says so', tOld.verdict?.tone === 'same' && /^Same size\. This record has no modified date to compare/.test(tOld.verdict!.text) && /by size alone/.test(tOld.verdict!.text) && tOld.rows.at(-1)!.cells[0] === 'not recorded' && !tOld.rows.at(-1)!.differs, JSON.stringify(tOld));
    check('changedSinceRecorded: null while size and date agree (2 s of slack); names what changed otherwise; a different KIND is left to the placement message', changedSinceRecorded(dated, { ...dated, stat: { ...dated.stat, modified: T0 + 2 } }) === null && changedSinceRecorded(noDate, dated) === null
      && changedSinceRecorded(dated, { kind: 'file', size: 1001, stat: { files: 1, bytes: 1001, modified: T0 + 60 } }) === 'its size and modified date have changed since it was recorded' && changedSinceRecorded(dated, oldSeq) === null && changedSinceRecorded(undefined, dated) === null);
    check('withHashes gives a record with no stat the fresh one, and leaves a stat the record already has alone', JSON.stringify((wh({ hash: 'md5:' + '00'.repeat(16) }, { ...fileUnit, manifest: dated }, noDate).manifest as any).stat) === JSON.stringify(dated.stat)
      && (wh({ hash: 'md5:' + '00'.repeat(16) }, { ...fileUnit, manifest: { ...dated, stat: { files: 1, bytes: 1000, modified: T0 + 1 } } }, dated).manifest as any).stat.modified === T0);
    check('a set whose hash came back with no members says so', /came back empty/.test(String(hpp(wh({ member_hashes: [] }, setUnit, setUnit.manifest), setUnit, setUnit.manifest))));
  } finally {
    await ui.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('SUITE ABORTED', e); process.exit(1); });
