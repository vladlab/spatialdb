/**
 * ============================================================================
 *  The `video_layout` shape: a mini EDL of what is on a file, and where.
 * ============================================================================
 *
 *  "Three seconds of black from 00:59:27:00, then bars and tone, a slate, picture
 *  at 01:00:00:00, textless after." A list of ITEMS in file order, at one timecode
 *  base — the way a delivery spec states it, and the way a DCP states its first
 *  frame of picture. On a Deliverable it is what is asked for; on an Edit or a File,
 *  what was built.
 *
 *  An item is one of three things, told apart by its `duration` alone:
 *
 *    a BLOCK    duration "HH:MM:SS:FF" — black, bars, a slate: it has a length.
 *    OPEN       duration "open" — a block whose length the spec does not know: the
 *               program, the textless. (Without this, "picture starts at
 *               01:00:00:00" would be indistinguishable from a marker.)
 *    a MARKER   no duration — one frame to be aware of: the 2-pop, FFOA, LFOA.
 *
 *  and its `start` is either TYPED (pinned: "the spec says 01:00:00:00") or left
 *  out, meaning "where the block before it ends" — so a head build is entered the
 *  way it is written, as lengths, and the timecodes are worked out (`resolveLayout`).
 *  When a pinned block follows blocks that add up, the two are CHECKED against each
 *  other: it lands exactly, or there is a gap, or an overlap. That check is the
 *  reason the chain exists.
 *
 *  All arithmetic is in LABEL frames (contract/timecode.ts): a layout is positions
 *  on the timecode track, as a spec writes them. Lengths are stored as timecode
 *  text too ("00:00:03:00"), so the JSON reads like the spec it came from.
 *
 *  `kind` is optional and only chooses a block's colour. It is also what a
 *  spec-versus-file comparison will match on, when there is one.
 */

import { z } from 'zod';
import {
  TC_RATES, baseLabel, canDrop, formatLength, labelToTc, lengthFromTc, snapLabel, tcError, tcFps, tcToLabel,
  type TcBase,
} from './timecode.js';

export const VIDEO_KINDS = ['black', 'bars', 'slate', 'picture', 'textless', 'other'] as const;
export type VideoKind = (typeof VIDEO_KINDS)[number];
export const VIDEO_KIND_LABELS: Record<VideoKind, string> = {
  black: 'Black', bars: 'Bars and tone', slate: 'Slate', picture: 'Picture', textless: 'Textless', other: 'Other',
};
export const VIDEO_LAYOUT_MAX_ITEMS = 200;

const TC_TEXT = /^\d{2}:\d{2}:\d{2}[:;]\d{2}$/;

export const VideoLayout = z.strictObject({
  rate: z.number().refine((r) => (TC_RATES as readonly number[]).includes(r), `rate is one of ${TC_RATES.join(', ')}`),
  drop: z.boolean(),
  items: z.array(z.strictObject({
    label: z.string().max(80),
    kind: z.enum(VIDEO_KINDS).optional(),
    start: z.string().regex(TC_TEXT, 'a start is a timecode, "01:00:00:00"').optional(),
    duration: z.string().refine((d) => d === 'open' || TC_TEXT.test(d), 'a duration is "open" or a length written as a timecode, "00:00:03:00"').optional(),
  })).max(VIDEO_LAYOUT_MAX_ITEMS),
}).superRefine((l, ctx) => {
  const base = { rate: l.rate, drop: l.drop };
  if (l.drop && !canDrop(l.rate)) ctx.addIssue({ code: 'custom', path: ['drop'], message: `drop-frame exists at 29.97 and 59.94, not ${l.rate}` });
  l.items.forEach((it, i) => {
    if (it.start !== undefined && TC_TEXT.test(it.start)) {
      const e = tcError(it.start, canDrop(l.rate) ? base : { rate: l.rate, drop: false });
      if (e) ctx.addIssue({ code: 'custom', path: ['items', i, 'start'], message: e });
    }
    if (it.duration !== undefined && it.duration !== 'open' && TC_TEXT.test(it.duration)) {
      const n = lengthFromTc(it.duration, base);
      if (n === null) ctx.addIssue({ code: 'custom', path: ['items', i, 'duration'], message: tcError(it.duration.replace(';', ':'), { rate: l.rate, drop: false }) ?? 'not a length' });
      else if (n === 0) ctx.addIssue({ code: 'custom', path: ['items', i, 'duration'], message: 'a length of zero is a marker — leave the duration out' });
    }
  });
});
export type VideoLayout = z.infer<typeof VideoLayout>;
export type VideoItem = VideoLayout['items'][number];

export const baseOf = (l: VideoLayout): TcBase => ({ rate: l.rate, drop: l.drop });
export const itemType = (it: VideoItem): 'span' | 'open' | 'marker' => (it.duration === undefined ? 'marker' : it.duration === 'open' ? 'open' : 'span');

/* ── resolving: lengths and pins → positions ──────────────────────────────── */

export interface ResolvedItem {
  index: number;
  label: string;
  kind: VideoKind | undefined;
  type: 'span' | 'open' | 'marker';
  /** The start was TYPED. Otherwise it was worked out (or could not be). */
  pinned: boolean;
  /** Label frames. Null when it cannot be known: nothing before it is pinned, or it follows an open block. */
  start: number | null;
  /** A block's length; an open block's only when a later pinned block says where it stops. */
  length: number | null;
  /** Where the next item starts (exclusive out). */
  end: number | null;
  /** Pinned, and exactly where the blocks before it end — the head adds up. */
  landed: boolean;
  /** When `start` is unknown: the block this one comes straight after ("after Program"). */
  follows: number | null;
}
export interface LayoutIssue { kind: 'gap' | 'overlap'; item: number; frames: number; detail: string }
export interface ResolvedLayout {
  base: TcBase;
  items: ResolvedItem[];
  issues: LayoutIssue[];
  /** First frame of file: where the first block starts. */
  fileStart: number | null;
  /** First frame of picture: where the first `picture` block starts. */
  pictureStart: number | null;
}

/**
 * Walk the items in order with a cursor: a block without a start begins at the
 * cursor; a block WITH one is checked against it (landed / gap / overlap) and moves
 * it. A marker never moves the cursor. An open block leaves the cursor unknown —
 * until the next pinned block, which is also where the open one stops.
 */
export function resolveLayout(l: VideoLayout): ResolvedLayout {
  const base = baseOf(l);
  const tc = (n: number) => labelToTc(n, base);
  const out: ResolvedItem[] = [];
  const issues: LayoutIssue[] = [];
  let cursor: number | null = null;
  let prev: number | null = null;                                // the last BLOCK (span or open)

  l.items.forEach((it, index) => {
    const type = itemType(it);
    const typed = it.start !== undefined ? tcToLabel(it.start, base) : null;
    const pinned = typed !== null;
    if (type === 'marker') {
      const start = typed ?? cursor;
      out.push({ index, label: it.label, kind: it.kind, type, pinned, start, length: null, end: null, landed: false, follows: start === null ? prev : null });
      return;
    }
    let landed = false;
    const name = it.label || `item ${index + 1}`;
    if (typed !== null) {
      if (cursor !== null) {
        if (typed === cursor) landed = prev !== null;
        else if (typed > cursor) issues.push({ kind: 'gap', item: index, frames: typed - cursor, detail: `${formatLength(typed - cursor, base)} unaccounted for before ${name} (${tc(cursor)} to ${tc(typed)})` });
        else issues.push({ kind: 'overlap', item: index, frames: cursor - typed, detail: `${name} starts at ${tc(typed)}, but the items before it run to ${tc(cursor)} — ${formatLength(cursor - typed, base)} over` });
      } else if (prev !== null && out[prev].type === 'open' && out[prev].start !== null) {
        const open = out[prev];
        if (typed > open.start!) { open.end = typed; open.length = typed - open.start!; }
        else issues.push({ kind: 'overlap', item: index, frames: open.start! - typed, detail: `${name} starts at ${tc(typed)}, before ${open.label || `item ${prev + 1}`} (${tc(open.start!)}) which comes before it` });
      }
    }
    const start = typed ?? cursor;
    const length = type === 'span' ? lengthFromTc(it.duration!, base) : null;
    const end = start !== null && length !== null ? snapLabel(start + length, base) : null;
    out.push({ index, label: it.label, kind: it.kind, type, pinned, start, length, end, landed, follows: start === null ? prev : null });
    cursor = end;
    prev = index;
  });

  const blocks = out.filter((x) => x.type !== 'marker');
  return {
    base, items: out, issues,
    fileStart: blocks[0]?.start ?? null,
    pictureStart: blocks.find((x) => x.kind === 'picture')?.start ?? null,
  };
}

/** The grid cell: "23.976 · file 00:59:27:00 · picture 01:00:00:00 · 8 items". */
export function summariseVideoLayout(l: VideoLayout): string {
  if (!l.items.length) return 'no items';
  const r = resolveLayout(l);
  return [
    baseLabel(r.base),
    r.fileStart !== null ? `file ${labelToTc(r.fileStart, r.base)}` : '',
    r.pictureStart !== null ? `picture ${labelToTc(r.pictureStart, r.base)}` : '',
    `${l.items.length} item${l.items.length === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' · ');
}

/* ── the strip: blocks at a READABLE scale ────────────────────────────────── */

export interface StripBlock {
  /** The item's index; null for a gap drawn between two blocks. */
  item: number | null;
  kind: VideoKind | 'gap';
  label: string;
  /** Under the label: "3s", "open". */
  sub: string;
  /** Percent of the strip. */
  left: number; width: number;
  open: boolean;
  /** An overlap issue points at this block. */
  warn: boolean;
  /** A TYPED start, printed under the block's left edge — and which row (−1: no room, the list has it). */
  tc: string | null; tcRow: number; tcAlign: 'left' | 'right';
}
export interface StripMarker { item: number; label: string; tc: string | null; x: number; row: number; align: 'left' | 'right' }
export interface Strip { blocks: StripBlock[]; markers: StripMarker[]; markerRows: number; tcRows: number }

/**
 * NOT true to time, on purpose: a 90-minute program beside three seconds of black
 * would be a bar and a hairline. A block's width grows with the LOGARITHM of its
 * length (3s, 15s and a minute are all readable and still in order of size), an
 * open block takes a fixed generous width, and the timecodes carry the truth.
 */
const weightOf = (seconds: number) => 3 + Math.log2(1 + Math.max(0, seconds));
const OPEN_WEIGHT = 9;

/** Rough text width, for keeping labels off each other. The strip cannot measure (and tests have no layout). */
const textPx = (chars: number) => chars * 6.2 + 10;

/** Put each label in the first row where it clears what is already there. `rows` rows; −1 when none has room and `must` is false. */
function stagger(labels: Array<{ x: number; px: number; align: 'left' | 'right' }>, widthPx: number, rows: number, must: boolean): number[] {
  const ends: number[] = Array(rows).fill(-Infinity);
  return labels.map((lab) => {
    const at = (lab.x / 100) * widthPx;
    const from = lab.align === 'left' ? at : at - lab.px, to = from + lab.px;
    let row = ends.findIndex((e) => from >= e);
    if (row < 0) { if (!must) return -1; row = ends.indexOf(Math.min(...ends)); }
    ends[row] = to + 6;
    return row;
  });
}

export function stripLayout(l: VideoLayout, widthPx = 420): Strip {
  const r = resolveLayout(l);
  const fps = tcFps(l.rate);
  const tc = (n: number) => labelToTc(n, r.base);
  const overlapped = new Set(r.issues.filter((i) => i.kind === 'overlap').map((i) => i.item));
  const gapBefore = new Map(r.issues.filter((i) => i.kind === 'gap').map((i) => [i.item, i.frames]));

  // Blocks in file order, a gap block before any block that a gap issue points at.
  const raw: Array<Omit<StripBlock, 'left' | 'width' | 'tcRow' | 'tcAlign'> & { w: number; start: number | null; end: number | null }> = [];
  for (const it of r.items) {
    if (it.type === 'marker') continue;
    const gap = gapBefore.get(it.index);
    if (gap !== undefined) raw.push({ item: null, kind: 'gap', label: '', sub: formatLength(gap, r.base), open: false, warn: false, tc: null, w: weightOf(gap / fps), start: it.start! - gap, end: it.start });
    raw.push({
      item: it.index, kind: it.kind ?? 'other', label: it.label,
      sub: it.type === 'open' ? 'open' : formatLength(it.length!, r.base),
      open: it.type === 'open', warn: overlapped.has(it.index),
      tc: it.pinned ? tc(it.start!) : null,
      w: it.type === 'open' ? OPEN_WEIGHT : weightOf(it.length! / fps),
      start: it.start, end: it.end,
    });
  }
  const total = raw.reduce((s, b) => s + b.w, 0) || 1;
  let at = 0;
  const placed = raw.map((b) => { const left = (at / total) * 100, width = (b.w / total) * 100; at += b.w; return { ...b, left, width }; });

  // A marker sits where its timecode falls: inside the block that contains it (in
  // proportion), on a boundary, or — in an open block, whose length nobody knows —
  // in its middle. With no timecode it sits where the block it follows ends.
  const xOf = (m: ResolvedItem): number => {
    if (m.start === null) { const b = placed.find((p) => p.item === m.follows); return b ? b.left + b.width : 0; }
    const t = m.start;
    for (const b of placed) {
      if (b.start === null) continue;
      if (t === b.start) return b.left;
      if (b.end !== null && t > b.start && t < b.end) return b.left + ((t - b.start) / (b.end - b.start)) * b.width;
      if (b.end === null && t > b.start) {
        const later = placed.slice(placed.indexOf(b) + 1).find((p) => p.start !== null);
        if (!later || t < later.start!) return b.left + b.width / 2;
      }
    }
    const known = placed.filter((p) => p.start !== null);
    if (!known.length || t < known[0].start!) return 0;
    const last = known[known.length - 1];
    return last.end !== null && t >= last.end ? last.left + last.width : 100;
  };
  const alignAt = (x: number): 'left' | 'right' => (x > 62 ? 'right' : 'left');

  const marks = r.items.filter((it) => it.type === 'marker')
    .map((m) => { const x = xOf(m); return { item: m.index, label: m.label, tc: m.start !== null ? tc(m.start) : null, x, align: alignAt(x) }; })
    .sort((a, b) => a.x - b.x);
  const markRows = stagger(marks.map((m) => ({ x: m.x, px: textPx(m.label.length + (m.tc ? 12 : 0)), align: m.align })), widthPx, 3, true);
  const markers = marks.map((m, i) => ({ ...m, row: markRows[i] }));

  const tcs = placed.map((b, i) => ({ i, x: b.left, tc: b.tc, align: alignAt(b.left) })).filter((b) => b.tc !== null);
  const tcRowsOf = stagger(tcs.map((b) => ({ x: b.x, px: textPx(11), align: b.align })), widthPx, 2, false);
  const tcRow = new Map(tcs.map((b, k) => [b.i, tcRowsOf[k]]));

  const blocks: StripBlock[] = placed.map(({ w: _w, start: _s, end: _e, ...b }, i) => { void _w; void _s; void _e; return { ...b, tcRow: tcRow.get(i) ?? -1, tcAlign: alignAt(b.left) }; });
  return {
    blocks, markers,
    markerRows: markers.length ? Math.max(...markers.map((m) => m.row)) + 1 : 0,
    tcRows: blocks.some((b) => b.tcRow >= 0) ? Math.max(...blocks.map((b) => b.tcRow)) + 1 : 0,
  };
}

/* ── operations (the editor is buttons and inputs over these) ─────────────── */

export const VIDEO_PRESETS: Array<{ id: string; label: string; item: VideoItem }> = [
  { id: 'black', label: 'Black', item: { label: 'Black', kind: 'black', duration: '00:00:02:00' } },
  { id: 'bars', label: 'Bars and tone', item: { label: 'Bars and tone', kind: 'bars', duration: '00:01:00:00' } },
  { id: 'slate', label: 'Slate', item: { label: 'Slate', kind: 'slate', duration: '00:00:10:00' } },
  { id: 'picture', label: 'Program', item: { label: 'Program', kind: 'picture', duration: 'open' } },
  { id: 'textless', label: 'Textless', item: { label: 'Textless', kind: 'textless', duration: 'open' } },
  { id: 'marker', label: 'Marker', item: { label: '' } },
];

const withItems = (l: VideoLayout, items: VideoItem[]): VideoLayout => ({ rate: l.rate, drop: l.drop, items });

export function addItem(l: VideoLayout, presetId: string): VideoLayout {
  const p = VIDEO_PRESETS.find((x) => x.id === presetId);
  return p ? withItems(l, [...l.items, { ...p.item }]) : l;
}
export const removeItem = (l: VideoLayout, i: number): VideoLayout => withItems(l, l.items.filter((_, k) => k !== i));
export function moveItem(l: VideoLayout, i: number, by: -1 | 1): VideoLayout {
  const j = i + by;
  if (i < 0 || j < 0 || i >= l.items.length || j >= l.items.length) return l;
  const t = [...l.items]; [t[i], t[j]] = [t[j], t[i]];
  return withItems(l, t);
}
/** Replace item `i`'s fields; a key set to `undefined` is REMOVED (a strict object stores no undefined). */
export function patchItem(l: VideoLayout, i: number, patch: Partial<Record<keyof VideoItem, string | undefined>>): VideoLayout {
  return withItems(l, l.items.map((it, k) => {
    if (k !== i) return it;
    const next: Record<string, unknown> = { ...it, ...patch };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    // Keys in one order, whatever was patched: the JSON should read label, kind, start, duration.
    const { label, kind, start, duration } = next as VideoItem;
    return { label, ...(kind ? { kind } : {}), ...(start ? { start } : {}), ...(duration ? { duration } : {}) };
  }));
}

/**
 * The same layout at another base. The digits stay — "00:59:27:00" at 23.976 is
 * "00:59:27:00" at 25 — except where they cannot: a frame number the new rate does
 * not count (frame 29 at 24) becomes its last frame, and a label drop-frame skips
 * moves on to the first that exists. Drop is cleared at a rate that has none.
 */
export function rebase(l: VideoLayout, rate: number, drop: boolean): VideoLayout {
  const base: TcBase = { rate, drop: drop && canDrop(rate) };
  const fps = tcFps(rate);
  const refit = (text: string, b: TcBase): string => {
    const m = /^(\d{2}):(\d{2}):(\d{2})[:;](\d{2})$/.exec(text);
    if (!m) return text;
    const label = ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * fps + Math.min(+m[4], fps - 1);
    return labelToTc(snapLabel(label, b), b);
  };
  return {
    rate, drop: base.drop,
    items: l.items.map((it) => ({
      ...it,
      ...(it.start !== undefined ? { start: refit(it.start, base) } : {}),
      ...(it.duration !== undefined && it.duration !== 'open' ? { duration: refit(it.duration, { rate, drop: false }) } : {}),
    })),
  };
}
