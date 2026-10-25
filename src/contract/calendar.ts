/**
 * ============================================================================
 *  Calendars (VIEWS-BRIEF.md Part B) — a calendar IS a record.
 * ============================================================================
 *
 *  As a report is a record in a table of kind 'report', a calendar is a record in
 *  a table of kind 'calendar'; its definition is a `structured` value of shape
 *  'calendar' on that record. Nothing else is stored: a calendar is DERIVED each
 *  time it is opened, from tables already loaded in the client.
 *
 *  A calendar POURS SEVERAL TABLES INTO ONE. Its definition is a list of SOURCES,
 *  each a report-style rule — which table, which records (the grid's filters,
 *  verbatim), which date fields, what to print, which tint. Four layouts draw the
 *  same events: month, week, agenda — and resource, which lays time out
 *  horizontally with one LANE per record of a ROW table (Computers), each event on
 *  the lane(s) of the record(s) it links to.
 *
 *  Three layers, kept apart as in reports.ts:
 *    definition  — `CalendarDef`, validated on both sides (`calendarDefError`)
 *    result      — `runCalendar`, pure, over loaded tables
 *    layout      — pure helpers the four layouts share: `monthGrid`, `weekDays`,
 *                  `placeEvents` (span packing), `agendaGroups`, `laneEvents`
 *
 *  DATES are the app's `date` type: 'YYYY-MM-DD', no time, no timezone
 *  (contract/values.ts). A span is two date fields, END INCLUSIVE. Date arithmetic
 *  here is on whole UTC days, so no timezone can move an event.
 *
 *  THE LANE. A source's `lane` names a LINK field on the source table whose target
 *  is the row table. That covers both cases the brief describes with one rule:
 *    - a direct link (Projects.computers → Computers): a project with three
 *      computers sits on three lanes — one event, drawn thrice;
 *    - a junction ENDPOINT (Bookings.a → Computers, the source being the junction
 *      table itself): each pair row is one bar on one computer's lane, so the same
 *      computer can be booked on the same project in several bouts, and on several
 *      projects at once.
 *  Nothing here tells the two apart; the editor lists endpoints under a "through
 *  <junction>" heading so the owner sees what he is picking.
 */

import { z } from 'zod';
import { applyView, FilterEntry, SortEntry, type LinkIds, type LinkLabels, type ViewRecord } from './views.js';
import { TINTS, type Tint } from './colorRules.js';
import { LABEL_TYPES } from './labels.js';
import { cellText, type ReportField, type ReportTable } from './reports.js';

/* ── the definition ───────────────────────────────────────────────────────── */

const uuid = z.guid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const MAX_SOURCES = 8;
export const MAX_LABEL_FIELDS = 3;
export const LAYOUTS = ['month', 'week', 'agenda', 'resource'] as const;
export type Layout = (typeof LAYOUTS)[number];
export const LAYOUT_LABELS: Record<Layout, string> = { month: 'Month', week: 'Week', agenda: 'Agenda', resource: 'Resource' };
export const ZOOMS = ['day', 'week', 'month'] as const;
export type Zoom = (typeof ZOOMS)[number];

export const CalendarSource = z.strictObject({
  /** Stable within the calendar: the legend, per-browser source toggles and event ids key on it. */
  id: z.string().min(1).max(64),
  tableId: uuid,
  filters: z.array(FilterEntry).max(32).default([]),
  /** A `date` field on `tableId`. */
  start: uuid,
  /** A `date` field on `tableId`. Absent: one-day events, on `start`. */
  end: uuid.optional(),
  /** 1–3 fields printed on the chip, in order, joined " · ". */
  label: z.array(uuid).min(1).max(MAX_LABEL_FIELDS),
  tint: z.enum(TINTS),
  /** A `select` field on `tableId` whose value picks the tint through `tintMap`. */
  tintBy: uuid.optional(),
  /**
   * Choice → tint. A choice not listed — or no longer a choice at all (renamed,
   * removed) — uses `tint`. Stale keys are TOLERATED, not refused: renaming a
   * status must not make every later write of the calendar (even switching its
   * layout) fail validation.
   */
  tintMap: z.record(z.string().max(200), z.enum(TINTS)).optional(),
  /** Resource only: a link field on `tableId` that targets `rows.tableId`. */
  lane: uuid.optional(),
});
export type CalendarSource = z.infer<typeof CalendarSource>;

export const CalendarRows = z.strictObject({
  tableId: uuid,
  filters: z.array(FilterEntry).max(32).default([]),
  sort: z.array(SortEntry).max(8).default([]),
});
export type CalendarRows = z.infer<typeof CalendarRows>;

export const CalendarDef = z.strictObject({
  v: z.literal(1),
  /** Remembered from the top bar ("where I was"), not configured in the editor. */
  layout: z.enum(LAYOUTS).default('month'),
  sources: z.array(CalendarSource).max(MAX_SOURCES),
  /** The resource axis. Absent: no resource layout. */
  rows: CalendarRows.optional(),
  /** Resource column width, also remembered from the top bar. */
  zoom: z.enum(ZOOMS).default('week'),
});
export type CalendarDef = z.infer<typeof CalendarDef>;

/**
 * A NEW calendar: no sources yet. Valid on purpose — it is saved the moment the
 * record is made, and the editor fills it in. A calendar with no sources simply
 * draws nothing and says so (`runCalendar` → problems).
 */
export const EMPTY_CALENDAR = (): CalendarDef => ({ v: 1, layout: 'month', sources: [], zoom: 'week' });

/* ── validation ───────────────────────────────────────────────────────────── */

export type CalendarField = ReportField;
/** `utility` is a records table ticked "utility" (sql/018): not offered as a row table. */
export type CalendarTable = ReportTable & { utility?: boolean | null };

/** Types a chip may print: what reads as a name, plus links and backlinks (their pill text). */
const CHIP_TYPES: ReadonlySet<string> = new Set([...LABEL_TYPES, 'link', 'backlink', 'lookup', 'checkbox']);
const UTILITY_KINDS: ReadonlySet<string> = new Set(['canvas', 'report', 'junction', 'calendar']);

/**
 * Null when `raw` is a calendar this schema can draw; otherwise the FIRST problem,
 * worded for the person editing it. Run by the server on every write of a
 * 'calendar' structured value (apply.ts) and by the editor before it saves.
 */
export function calendarDefError(raw: unknown, fields: Iterable<CalendarField>, tables: Iterable<CalendarTable>): string | null {
  const r = CalendarDef.safeParse(raw);
  if (!r.success) { const i = r.error.issues[0]; return `calendar: ${i.path.join('.')}${i.path.length ? ': ' : ''}${i.message}`; }
  const def = r.data;
  const byId = new Map<string, CalendarField>(); for (const f of fields) byId.set(f.id, f);
  const tableById = new Map<string, CalendarTable>(); for (const t of tables) tableById.set(t.id, t);
  const tName = (id: string) => tableById.get(id)?.name ?? 'that table';

  const fieldOn = (id: string, table: string, what: string, path: string): CalendarField | string => {
    const f = byId.get(id);
    if (!f) return `${path}: the ${what} field no longer exists`;
    if (f.table_id !== table) return `${path}: '${f.name}' is not a field of ${tName(table)}`;
    return f;
  };
  const filtersOn = (filters: readonly { fieldId: string }[], table: string, path: string): string | null => {
    for (const e of filters) { const f = fieldOn(e.fieldId, table, 'filter', path); if (typeof f === 'string') return f; }
    return null;
  };

  if (def.rows) {
    const t = tableById.get(def.rows.tableId);
    if (!t) return 'rows: that table no longer exists';
    if (UTILITY_KINDS.has(t.kind ?? '') || t.utility) return `rows: ${t.name} is a utility table — pick a table of things (Computers, People…)`;
    const e = filtersOn(def.rows.filters, t.id, 'rows'); if (e) return e;
    for (const s of def.rows.sort) { const f = fieldOn(s.fieldId, t.id, 'sort', 'rows'); if (typeof f === 'string') return f; }
  }
  if (def.layout === 'resource' && !def.rows) return 'the resource layout needs a row table';

  const seen = new Set<string>();
  for (const s of def.sources) {
    const t = tableById.get(s.tableId);
    const path = `source ${t?.name ?? s.id}`;
    if (seen.has(s.id)) return `${path}: id '${s.id}' is used twice`;
    seen.add(s.id);
    if (!t) return `source ${s.id}: that table no longer exists`;
    const e = filtersOn(s.filters, t.id, path); if (e) return e;

    const start = fieldOn(s.start, t.id, 'start', path); if (typeof start === 'string') return start;
    if (start.type !== 'date') return `${path}: start '${start.name}' is not a date field`;
    if (s.end) {
      if (s.end === s.start) return `${path}: start and end are the same field — leave end empty for one-day events`;
      const end = fieldOn(s.end, t.id, 'end', path); if (typeof end === 'string') return end;
      if (end.type !== 'date') return `${path}: end '${end.name}' is not a date field`;
    }
    for (const id of s.label) {
      const f = fieldOn(id, t.id, 'label', path); if (typeof f === 'string') return f;
      if (!CHIP_TYPES.has(f.type)) return `${path}: '${f.name}' cannot be printed on a chip`;
    }
    if (new Set(s.label).size !== s.label.length) return `${path}: a label field is listed twice`;
    if (s.tintBy) {
      const f = fieldOn(s.tintBy, t.id, 'tint-by', path); if (typeof f === 'string') return f;
      if (f.type !== 'select') return `${path}: tint by '${f.name}' — only a single select can pick a tint`;
    } else if (s.tintMap && Object.keys(s.tintMap).length) return `${path}: a tint map without a "tint by" field`;

    if (def.rows) {
      if (!s.lane) return `${path}: with rows set, every source needs a lane — the link from ${t.name} to ${tName(def.rows.tableId)}`;
      const f = fieldOn(s.lane, t.id, 'lane', path); if (typeof f === 'string') return f;
      if (f.type !== 'link') return `${path}: the lane '${f.name}' is not a link field`;
      if (f.options?.target_table_id !== def.rows.tableId) return `${path}: the lane '${f.name}' does not link to ${tName(def.rows.tableId)}`;
    } else if (s.lane) return `${path}: a lane without a row table`;
  }
  return null;
}

/**
 * Which link fields of `tableId` can be a source's lane to `rowsTable`, for the
 * editor: direct links, and junction endpoints (marked with the junction's name).
 * Empty = this table cannot go on a calendar that has rows ("Milestones has no
 * link to Computers").
 */
export function laneCandidates(tableId: string, rowsTable: string, fields: Iterable<CalendarField>, tables: Iterable<CalendarTable>):
  Array<{ field: CalendarField; through?: string }> {
  const t = [...tables].find((x) => x.id === tableId);
  const through = t?.kind === 'junction' ? t.name : undefined;
  return [...fields].filter((f) => f.table_id === tableId && f.type === 'link' && f.options?.target_table_id === rowsTable)
    .map((field) => (through ? { field, through } : { field }));
}

/* ── dates: whole UTC days ────────────────────────────────────────────────── */

/** The week starts on MONDAY (owner, Oct 25 2026). The one place that says so. */
export const WEEK_START = 1;   // 0 = Sunday … 6 = Saturday, as Date.getUTCDay

const DAY_MS = 86_400_000;
/** Days since 1970-01-01 for a real 'YYYY-MM-DD'; NaN for anything else. */
export function dayNumber(iso: string): number {
  if (typeof iso !== 'string' || !isoDate.safeParse(iso).success) return NaN;
  const [y, m, d] = iso.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? t / DAY_MS : NaN;
}
export function isoOf(day: number): string { return new Date(day * DAY_MS).toISOString().slice(0, 10); }
export const addDays = (iso: string, n: number): string => isoOf(dayNumber(iso) + n);
/** Inclusive count of days from `a` to `b` (same day = 1). */
export const daysBetween = (a: string, b: string): number => dayNumber(b) - dayNumber(a) + 1;
/** 0 = the first day of the week (Monday) … 6. */
export const weekdayIndex = (iso: string): number => (new Date(dayNumber(iso) * DAY_MS).getUTCDay() - WEEK_START + 7) % 7;
export const isWeekend = (iso: string): boolean => { const d = new Date(dayNumber(iso) * DAY_MS).getUTCDay(); return d === 0 || d === 6; };
export const startOfWeek = (iso: string): string => addDays(iso, -weekdayIndex(iso));

/** The seven days of the week containing `iso`, first day first. */
export function weekDays(iso: string): string[] {
  const s = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

/**
 * The weeks a month view draws for 'YYYY-MM': whole weeks, first day first, from
 * the week holding the 1st to the week holding the last day — 4 to 6 rows. Days
 * outside the month are included (drawn dimmed); `inMonth` tells them apart.
 */
export function monthGrid(ym: string): { weeks: string[][]; inMonth: (iso: string) => boolean } {
  const first = `${ym}-01`;
  if (Number.isNaN(dayNumber(first))) return { weeks: [], inMonth: () => false };
  const [y, m] = ym.split('-').map(Number);
  const last = isoOf(Date.UTC(y, m, 0) / DAY_MS);    // day 0 of next month = last of this
  const weeks: string[][] = [];
  for (let d = startOfWeek(first); dayNumber(d) <= dayNumber(last); d = addDays(d, 7)) weeks.push(weekDays(d));
  return { weeks, inMonth: (iso) => iso.slice(0, 7) === ym };
}

/* ── the result ───────────────────────────────────────────────────────────── */

export interface CalendarEvent {
  /** `${sourceId}:${recordId}` — unique within one run. */
  id: string;
  sourceId: string;
  recordId: string;
  tableId: string;
  start: string;
  /** Inclusive; === start for a one-day event (and for one whose end is before its start, see `warn`). */
  end: string;
  /** Inclusive day count. */
  days: number;
  /** The record has an end date of its own. A move writes the end only when it does — dragging must not invent one. */
  hasEnd: boolean;
  label: string;
  tint: Tint;
  /** Resource only: records of the row table this event links to through its lane. Empty = Unassigned. */
  laneIds: string[];
  /** "ends before it starts" — drawn as one day on `start`, with a warning mark. */
  warn?: string;
}

export interface Lane {
  /** The row record's id; UNASSIGNED for the catch-all. */
  id: string;
  label: string;
}
export const UNASSIGNED = '\u0000unassigned';

export interface CalendarResult {
  /** Every event of every source, sorted by start, then by longer first, then label. */
  events: CalendarEvent[];
  /** Present when the definition has rows: the row records (filtered, sorted), then "Unassigned". */
  lanes?: Lane[];
  legend: Array<{ sourceId: string; tableId: string; tableName: string; tint: Tint }>;
  /** Things that stopped part of it drawing — a field deleted since the definition was saved. */
  problems: string[];
}

export interface CalendarContext {
  fields: CalendarField[];
  tables: CalendarTable[];
  recordsOf: (tableId: string) => ViewRecord[];
  linksFrom: (recordId: string, fieldId: string) => readonly string[];
  labelOf: (recordId: string) => string;
  /** Text for link / lookup / backlink fields, as the grid gets it. */
  links?: LinkLabels;
  /** The ids a link OR backlink holds (the `is` filter). Absent: links only, through `linksFrom`. */
  idsOf?: LinkIds;
  /** The section's scope, applied to every source (and to the rows). Absent: everything. */
  inScope?: (record: ViewRecord) => boolean;
  /** Keep only events overlapping these days (inclusive). Absent: every event. */
  range?: { from: string; to: string };
  /** Sources switched off in this browser (the legend toggle). */
  hidden?: ReadonlySet<string>;
}

/**
 * The calendar. Pure: same inputs, same result. Rules pinned by test/calendar.ts:
 * a record without a valid start date is not an event (it is simply not on the
 * calendar); no end field, or an empty end, is one day; an end before its start is
 * one day on the start, warned; a source naming something deleted is skipped with
 * a problem, never thrown; scope and the source's filters both apply; a
 * resource event's lanes are what its lane link holds, and an event linking to no
 * row record at all is Unassigned. An event linking only to row records the rows'
 * filter hides is drawn on no lane — it belongs to a lane that is not shown, which
 * is different from belonging to none.
 */
export function runCalendar(raw: CalendarDef, ctx: CalendarContext): CalendarResult {
  const parsed = CalendarDef.safeParse(raw);
  if (!parsed.success) return { events: [], legend: [], problems: ['the calendar definition is not readable'] };
  const def = parsed.data;
  const byId = new Map(ctx.fields.map((f) => [f.id, f]));
  const tableById = new Map(ctx.tables.map((t) => [t.id, t]));
  const links: LinkLabels = ctx.links ?? (() => []);
  const ids: LinkIds = ctx.idsOf ?? ctx.linksFrom;
  const inScope = ctx.inScope ?? (() => true);
  const problems: string[] = [];
  const events: CalendarEvent[] = [];
  const legend: CalendarResult['legend'] = [];
  const range = ctx.range && !Number.isNaN(dayNumber(ctx.range.from)) && !Number.isNaN(dayNumber(ctx.range.to))
    ? { from: dayNumber(ctx.range.from), to: dayNumber(ctx.range.to) } : null;

  if (!def.sources.length) problems.push('no sources yet — add one in the calendar\'s settings');

  let lanes: Lane[] | undefined;
  if (def.rows) {
    const t = tableById.get(def.rows.tableId);
    if (!t) problems.push('rows: that table no longer exists');
    else {
      const rowRecs = applyView(ctx.recordsOf(t.id).filter(inScope), ctx.fields,
        { sort: def.rows.sort, filters: def.rows.filters, hidden: [] }, links, ids);
      lanes = [...rowRecs.map((r) => ({ id: r.id, label: ctx.labelOf(r.id) || '(untitled)' })), { id: UNASSIGNED, label: 'Unassigned' }];
    }
  }

  for (const s of def.sources) {
    const t = tableById.get(s.tableId);
    if (!t) { problems.push(`source ${s.id}: its table no longer exists`); continue; }
    legend.push({ sourceId: s.id, tableId: t.id, tableName: t.name, tint: s.tint });
    if (ctx.hidden?.has(s.id)) continue;
    const startF = byId.get(s.start);
    if (!startF || startF.table_id !== t.id) { problems.push(`${t.name}: its start field no longer exists`); continue; }
    const endF = s.end ? byId.get(s.end) : undefined;
    if (s.end && (!endF || endF.table_id !== t.id)) problems.push(`${t.name}: its end field no longer exists — drawn as one-day events`);
    const labelFs = s.label.map((id) => byId.get(id)).filter((f): f is CalendarField => !!f && f.table_id === t.id);
    const tintF = s.tintBy ? byId.get(s.tintBy) : undefined;
    const laneF = def.rows && s.lane ? byId.get(s.lane) : undefined;
    if (def.rows && s.lane && !laneF) problems.push(`${t.name}: its lane field no longer exists — every event is Unassigned`);

    const recs = applyView(ctx.recordsOf(t.id).filter(inScope), ctx.fields, { sort: [], filters: s.filters, hidden: [] }, links, ids);
    for (const r of recs) {
      const start = r.data[startF.key];
      const s0 = typeof start === 'string' ? dayNumber(start) : NaN;
      if (Number.isNaN(s0)) continue;
      const endRaw = endF ? r.data[endF.key] : undefined;
      let e0 = typeof endRaw === 'string' ? dayNumber(endRaw) : NaN;
      const hasEnd = !Number.isNaN(e0);
      let warn: string | undefined;
      if (!hasEnd) e0 = s0;
      else if (e0 < s0) { warn = 'ends before it starts'; e0 = s0; }
      if (range && (e0 < range.from || s0 > range.to)) continue;

      const label = labelFs.map((f) => cellText(f, r, links)).filter((x) => x !== '').join(' · ') || ctx.labelOf(r.id) || '(untitled)';
      const choice = tintF ? r.data[tintF.key] : undefined;
      const tint = (typeof choice === 'string' && s.tintMap?.[choice]) || s.tint;
      let laneIds: string[] = [];
      if (laneF) laneIds = [...ctx.linksFrom(r.id, laneF.id)];
      const ev: CalendarEvent = {
        id: `${s.id}:${r.id}`, sourceId: s.id, recordId: r.id, tableId: t.id,
        start: isoOf(s0), end: isoOf(e0), days: e0 - s0 + 1, hasEnd, label, tint, laneIds,
      };
      if (warn) ev.warn = warn;
      events.push(ev);
    }
  }
  events.sort((a, b) => a.start.localeCompare(b.start) || b.days - a.days || a.label.localeCompare(b.label, undefined, { numeric: true }) || a.id.localeCompare(b.id));
  return lanes ? { events, lanes, legend, problems } : { events, legend, problems };
}

/** The events a lane draws: those linking to that row record; for UNASSIGNED, those linking to none. */
export function laneEvents(events: CalendarEvent[], laneId: string): CalendarEvent[] {
  return laneId === UNASSIGNED ? events.filter((e) => e.laneIds.length === 0) : events.filter((e) => e.laneIds.includes(laneId));
}

/* ── layout helpers ───────────────────────────────────────────────────────── */

export interface Placed {
  event: CalendarEvent;
  /** Column of the first and last day drawn, within `days` (0-based, inclusive). */
  fromCol: number;
  toCol: number;
  /** The row within the strip, 0 = top. Overlapping events never share a track. */
  track: number;
  /** The event runs on before / after the strip — the chip draws an open end. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/**
 * Pack events into TRACKS over a strip of consecutive `days` (a month row, a week,
 * a resource lane): each event gets the lowest track free over its whole span, so
 * overlapping spans stack and never collide. Events outside the strip are dropped.
 * Order (and so who gets the top track): earlier start, then longer, then label —
 * the order `runCalendar` already sorts in. `tracks` is how many rows were needed.
 */
export function placeEvents(events: CalendarEvent[], days: string[]): { placed: Placed[]; tracks: number } {
  if (!days.length) return { placed: [], tracks: 0 };
  const d0 = dayNumber(days[0]), d1 = dayNumber(days[days.length - 1]);
  const ordered = [...events].sort((a, b) => a.start.localeCompare(b.start) || b.days - a.days || a.label.localeCompare(b.label, undefined, { numeric: true }) || a.id.localeCompare(b.id));
  const busyUntil: number[] = [];   // per track: the last column taken
  const placed: Placed[] = [];
  for (const ev of ordered) {
    const s = dayNumber(ev.start), e = dayNumber(ev.end);
    if (e < d0 || s > d1) continue;
    const fromCol = Math.max(s, d0) - d0, toCol = Math.min(e, d1) - d0;
    let track = busyUntil.findIndex((last) => last < fromCol);
    if (track === -1) { track = busyUntil.length; busyUntil.push(toCol); } else busyUntil[track] = toCol;
    placed.push({ event: ev, fromCol, toCol, track, continuesBefore: s < d0, continuesAfter: e > d1 });
  }
  return { placed, tracks: busyUntil.length };
}

export interface AgendaItem {
  event: CalendarEvent;
  /** Started before the agenda's first day: listed under that day, "continued". */
  continued: boolean;
}
export interface AgendaDay { day: string; items: AgendaItem[] }

/**
 * The agenda: days from `from` to `to` that have something, each with its events.
 * A multi-day event is listed ONCE, under its first day ("→ until …" is the
 * renderer's) — or under `from` if it began earlier, marked continued.
 */
export function agendaGroups(events: CalendarEvent[], from: string, to: string): AgendaDay[] {
  const f = dayNumber(from), t = dayNumber(to);
  const byDay = new Map<number, AgendaItem[]>();
  for (const ev of events) {
    const s = dayNumber(ev.start), e = dayNumber(ev.end);
    if (e < f || s > t) continue;
    const day = Math.max(s, f);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push({ event: ev, continued: s < f });
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0])
    .map(([day, items]) => ({ day: isoOf(day), items: items.sort((a, b) => Number(b.continued) - Number(a.continued) || b.event.days - a.event.days || a.event.label.localeCompare(b.event.label, undefined, { numeric: true })) }));
}

/**
 * The record update that MOVES an event by `delta` days (both ends, duration
 * kept) or sets one edge, as `set` for a `record.update`. Null when nothing would
 * change or the result would be invalid (an edge dragged past the other is
 * clamped by the caller before asking). One-day sources have no end to write.
 */
export function moveEvent(ev: CalendarEvent, src: CalendarSource, fields: ReadonlyMap<string, CalendarField>,
  how: { kind: 'move'; delta: number } | { kind: 'start'; to: string } | { kind: 'end'; to: string }): Record<string, string> | null {
  const startF = fields.get(src.start), endF = src.end ? fields.get(src.end) : undefined;
  if (!startF) return null;
  let s = ev.start, e = ev.end;
  if (how.kind === 'move') { if (!how.delta) return null; s = addDays(s, how.delta); e = addDays(e, how.delta); }
  else if (how.kind === 'start') { if (dayNumber(how.to) > dayNumber(e) || how.to === s) return null; s = how.to; }
  else { if (!endF || dayNumber(how.to) < dayNumber(s) || how.to === e) return null; e = how.to; }
  const set: Record<string, string> = { [startF.key]: s };
  if (endF && (ev.hasEnd || how.kind === 'end')) set[endF.key] = e;
  return set;
}
