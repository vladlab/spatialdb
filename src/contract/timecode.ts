/**
 * ============================================================================
 *  Timecode: parsing, formatting, and the arithmetic a layout needs.
 * ============================================================================
 *
 *  Pure, shared by server and client. The first user is the `video_layout` shape
 *  (contract/shapes.ts); a timecode FIELD TYPE, when there is one, starts here.
 *
 *  A timecode is a LABEL on a frame — "01:00:00:00" — and means nothing without
 *  its base: the rate it counts at, and whether it drops. Two numberings of the
 *  same label are used here, and they must not be confused:
 *
 *    label frames   hh, mm, ss, ff counted straight at the nominal rate (24 for
 *                   23.976, 30 for 29.97). "Three seconds after 00:59:27:00" is
 *                   label arithmetic: it is how a spec is written and how a
 *                   person reads a slate, at every rate. `tcToLabel`, `labelToTc`,
 *                   `tcAdd`.
 *    real frames    how many frames of picture came before this label. The same
 *                   as label frames for non-drop; for DROP-FRAME, fewer — two
 *                   labels (four at 59.94) are skipped each minute except every
 *                   tenth, so the labels keep up with the clock. `tcToFrames`,
 *                   `framesToTc`.
 *
 *  A layout works in LABEL frames on purpose. "Bars at 00:58:30;00 for one
 *  minute" ends at 00:59:30;00 — what the spec means — where real-frame arithmetic
 *  (1800 frames on) says 00:59:30;02. In drop-frame a label sum can land on a label
 *  that does not exist (00:59:00;00); `snapLabel` moves it to the next one that does.
 */

export interface TcBase { rate: number; drop: boolean }

/** The rates a timecode base may name. Numbers as ffprobe's `frame_rate` field stores them (3 decimals). */
export const TC_RATES = [23.976, 24, 25, 29.97, 30, 47.952, 48, 50, 59.94, 60] as const;

/** The nominal rate the labels count at: 24 for 23.976, 30 for 29.97. */
export const tcFps = (rate: number): number => Math.round(rate);
/** Drop-frame exists only at 29.97 and 59.94. */
export const canDrop = (rate: number): boolean => rate === 29.97 || rate === 59.94;
/** Labels skipped at the top of each minute (except every tenth): 2 at 29.97, 4 at 59.94. */
const dropPerMinute = (fps: number): number => Math.round(fps / 15);

/** "23.976", "29.97 DF" — how a base reads in a summary. */
export const baseLabel = (b: TcBase): string => `${b.rate}${b.drop ? ' DF' : ''}`;

const TC_RE = /^(\d{2}):(\d{2}):(\d{2})([:;])(\d{2})$/;

/** hh:mm:ss:ff split, or null when the text is not eight digits and three separators. */
function parts(tc: string): { h: number; m: number; s: number; f: number; sep: string } | null {
  const x = TC_RE.exec(tc);
  return x ? { h: +x[1], m: +x[2], s: +x[3], f: +x[5], sep: x[4] } : null;
}

/** A label the drop-frame count skips: frames 00–01 (00–03 at 59.94) of any minute not divisible by ten. */
const isDropped = (m: number, s: number, f: number, fps: number): boolean => s === 0 && m % 10 !== 0 && f < dropPerMinute(fps);

/**
 * Why `tc` is not a timecode at this base, or null. Either separator is accepted
 * before the frames (a tool may write ':' at a drop base); the frames must exist at
 * the rate, and at a drop base the label must be one the count does not skip.
 */
export function tcError(tc: string, base: TcBase): string | null {
  const p = parts(tc);
  if (!p) return `"${tc}" is not a timecode (HH:MM:SS:FF)`;
  const fps = tcFps(base.rate);
  if (p.h > 23 || p.m > 59 || p.s > 59) return `"${tc}" is not a time of day`;
  if (p.f >= fps) return `"${tc}" has frame ${p.f}, and ${base.rate} counts 00–${String(fps - 1).padStart(2, '0')}`;
  if (base.drop && isDropped(p.m, p.s, p.f, fps)) return `"${tc}" does not exist in drop-frame (the first ${dropPerMinute(fps)} frames of that minute are skipped)`;
  return null;
}

/** Label frames of a timecode — null if it is not one at this base. */
export function tcToLabel(tc: string, base: TcBase): number | null {
  if (tcError(tc, base)) return null;
  const p = parts(tc)!;
  return ((p.h * 60 + p.m) * 60 + p.s) * tcFps(base.rate) + p.f;
}

/** At a drop base, a label sum that landed on a skipped label moves on to the first that exists. */
export function snapLabel(label: number, base: TcBase): number {
  if (!base.drop) return label;
  const fps = tcFps(base.rate);
  const f = label % fps, s = Math.floor(label / fps) % 60, m = Math.floor(label / (fps * 60)) % 60;
  return isDropped(m, s, f, fps) ? label + (dropPerMinute(fps) - f) : label;
}

const two = (n: number) => String(n).padStart(2, '0');

/** The timecode of a label-frame count. Wraps at 24 hours, as timecode does; ';' before the frames at a drop base. */
export function labelToTc(label: number, base: TcBase): string {
  const fps = tcFps(base.rate), day = 24 * 3600 * fps;
  const n = ((Math.round(label) % day) + day) % day;
  const f = n % fps, s = Math.floor(n / fps) % 60, m = Math.floor(n / (fps * 60)) % 60, h = Math.floor(n / (fps * 3600));
  return `${two(h)}:${two(m)}:${two(s)}${base.drop ? ';' : ':'}${two(f)}`;
}

/** `tc` moved on by `labelFrames` (label arithmetic — see the header), or null if `tc` is not a timecode. */
export function tcAdd(tc: string, labelFrames: number, base: TcBase): string | null {
  const a = tcToLabel(tc, base);
  return a === null ? null : labelToTc(snapLabel(a + labelFrames, base), base);
}

/** REAL frames before this label: the label count, less the labels drop-frame skipped on the way. */
export function tcToFrames(tc: string, base: TcBase): number | null {
  const label = tcToLabel(tc, base);
  if (label === null || !base.drop) return label;
  const fps = tcFps(base.rate), minutes = Math.floor(label / (fps * 60));
  return label - dropPerMinute(fps) * (minutes - Math.floor(minutes / 10));
}

/** The label of real frame `n` — the inverse of `tcToFrames`. */
export function framesToTc(n: number, base: TcBase): string {
  if (!base.drop) return labelToTc(n, base);
  const fps = tcFps(base.rate), d = dropPerMinute(fps);
  const per10 = fps * 600 - d * 9, perMin = fps * 60 - d;
  const day = per10 * 6 * 24;
  let f = ((Math.round(n) % day) + day) % day;
  const tens = Math.floor(f / per10), rest = f % per10;
  f += d * 9 * tens + (rest >= d ? d * Math.floor((rest - d) / perMin) : 0);
  return labelToTc(f, base);
}

/* ── what a person types ──────────────────────────────────────────────────── */

/**
 * A timecode as typed, completed from the RIGHT the way a grading or editing
 * system reads one: "1:00:00:00" → 01:00:00:00, "59:27:00" → 00:59:27:00,
 * "3:00" → 00:00:03:00 (seconds and frames, not minutes and seconds). One or two
 * digits a group; ':' ';' or '.' between them. Returned in the base's own spelling,
 * or null when it is not a timecode there (too many groups, frame 30 at 24…).
 */
export function completeTc(typed: string, base: TcBase): string | null {
  const groups = typed.trim().split(/[:;.]/);
  if (!groups.length || groups.length > 4 || groups.some((g) => !/^\d{1,2}$/.test(g))) return null;
  const [h, m, s, f] = [...Array(4 - groups.length).fill('0'), ...groups].map(Number);
  const tc = `${two(h)}:${two(m)}:${two(s)}${base.drop ? ';' : ':'}${two(f)}`;
  return tcError(tc, base) ? null : tc;
}

/**
 * A LENGTH as typed, in label frames, or null:
 *   "3s" "90s" "1m" "1m30s" "2s12f" "72f" "1h"   units, in that order, any of them
 *   "45"                                          a bare number is SECONDS
 *   "3:00" "00:01:00:00"                          a timecode, completed from the right
 */
export function parseLength(typed: string, base: TcBase): number | null {
  const t = typed.trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  const fps = tcFps(base.rate);
  if (/^\d+$/.test(t)) return Number(t) * fps;
  const u = /^(?:(\d+)h)?(?:(\d+)m(?:in)?)?(?:(\d+)s(?:ec)?)?(?:(\d+)f(?:r)?)?$/.exec(t);
  if (u && u[0]) return ((Number(u[1] ?? 0) * 60 + Number(u[2] ?? 0)) * 60 + Number(u[3] ?? 0)) * fps + Number(u[4] ?? 0);
  if (/[:;.]/.test(t)) {
    // A length is a count, not a position: no drop-frame labels to skip, so it is read non-drop.
    const tc = completeTc(t, { rate: base.rate, drop: false });
    return tc ? tcToLabel(tc, { rate: base.rate, drop: false }) : null;
  }
  return null;
}

/** A length in label frames as "HH:MM:SS:FF" — how a layout stores one (always ':'; a length is not a drop-frame label). */
export const lengthToTc = (labelFrames: number, base: TcBase): string => labelToTc(labelFrames, { rate: base.rate, drop: false });
/** …and back. Null if it is not one. */
export const lengthFromTc = (tc: string, base: TcBase): number | null => tcToLabel(tc.replace(';', ':'), { rate: base.rate, drop: false });

/**
 * A length the way it is said — "3s", "1m 30s", "2s 12f", "1 frame", "1h 2m" — while
 * that is short. One that needs three units or more (a program: 1h 32m 10s 5f) is
 * written the way such a length is always read: as a timecode, "01:32:10:05".
 */
export function formatLength(labelFrames: number, base: TcBase): string {
  const fps = tcFps(base.rate);
  const f = labelFrames % fps, total = Math.floor(labelFrames / fps);
  const s = total % 60, m = Math.floor(total / 60) % 60, h = Math.floor(total / 3600);
  if (labelFrames === 1) return '1 frame';
  const out = [h ? `${h}h` : '', m ? `${m}m` : '', s ? `${s}s` : '', f ? `${f}f` : ''].filter(Boolean);
  if (out.length > 2) return lengthToTc(labelFrames, base);
  return out.length ? out.join(' ') : '0s';
}
