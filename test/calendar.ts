/**
 * The calendar contract (VIEWS-BRIEF.md Part B), pure — no server, no database.
 * The fixture is the brief's worked example (B10): Computers, Projects, Bookings —
 * a JUNCTION, a → Computers, b → Projects, with its own status, start and end —
 * and Milestones (one-day, linked to a project). Two calendars over it: "Machine
 * room" (rows = Computers, resource) and "Deadlines" (Milestones + Bookings, no rows).
 */
import { randomUUID } from 'node:crypto';
import {
  calendarDefError, runCalendar, laneCandidates, laneEvents, placeEvents, agendaGroups, moveEvent, monthGrid, weekDays,
  dayNumber, daysBetween, weekdayIndex, isWeekend, addDays, EMPTY_CALENDAR, UNASSIGNED,
  type CalendarDef, type CalendarField, type CalendarTable, type CalendarContext, type CalendarEvent,
} from '../src/contract/calendar.js';
import type { ViewRecord } from '../src/contract/views.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/* ── fixture ──────────────────────────────────────────────────────────────── */

const T = { computers: randomUUID(), projects: randomUUID(), bookings: randomUUID(), milestones: randomUUID(), boards: randomUUID(), rooms: randomUUID() };
const fields: CalendarField[] = [];
const F: Record<string, string> = {};
const tableName: Record<string, string> = { [T.computers]: 'Computers', [T.projects]: 'Projects', [T.bookings]: 'Bookings', [T.milestones]: 'Milestones', [T.boards]: 'Boards', [T.rooms]: 'Rooms' };
function field(name: string, table: string, type: string, options: Record<string, unknown> = {}) {
  const id = randomUUID(); const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  fields.push({ id, key, name, type, table_id: table, options });
  F[`${tableName[table]}.${name}`] = id;
  return id;
}
field('Name', T.computers, 'text'); field('Kind', T.computers, 'select', { choices: ['workstation', 'laptop'] });
field('Name', T.projects, 'text');
const fA = field('Computer', T.bookings, 'link', { target_table_id: T.computers, single: true });
const fB = field('Project', T.bookings, 'link', { target_table_id: T.projects, single: true });
field('Status', T.bookings, 'select', { choices: ['Planned', 'Confirmed', 'Done'] });
field('Start', T.bookings, 'date'); field('End', T.bookings, 'date'); field('Note', T.bookings, 'long_text'); field('Spec', T.bookings, 'structured', { shape: 'json' });
field('Name', T.milestones, 'text'); field('Date', T.milestones, 'date');
field('Project', T.milestones, 'link', { target_table_id: T.projects });
field('Name', T.rooms, 'text');

const tables: CalendarTable[] = [
  { id: T.computers, name: 'Computers' }, { id: T.projects, name: 'Projects' },
  { id: T.bookings, name: 'Bookings', kind: 'junction', junction: { a: fA, b: fB, status: F['Bookings.Status'] } },
  { id: T.milestones, name: 'Milestones' }, { id: T.boards, name: 'Boards', kind: 'canvas' }, { id: T.rooms, name: 'Rooms', utility: true },
];

const recs = new Map<string, ViewRecord[]>();
const label = new Map<string, string>();
const linkMap = new Map<string, string[]>();   // `${recordId}|${fieldId}` → ids
function rec(table: string, data: Record<string, unknown>, name?: string): string {
  const id = randomUUID();
  if (!recs.has(table)) recs.set(table, []);
  recs.get(table)!.push({ id, data });
  label.set(id, name ?? String(data.name ?? ''));
  return id;
}
function link(from: string, fieldId: string, to: string) { const k = `${from}|${fieldId}`; linkMap.set(k, [...(linkMap.get(k) ?? []), to]); }

const c1 = rec(T.computers, { name: 'Color 01', kind: 'workstation' });
const c2 = rec(T.computers, { name: 'Color 02', kind: 'workstation' });
const lap = rec(T.computers, { name: 'Laptop', kind: 'laptop' });
const duke = rec(T.projects, { name: 'Duke' });
const novak = rec(T.projects, { name: 'Novak' });
function booking(computer: string | null, project: string, status: string, start: string, end?: string, note = '') {
  const data: Record<string, unknown> = { status, start, ...(end ? { end } : {}), ...(note ? { note } : {}) };
  const id = rec(T.bookings, data, `${status}`);
  if (computer) link(id, fA, computer);
  link(id, fB, project);
  return id;
}
const bDuke1 = booking(c1, duke, 'Confirmed', '2026-10-05', '2026-10-09');       // Color 01 on Duke, bout 1
const bDuke2 = booking(c1, duke, 'Planned', '2026-10-19', '2026-10-23');         // …bout 2
const bDuke3 = booking(c2, duke, 'Done', '2026-10-12', '2026-10-21');            // Color 02 on Duke…
const bNovak = booking(c2, novak, 'Confirmed', '2026-10-14', '2026-10-16');      // …and Novak, overlapping
const bOrphan = booking(null, novak, 'Planned', '2026-10-27', '2026-10-28');     // no computer: Unassigned
const bBackwards = booking(lap, novak, 'Planned', '2026-10-30', '2026-10-28');   // ends before it starts
const bOneDay = booking(lap, duke, 'Planned', '2026-10-22');                      // no end: one day
const bNoStart = booking(lap, duke, 'Planned', 'not a date');                     // not on the calendar
const mDuke = rec(T.milestones, { name: 'Duke picture lock', date: '2026-10-16' });
const mNovak = rec(T.milestones, { name: 'Novak delivery', date: '2026-11-03' });
link(mDuke, F['Milestones.Project'], duke); link(mNovak, F['Milestones.Project'], novak);
void bNoStart;

const linksFrom = (r: string, f: string) => linkMap.get(`${r}|${f}`) ?? [];
const ctx = (over: Partial<CalendarContext> = {}): CalendarContext => ({
  fields, tables,
  recordsOf: (t) => recs.get(t) ?? [],
  linksFrom,
  labelOf: (id) => label.get(id) ?? '',
  links: (r, f) => linksFrom(r, f).map((id) => label.get(id) ?? ''),
  ...over,
});

const machineRoom: CalendarDef = {
  v: 1, layout: 'resource', zoom: 'week',
  rows: { tableId: T.computers, filters: [], sort: [{ fieldId: F['Computers.Name'], dir: 'asc' }] },
  sources: [{
    id: 'bookings', tableId: T.bookings, filters: [], start: F['Bookings.Start'], end: F['Bookings.End'],
    label: [fB, F['Bookings.Status']], tint: 'blue', tintBy: F['Bookings.Status'], tintMap: { Confirmed: 'green', Done: 'grey' }, lane: fA,
  }],
};
const deadlines: CalendarDef = {
  v: 1, layout: 'month', zoom: 'week',
  sources: [
    { id: 'ms', tableId: T.milestones, filters: [], start: F['Milestones.Date'], label: [F['Milestones.Name']], tint: 'amber' },
    { id: 'bk', tableId: T.bookings, filters: [], start: F['Bookings.Start'], end: F['Bookings.End'], label: [fB], tint: 'blue' },
  ],
};
const err = (d: unknown) => calendarDefError(d, fields, tables);
const clone = <X>(x: X): X => JSON.parse(JSON.stringify(x));
const src0 = (d: CalendarDef) => d.sources[0];

/* ── C1. the definition ───────────────────────────────────────────────────── */

console.log('\nC1. Validation');
check('a new, empty calendar is valid (it is saved the moment the record is made)', err(EMPTY_CALENDAR()) === null, String(err(EMPTY_CALENDAR())));
check('the worked example — Machine room — is valid', err(machineRoom) === null, String(err(machineRoom)));
check('…and Deadlines', err(deadlines) === null, String(err(deadlines)));
check('defaults fill in: layout month, zoom week, no filters', err({ v: 1, sources: [{ id: 's', tableId: T.milestones, start: F['Milestones.Date'], label: [F['Milestones.Name']], tint: 'amber' }] }) === null);
check('a stray key is refused', !!err({ ...EMPTY_CALENDAR(), colour: 'red' }));
{ const d = clone(machineRoom); delete d.rows; check('the resource layout needs rows', /needs a row table/.test(String(err(d))), String(err(d))); }
{ const d = clone(deadlines); d.sources[1].id = 'ms'; check('source ids must be unique', /used twice/.test(String(err(d))), String(err(d))); }
{ const d = clone(deadlines); d.sources[0].tableId = randomUUID(); check('a source on a deleted table', /no longer exists/.test(String(err(d))), String(err(d))); }
{ const d = clone(deadlines); d.sources[0].start = F['Milestones.Name']; check('start must be a date field', /not a date field/.test(String(err(d))), String(err(d))); }
{ const d = clone(deadlines); d.sources[0].start = F['Bookings.Start']; check('start must be on the source\'s table', /is not a field of Milestones/.test(String(err(d))), String(err(d))); }
{ const d = clone(deadlines); d.sources[1].end = d.sources[1].start; check('end = start is refused, with the way out', /leave end empty/.test(String(err(d))), String(err(d))); }
{ const d = clone(deadlines); d.sources[1].end = F['Bookings.Note']; check('end must be a date field', /end 'Note' is not a date field/.test(String(err(d))), String(err(d))); }
{ const d = clone(deadlines); d.sources[0].label = []; check('at least one label field', !!err(d)); }
{ const d = clone(deadlines); d.sources[1].label = [fA, fB, F['Bookings.Status'], F['Bookings.Start']]; check('at most three label fields', !!err(d)); }
{ const d = clone(deadlines); d.sources[1].label = [F['Bookings.Spec']]; check('a structured field cannot be printed on a chip', /cannot be printed/.test(String(err(d))), String(err(d))); }
{ const d = clone(deadlines); d.sources[1].label = [fB, fB]; check('a label field listed twice', /listed twice/.test(String(err(d))), String(err(d))); }
{ const d = clone(machineRoom); src0(d).tintBy = F['Bookings.Note']; check('tint by must be a single select', /only a single select/.test(String(err(d))), String(err(d))); }
{ const d = clone(machineRoom); delete src0(d).tintBy; check('a tint map without "tint by"', /without a "tint by"/.test(String(err(d))), String(err(d))); }
{ const d = clone(machineRoom); src0(d).tintMap = { Confirmed: 'green', 'Gone choice': 'red' }; check('a STALE tint-map key (choice renamed since) is tolerated, not refused', err(d) === null, String(err(d))); }
{ const d = clone(machineRoom); src0(d).tint = 'pink' as never; check('tints are the six named ones', !!err(d)); }
{ const d = clone(machineRoom); d.rows!.tableId = T.bookings; check('a junction cannot be the row table', /utility table/.test(String(err(d))), String(err(d))); }
{ const d = clone(machineRoom); d.rows!.tableId = T.boards; check('nor a table of boards', /utility table/.test(String(err(d))), String(err(d))); }
{ const d = clone(machineRoom); d.rows!.tableId = T.rooms; check('nor a table ticked utility', /utility table/.test(String(err(d))), String(err(d))); }
{ const d = clone(machineRoom); d.rows!.sort = [{ fieldId: F['Projects.Name'], dir: 'asc' }]; check('rows sort on the rows\' own fields', /not a field of Computers/.test(String(err(d))), String(err(d))); }
{ const d = clone(machineRoom); delete src0(d).lane; check('with rows set, every source needs a lane', /needs a lane/.test(String(err(d))), String(err(d))); }
{ const d = clone(machineRoom); src0(d).lane = F['Bookings.Status']; check('a lane must be a link', /not a link field/.test(String(err(d))), String(err(d))); }
{ const d = clone(machineRoom); src0(d).lane = fB; check('…to the row table', /does not link to Computers/.test(String(err(d))), String(err(d))); }
{ const d = clone(deadlines); d.sources[1].lane = fA; check('a lane without a row table', /lane without a row table/.test(String(err(d))), String(err(d))); }
{
  const d = clone(machineRoom);
  d.sources.push({ id: 'ms', tableId: T.milestones, filters: [], start: F['Milestones.Date'], label: [F['Milestones.Name']], tint: 'amber' });
  check('the brief\'s deliberate edge: Milestones cannot join Machine room — and the message says why', /Milestones.*needs a lane.*Milestones to Computers/.test(String(err(d))), String(err(d)));
}
{
  const bk = laneCandidates(T.bookings, T.computers, fields, tables), ms = laneCandidates(T.milestones, T.computers, fields, tables);
  check('lane candidates: Bookings offers its Computer endpoint, marked "through Bookings"; Milestones offers nothing',
    bk.length === 1 && bk[0].field.id === fA && bk[0].through === 'Bookings' && ms.length === 0, JSON.stringify(bk.map((c) => [c.field.name, c.through])));
}

/* ── C2. dates ────────────────────────────────────────────────────────────── */

console.log('\nC2. Dates — whole days, the week starts on Monday');
check('a real date is a day number; a fake one is NaN', !Number.isNaN(dayNumber('2026-10-25')) && Number.isNaN(dayNumber('2026-02-30')) && Number.isNaN(dayNumber('25/10/2026')));
check('inclusive day counts: same day = 1, Oct 5–9 = 5', daysBetween('2026-10-05', '2026-10-05') === 1 && daysBetween('2026-10-05', '2026-10-09') === 5);
check('across a DST change and a month end, a day is a day', addDays('2026-11-01', 1) === '2026-11-02' && addDays('2026-03-31', 1) === '2026-04-01' && daysBetween('2026-03-07', '2026-03-09') === 3);
check('Monday is the first day of the week; Sunday the last', weekdayIndex('2026-10-26') === 0 && weekdayIndex('2026-10-25') === 6);
check('weekDays: the week containing a Sunday starts the Monday before', weekDays('2026-10-25').join() === ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'].join());
check('weekends', isWeekend('2026-10-24') && isWeekend('2026-10-25') && !isWeekend('2026-10-26'));
{
  const oct = monthGrid('2026-10');
  check('October 2026: five Monday-first weeks, Sep 28 → Nov 1', oct.weeks.length === 5 && oct.weeks[0][0] === '2026-09-28' && oct.weeks[4][6] === '2026-11-01', `${oct.weeks.length} ${oct.weeks[0]?.[0]} ${oct.weeks.at(-1)?.[6]}`);
  check('…and knows which days are in the month', oct.inMonth('2026-10-01') && !oct.inMonth('2026-09-30'));
  const feb = monthGrid('2027-02');
  check('February 2027 starts on a Monday and ends on a Sunday: exactly four rows', feb.weeks.length === 4 && feb.weeks[0][0] === '2027-02-01' && feb.weeks[3][6] === '2027-02-28');
  check('a nonsense month gives nothing', monthGrid('2026-13').weeks.length === 0);
}

/* ── C3. the result ───────────────────────────────────────────────────────── */

console.log('\nC3. runCalendar — Deadlines (no rows)');
const dl = runCalendar(deadlines, ctx());
const ev = (res: { events: CalendarEvent[] }, recordId: string, sourceId?: string) => res.events.find((e) => e.recordId === recordId && (!sourceId || e.sourceId === sourceId));
check('every Booking with a real start, and both Milestones, are events; one without a start is not', dl.events.length === 7 + 2, String(dl.events.length));
check('no lanes without rows', dl.lanes === undefined);
check('a span is inclusive: Oct 5–9 is 5 days, and remembers it has an end', ev(dl, bDuke1)?.days === 5 && ev(dl, bDuke1)?.hasEnd === true);
check('no end field (Milestones): one day on the start', ev(dl, mDuke)?.start === '2026-10-16' && ev(dl, mDuke)?.end === '2026-10-16' && ev(dl, mDuke)?.days === 1 && ev(dl, mDuke)?.hasEnd === false);
check('an EMPTY end on a source that has one: one day, no end of its own', ev(dl, bOneDay)?.days === 1 && ev(dl, bOneDay)?.hasEnd === false);
check('ends before it starts: drawn as one day on the start, with a warning', ev(dl, bBackwards)?.start === '2026-10-30' && ev(dl, bBackwards)?.days === 1 && ev(dl, bBackwards)?.warn === 'ends before it starts');
check('the chip label reads link fields as their pill text', ev(dl, bNovak)?.label === 'Novak', ev(dl, bNovak)?.label);
check('the legend: one chip per source, in order, with its table and tint', dl.legend.map((l) => `${l.tableName}:${l.tint}`).join() === 'Milestones:amber,Bookings:blue');
check('events sorted by start, longer first on the same day', dl.events.map((e) => e.start).join() === [...dl.events.map((e) => e.start)].sort().join());
check('event ids are source:record, so one record on two sources is two events', ev(dl, bDuke1)?.id === `bk:${bDuke1}`);
check('no problems', dl.problems.length === 0, dl.problems.join('; '));

console.log('\nC3b. Filters, tint, scope, range, hidden');
const mr = runCalendar(machineRoom, ctx());
check('tint by status: Confirmed → green, Done → grey, Planned (not mapped) → the source tint', ev(mr, bDuke1)?.tint === 'green' && ev(mr, bDuke3)?.tint === 'grey' && ev(mr, bDuke2)?.tint === 'blue');
check('several label fields join with " · "', ev(mr, bDuke1)?.label === 'Duke · Confirmed', ev(mr, bDuke1)?.label);
{
  const d = clone(machineRoom); src0(d).filters = [{ fieldId: F['Bookings.Status'], op: 'neq', value: 'Done' }];
  check('a source\'s filters are the grid\'s: "status is not Done" drops the Done booking', !ev(runCalendar(d, ctx()), bDuke3) && !!ev(runCalendar(d, ctx()), bDuke1));
}
{
  const inScope = (r: ViewRecord) => r.id !== bNovak && r.id !== mNovak;
  const sc = runCalendar(deadlines, ctx({ inScope }));
  check('scope applies to EVERY source', !ev(sc, bNovak) && !ev(sc, mNovak) && !!ev(sc, mDuke) && !!ev(sc, bDuke1));
}
{
  const r = runCalendar(deadlines, ctx({ range: { from: '2026-10-10', to: '2026-10-15' } }));
  check('a range keeps events OVERLAPPING it — one that started before and runs into it too', !!ev(r, bDuke3) && !!ev(r, bNovak) && !ev(r, bDuke1) && !ev(r, mDuke) && !ev(r, bDuke2),
    r.events.map((e) => label.get(e.recordId)).join());
}
{
  const r = runCalendar(deadlines, ctx({ hidden: new Set(['ms']) }));
  check('a source switched off in this browser draws nothing but keeps its legend chip', !r.events.some((e) => e.sourceId === 'ms') && r.legend.length === 2);
}

console.log('\nC3c. Problems are reported, never thrown');
check('no sources: says so', runCalendar(EMPTY_CALENDAR(), ctx()).problems.some((p) => /no sources/.test(p)));
check('an unreadable definition: says so', runCalendar({ v: 2 } as never, ctx()).problems.length === 1);
{
  const gone = fields.filter((f) => f.id !== F['Milestones.Date']);
  const r = runCalendar(deadlines, ctx({ fields: gone }));
  check('a deleted start field: that source is skipped with a problem; the others still draw', r.problems.some((p) => /Milestones: its start field/.test(p)) && !r.events.some((e) => e.sourceId === 'ms') && r.events.some((e) => e.sourceId === 'bk'), r.problems.join('; '));
}
{
  const gone = fields.filter((f) => f.id !== F['Bookings.End']);
  const r = runCalendar(deadlines, ctx({ fields: gone }));
  check('a deleted end field: one-day events, with a problem', r.problems.some((p) => /end field no longer exists/.test(p)) && ev(r, bDuke1, 'bk')?.days === 1);
}

/* ── C4. resource ─────────────────────────────────────────────────────────── */

console.log('\nC4. Resource — Machine room');
check('lanes: the row records, filtered and sorted, then Unassigned', mr.lanes?.map((l) => l.label).join() === 'Color 01,Color 02,Laptop,Unassigned', mr.lanes?.map((l) => l.label).join());
const onLane = (laneId: string) => laneEvents(mr.events, laneId).map((e) => e.recordId);
check('Color 01: Duke twice — two bouts, one lane', onLane(c1).length === 2 && onLane(c1).includes(bDuke1) && onLane(c1).includes(bDuke2));
check('Color 02: Duke and Novak at once', onLane(c2).length === 2 && onLane(c2).includes(bDuke3) && onLane(c2).includes(bNovak));
check('…which pack into two tracks over the week they overlap', placeEvents(laneEvents(mr.events, c2), weekDays('2026-10-14')).tracks === 2);
check('…while Color 01\'s two bouts never overlap: one track over the month', placeEvents(laneEvents(mr.events, c1), monthGrid('2026-10').weeks.flat()).tracks === 1);
check('a booking with no computer is Unassigned', onLane(UNASSIGNED).length === 1 && onLane(UNASSIGNED)[0] === bOrphan);
{
  const d = clone(machineRoom); d.rows!.filters = [{ fieldId: F['Computers.Kind'], op: 'eq', value: 'workstation' }];
  const r = runCalendar(d, ctx());
  check('rows filtered to workstations: the Laptop lane is gone — and its bookings are NOT Unassigned (they have a lane, it is just not shown)',
    r.lanes?.map((l) => l.label).join() === 'Color 01,Color 02,Unassigned' && laneEvents(r.events, UNASSIGNED).map((e) => e.recordId).join() === bOrphan, r.lanes?.map((l) => l.label).join());
}
{
  const r = runCalendar(machineRoom, ctx({ fields: fields.filter((f) => f.id !== fA) }));
  check('a deleted lane field: every event Unassigned, with a problem', r.problems.some((p) => /lane field no longer exists/.test(p)) && laneEvents(r.events, UNASSIGNED).length === r.events.length);
}
{
  const r = runCalendar(machineRoom, ctx({ inScope: (rec) => rec.id !== c2 }));
  check('scope applies to the rows too', !r.lanes?.some((l) => l.id === c2));
}

/* ── C5. packing ──────────────────────────────────────────────────────────── */

console.log('\nC5. placeEvents');
const mk = (id: string, start: string, end: string): CalendarEvent => ({ id, sourceId: 's', recordId: id, tableId: 't', start, end, days: daysBetween(start, end), hasEnd: true, label: id, tint: 'blue', laneIds: [] });
const week = weekDays('2026-10-19');   // Mon 19 … Sun 25
{
  const p = placeEvents([mk('a', '2026-10-19', '2026-10-22'), mk('b', '2026-10-20', '2026-10-21'), mk('c', '2026-10-21', '2026-10-25')], week);
  check('three overlapping spans → three tracks', p.tracks === 3 && new Set(p.placed.map((x) => x.track)).size === 3);
}
{
  const p = placeEvents([mk('a', '2026-10-19', '2026-10-20'), mk('b', '2026-10-21', '2026-10-22'), mk('c', '2026-10-23', '2026-10-25')], week);
  check('disjoint spans share one track', p.tracks === 1);
}
{
  const p = placeEvents([mk('a', '2026-10-19', '2026-10-20'), mk('b', '2026-10-20', '2026-10-22'), mk('c', '2026-10-21', '2026-10-23')], week);
  check('a track is reused once its event has ended: a and c share, b sits between', p.tracks === 2 && p.placed.find((x) => x.event.id === 'a')!.track === p.placed.find((x) => x.event.id === 'c')!.track);
}
{
  const p = placeEvents([mk('long', '2026-10-12', '2026-11-02'), mk('out', '2026-11-05', '2026-11-06')], week);
  const l = p.placed[0];
  check('a span longer than the strip is clipped to it and open at both ends; one outside is dropped',
    p.placed.length === 1 && l.fromCol === 0 && l.toCol === 6 && l.continuesBefore && l.continuesAfter);
}
check('an empty strip places nothing', placeEvents([mk('a', '2026-10-19', '2026-10-20')], []).placed.length === 0);

/* ── C6. agenda ───────────────────────────────────────────────────────────── */

console.log('\nC6. agendaGroups');
{
  const g = agendaGroups(dl.events, '2026-10-13', '2026-10-19');
  const days = g.map((d) => d.day);
  check('only days with something on them, in order', days.join() === '2026-10-13,2026-10-14,2026-10-16,2026-10-19', days.join());
  check('an event that began before the window is listed once, under its first day, marked continued', g[0].items.length === 1 && g[0].items[0].event.recordId === bDuke3 && g[0].items[0].continued);
  check('a multi-day event is listed ONCE — under the day it starts', g.flatMap((d) => d.items).filter((i) => i.event.recordId === bNovak).length === 1 && g[1].items[0].event.recordId === bNovak);
  check('…not again on the days it runs through', !g[2].items.some((i) => i.event.recordId === bNovak));
}

/* ── C7. moving ───────────────────────────────────────────────────────────── */

console.log('\nC7. moveEvent');
const fmap = new Map(fields.map((f) => [f.id, f]));
const mrSrc = src0(machineRoom);
check('a move shifts both ends, keeping the duration', JSON.stringify(moveEvent(ev(mr, bDuke1)!, mrSrc, fmap, { kind: 'move', delta: 7 })) === JSON.stringify({ start: '2026-10-12', end: '2026-10-16' }));
check('a move of 0 days is nothing', moveEvent(ev(mr, bDuke1)!, mrSrc, fmap, { kind: 'move', delta: 0 }) === null);
check('moving an event with an EMPTY end writes only the start — dragging does not invent an end', JSON.stringify(moveEvent(ev(mr, bOneDay)!, mrSrc, fmap, { kind: 'move', delta: 1 })) === JSON.stringify({ start: '2026-10-23' }));
check('…but dragging its end edge does give it one', JSON.stringify(moveEvent(ev(mr, bOneDay)!, mrSrc, fmap, { kind: 'end', to: '2026-10-24' })) === JSON.stringify({ start: '2026-10-22', end: '2026-10-24' }));
check('a one-day source (no end field) moves its single date', JSON.stringify(moveEvent(ev(dl, mDuke)!, deadlines.sources[0], fmap, { kind: 'move', delta: -1 })) === JSON.stringify({ date: '2026-10-15' }));
check('…and has no end edge to drag', moveEvent(ev(dl, mDuke)!, deadlines.sources[0], fmap, { kind: 'end', to: '2026-10-20' }) === null);
check('the start edge cannot pass the end', moveEvent(ev(mr, bDuke1)!, mrSrc, fmap, { kind: 'start', to: '2026-10-10' }) === null);
check('the end edge cannot pass the start', moveEvent(ev(mr, bDuke1)!, mrSrc, fmap, { kind: 'end', to: '2026-10-04' }) === null);
check('dragging the start edge in', JSON.stringify(moveEvent(ev(mr, bDuke1)!, mrSrc, fmap, { kind: 'start', to: '2026-10-07' })) === JSON.stringify({ start: '2026-10-07', end: '2026-10-09' }));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
