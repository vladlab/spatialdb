/**
 * ============================================================================
 *  The structured-field contract: shapes, summaries, layout operations, the diff.
 * ============================================================================
 *
 *  A `structured` field holds a JSON object whose SHAPE is named in the field's
 *  options. Everything about a shape is here, pure, and shared: the server uses it
 *  to refuse a bad value, the web app to summarise and edit one, and the desktop
 *  client's tools (the file-drop tool writes manifests; ffprobe fills audio
 *  layouts) to produce values that will be accepted. (The `video_layout` shape —
 *  a mini EDL of what is on a file — has a file of its own, contract/videoLayout.ts,
 *  over contract/timecode.ts; it is registered here like the rest.) A Python QC script gets the
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
import { VideoLayout, summariseVideoLayout } from './videoLayout.js';
import { isTcLabel } from './timecode.js';

export const STRUCTURED_MAX_BYTES = 256 * 1024;
export const MANIFEST_MAX_MEMBERS = 2000;

/* ── manifest ─────────────────────────────────────────────────────────────── */

/**
 * `<algorithm>:<hex>` — "sha256:9f2c…", "xxh64:ab12…". The algorithm is IN the
 * value because which one to use (a full SHA-256 of 200 GB is minutes; xxhash or a
 * partial hash is not) is still an open decision, and must be changeable later
 * without touching the schema or rewriting old records.
 */
export const Hash = z.string().regex(/^[a-z0-9_-]{2,20}:[0-9a-f]{8,128}$/i, 'a hash looks like "sha256:9f2c…"');
/**
 * Several hashes of ONE file, keyed by algorithm: `{ xxh3: "xxh3:…", md5: "md5:…" }`.
 * The xxh3 is the FINGERPRINT (contract/fingerprint.ts) — the one the app reads to
 * decide "is this the same file"; an md5 is a deliverable's checksum, asked for by
 * hand. They coexist: running one never replaces another (the owner, Oct 18). The
 * older single `hash` is read as one entry of this map (`hashesOf`) and left alone
 * on records that still carry it.
 */
export const Hashes = z.record(z.string().regex(/^[a-z0-9_-]{2,20}$/i), Hash);
const bytes = z.number().int().nonnegative();
/** Relative to the RECORD's path — never absolute, so the cross-machine path question stays in one place. */
const relPath = z.string().min(1).max(1024).refine((p) => !p.startsWith('/') && !/^[a-z]:[\\/]/i.test(p) && !p.split(/[\\/]/).includes('..'),
  'member paths are relative to the record\'s path (no leading "/", no "..")');

export const Manifest = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('file'), size: bytes, hash: Hash.optional(), hashes: Hashes.optional() }),
  z.strictObject({
    kind: z.literal('bundle'),                                   // an IMF / DCP folder
    members: z.array(z.strictObject({ path: relPath, size: bytes, hash: Hash.optional(), hashes: Hashes.optional() })).max(MANIFEST_MAX_MEMBERS),
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
    members: z.array(z.strictObject({ path: relPath, channel: z.string().min(1).max(16), size: bytes.optional(), hash: Hash.optional(), hashes: Hashes.optional() })).min(1).max(64),
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
  { id: '7.1', label: '7.1', channels: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs', 'Lrs', 'Rrs'] },   // house spelling (Sept 29): Ls/Rs side, Lrs/Rrs rear — what the desktop's ffprobe mapping and qt_chan_tag_inplace.py write
];

/* ── timeline audio (the Resolve tool) ────────────────────────────────────── */

/**
 * What a Resolve timeline's audio tracks ARE — the lanes, their format, and the
 * clips on each — as the desktop's Resolve tool reads them (RESOLVE-BRIEF.md R1.3).
 * NOT an `audio_layout`: there a track is a CONTAINER and its channels the content
 * (what a file carries, what a deliverable asks for); here a track is a LANE with
 * clips on it, and the question is "which mix files are on this timeline". The
 * layout a timeline would render to is derived from this (`layoutFromTimeline`).
 *
 * Read-only by intent: Resolve is the source of truth. Change it there, ingest again.
 *
 * - `format` is Resolve's own word for the track (GetTrackSubType): "mono",
 *   "stereo", "5.1", "5.1film", "7.1", "7.1film", "adaptive6" — kept as Resolve
 *   says it, so a reader can trust it; the channel names are the derivation's job.
 * - Clip `start`/`end` are timecode LABELS on the timeline, `end` EXCLUSIVE (the
 *   frame after the last), as `video_layout` has it. Checked only for the
 *   eight-digit form: the base they count at (rate, drop) is another field of the
 *   record, and a shape never reads a second field.
 * - `path` is absent for a clip with no file behind it (a generator, tone made in
 *   Fairlight). It is what the tool links File records by, exactly.
 * - Mute is NOT recorded (the owner, Oct 26): what is muted at the moment of an
 *   ingest is ephemeral and says nothing worth tracking.
 */
const tcLabel = z.string().refine(isTcLabel, 'a timecode label looks like "01:00:00:00" (";" before the frames at a drop base)');
export const TimelineAudio = z.strictObject({
  tracks: z.array(z.strictObject({
    index: z.number().int().positive(),                          // Resolve's 1-based track index: A1 is 1
    name: z.string().max(80),                                     // GetTrackName: "A1", "Mix", "M&E"
    format: z.string().min(1).max(16),                            // GetTrackSubType, as Resolve says it
    clips: z.array(z.strictObject({
      name: z.string().max(255),                                  // the item's name on the timeline
      path: z.string().min(1).max(1024).optional(),               // the media file, absolute, as Resolve has it
      start: tcLabel,
      end: tcLabel,                                               // exclusive
      frames: z.number().int().nonnegative(),
    })).max(500),
  })).max(128),
});
export type TimelineAudio = z.infer<typeof TimelineAudio>;

/**
 * Resolve's track formats → the channels of the `audio_layout` track they make.
 * Labels are the HOUSE spelling (`LAYOUT_PRESETS`: Ls/Rs side, Lrs/Rrs rear) in
 * the order Resolve carries them — the "film" formats put C second and LFE last.
 * The film orders are from Resolve's documentation and unverified against a real
 * timeline (RESOLVE-BRIEF.md R6, needs eyes).
 */
export const RESOLVE_TRACK_CHANNELS: Record<string, readonly string[]> = {
  mono: ['M'],
  stereo: ['L', 'R'],
  '5.1': ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'],
  '5.1film': ['L', 'C', 'R', 'Ls', 'Rs', 'LFE'],
  '7.1': ['L', 'R', 'C', 'LFE', 'Ls', 'Rs', 'Lrs', 'Rrs'],
  '7.1film': ['L', 'C', 'R', 'Ls', 'Rs', 'Lrs', 'Rrs', 'LFE'],
};
/** Fairlight's adaptive tracks: "adaptive1" … "adaptive36", unnamed channels. */
const ADAPTIVE = /^adaptive([1-9]|[12]\d|3[0-6])$/;

/** The channels of one Resolve track format, or null when the format is not one this knows. */
export function resolveTrackChannels(format: string): string[] | null {
  const f = format.trim().toLowerCase();
  const known = RESOLVE_TRACK_CHANNELS[f];
  if (known) return [...known];
  const a = ADAPTIVE.exec(f);
  return a ? Array.from({ length: Number(a[1]) }, (_, i) => `ch${i + 1}`) : null;
}

/**
 * The `audio_layout` a timeline renders to: one track per Resolve track, in track
 * order, named after it, channels by format. EVERY track — mute is not read, and
 * an empty lane is still a lane of the layout. A format this does not know becomes
 * ONE placeholder channel "?" and a problem, so a layout compare fails loudly on
 * the count instead of passing on a guess.
 *
 * What it is for: the bridge to everything `audio_layout` already has — the
 * summary, the editor, `diffLayouts` against a deliverable's spec.
 */
export function layoutFromTimeline(ta: TimelineAudio): { layout: AudioLayout; problems: string[] } {
  const problems: string[] = [];
  const tracks = [...ta.tracks].sort((a, b) => a.index - b.index).map((t) => {
    const channels = resolveTrackChannels(t.format);
    if (!channels) problems.push(`${t.name || `A${t.index}`}: Resolve's track format "${t.format}" is not one the tool knows — one "?" channel stands in for it`);
    return { name: t.name, channels: channels ?? ['?'] };
  });
  return { layout: { tracks }, problems };
}

/* ── the registry ─────────────────────────────────────────────────────────── */

export const SHAPES = ['manifest', 'audio_layout', 'video_layout', 'timeline_audio', 'json', 'report', 'calendar'] as const;
export type Shape = (typeof SHAPES)[number];
export const SHAPE_LABELS: Record<Shape, string> = {
  manifest: 'File manifest', audio_layout: 'Audio layout', video_layout: 'Video layout', timeline_audio: 'Timeline audio', json: 'Generic JSON', report: 'Report definition', calendar: 'Calendar definition',
};
/**
 * 'report' is a shape only a table of REPORTS makes (sql/013), and 'calendar' one
 * only a table of CALENDARS makes (sql/020), so the field form offers neither. The
 * same cycle rule applies to contract/calendar.ts (it imports reports.ts). Its schema is in contract/reports.ts, which imports views.ts, which
 * imports THIS file — so the report parse is done by values.ts (which imports both),
 * never here: a cycle through zod schemas evaluated at module load would be a TDZ
 * error the moment views.ts is imported first.
 */
export const FIELD_FORM_SHAPES: readonly Shape[] = ['manifest', 'audio_layout', 'video_layout', 'timeline_audio', 'json'];

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
  if (shape === 'video_layout') { const r = VideoLayout.safeParse(value); return r.success ? null : `'${key}' (video layout) — ${first(r.error)}`; }
  if (shape === 'timeline_audio') { const r = TimelineAudio.safeParse(value); return r.success ? null : `'${key}' (timeline audio) — ${first(r.error)}`; }
  return null;                                                  // 'json' (an object is enough), or 'report' / 'calendar' (values.ts parses those)
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

/**
 * A structured value as ONE line of text — what a grid cell, a card row, a report
 * cell show in its place.
 *
 * `detail` is for where that text is MATCHED or COMPARED rather than read at a glance
 * (a view's search, filter and sort; a comparison's "expected … found …"; the tooltip
 * of a copied layout): an audio layout then also lists each track's format,
 * "4 tracks / 12 ch (5.1, 2.0, 2.0, 2.0)". Shown in a cell that list is noise — ten
 * mono tracks read "(mono, mono, mono, …)" and push everything else off the line —
 * so the plain summary stops at "10 tracks / 10 ch". The tray's editor is where the
 * tracks are read.
 */
export function summarise(shape: Shape | null, value: unknown, detail = false): string {
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
    const counts = `${t.length} track${t.length === 1 ? '' : 's'} / ${flattenChannels(r.data).length} ch`;
    return detail ? `${counts} (${t.map(trackFormat).join(', ')})` : counts;
  }
  if (shape === 'video_layout') {
    const r = VideoLayout.safeParse(value);
    return r.success ? summariseVideoLayout(r.data) : 'invalid layout';
  }
  if (shape === 'timeline_audio') {
    // "A1 stereo · A2 5.1 · A3 stereo (3)" — the clip count only when it is not
    // the usual one mix per track. `detail` (search, filter, sort) names every
    // clip, so "which edit has EP101_Mix_v3 on it" finds the record.
    const r = TimelineAudio.safeParse(value);
    if (!r.success) return 'invalid timeline audio';
    const t = [...r.data.tracks].sort((a, b) => a.index - b.index);
    if (!t.length) return 'no audio tracks';
    return t.map((x) => {
      const head = `${x.name || `A${x.index}`} ${x.format}`;
      if (detail) return `${head} (${x.clips.map((c) => c.name).join(', ')})`;
      return x.clips.length === 1 ? head : `${head} (${x.clips.length})`;
    }).join(' · ');
  }
  if (shape === 'report') {
    // Structural, deliberately without the schema: "3 levels, 2 rollups". The
    // outline renderer shows the real thing; this is the grid cell.
    const root = (value as { root?: unknown }).root;
    if (!root || typeof root !== 'object') return 'empty report';
    let levels = 0, rollups = 0;
    const walk = (l: { rollups?: unknown[]; children?: unknown[] }) => { levels++; rollups += l.rollups?.length ?? 0; for (const c of l.children ?? []) walk(c as typeof l); };
    walk(root as { rollups?: unknown[]; children?: unknown[] });
    return `${levels} level${levels === 1 ? '' : 's'}${rollups ? `, ${rollups} rollup${rollups === 1 ? '' : 's'}` : ''}`;
  }
  if (shape === 'calendar') {
    // Structural, without the schema, like a report's: "2 sources · resource".
    const v = value as { sources?: unknown[]; rows?: unknown };
    const n = Array.isArray(v.sources) ? v.sources.length : 0;
    return `${n ? `${n} source${n === 1 ? '' : 's'}` : 'no sources'}${v.rows ? ' · resource' : ''}`;
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
 *   language   OFF unless `labels` is asked for (Oct 17): track names and languages
 *              are rarely enforced by a spec — the track and channel layout is what
 *              gets a delivery rejected. A compare pair ticks "names too" for the
 *              rare spec that does enforce them (compare.ts `params.labels`).
 *
 * Channel labels compare case-insensitively; names ignore case and outer spaces.
 */
export function diffLayouts(a: AudioLayout, b: AudioLayout, labels = false): LayoutDiff {
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
      } else if (labels) {
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

/* ── manifests ────────────────────────────────────────────────────────────── */

export const MANIFEST_KINDS = ['file', 'bundle', 'sequence', 'channel_set'] as const;

