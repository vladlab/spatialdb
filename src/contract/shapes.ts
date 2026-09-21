/**
 * ============================================================================
 *  The structured-field contract: shapes, summaries, layout operations, the diff.
 * ============================================================================
 *
 *  A `structured` field holds a JSON object whose SHAPE is named in the field's
 *  options. Everything about a shape is here, pure, and shared: the server uses it
 *  to refuse a bad value, the web app to summarise and edit one, and the desktop
 *  client's tools (the file-drop tool writes manifests; ffprobe fills audio
 *  layouts) to produce values that will be accepted. A Python QC script gets the
 *  same diff through `POST /api/qc/audio-layout-diff`.
 *
 *  Rules that apply to every shape:
 *    - STRICT objects: an unknown key is refused (as mutations are). A typo in a
 *      tool must fail loudly, not be stored and silently ignored forever.
 *    - A value is at most 256 KB. Tables load WHOLE into the browser, so every
 *      structured value rides along with its row; a manifest is a description of
 *      a record, not an inventory system. (Sequences never list their files.)
 *    - An unknown shape name is an ERROR at field creation, not "generic JSON" —
 *      `audio_layuot` must not quietly switch validation off. Generic is spelled
 *      `json`, on purpose.
 */

import { z } from 'zod';

export const STRUCTURED_MAX_BYTES = 256 * 1024;
export const MANIFEST_MAX_MEMBERS = 2000;

/* ── manifest ─────────────────────────────────────────────────────────────── */

/**
 * `<algorithm>:<hex>` — "sha256:9f2c…", "xxh64:ab12…". The algorithm is IN the
 * value because which one to use (a full SHA-256 of 200 GB is minutes; xxhash or a
 * partial hash is not) is still an open decision, and must be changeable later
 * without touching the schema or rewriting old records.
 */
const Hash = z.string().regex(/^[a-z0-9_-]{2,20}:[0-9a-f]{8,128}$/i, 'a hash looks like "sha256:9f2c…"');
const bytes = z.number().int().nonnegative();
/** Relative to the RECORD's path — never absolute, so the cross-machine path question stays in one place. */
const relPath = z.string().min(1).max(1024).refine((p) => !p.startsWith('/') && !/^[a-z]:[\\/]/i.test(p) && !p.split(/[\\/]/).includes('..'),
  'member paths are relative to the record\'s path (no leading "/", no "..")');

export const Manifest = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('file'), size: bytes, hash: Hash.optional() }),
  z.strictObject({
    kind: z.literal('bundle'),                                   // an IMF / DCP folder
    members: z.array(z.strictObject({ path: relPath, size: bytes, hash: Hash.optional() })).max(MANIFEST_MAX_MEMBERS),
    source: z.string().max(200).optional(),                       // "ASSETMAP.xml", "PKL_….xml" — what the list was read from
  }),
  z.strictObject({
    kind: z.literal('sequence'),                                 // pattern + range; NEVER the file list
    pattern: z.string().min(1).max(1024),                         // "shot_010.%07d.exr"
    first: z.number().int(), last: z.number().int(), count: z.number().int().nonnegative(),
    gaps: z.array(z.tuple([z.number().int(), z.number().int()])).max(1000),
  }).refine((s) => s.last >= s.first, 'last frame is before first'),
  z.strictObject({
    kind: z.literal('channel_set'),                              // a multi-mono mix: 6 wavs = one 5.1
    members: z.array(z.strictObject({ path: relPath, channel: z.string().min(1).max(16) })).min(1).max(64),
  }),
]);
export type Manifest = z.infer<typeof Manifest>;

/* ── audio layout ─────────────────────────────────────────────────────────── */

/**
 * A TRACK is the container a vendor sees; its `channels` are what is inside it.
 * 12 mono tracks and "5.1 + 3× stereo" are the same 12 channels and a DIFFERENT
 * layout — and vendors are particular about exactly that, which is why the
 * grouping is the structure here and the flat list is derived (`flattenChannels`).
 * Channel labels are free text: vendors vary (Ls/Rs vs Lss/Rss vs SL/SR), and a
 * spec must be recordable as the vendor wrote it. Presets supply the usual ones.
 * `name` is where "M&E", "Dialog", "Full mix" live.
 */
export const AudioLayout = z.strictObject({
  tracks: z.array(z.strictObject({
    name: z.string().max(80),
    channels: z.array(z.string().min(1).max(16)).min(1).max(64),
    language: z.string().max(35).optional(),                      // BCP-47-ish: "en", "es-419"
  })).max(128),
});
export type AudioLayout = z.infer<typeof AudioLayout>;
export type AudioTrack = AudioLayout['tracks'][number];

export const LAYOUT_PRESETS: Array<{ id: string; label: string; channels: string[] }> = [
  { id: 'mono', label: 'Mono', channels: ['M'] },
  { id: '2.0', label: 'Stereo (2.0)', channels: ['L', 'R'] },
  { id: '5.1', label: '5.1', channels: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'] },
  { id: '7.1', label: '7.1', channels: ['L', 'R', 'C', 'LFE', 'Lss', 'Rss', 'Lsr', 'Rsr'] },
];

/* ── the registry ─────────────────────────────────────────────────────────── */

export const SHAPES = ['manifest', 'audio_layout', 'json'] as const;
export type Shape = (typeof SHAPES)[number];
export const SHAPE_LABELS: Record<Shape, string> = {
  manifest: 'File manifest', audio_layout: 'Audio layout', json: 'Generic JSON',
};

export const shapeOf = (f: { options?: Record<string, unknown> | null }): Shape | null =>
  (SHAPES as readonly string[]).includes(String(f.options?.shape)) ? (f.options!.shape as Shape) : null;

/** Why a structured field's options are unacceptable, or null. */
export function shapeOptionError(options: Record<string, unknown> | null | undefined): string | null {
  const s = options?.shape;
  if (typeof s !== 'string') return `a structured field needs a shape: ${SHAPES.join(', ')}`;
  return (SHAPES as readonly string[]).includes(s) ? null : `unknown shape '${s}' — one of: ${SHAPES.join(', ')} ('json' is the unvalidated one)`;
}

const first = (e: z.ZodError) => { const i = e.issues[0]; return `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`; };

/** Why `value` is not acceptable for a structured field of this shape, or null. */
export function structuredError(key: string, shape: Shape | null, value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return `'${key}' must be an object`;
  if (JSON.stringify(value).length > STRUCTURED_MAX_BYTES) return `'${key}' is larger than ${STRUCTURED_MAX_BYTES / 1024} KB — a structured value describes a record; it is not a place to keep an inventory`;
  if (shape === 'manifest') { const r = Manifest.safeParse(value); return r.success ? null : `'${key}' (manifest) — ${first(r.error)}`; }
  if (shape === 'audio_layout') { const r = AudioLayout.safeParse(value); return r.success ? null : `'${key}' (audio layout) — ${first(r.error)}`; }
  return null;                                                  // 'json', or a shape this build does not know: an object is enough
}

/* ── summaries: the one line a grid cell or a card row shows ───────────────── */

const n = (x: number) => x.toLocaleString('en-US');
export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let v = b / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

/**
 * How a NUMBER field's value is shown. `options.format = 'bytes'` turns 128849018880
 * into "120 GB" — the stored value stays a plain number (sortable, summable); only
 * the display changes. Lives here because the Files convention is what needs it.
 */
export function formatNumberField(f: { type: string; options?: Record<string, unknown> | null }, v: unknown): string | null {
  return f.type === 'number' && f.options?.format === 'bytes' && typeof v === 'number' ? formatBytes(v) : null;
}

export const flattenChannels = (l: AudioLayout): string[] => l.tracks.flatMap((t) => t.channels);

/** "5.1", "2.0", "mono", or "3 ch" when the channels match no preset. */
export function trackFormat(t: AudioTrack): string {
  const p = LAYOUT_PRESETS.find((x) => x.channels.length === t.channels.length && x.channels.every((c, i) => c.toLowerCase() === t.channels[i].toLowerCase()));
  if (p) return p.id;
  if (t.channels.length === 1) return 'mono';
  return `${t.channels.length} ch`;
}

export function summarise(shape: Shape | null, value: unknown): string {
  if (value === undefined || value === null) return '';
  if (shape === 'manifest') {
    const r = Manifest.safeParse(value);
    if (!r.success) return 'invalid manifest';
    const m = r.data;
    if (m.kind === 'file') return `1 file, ${formatBytes(m.size)}`;
    if (m.kind === 'bundle') return `${n(m.members.length)} files, ${formatBytes(m.members.reduce((s, x) => s + x.size, 0))}${m.source ? ` (${m.source})` : ''}`;
    if (m.kind === 'sequence') {
      const missing = m.gaps.reduce((s, [a, b]) => s + (b - a + 1), 0);
      return `${n(m.count)} frames ${m.first}–${m.last}, ${m.gaps.length ? `${n(missing)} missing in ${m.gaps.length} gap${m.gaps.length === 1 ? '' : 's'}` : '0 gaps'}`;
    }
    return `${m.members.length} mono files (${m.members.map((x) => x.channel).join(' ')})`;
  }
  if (shape === 'audio_layout') {
    const r = AudioLayout.safeParse(value);
    if (!r.success) return 'invalid layout';
    const t = r.data.tracks;
    if (!t.length) return 'no tracks';
    return `${t.length} track${t.length === 1 ? '' : 's'} / ${flattenChannels(r.data).length} ch (${t.map(trackFormat).join(', ')})`;
  }
  const keys = Object.keys(value as object);
  return keys.length ? `{ ${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''} }` : '{ }';
}

/* ── layout operations (the editor is just buttons over these) ────────────── */

const withTracks = (l: AudioLayout, tracks: AudioTrack[]): AudioLayout => ({ tracks });

export function addPreset(l: AudioLayout, presetId: string, name = ''): AudioLayout {
  const p = LAYOUT_PRESETS.find((x) => x.id === presetId);
  return p ? withTracks(l, [...l.tracks, { name, channels: [...p.channels] }]) : l;
}
export function removeTrack(l: AudioLayout, i: number): AudioLayout { return withTracks(l, l.tracks.filter((_, k) => k !== i)); }
export function moveTrack(l: AudioLayout, i: number, by: -1 | 1): AudioLayout {
  const j = i + by;
  if (i < 0 || j < 0 || i >= l.tracks.length || j >= l.tracks.length) return l;
  const t = [...l.tracks]; [t[i], t[j]] = [t[j], t[i]];
  return withTracks(l, t);
}
/** One multichannel track → one mono track per channel, in place. "5.1" named "Full mix" → "Full mix L", "Full mix R", … */
export function splitTrack(l: AudioLayout, i: number): AudioLayout {
  const t = l.tracks[i];
  if (!t || t.channels.length < 2) return l;
  const monos = t.channels.map((c) => ({ name: [t.name, c].filter(Boolean).join(' '), channels: [c], ...(t.language ? { language: t.language } : {}) }));
  return withTracks(l, [...l.tracks.slice(0, i), ...monos, ...l.tracks.slice(i + 1)]);
}
/** The tracks at `indices` → one track (channels concatenated in track order), placed where the first of them was. */
export function mergeTracks(l: AudioLayout, indices: number[], name = ''): AudioLayout {
  const idx = [...new Set(indices)].filter((i) => i >= 0 && i < l.tracks.length).sort((a, b) => a - b);
  if (idx.length < 2) return l;
  const picked = idx.map((i) => l.tracks[i]);
  const lang = picked.every((t) => t.language === picked[0].language) ? picked[0].language : undefined;
  const merged: AudioTrack = { name, channels: picked.flatMap((t) => t.channels), ...(lang ? { language: lang } : {}) };
  const out: AudioTrack[] = [];
  l.tracks.forEach((t, i) => { if (i === idx[0]) out.push(merged); else if (!idx.includes(i)) out.push(t); });
  return withTracks(l, out);
}

/* ── the diff: the first QC primitive ─────────────────────────────────────── */

export interface LayoutDiff {
  same: boolean;
  /** [a, b] total channels. */
  channelCount: [number, number];
  issues: Array<{ kind: 'count' | 'order' | 'grouping' | 'name' | 'language'; track?: number; detail: string }>;
}

/**
 * Compare `b` (e.g. what a file IS) against `a` (e.g. what the deliverable ASKS
 * FOR). Reported from the most to the least serious, and each kind only when the
 * kinds above it are clean enough for it to mean something:
 *
 *   count      a different number of channels — nothing else is worth saying.
 *   order      same channels, different order ("L R C LFE…" vs "L C R LFE…").
 *   grouping   same channels in the same order, contained differently — 12 mono
 *              vs 5.1 + 3× stereo. THE one vendors reject deliveries for.
 *   name,      only when the grouping matches (track i ↔ track i): labels differ.
 *   language   Warnings, in effect: `same` is false, but the audio may be right.
 *
 * Channel labels compare case-insensitively; names ignore case and outer spaces.
 */
export function diffLayouts(a: AudioLayout, b: AudioLayout): LayoutDiff {
  const fa = flattenChannels(a), fb = flattenChannels(b);
  const out: LayoutDiff = { same: true, channelCount: [fa.length, fb.length], issues: [] };
  const low = (s: string) => s.trim().toLowerCase();

  if (fa.length !== fb.length) {
    out.issues.push({ kind: 'count', detail: `${fa.length} channels expected, ${fb.length} found` });
  } else {
    const wrong = fa.map((c, i) => (low(c) === low(fb[i]) ? -1 : i)).filter((i) => i >= 0);
    if (wrong.length) {
      const sameSet = [...fa].map(low).sort().join('|') === [...fb].map(low).sort().join('|');
      out.issues.push({ kind: 'order', detail: sameSet
        ? `same channels, different order — expected ${fa.join(' ')}, found ${fb.join(' ')}`
        : `channel ${wrong[0] + 1} is ${fb[wrong[0]]}, expected ${fa[wrong[0]]}${wrong.length > 1 ? ` (and ${wrong.length - 1} more)` : ''}` });
    } else {
      const ga = a.tracks.map((t) => t.channels.length).join('+'), gb = b.tracks.map((t) => t.channels.length).join('+');
      if (ga !== gb) {
        out.issues.push({ kind: 'grouping', detail: `same ${fa.length} channels, grouped differently — expected ${a.tracks.map(trackFormat).join(', ')}; found ${b.tracks.map(trackFormat).join(', ')}` });
      } else {
        a.tracks.forEach((t, i) => {
          const u = b.tracks[i];
          if (low(t.name) !== low(u.name)) out.issues.push({ kind: 'name', track: i, detail: `track ${i + 1} is named “${u.name || '(unnamed)'}”, expected “${t.name || '(unnamed)'}”` });
          if ((t.language ?? '') !== (u.language ?? '')) out.issues.push({ kind: 'language', track: i, detail: `track ${i + 1} language is ${u.language || '(none)'}, expected ${t.language || '(none)'}` });
        });
      }
    }
  }
  out.same = out.issues.length === 0;
  return out;
}

/* ── the Files convention (a convenience, not a rule) ─────────────────────── */

export const MANIFEST_KINDS = ['file', 'bundle', 'sequence', 'channel_set'] as const;

/**
 * The fields a Files table conventionally has for delivered-unit records. NOT
 * hard-wired anywhere: the desktop drop tool will map its outputs onto whatever
 * fields the owner chooses. This list only feeds "Add standard Files fields" in
 * Table settings, which adds the ones a table does not already have (by key).
 */
export const FILES_STANDARD_FIELDS: Array<{ key: string; name: string; type: string; options?: Record<string, unknown>; self?: boolean }> = [
  { key: 'kind', name: 'Kind', type: 'select', options: { choices: [...MANIFEST_KINDS] } },
  { key: 'path', name: 'Path', type: 'file_path' },
  { key: 'manifest', name: 'Manifest', type: 'structured', options: { shape: 'manifest' } },
  { key: 'file_count', name: 'File count', type: 'number' },
  { key: 'total_size', name: 'Total size', type: 'number', options: { format: 'bytes' } },
  { key: 'hash', name: 'Hash', type: 'text' },
  { key: 'audio_layout', name: 'Audio layout', type: 'structured', options: { shape: 'audio_layout' } },
  // A member promoted to its own record points at the unit it came from.
  { key: 'parent', name: 'Parent', type: 'link', self: true },
];
