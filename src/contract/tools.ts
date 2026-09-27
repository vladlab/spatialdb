/**
 * ============================================================================
 *  The tools contract — what the desktop client can do TO a table.
 * ============================================================================
 *
 *  A TOOL is code compiled into the desktop client (never into the server, never
 *  sent by it). The server's whole knowledge of a tool is this file plus one
 *  jsonb column: `tables.tools`, which says "file drop is enabled on Files, and
 *  its outputs go into these fields". Shared three ways:
 *
 *    server    validates `tables.tools` on `table.update` — a mapped field must
 *              exist on that table and accept the output's type (values.ts rules)
 *    web app   lets an admin configure the mapping in Table settings, even though
 *              only the desktop client can run the tool
 *    desktop   reads the mapping to know WHERE to write what it found
 *
 *  Principles (TAURI-HANDOFF.md §3), restated as code constraints:
 *    - nothing executable crosses the wire: a config is only key→fieldId
 *    - a tool writes ORDINARY mutations (record.create / record.update / link.add),
 *      so undo, the stream, History, scope and validation all apply unchanged
 *    - an output the table has no field for is simply not written; an output the
 *      tool could not determine (no video stream in a WAV) is left untouched —
 *      never written as null (values.ts refuses nulls; absent IS empty)
 */

import { z } from 'zod';
import { MANIFEST_KINDS } from './shapes.js';

/* ── outputs ─────────────────────────────────────────────────────────────── */

/**
 * The type an output PRODUCES. Deliberately coarser than FIELD_TYPES: a tool never
 * produces a link, a lookup, rich text or an attachment (attachments — waveform
 * images — are a later ENRICH tool and go through the asset store).
 * `select` outputs are written only when the value is one of the field's choices;
 * otherwise the cell is left alone and the client reports it. Adding a choice is a
 * schema change (admin) and a tool must never do one as a side effect.
 */
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

export interface ToolOutput {
  key: string;
  name: string;
  type: OutputType;
  /** When it is produced. `file` = always; the rest depend on what was dropped. */
  when: 'file' | 'video' | 'audio' | 'image' | 'sequence' | 'bundle' | 'hash';
  /** For `select` outputs: the values the tool can produce (so the admin can add choices). */
  choices?: readonly string[];
  note?: string;
}

/** What the checks need to know about a field — a FieldRow, or the server's `select id, type, options`. */
export interface ToolFieldLike { id: string; type: string; options?: Record<string, unknown> | null }

/** May this field receive this output? (Same rule `toolsProblem` enforces.) */
export function fieldAccepts(out: ToolOutput, field: ToolFieldLike): boolean {
  return ACCEPTS[out.type].some((a) => a.type === field.type && (!a.shape || field.options?.shape === a.shape));
}

export interface ToolDef {
  id: string;
  name: string;
  kind: 'ingest' | 'enrich';
  outputs: readonly ToolOutput[];
  /** Outputs that MUST be mapped for the tool to be enabled at all. */
  required: readonly string[];
}

/* ── file drop ───────────────────────────────────────────────────────────── */

/**
 * Three stages, each ordinary mutations, tagged `via: "file_drop"`:
 *   1. CLASSIFY (Rust, before anything is written): one file, an IMF/DCP bundle
 *      (ASSETMAP / CPL present), an image sequence (same stem + padding, frame
 *      range + gaps, never the file list), or a multi-mono channel set.
 *   2. CREATE at once: `file` outputs, plus the context links createRecord adds.
 *      Dropped ONTO an existing record of this table → record.update instead
 *      (a placeholder made before the file existed). Same absolute `path` already
 *      in this table → update that record, and say so. Otherwise a new record.
 *   3. ENRICH afterwards, each as its own record.update, NOT undoable on the
 *      client (Ctrl+Z on the drop deletes what it created, probe results and all):
 *      ffprobe outputs in seconds; `hash` last, and only if it is mapped.
 *
 * Timecode and durations are TEXT ("01:00:00:00", "00:23:12:05"): there is no
 * timecode field type and a number of seconds loses the frame. Frame rate is a
 * NUMBER rounded to 3 decimals (23.976), so a spec's `within` rule can compare it.
 * `modified` is a `date`: values.ts has no moment-in-time type, so the time of day
 * is lost — accepted; the file itself is the record of that.
 */
export const FILE_DROP: ToolDef = {
  id: 'file_drop',
  name: 'File drop',
  kind: 'ingest',
  required: ['path'],
  outputs: [
    // ── always ──
    { key: 'path',        name: 'Path',          type: 'file_path', when: 'file', note: 'absolute; a bundle or sequence is its folder' },
    { key: 'name',        name: 'File name',     type: 'text',      when: 'file' },
    { key: 'kind',        name: 'Kind',          type: 'select',    when: 'file', choices: MANIFEST_KINDS },
    { key: 'manifest',    name: 'Manifest',      type: 'structured:manifest', when: 'file' },
    { key: 'file_count',  name: 'File count',    type: 'number',    when: 'file' },
    { key: 'total_size',  name: 'Total size',    type: 'number',    when: 'file', note: 'bytes; give the field options.format = "bytes"' },
    { key: 'extension',   name: 'Extension',     type: 'text',      when: 'file', note: '"mov", "wav", "exr" (a sequence: its frames\'; a bundle: "imf" or "dcp")' },
    { key: 'modified',    name: 'Modified',      type: 'date',      when: 'file' },
    { key: 'media',       name: 'Media',         type: 'select',    when: 'file', choices: ['video', 'audio', 'image', 'document', 'other'] },

    // ── video stream (first video stream of a file; the first frame of a sequence) ──
    { key: 'container',       name: 'Container',       type: 'text',   when: 'video', note: 'ffprobe format_name, first entry: "mov", "mxf"' },
    { key: 'video_codec',     name: 'Video codec',     type: 'text',   when: 'video', note: '"prores", "dnxhd", "h264", "exr"' },
    { key: 'codec_profile',   name: 'Codec profile',   type: 'text',   when: 'video', note: '"4444 XQ", "HQ", "High"' },
    { key: 'width',           name: 'Width',           type: 'number', when: 'video' },
    { key: 'height',          name: 'Height',          type: 'number', when: 'video' },
    { key: 'frame_rate',      name: 'Frame rate',      type: 'number', when: 'video', note: '23.976, 25, 29.97 — 3 decimals' },
    { key: 'frame_count',     name: 'Frame count',     type: 'number', when: 'video' },
    { key: 'duration',        name: 'Duration',        type: 'text',   when: 'video', note: 'timecode HH:MM:SS:FF at the file\'s rate' },
    { key: 'duration_seconds', name: 'Duration (s)',   type: 'number', when: 'video' },
    { key: 'start_timecode',  name: 'Start timecode',  type: 'text',   when: 'video', note: 'hunted across format, video and data streams, as viznotes did' },
    { key: 'pixel_format',    name: 'Pixel format',    type: 'text',   when: 'video', note: '"yuv422p10le", "rgb48le"' },
    { key: 'bit_depth',       name: 'Bit depth',       type: 'number', when: 'video' },
    { key: 'chroma',          name: 'Chroma',          type: 'text',   when: 'video', note: '"4:2:2", "4:4:4", "RGB"' },
    { key: 'color_primaries', name: 'Primaries',       type: 'text',   when: 'video', note: 'as ffprobe names them: "bt709", "bt2020"' },
    { key: 'color_transfer',  name: 'Transfer',        type: 'text',   when: 'video' },
    { key: 'color_matrix',    name: 'Matrix',          type: 'text',   when: 'video' },
    { key: 'color_range',     name: 'Range',           type: 'select', when: 'video', choices: ['tv', 'pc'] },
    { key: 'scan',            name: 'Scan',            type: 'select', when: 'video', choices: ['progressive', 'interlaced'] },
    { key: 'video_bitrate',   name: 'Video bitrate',   type: 'number', when: 'video', note: 'bits per second' },

    // ── audio (all audio streams of a file; the members of a channel set) ──
    { key: 'audio_codec',        name: 'Audio codec',   type: 'text',   when: 'audio', note: '"pcm_s24le", "aac"' },
    { key: 'audio_stream_count', name: 'Audio streams', type: 'number', when: 'audio' },
    { key: 'audio_channels',     name: 'Audio channels', type: 'number', when: 'audio', note: 'total, across streams' },
    { key: 'audio_layout',       name: 'Audio layout',  type: 'structured:audio_layout', when: 'audio', note: 'one track per stream, channels labelled from the stream layout when ffprobe knows it, else "ch1"…' },
    { key: 'sample_rate',        name: 'Sample rate',   type: 'number', when: 'audio' },
    { key: 'audio_bit_depth',    name: 'Audio bit depth', type: 'number', when: 'audio' },

    // ── sequence ──
    { key: 'first_frame', name: 'First frame', type: 'number', when: 'sequence' },
    { key: 'last_frame',  name: 'Last frame',  type: 'number', when: 'sequence' },
    { key: 'gaps',        name: 'Missing frames', type: 'number', when: 'sequence', note: 'count of missing frames; the ranges are in the manifest' },

    // ── bundle ──
    { key: 'bundle_type', name: 'Bundle type', type: 'select', when: 'bundle', choices: ['imf', 'dcp'] },
    { key: 'cpl_title',   name: 'CPL title',   type: 'text',   when: 'bundle', note: 'ContentTitleText / AnnotationText of the first CPL' },

    // ── hash: last, and only if mapped ──
    { key: 'hash', name: 'Hash', type: 'text', when: 'hash', note: '"xxh3:…" of the file, or of members concatenated in manifest order; algorithm is in the value (shapes.ts)' },
  ],
};

export const TOOLS: Record<string, ToolDef> = { [FILE_DROP.id]: FILE_DROP };

/* ── a table's configuration ─────────────────────────────────────────────── */

/**
 * `tables.tools` (sql/014): `{ "<toolId>": { "map": { "<outputKey>": "<fieldId>" } } }`.
 * Presence of a tool's entry means ENABLED. Replaced whole on `table.update { tools }`
 * (like a view's config). Field ids have no foreign keys, on purpose and by precedent
 * (views, sections): `field.delete` does not rewrite this; an id that no longer
 * resolves is skipped when the tool runs, and undoing the delete heals it.
 */
export const ToolConfig = z.strictObject({
  map: z.record(z.string(), z.guid()),
});
export const TablesTools = z.record(z.string(), ToolConfig);
export type TablesTools = z.infer<typeof TablesTools>;

/**
 * Validation, on write (server) and in the settings UI (client). Returns the first
 * problem, or null. `fields` are the table's own fields.
 */
export function toolsProblem(tools: unknown, fields: Iterable<ToolFieldLike>): string | null {
  const parsed = TablesTools.safeParse(tools);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'not a tools config';
  const byId = new Map<string, ToolFieldLike>();
  for (const f of fields) byId.set(f.id, f);

  for (const [toolId, cfg] of Object.entries(parsed.data)) {
    const tool = TOOLS[toolId];
    if (!tool) return `unknown tool: ${toolId}`;
    const used = new Set<string>();
    for (const [key, fieldId] of Object.entries(cfg.map)) {
      const out = tool.outputs.find((o) => o.key === key);
      if (!out) return `${tool.name}: no output called "${key}"`;
      const field = byId.get(fieldId);
      if (!field) return `${tool.name}: "${out.name}" is mapped to a field that is not on this table`;
      if (!fieldAccepts(out, field)) return `${tool.name}: "${out.name}" (${out.type}) cannot be written to a ${field.type} field`;
      // Two outputs into one field would race: whichever finished last would win.
      if (used.has(fieldId)) return `${tool.name}: two outputs are mapped to the same field`;
      used.add(fieldId);
    }
    for (const req of tool.required) {
      if (!(req in cfg.map)) return `${tool.name} needs "${tool.outputs.find((o) => o.key === req)?.name ?? req}" mapped`;
    }
  }
  return null;
}

/** Only outputs whose mapped field still exists — what a tool actually writes to. */
export function resolveMap(cfg: z.infer<typeof ToolConfig>, fields: Iterable<{ id: string; key: string }>) {
  const keyOf = new Map<string, string>();
  for (const f of fields) keyOf.set(f.id, f.key);
  const out = new Map<string, string>();               // output key → field KEY (what record.update wants)
  for (const [k, id] of Object.entries(cfg.map)) { const key = keyOf.get(id); if (key) out.set(k, key); }
  return out;
}

/* ── provenance ──────────────────────────────────────────────────────────── */

/**
 * `MutationRequest.via` — a short tag naming the tool that produced a batch, stored
 * in the log (sql/014 `mutations.via`) and carried on every stream event, so History
 * can say "45 records · via File drop". Absent for everything a person typed.
 */
export const Via = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);
