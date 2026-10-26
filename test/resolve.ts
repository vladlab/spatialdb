/**
 * The Resolve timeline tool's CONTRACT (RESOLVE-BRIEF.md R1), pure: the second
 * tool id and the rule's per-tool shape, the analyzer and where its outputs may
 * land, the `timeline_audio` shape, its summary, and the derivation of an
 * `audio_layout` from Resolve's track formats.
 *
 * Nothing here talks to Resolve or the desktop shell: that is R2, and needs eyes.
 * The server's refusal of a bad value on write is in test/structured.ts (T-R).
 */
import { randomUUID } from 'node:crypto';
import { ANALYZERS, REQUIRED, REQUIRED_BY_TOOL, TOOL_IDS, TOOL_NAMES, TablesTools, Via, analyzerOf, analyzersOf, defaultRecipe, describe, fieldAccepts, pruneTools, toolsProblem } from '../src/contract/tools.js';
import { FIELD_FORM_SHAPES, SHAPES, SHAPE_LABELS, TimelineAudio, diffLayouts, layoutFromTimeline, resolveTrackChannels, structuredError, summarise } from '../src/contract/shapes.js';
import { validateValue } from '../src/contract/values.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const fName = randomUUID(), fFps = randomUUID(), fDrop = randomUUID(), fStart = randomUUID(), fDims = randomUUID(),
  fTracks = randomUUID(), fLayout = randomUUID(), fFiles = randomUUID(), fPath = randomUUID(), fManifest = randomUUID(), fCodec = randomUUID();
const fields = [
  { id: fName, key: 'name', name: 'Name', type: 'text', options: {} },
  { id: fFps, key: 'fps', name: 'FPS', type: 'number', options: {} },
  { id: fDrop, key: 'df', name: 'Drop frame', type: 'checkbox', options: {} },
  { id: fStart, key: 'start_tc', name: 'Start TC', type: 'text', options: {} },
  { id: fDims, key: 'size', name: 'Size', type: 'dimensions', options: {} },
  { id: fTracks, key: 'audio_tracks', name: 'Audio tracks', type: 'structured', options: { shape: 'timeline_audio' } },
  { id: fLayout, key: 'audio_layout', name: 'Audio layout', type: 'structured', options: { shape: 'audio_layout' } },
  { id: fFiles, key: 'audio_files', name: 'Audio files', type: 'link', options: { target_table_id: randomUUID() } },
  { id: fPath, key: 'path', name: 'Path', type: 'file_path', options: {} },
  { id: fManifest, key: 'manifest', name: 'Manifest', type: 'structured', options: { shape: 'manifest' } },
  { id: fCodec, key: 'codec', name: 'Codec', type: 'text', options: {} },
];
const fieldOf = (id: string) => fields.find((f) => f.id === id)!;
const resolveStep = (map: Record<string, string>, extra: Record<string, unknown> = {}) => ({ analyzer: 'resolve', map, ...extra });
const full = { timeline_name: fName, frame_rate: fFps, drop_frame: fDrop, start_timecode: fStart, dimensions: fDims, audio_tracks: fTracks, audio_layout: fLayout, audio_files: fFiles };

const clip = (name: string, start: string, end: string, frames: number, path?: string) => ({ name, start, end, frames, ...(path ? { path } : {}) });
const deliverable: TimelineAudio = { tracks: [
  { index: 1, name: 'A1', format: 'stereo', clips: [clip('EP101_Mix_ST.wav', '00:59:30:00', '01:52:14:08', 75968, '/mnt/post/EP101/mix/EP101_Mix_ST.wav')] },
  { index: 2, name: 'A2', format: '5.1', clips: [clip('EP101_Mix_51.wav', '00:59:30:00', '01:52:14:08', 75968, '/mnt/post/EP101/mix/EP101_Mix_51.wav')] },
  { index: 3, name: 'A3', format: 'stereo', clips: [
    clip('tone', '00:58:30:00', '00:59:30:00', 1440),
    clip('EP101_ME_ST.wav', '00:59:30:00', '01:52:14:08', 75968, '/mnt/post/EP101/mix/EP101_ME_ST.wav'),
    clip('EP101_ME_tail.wav', '01:52:14:08', '01:52:20:00', 136, '/mnt/post/EP101/mix/EP101_ME_tail.wav'),
  ] },
] };

/* ── R1.1 the second tool ─────────────────────────────────────────────────── */

console.log('\nR1. The tool id and the rule\'s per-tool shape');
check('there are two tools, and the second is "resolve", named "Resolve timeline"', TOOL_IDS.join() === 'file_drop,resolve' && TOOL_NAMES.resolve === 'Resolve timeline');
check('a table may enable it: tables.tools.resolve parses', TablesTools.safeParse({ resolve: defaultRecipe('resolve') }).success);
check('"resolve" is a valid via tag (History says where a batch came from)', Via.safeParse('resolve').success);
check('its default recipe is its one step, nothing mapped', JSON.stringify(defaultRecipe('resolve')) === '{"steps":[{"analyzer":"resolve","map":{}}]}');
check('File drop\'s default recipe is unchanged (filesystem, then ffprobe)', JSON.stringify(defaultRecipe()) === JSON.stringify(defaultRecipe('file_drop')) && defaultRecipe().steps.map((s) => s.analyzer).join() === 'filesystem,ffprobe');
check('the empty default passes — nothing is REQUIRED of the Resolve tool (it writes onto the record it was asked from)', toolsProblem({ resolve: defaultRecipe('resolve') }, fields) === null && REQUIRED_BY_TOOL.resolve.length === 0, String(toolsProblem({ resolve: defaultRecipe('resolve') }, fields)));
check('…while File drop still requires its Path (REQUIRED is File drop\'s, as before)', /needs "Path"/.test(String(toolsProblem({ file_drop: { steps: [{ analyzer: 'filesystem', map: {} }] } }, fields))) && REQUIRED === REQUIRED_BY_TOOL.file_drop);
check('a full mapping passes', toolsProblem({ resolve: { steps: [resolveStep(full)] } }, fields) === null, String(toolsProblem({ resolve: { steps: [resolveStep(full)] } }, fields)));
check('both tools on one table pass, each by its own rules', toolsProblem({ file_drop: { steps: [{ analyzer: 'filesystem', map: { path: fPath, manifest: fManifest } }] }, resolve: { steps: [resolveStep({ timeline_name: fName })] } }, fields) === null);
check('two tools MAY write one field: each runs by a separate act, so nothing races', toolsProblem({ file_drop: { steps: [{ analyzer: 'filesystem', map: { path: fPath, name: fName } }] }, resolve: { steps: [resolveStep({ timeline_name: fName })] } }, fields) === null);
check('no step at all is refused, by count', /exactly one step .*not 0/.test(String(toolsProblem({ resolve: { steps: [] } }, fields))));
check('two steps are refused, by count', /exactly one step .*not 2/.test(String(toolsProblem({ resolve: { steps: [resolveStep({}), resolveStep({})] } }, fields))));
for (const [k, v] of [['runs_on', { media: ['video'] }], ['when', 'manual'], ['into_manifest', true]] as const) {
  check(`a "${k}" on its step is refused, naming the key`, new RegExp(`"${k}" means nothing for this tool`).test(String(toolsProblem({ resolve: { steps: [resolveStep({}, { [k]: v })] } }, fields))));
}
check('a File drop analyzer under the Resolve tool is refused, naming whose it is', /Resolve timeline step 1: "ffprobe" belongs to File drop/.test(String(toolsProblem({ resolve: { steps: [{ analyzer: 'ffprobe', map: {} }] } }, fields))), String(toolsProblem({ resolve: { steps: [{ analyzer: 'ffprobe', map: {} }] } }, fields)));
check('…and the Resolve analyzer inside a File drop recipe is refused the same way', /File drop step 2: "Resolve timeline" belongs to Resolve timeline/.test(String(toolsProblem({ file_drop: { steps: [{ analyzer: 'filesystem', map: { path: fPath } }, resolveStep({})] } }, fields))));
check('an output of another analyzer is refused ("codec" is ffprobe\'s)', /Resolve timeline: no output called "codec"/.test(String(toolsProblem({ resolve: { steps: [resolveStep({ codec: fCodec })] } }, fields))));
check('two Resolve outputs into one field are refused (as within File drop)', /two outputs .* same field/.test(String(toolsProblem({ resolve: { steps: [resolveStep({ timeline_name: fName, project: fName })] } }, fields))));

/* ── R1.2 the analyzer and its outputs ────────────────────────────────────── */

console.log('\nR2. The analyzer');
const R = analyzerOf('resolve')!;
check('the analyzer exists, belongs to the Resolve tool, and runs python3', !!R && R.tool === 'resolve' && R.program === 'python3');
check('every analyzer belongs to exactly one tool, and File drop\'s editor list has no Resolve in it', ANALYZERS.every((a) => (TOOL_IDS as readonly string[]).includes(a.tool)) && !analyzersOf('file_drop').some((a) => a.id === 'resolve') && analyzersOf('resolve').map((a) => a.id).join() === 'resolve');
check('it offers its provenance: the Resolve version', R.outputs.some((o) => o.key === 'resolve.version'));
check('it offers what the owner asked for: name, size, fps, start TC, the audio tracks', ['timeline_name', 'dimensions', 'frame_rate', 'start_timecode', 'audio_tracks'].every((k) => R.outputs.some((o) => o.key === k)));
check('it does not read mute (the owner, Oct 26) — no output, and no field in the shape', !R.outputs.some((o) => /mute|enabled/i.test(o.key)) && !('enabled' in TimelineAudio.shape.tracks.element.shape));
const out = (k: string) => R.outputs.find((o) => o.key === k)!;
check('Audio tracks → only a structured field of shape timeline_audio', fieldAccepts(out('audio_tracks'), fieldOf(fTracks)) && !fieldAccepts(out('audio_tracks'), fieldOf(fLayout)) && !fieldAccepts(out('audio_tracks'), fieldOf(fName)));
check('Audio layout (derived) → only an audio_layout field', fieldAccepts(out('audio_layout'), fieldOf(fLayout)) && !fieldAccepts(out('audio_layout'), fieldOf(fTracks)));
check('Audio files → any LINK field, and nothing else', fieldAccepts(out('audio_files'), fieldOf(fFiles)) && !fieldAccepts(out('audio_files'), fieldOf(fName)) && !fieldAccepts(out('audio_files'), fieldOf(fPath)));
check('…and a NON-link output still cannot go into a link (only vocabulary and link outputs may)', !fieldAccepts(out('timeline_name'), fieldOf(fFiles)));
check('Drop frame → a checkbox; Frame rate → a number; Dimensions → a dimensions field', fieldAccepts(out('drop_frame'), fieldOf(fDrop)) && fieldAccepts(out('frame_rate'), fieldOf(fFps)) && fieldAccepts(out('dimensions'), fieldOf(fDims)) && !fieldAccepts(out('frame_rate'), fieldOf(fName)));
check('describe says what it is, in a sentence', (() => { const d = describe({ steps: [resolveStep({ timeline_name: fName, frame_rate: fFps })] }, fields, { resolve: '3.11.5' })[0]; return d === '1. For the timeline picked, when asked from the record: python3 3.11.5 → Timeline name → Name, Frame rate → FPS.' ? true : (console.log('      got: ' + d), false); })());
check('pruneTools drops a Resolve mapping whose field is gone, and keeps the rest', (() => { const p = pruneTools({ resolve: { steps: [resolveStep({ timeline_name: fName, frame_rate: randomUUID() })] } }, fields); return JSON.stringify(p.tools.resolve!.steps[0].map) === JSON.stringify({ timeline_name: fName }) && p.dropped.length === 1; })());

/* ── R1.3 the shape ───────────────────────────────────────────────────────── */

console.log('\nR3. The timeline_audio shape');
check('it is registered, labelled, and offered by the field form (a person may make the field by hand to map into)', SHAPES.includes('timeline_audio') && SHAPE_LABELS.timeline_audio === 'Timeline audio' && FIELD_FORM_SHAPES.includes('timeline_audio'));
check('a real deliverable timeline is accepted', structuredError('t', 'timeline_audio', deliverable) === null, String(structuredError('t', 'timeline_audio', deliverable)));
check('no tracks is accepted (a timeline with no audio)', structuredError('t', 'timeline_audio', { tracks: [] }) === null);
check('drop-frame labels (";") are accepted', structuredError('t', 'timeline_audio', { tracks: [{ index: 1, name: 'A1', format: 'stereo', clips: [clip('m', '00:59:30;00', '01:00:00;02', 900)] }] }) === null);
check('an unknown key is refused — a typo in the tool must fail loudly', /timeline audio/.test(structuredError('t', 'timeline_audio', { tracks: [{ ...deliverable.tracks[0], muted: false }] }) ?? ''));
check('…including an "enabled" flag: mute is not part of the shape', !!structuredError('t', 'timeline_audio', { tracks: [{ ...deliverable.tracks[0], enabled: true }] }));
check('a nine-digit label is refused, with what a label looks like', /a timecode label looks like/.test(structuredError('t', 'timeline_audio', { tracks: [{ index: 1, name: 'A1', format: 'stereo', clips: [clip('m', '001:00:00:00', '01:00:00:01', 1)] }] }) ?? ''));
check('a frame count that is not a whole number is refused', !!structuredError('t', 'timeline_audio', { tracks: [{ index: 1, name: 'A1', format: 'stereo', clips: [{ ...clip('m', '01:00:00:00', '01:00:01:00', 24), frames: 2.5 }] }] }));
check('track index 0 is refused (Resolve counts from 1: A1 is 1)', !!structuredError('t', 'timeline_audio', { tracks: [{ ...deliverable.tracks[0], index: 0 }] }));
check('an empty path is refused — a clip with no file has NO path, not ""', !!structuredError('t', 'timeline_audio', { tracks: [{ index: 1, name: 'A1', format: 'stereo', clips: [{ ...clip('m', '01:00:00:00', '01:00:01:00', 24), path: '' }] }] }));
const fieldShape = { key: 'audio_tracks', type: 'structured', options: { shape: 'timeline_audio' } };
check('validateValue (what the server runs on write) refuses a bad value and accepts a good one', validateValue(fieldShape as never, deliverable) === null && /timeline audio/.test(validateValue(fieldShape as never, { tracks: 'A1' }) ?? ''), String(validateValue(fieldShape as never, deliverable)));

console.log('\nR4. The summary');
check('one line: name and format per track, the clip count only when it is not 1', summarise('timeline_audio', deliverable) === 'A1 stereo · A2 5.1 · A3 stereo (3)', summarise('timeline_audio', deliverable));
check('an empty lane shows (0) — worth seeing on a deliverable', summarise('timeline_audio', { tracks: [{ index: 1, name: 'A1', format: 'stereo', clips: [] }] }) === 'A1 stereo (0)');
check('tracks read in Resolve\'s order whatever order they are stored in', summarise('timeline_audio', { tracks: [deliverable.tracks[1], deliverable.tracks[0]] }) === 'A1 stereo · A2 5.1');
check('an unnamed track reads as its slot, A4', summarise('timeline_audio', { tracks: [{ index: 4, name: '', format: 'mono', clips: [clip('vo', '01:00:00:00', '01:00:01:00', 24)] }] }) === 'A4 mono');
check('no tracks: "no audio tracks"; invalid: says so', summarise('timeline_audio', { tracks: [] }) === 'no audio tracks' && summarise('timeline_audio', { tracks: 1 }) === 'invalid timeline audio');
check('detail (search, filter, sort) names every clip, so a mix file name finds the record', summarise('timeline_audio', deliverable, true) === 'A1 stereo (EP101_Mix_ST.wav) · A2 5.1 (EP101_Mix_51.wav) · A3 stereo (tone, EP101_ME_ST.wav, EP101_ME_tail.wav)', summarise('timeline_audio', deliverable, true));

/* ── R1.4 the derivation ──────────────────────────────────────────────────── */

console.log('\nR5. layoutFromTimeline — Resolve\'s formats → channels');
const table: Array<[string, string]> = [
  ['mono', 'M'], ['stereo', 'L R'], ['5.1', 'L R C LFE Ls Rs'], ['5.1film', 'L C R Ls Rs LFE'],
  ['7.1', 'L R C LFE Ls Rs Lrs Rrs'], ['7.1film', 'L C R Ls Rs Lrs Rrs LFE'], ['adaptive1', 'ch1'], ['adaptive6', 'ch1 ch2 ch3 ch4 ch5 ch6'],
];
for (const [fmt, ch] of table) check(`${fmt} → ${ch}`, resolveTrackChannels(fmt)?.join(' ') === ch, String(resolveTrackChannels(fmt)?.join(' ')));
check('adaptive36 is the most there is; adaptive37 and adaptive0 are not formats', resolveTrackChannels('adaptive36')?.length === 36 && resolveTrackChannels('adaptive37') === null && resolveTrackChannels('adaptive0') === null);
check('case and stray spaces do not matter ("Stereo ")', resolveTrackChannels('Stereo ')?.join(' ') === 'L R');
check('the 5.1 and 7.1 channels are the house presets\' spelling', resolveTrackChannels('5.1')!.join() === 'L,R,C,LFE,Ls,Rs' && resolveTrackChannels('7.1')!.join() === 'L,R,C,LFE,Ls,Rs,Lrs,Rrs');
const d = layoutFromTimeline(deliverable);
check('one layout track per Resolve track, named after it, in order — EVERY track (mute is not read)', JSON.stringify(d.layout) === JSON.stringify({ tracks: [{ name: 'A1', channels: ['L', 'R'] }, { name: 'A2', channels: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'] }, { name: 'A3', channels: ['L', 'R'] }] }) && d.problems.length === 0, JSON.stringify(d));
check('the derived layout is a valid audio_layout value', structuredError('l', 'audio_layout', d.layout) === null);
check('stored out of order, derived in Resolve\'s order', layoutFromTimeline({ tracks: [deliverable.tracks[2], deliverable.tracks[0]] }).layout.tracks.map((t) => t.name).join() === 'A1,A3');
const odd = layoutFromTimeline({ tracks: [{ index: 1, name: 'Dial', format: 'lcr', clips: [] }] });
check('an unknown format → ONE "?" channel and a problem naming the track and format', JSON.stringify(odd.layout.tracks[0].channels) === '["?"]' && /Dial: Resolve's track format "lcr" is not one the tool knows/.test(odd.problems[0] ?? ''), JSON.stringify(odd));
check('…so a compare against a spec fails on the count, never passes on a guess', !diffLayouts({ tracks: [{ name: 'Dial', channels: ['L', 'C', 'R'] }] }, odd.layout).same);
check('a derived layout compares clean against the matching deliverable spec (2.0 + 5.1 + 2.0)', diffLayouts({ tracks: [{ name: 'Mix', channels: ['L', 'R'] }, { name: '5.1', channels: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'] }, { name: 'M&E', channels: ['L', 'R'] }] }, d.layout).same);
check('…and catches a 5.1film track against a 5.1 spec as ORDER (same channels, Resolve\'s film order)', diffLayouts({ tracks: [{ name: '', channels: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'] }] }, layoutFromTimeline({ tracks: [{ index: 1, name: 'A1', format: '5.1film', clips: [] }] }).layout).issues[0]?.kind === 'order');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
