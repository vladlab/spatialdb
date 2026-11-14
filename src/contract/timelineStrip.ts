/**
 * ============================================================================
 *  A timeline's audio, DRAWN small (CANVAS-BRIEF.md B3) — the sibling of the
 *  video layout's strip (videoLayout.ts `stripLayout`)
 * ============================================================================
 *
 *  The owner's words: "if A1 has Tone for 30 sec then Mix, I'd like to see that" —
 *  not to scale, like the video strip. The data is already there: the Resolve tool
 *  stores every audio lane's clips with their start and (exclusive) end
 *  (shapes.ts `TimelineAudio`). Nothing new is read.
 *
 *  THE COLUMNS ARE SHARED BY EVERY LANE. Every clip start and end on any track is a
 *  boundary; the spans between boundaries are columns, each as wide as the LOG of
 *  its length (the video strip's rule — 2s of tone and 52 minutes of mix are both
 *  readable, still in order of size). So A1's Mix and A2's Mix that start at the same
 *  timecode start at the same x, and a gap is a gap on that lane only.
 *
 *  Lengths come from the labels themselves, at a nominal 30 frames a second: the
 *  record's real rate is another field, a shape never reads a second field, and a
 *  log scale does not care about the difference. The timecodes printed are the
 *  labels as stored — the truth is always in the words.
 */
import { TimelineAudio } from './shapes.js';
import type { Tint } from './colorRules.js';

/** "01:00:00:00" or "00:59:59;29" → seconds, at a nominal 30 fps (see above). NaN when it is not a label. */
export function labelSeconds(label: string): number {
  const m = /^(\d{2}):(\d{2}):(\d{2})[:;](\d{2})$/.exec(label.trim());
  if (!m) return NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 30;
}

const weightOf = (seconds: number) => 3 + Math.log2(1 + Math.max(0, seconds));
/** A lane with more clips than this draws as one block, "N clips". */
export const STRIP_MAX_CLIPS = 12;
/** Clip colours: a stable pick per clip NAME, so a stem is the same colour on every lane. Not red — red means a problem here. */
const CLIP_TINTS: Tint[] = ['blue', 'green', 'amber', 'violet'];

export interface StripClip { name: string; left: number; width: number; tint: Tint; title: string }
export interface StripLane { index: number; label: string; clips: StripClip[] }
export interface StripTick { x: number; tc: string }
export interface TimelineStrip { lanes: StripLane[]; ticks: StripTick[]; hidden: number }

function tintOf(name: string, hasFile: boolean): Tint {
  if (!hasFile) return 'grey';
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CLIP_TINTS[h % CLIP_TINTS.length];
}

/**
 * The strip of a `timeline_audio` value: lanes in track order (at most `maxLanes`;
 * `hidden` says how many more), clips placed in percent of the width, and a tick at
 * every boundary where a clip starts. Null when the value is not a timeline audio or
 * has no clips at all.
 */
export function timelineStrip(value: unknown, maxLanes = Infinity): TimelineStrip | null {
  const parsed = TimelineAudio.safeParse(value);
  if (!parsed.success) return null;
  const tracks = [...parsed.data.tracks].sort((a, b) => a.index - b.index);
  const spans = tracks.map((t) => {
    const clips = t.clips
      .map((c) => ({ ...c, s: labelSeconds(c.start), e: labelSeconds(c.end) }))
      .filter((c) => Number.isFinite(c.s) && Number.isFinite(c.e) && c.e > c.s)
      .sort((a, b) => a.s - b.s);
    if (clips.length <= STRIP_MAX_CLIPS) return { t, clips: clips.map((c) => ({ name: c.name, s: c.s, e: c.e, start: c.start, end: c.end, file: !!c.path })) };
    const first = clips[0], last = clips.reduce((a, b) => (b.e > a.e ? b : a));
    return { t, clips: [{ name: `${clips.length} clips`, s: first.s, e: last.e, start: first.start, end: last.end, file: true }] };
  });
  const bounds = new Map<number, string>();
  for (const sp of spans) for (const c of sp.clips) { if (!bounds.has(c.s)) bounds.set(c.s, c.start); if (!bounds.has(c.e)) bounds.set(c.e, c.end); }
  const at = [...bounds.keys()].sort((a, b) => a - b);
  if (at.length < 2) return null;
  // x of each boundary, in percent: the columns between them weighted by log length.
  const weights = at.slice(1).map((t, i) => weightOf(t - at[i]));
  const total = weights.reduce((a, b) => a + b, 0);
  const x = new Map<number, number>([[at[0], 0]]);
  let acc = 0;
  at.slice(1).forEach((t, i) => { acc += weights[i]; x.set(t, (acc / total) * 100); });

  const shown = spans.slice(0, maxLanes);
  const lanes: StripLane[] = shown.map(({ t, clips }) => ({
    index: t.index,
    label: [t.name || `A${t.index}`, t.format].filter(Boolean).join(' '),
    clips: clips.map((c) => ({
      name: c.name, left: x.get(c.s)!, width: x.get(c.e)! - x.get(c.s)!, tint: tintOf(c.name, c.file),
      title: `${c.name} · ${c.start} → ${c.end}${c.file ? '' : ' · no file (tone, a generator)'}`,
    })),
  }));
  const starts = new Set(shown.flatMap((l) => l.clips).map((c) => c.s));
  const ticks = at.filter((t) => starts.has(t)).map((t) => ({ x: x.get(t)!, tc: bounds.get(t)! }));
  return { lanes, ticks, hidden: Math.max(0, spans.length - shown.length) };
}

/**
 * Which ticks have room to be printed on a strip `widthPx` wide: the first always,
 * then each one that clears the last printed by a timecode's width. A timecode is
 * eleven characters of the strip's small mono type.
 */
export function ticksThatFit(ticks: StripTick[], widthPx: number, labelPx = 64): StripTick[] {
  const out: StripTick[] = [];
  let lastEnd = -Infinity;
  for (const t of ticks) {
    const left = (t.x / 100) * widthPx;
    if (left < lastEnd || left + labelPx > widthPx + 1) continue;
    out.push(t); lastEnd = left + labelPx + 6;
  }
  return out;
}
