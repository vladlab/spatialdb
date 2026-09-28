/**
 * ============================================================================
 *  The tools contract — how the desktop client derives data from files.
 * ============================================================================
 *
 *  Three ideas, so that a person reading a table's configuration a year from now
 *  can tell WHERE every value came from:
 *
 *  ANALYZER   a compiled unit of derivation in the desktop client: what program it
 *             runs (or "built-in"), what it accepts by default, which OUTPUTS it
 *             produces. Listed here; the desktop's handshake reports which ones a
 *             given build has and their versions. Adding one is a Rust module plus
 *             an entry below — never anything a table or a server can supply.
 *
 *  RECIPE     what a table stores (`tables.tools.file_drop`, sql/014, reshaped by
 *             sql/015): an ORDERED list of steps `{ analyzer, runs_on, map }`.
 *             `runs_on` says explicitly which dropped things the step applies to
 *             (by media class and/or kind); `map` says which OUTPUT lands in which
 *             FIELD. Steps run in order and do not feed each other — a recipe is a
 *             list, not a DAG, and it is DATA, not a script: it selects and routes
 *             analyzers, it never carries logic to execute (TAURI-HANDOFF.md §3).
 *
 *  PROVENANCE every analyzer that runs a program offers its version as an output
 *             (`ffprobe.version`), so a table CAN keep "ffprobe 7.1" per record. A
 *             hash value carries its algorithm inside the value (shapes.ts).
 *
 *  Shared three ways:
 *    server    validates a recipe on `table.update { tools }` (`toolsProblem`)
 *    web app   edits it — as steps, as JSON — and shows it as sentences (`describe`)
 *    desktop   runs it (client/tools/fileDrop.ts)
 *
 *  Values: an output the table has no field for is not written; an output the
 *  analyzer could not determine is left untouched — never written as null
 *  (values.ts refuses nulls; absent IS empty). A `select` output is written only
 *  when the value is one of the field's choices; otherwise the cell is left alone
 *  and the client reports it — a tool never changes a schema as a side effect.
 */

import { z } from 'zod';
import { MANIFEST_KINDS } from './shapes.js';
import { VOCABULARIES } from './vocab.js';

/* ── what a dropped thing is ─────────────────────────────────────────────── */

/**
 * Media class, decided by the classifier from the extension (and, for a bundle,
 * the package). `other` is the explicit FALLBACK: anything not recognised lands
 * there, and a step may target it — nothing is silently unreachable.
 */
export const MEDIA = ['video', 'audio', 'image', 'document', 'other'] as const;
export type Media = (typeof MEDIA)[number];

/** The shape of what arrived — the manifest kinds of shapes.ts. */
export const KINDS = MANIFEST_KINDS;
export type Kind = (typeof KINDS)[number];

/* ── outputs ─────────────────────────────────────────────────────────────── */

export const OUTPUT_TYPES = [
  'text', 'number', 'date', 'checkbox', 'select', 'file_path',
  'structured:manifest', 'structured:audio_layout',
] as const;
export type OutputType = (typeof OUTPUT_TYPES)[number];

/** Which field types may receive each output type. */
const ACCEPTS: Record<OutputType, ReadonlyArray<{ type: string; shape?: string }>> = {
  text:       [{ type: 'text' }, { type: 'long_text' }],
  number:     [{ type: 'number' }],
  date:       [{ type: 'date' }],
  checkbox:   [{ type: 'checkbox' }],
  select:     [{ type: 'select' }, { type: 'text' }],
  file_path:  [{ type: 'file_path' }],
  'structured:manifest':     [{ type: 'structured', shape: 'manifest' }],
  'structured:audio_layout': [{ type: 'structured', shape: 'audio_layout' }],
};

export interface Output {
  key: string;
  name: string;
  type: OutputType;
  /** For `select` outputs: the values the analyzer can produce (so the UI can make the field). */
  choices?: readonly string[];
  /** For `select` outputs normalised through a built-in list (contract/vocab.ts): the
   *  target select must be bound to the SAME vocabulary (or be a text field). */
  vocabulary?: string;
  note?: string;
}

/** What the checks need to know about a field — a FieldRow, or the server's `select id, type, options`. */
export interface ToolFieldLike { id: string; type: string; options?: Record<string, unknown> | null }

export function fieldAccepts(out: Output, field: ToolFieldLike): boolean {
  if (!ACCEPTS[out.type].some((a) => a.type === field.type && (!a.shape || field.options?.shape === a.shape))) return false;
  // A vocabulary output into a select: only one bound to the same list — a select
  // with its own typed choices would silently refuse most values.
  if (out.vocabulary && field.type === 'select' && field.options?.vocabulary !== out.vocabulary) return false;
  return true;
}

/* ── analyzers ───────────────────────────────────────────────────────────── */

export interface Analyzer {
  id: string;
  name: string;
  /** The program it runs on the host, or `null` for built-in code. Shown with the version the handshake reports. */
  program: string | null;
  /** One line a reader can trust: what this derives and how. */
  how: string;
  /** What it applies to unless the step says otherwise. `{}` = everything. */
  defaultRunsOn: RunsOn;
  outputs: readonly Output[];
}

const FILESYSTEM: Analyzer = {
  id: 'filesystem', name: 'Filesystem', program: null,
  how: 'stat and directory listing — the dropped path, its size, dates and shape; nothing is read',
  defaultRunsOn: {},
  outputs: [
    { key: 'path',        name: 'Path',          type: 'file_path', note: 'absolute; a bundle or sequence is its folder' },
    { key: 'name',        name: 'File name',     type: 'text' },
    { key: 'extension',   name: 'Extension',     type: 'text',      note: '"mov", "wav", "exr" (a sequence: its frames\'; a bundle: "imf" or "dcp")' },
    { key: 'media',       name: 'Media',         type: 'select',    choices: MEDIA, note: 'as classified from the extension; "other" when unrecognised' },
    { key: 'kind',        name: 'Kind',          type: 'select',    choices: KINDS },
    { key: 'manifest',    name: 'Manifest',      type: 'structured:manifest' },
    { key: 'file_count',  name: 'File count',    type: 'number' },
    { key: 'total_size',  name: 'Total size',    type: 'number',    note: 'bytes; give the field options.format = "bytes"' },
    { key: 'modified',    name: 'Modified',      type: 'date',      note: 'the newest member\'s mtime, as a day (UTC)' },
  ],
};

const SEQUENCE: Analyzer = {
  id: 'sequence', name: 'Image sequence', program: null,
  how: 'the frame range from the file names in the folder (pattern, first, last, gaps)',
  defaultRunsOn: { kind: ['sequence'] },
  outputs: [
    { key: 'first_frame', name: 'First frame',    type: 'number' },
    { key: 'last_frame',  name: 'Last frame',     type: 'number' },
    { key: 'frame_count', name: 'Frame count',    type: 'number', note: 'frames present' },
    { key: 'gaps',        name: 'Missing frames', type: 'number', note: 'count of missing frames; the ranges are in the manifest' },
  ],
};

const IMF: Analyzer = {
  id: 'imf', name: 'IMF / DCP package', program: null,
  how: 'reads the ASSETMAP and the first CPL of a package folder',
  defaultRunsOn: { kind: ['bundle'] },
  outputs: [
    { key: 'bundle_type', name: 'Package type', type: 'select', choices: ['imf', 'dcp'] },
    { key: 'cpl_title',   name: 'CPL title',    type: 'text',   note: 'ContentTitleText / AnnotationText of the first CPL' },
  ],
};

const FFPROBE: Analyzer = {
  id: 'ffprobe', name: 'ffprobe', program: 'ffprobe',
  how: 'ffprobe -show_format -show_streams on the file (a sequence: its first frame; a channel set: each member)',
  defaultRunsOn: { media: ['video', 'audio'] },
  outputs: [
    { key: 'ffprobe.version',  name: 'ffprobe version', type: 'text',   note: 'provenance: which ffprobe wrote the rest' },
    { key: 'container',        name: 'Container',       type: 'text',   note: 'format_name, first entry: "mov", "mxf"' },
    { key: 'codec',            name: 'Codec',           type: 'select', vocabulary: 'video_codec', choices: VOCABULARIES.video_codec.choices, note: 'the CANONICAL name, looked up from codec + profile in contract/vocab.ts: "ProRes 4444 XQ", "H.264"; absent when the table has no entry' },
    { key: 'video_codec',      name: 'Video codec (raw)', type: 'text', note: 'as ffprobe says it: "prores", "dnxhd", "h264", "exr"' },
    { key: 'codec_profile',    name: 'Codec profile (raw)', type: 'text', note: 'as ffprobe says it: "4444 XQ", "HQ", "High"' },
    { key: 'width',            name: 'Width',           type: 'number' },
    { key: 'height',           name: 'Height',          type: 'number' },
    { key: 'frame_rate',       name: 'Frame rate',      type: 'number', note: '23.976, 25, 29.97 — 3 decimals' },
    { key: 'frame_count',      name: 'Frame count',     type: 'number' },
    { key: 'duration',         name: 'Duration',        type: 'text',   note: 'HH:MM:SS:FF at the file\'s rate, non-drop' },
    { key: 'duration_seconds', name: 'Duration (s)',    type: 'number' },
    { key: 'start_timecode',   name: 'Start timecode',  type: 'text',   note: 'from the format, video or data (tmcd) stream tags' },
    { key: 'pixel_format',     name: 'Pixel format',    type: 'text',   note: '"yuv422p10le", "rgb48le"' },
    { key: 'bit_depth',        name: 'Bit depth',       type: 'number' },
    { key: 'chroma',           name: 'Chroma',          type: 'text',   note: '"4:2:2", "4:4:4", "RGB"' },
    { key: 'color_primaries',  name: 'Primaries',       type: 'text',   note: 'as ffprobe names them: "bt709", "bt2020"' },
    { key: 'color_transfer',   name: 'Transfer',        type: 'text' },
    { key: 'color_matrix',     name: 'Matrix',          type: 'text' },
    { key: 'color_range',      name: 'Range',           type: 'select', choices: ['tv', 'pc'] },
    { key: 'scan',             name: 'Scan',            type: 'select', choices: ['progressive', 'interlaced'] },
    { key: 'video_bitrate',    name: 'Video bitrate',   type: 'number', note: 'bits per second' },
    { key: 'audio_codec',        name: 'Audio codec',     type: 'text',   note: '"pcm_s24le", "aac"' },
    { key: 'audio_stream_count', name: 'Audio streams',   type: 'number' },
    { key: 'audio_channels',     name: 'Audio channels',  type: 'number', note: 'total, across streams' },
    { key: 'audio_layout',       name: 'Audio layout',    type: 'structured:audio_layout', note: 'one track per stream; channels labelled from the stream layout when known, else ch1…' },
    { key: 'sample_rate',        name: 'Sample rate',     type: 'number' },
    { key: 'audio_bit_depth',    name: 'Audio bit depth', type: 'number' },
  ],
};

const hashAnalyzer = (algo: string, note: string): Analyzer => ({
  id: `hash-${algo}`, name: `Hash (${algo})`, program: null,
  how: `${note}; a multi-file unit is hashed as its members concatenated in manifest order`,
  defaultRunsOn: {},
  outputs: [{ key: 'hash', name: 'Hash', type: 'text', note: `"${algo}:<hex>" — the algorithm travels with the value` }],
});

export const ANALYZERS: readonly Analyzer[] = [
  FILESYSTEM, SEQUENCE, IMF, FFPROBE,
  hashAnalyzer('xxh3', 'xxh3-64, fast, NOT cryptographic — a fingerprint for "is this the same file"'),
  hashAnalyzer('sha256', 'SHA-256 — slow on large files; for a checksum a client will verify'),
];
export const analyzerOf = (id: string) => ANALYZERS.find((a) => a.id === id);

/* ── the recipe a table stores ───────────────────────────────────────────── */

export const RunsOnSchema = z.strictObject({
  media: z.array(z.enum(MEDIA)).optional(),
  kind: z.array(z.enum(KINDS)).optional(),
});
export const Step = z.strictObject({
  analyzer: z.string(),
  /** Absent = the analyzer's default. `{}` = everything. Both lists given = both must match. */
  runs_on: RunsOnSchema.optional(),
  map: z.record(z.string(), z.guid()),
});
export const Recipe = z.strictObject({ steps: z.array(Step) });
export type Step = z.infer<typeof Step>;
export type Recipe = z.infer<typeof Recipe>;
export type RunsOn = z.infer<typeof RunsOnSchema>;

/**
 * `tables.tools`: `{ "file_drop": <Recipe> }`. Presence means ENABLED. Replaced
 * whole on `table.update { tools }`. Field ids have no foreign keys (views/sections
 * precedent): `field.delete` does not rewrite this; an id that no longer resolves
 * is skipped when the recipe runs.
 */
export const TOOL_IDS = ['file_drop'] as const;
export const TablesTools = z.partialRecord(z.enum(TOOL_IDS), Recipe);   // partial: `{}` = nothing enabled
export type TablesTools = z.infer<typeof TablesTools>;
export const TOOL_NAMES: Record<string, string> = { file_drop: 'File drop' };

/** The output the whole tool cannot work without: matching a dropped file to its record. */
export const REQUIRED: Array<{ analyzer: string; key: string }> = [{ analyzer: 'filesystem', key: 'path' }];

/** Validation, on write (server) and in the editor (client). The first problem, or null. */
export function toolsProblem(tools: unknown, fields: Iterable<ToolFieldLike>): string | null {
  const parsed = TablesTools.safeParse(tools);
  if (!parsed.success) { const i = parsed.error.issues[0]; return i ? `${i.path.join('.') || 'tools'}: ${i.message}` : 'not a tools config'; }
  const byId = new Map<string, ToolFieldLike>();
  for (const f of fields) byId.set(f.id, f);

  for (const [toolId, recipe] of Object.entries(parsed.data)) {
    const used = new Map<string, string>();   // field id → "analyzer.output" that writes it
    for (const [i, step] of recipe.steps.entries()) {
      const a = analyzerOf(step.analyzer);
      if (!a) return `${toolId} step ${i + 1}: unknown analyzer "${step.analyzer}"`;
      for (const [key, fieldId] of Object.entries(step.map)) {
        const out = a.outputs.find((o) => o.key === key);
        if (!out) return `${a.name}: no output called "${key}"`;
        const field = byId.get(fieldId);
        if (!field) return `${a.name}: "${out.name}" is mapped to a field that is not on this table`;
        if (!fieldAccepts(out, field)) return `${a.name}: "${out.name}" (${out.type}) cannot be written to a ${field.type} field`;
        // Two steps into one field would race: whichever finished last would win.
        const prev = used.get(fieldId);
        if (prev && prev !== `${a.id}.${key}`) return `two outputs (${prev} and ${a.id}.${key}) are mapped to the same field`;
        used.set(fieldId, `${a.id}.${key}`);
      }
    }
    for (const r of REQUIRED) {
      if (!recipe.steps.some((s) => s.analyzer === r.analyzer && r.key in s.map)) {
        const a = analyzerOf(r.analyzer)!;
        return `${TOOL_NAMES[toolId] ?? toolId} needs "${a.outputs.find((o) => o.key === r.key)?.name}" (${a.name}) mapped`;
      }
    }
  }
  return null;
}

/** The effective filter of a step. */
export const runsOnOf = (step: Step): RunsOn => step.runs_on ?? analyzerOf(step.analyzer)?.defaultRunsOn ?? {};

/** Does a step apply to a dropped thing? An absent list is no constraint. */
export function stepApplies(step: Step, unit: { media: string; kind: string }): boolean {
  const r = runsOnOf(step);
  if (r.media && !r.media.includes(unit.media as Media)) return false;
  if (r.kind && !r.kind.includes(unit.kind as Kind)) return false;
  return true;
}

/** Only outputs whose mapped field still exists — what a step actually writes to. Output key → field KEY. */
export function resolveMap(step: Step, fields: Iterable<{ id: string; key: string }>): Map<string, string> {
  const keyOf = new Map<string, string>();
  for (const f of fields) keyOf.set(f.id, f.key);
  const out = new Map<string, string>();
  for (const [k, id] of Object.entries(step.map)) { const key = keyOf.get(id); if (key) out.set(k, key); }
  return out;
}

/**
 * The recipe as sentences a person can check against the table — the Summary
 * view, and what a reader should get from the JSON in a year. `versions` is the
 * handshake's report (analyzer id → version, or null for "not on this machine").
 */
export function describe(recipe: Recipe, fields: Iterable<{ id: string; name: string }>, versions: Record<string, string | null> = {}): string[] {
  const nameOf = new Map<string, string>();
  for (const f of fields) nameOf.set(f.id, f.name);
  return recipe.steps.map((step, i) => {
    const a = analyzerOf(step.analyzer);
    if (!a) return `${i + 1}. Unknown analyzer "${step.analyzer}".`;
    const r = runsOnOf(step);
    const cond = [r.media?.length ? r.media.join(' or ') : '', r.kind?.length ? r.kind.map((k) => k.replace('_', ' ')).join(' or ') : ''].filter(Boolean);
    const when = cond.length ? `If ${cond.join(', and ')}` : 'For everything';
    const v = a.id in versions ? (versions[a.id] === null ? ' (not on this machine)' : ` ${versions[a.id]}`) : '';
    const via = a.program ? `${a.program}${v}` : a.name;
    // In the analyzer's own output order — jsonb does not keep a map's key order.
    const cols = a.outputs.filter((o) => o.key in step.map).map((o) => `${o.name} → ${nameOf.get(step.map[o.key]) ?? 'a missing field'}`);
    return `${i + 1}. ${when}: ${via} → ${cols.length ? cols.join(', ') : 'nothing mapped'}.`;
  });
}

/** The default recipe when File drop is switched on: the filesystem, then ffprobe. */
export function defaultRecipe(): Recipe {
  return { steps: [{ analyzer: 'filesystem', map: {} }, { analyzer: 'ffprobe', map: {} }] };
}

/* ── provenance ──────────────────────────────────────────────────────────── */

/**
 * `MutationRequest.via` — a short tag naming the tool that produced a batch, stored
 * in the log (sql/014 `mutations.via`) and carried on every stream event, so History
 * can say "45 records · via File drop". Absent for everything a person typed.
 */
export const Via = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);
