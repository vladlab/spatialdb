# Brief: stacks, calendars and resource boards

A design agreed with the owner on Oct 25 2026, for the session that builds it.
Nothing here is built. Read `API.md`, `PLAN.md` and `REPORTS-BRIEF.md` first: the
idioms this leans on (a canvas/report IS a record; filters and sort are the grid's,
verbatim; derived values are computed, not stored; one patch per round, built on
what the owner last confirmed applied) are established there.

**Source of truth:** <https://github.com/vladlab/spatialdb>, `main` (at writing:
`e29e267`, "desktop: declare hash_cancel and allow_paths in build.rs").

Standing rules that apply throughout (UI-NOTES.md has the long form):

- Ask the owner any question that comes from reading the code before building;
  stop for his review after the contract step of each part.
- Nothing jumps or shifts; more UI beats getting lost. Pills for links. Double-click
  opens a record; no ⤢ icons on new work. A setting that affects the whole view
  lives on the view's top bar, not inside a card's local menu.
- All dates are the existing `date` type: `YYYY-MM-DD`, no time, no timezone
  (`contract/values.ts`). Spans are two date fields, end **inclusive**. Nothing in
  this brief needs a new field type; do not add one.
- Deliver as `git format-patch` mailbox output against the main the owner confirms,
  one patch per round, new files included.

Two parts. They are independent; Part A is small and goes first.

---

## Part A — the kanban becomes "stack by any field"

**Status (Oct 25 2026): built** — `kanban-stacks.patch`, one commit on `3b80e34`.
`test/grid.ts` G1m2 (pure) and `test/kanban.ts` K4 (UI). Decided with the owner while
building: the week starts on Monday (Part B); the ⤢ button stays on board cards (a
later "double-click edits a field, ⤢ expands" split); the hide-empty toggle is offered
for every field type, with a tooltip. Built as the canvas's toggle is drawn ("empty
stacks: hidden / shown"), not a checkbox. A new board stacks by a select first, then a
single link, then anything else — never the primary text field by default. Text
stacks sort locale-aware with numeric collation ("duke" before "Duke", "ep2" before
"ep10").

### A1. What changes

Today (`contract/views.ts` → `canMakeColumns`, `kanbanColumns`; `KanbanView.vue`;
`GridView.vue` toolbar "columns ·") a board stacks by a **select** or a **single
link**, in a fixed column order that comes from the choices / target records, with
empty columns kept as drop targets.

The board keeps that for selects and links, and additionally stacks by:

| field type | stacks are… | order |
|---|---|---|
| `text`, `file_path`, `dimensions` | one per distinct value, exact string match (trim whitespace only; case-sensitive) | alphabetical, locale-aware |
| `number` | one per distinct value | numeric |
| `select` | one per choice (as now) | choice order |
| `link` (single) | one per target record (as now) | target labels |

Plus "(none)" last, as now. For text/number the stack list is **derived from the
records** (there is no choice list), so a stack exists iff a card is in it — except
"(none)", which always exists.

The owner's words for what this becomes: *"a simple horizontal canvas for searching
and seeing multiple cards with data at once vs a table."* It is still the kanban
view; it is not a new view kind. Rename nothing in the UI except the toolbar menu
label: "columns · *field*" → **"stack by · *field*"**.

### A2. Drag writes the value

Dropping a card on a text/number stack writes that stack's value into the field —
same mutation path as a select move (one batch, one Ctrl+Z). Dropping on "(none)"
clears it. `isSingleValued` is true for all of these types, so a drag is always a
MOVE. Nothing special for numbers: the stack's value is the exact number.

### A3. Hide empty stacks

A toolbar toggle, **"hide empty stacks"**, saved in the view config:

```
kanban: { fieldId, hideEmpty?: boolean }
```

Absent means the default for the field type: **on** for text / number / link,
**off** for select (a select's empty columns are the point of a kanban). The toggle
is a plain switch next to "stack by ·" on the board's bar. When on, the "(none)"
stack also hides when empty.

### A4. Search hides stacks with no matches

The grid's quick-search box (`GridView.vue` `search`, `quickSearch` in views.ts)
already narrows the records the board sees (`matched`). Today a column whose cards
all failed the search is still drawn, empty. New rule: **while the search box is
non-empty, a stack with no matching cards is not drawn, regardless of the
hide-empty setting.** Clearing the search restores them. This is purely presentational
and lives in `KanbanView.vue` / the computed that feeds it — the search remains "not
part of the view" exactly as GridView's comment says.

### A5. Contract changes (views.ts)

- `canMakeColumns(f)`: add `text`, `number`, `file_path`, `dimensions`.
- `KanbanConfig`: `z.strictObject({ fieldId: uuid, hideEmpty: z.boolean().optional() })`.
- `kanbanColumns(records, field, linkIds, targets)`: for the new types, collect
  distinct values from `records`, sort per the table above, build `{ kind: 'value',
  value }` columns. Keep the existing select/link path untouched.
- A new pure helper, `visibleColumns(cols, { hideEmpty, searching })`, so the
  hide/search rule is tested without a DOM.
- Update the doc comment on `kanban:` — the paragraph about single-valued fields is
  still true; the sentence "Only SINGLE-VALUED fields may make columns — a select, or
  a link ticked single" is no longer the whole story.

### A6. Tests

`test/kanban.ts`: text stacks by exact value, trimmed; number stacks sort
numerically (2 before 10); "(none)" always last; hideEmpty defaults per type;
`visibleColumns` with `searching: true` drops empties whatever `hideEmpty` says;
drag onto a text stack writes the string; drag onto "(none)" clears.
`test/ui.ts` or `test/kanban.ts`: the toolbar menu offers text/number fields and
the switch round-trips through `view.update`.

### A7. Out of scope, on purpose

Number bucketing (0–10, 10–20); case-insensitive stacking; multi-valued fields
(pulled once already — "let's not break things before we build them"); a
per-stack collapse.

---

## Part B — calendars: one record kind, four layouts

### B1. What a calendar is

A **calendar is a record**, exactly as a report is: a table of kind `calendar`
(sql/020), every record in it is one calendar, and its definition is a `structured`
value of shape `calendar` on a field the table is born with ("Calendar", key
`calendar`). Nothing else is stored; a calendar is DERIVED each time it is opened,
from the tables already loaded in the client. Reasons, all of which also decided
reports: it files into sections and scope for free; it is cross-table by design, so it
cannot be a saved view of one table; one calendar per project is just one more
record.

A calendar **pours several tables into one**: its definition is a list of *sources*,
each a report-style rule (which table, which records, which date fields, what to
print, which colour). The owner's framing: "like we do with reports — which table,
which color, which fields for dates."

A calendar has four **layouts**, switched from its top bar and remembered in the
definition: **month**, **week**, **agenda**, **resource**. The first three draw the
same events on a grid of days or a dated list. The fourth — the Float / Resource Guru
view — draws time horizontally and one lane per record of a *row table*, placing each
event on the lane of the record it is linked to. Same sources, one more axis. The
Resource button is disabled (with a title saying why) until the definition names a
row table.

### B2. The definition shape

```ts
CalendarDef = {
  layout:  'month' | 'week' | 'agenda' | 'resource',        // default 'month'
  sources: CalendarSource[],                                 // 1..MAX_SOURCES (8)
  rows?: {                                                   // the resource axis
    tableId:  uuid,                                          // Computers
    filter?:  FilterEntry[],                                 // the grid's, verbatim
    sort?:    SortEntry[],                                   // the grid's, verbatim
  },
  resource?: {
    zoom: 'day' | 'week' | 'month',                          // column width; default 'week'
  },
}

CalendarSource = {
  id:          string,                                       // stable, for colour legend + tests
  tableId:     uuid,                                         // the table the events come from
  filter?:     FilterEntry[],                                // which records
  start:       uuid,                                         // a `date` field on tableId
  end?:        uuid,                                         // a `date` field on tableId; absent = one-day events
  label:       uuid[],                                       // 1..3 fields printed on the chip, in order
  tint:        Tint,                                         // colorRules.ts TINTS: green amber red blue violet grey
  tintBy?:     uuid,                                         // optional: a `select` field on tableId; its choices map to tints
  tintMap?:    Record<string, Tint>,                         // choice → tint; choices not listed use `tint`
  lane?:       uuid,                                         // resource only: the link path to rows.tableId (B4)
}
```

Validation (`calendarDefError`, run on both sides like `reportDefError`, and in
`server/apply.ts` next to the `report` shape check):

- `sources` non-empty, ids unique.
- `start`/`end` exist, are on `tableId`, are type `date`; `end !== start`.
- `label` fields exist on `tableId`, 1–3 of them, types in `labels.ts`'s labelable
  set plus `link`/`backlink` (printed as pill text).
- `tintBy` is a `select` on `tableId`; `tintMap` keys ⊆ its choices.
- `rows.tableId` exists and is not a utility table; `rows.filter`/`sort` reference
  fields on it.
- `layout === 'resource'` requires `rows`.
- If `rows` is set, every source must have a `lane`, and it must resolve to
  `rows.tableId` (B4). If `rows` is absent, `lane` must be absent.
- An event whose `end < start` is **not** an error at the definition level — it is
  data. Render it as a one-day event on `start` with a warning glyph (VerdictMark,
  `warn`), and the agenda prints "ends before it starts".

### B3. The result: one pure function

```ts
runCalendar(def, state, scope) → {
  events:  CalendarEvent[],            // every event, all sources, filtered by source filter AND scope
  lanes?:  Lane[],                     // resource only: rows.tableId records after filter/sort, + unassigned
  legend:  { sourceId, tableName, tint }[],
  problems: string[],                  // definition problems found at run time (a field deleted since)
}

CalendarEvent = {
  id:        string,                   // `${sourceId}:${recordId}`
  sourceId:  string,
  recordId:  string,
  tableId:   uuid,
  start:     'YYYY-MM-DD',
  end:       'YYYY-MM-DD',             // inclusive; === start for one-day events
  days:      number,                   // inclusive count
  label:     string,                   // the label fields, joined " · "
  tint:      Tint,                     // after tintBy/tintMap
  laneIds:   string[],                 // resource only: ids in rows.tableId this event sits on ([] → unassigned)
  warn?:     string,                   // "ends before it starts"
}
```

Pure, in `contract/calendar.ts`, tested without a DOM (`test/calendar.ts`). Scope
applies to every source through the existing scope filter, the same way the grid and
reports already honour it. Layout helpers live beside it and are also pure:

- `monthGrid(ym)`, `weekDays(iso)` — day cells, **Monday-first** (confirmed by the
  owner Oct 25; keep the week start a single constant).
- `placeEvents(events, days)` — the classic span-packing: for a row of days, assign
  each event a *track* so overlapping spans stack without colliding; returns
  `{ event, fromCol, toCol, track }`. Used by month, week and resource alike.
- `agendaGroups(events, from, to)` — events grouped by day, a multi-day event listed
  under its first day with "→ until *end*".

### B4. The lane: how an event finds its row

A source's `lane` is **a field id**, one of:

1. A `link` field on the source table whose target is `rows.tableId`. Direct case —
   Projects has a `computers` link; a project with three computers draws on three
   lanes (it is one event, drawn thrice; moving one moves all).
2. A `link` field on the source table that is a **junction endpoint** pointing at
   `rows.tableId` — the source is the junction table itself. This is the owner's
   case and the one to build against: a `Computer × Project` junction ("Bookings"),
   endpoint `a` → Computers, endpoint `b` → Projects, with its own `start`, `end`
   and `status` select. Each junction row is one bar on one computer's lane; the
   same computer can be booked on the same project in several bouts, and on several
   projects at once (bars stack in tracks).

Both resolve with existing machinery: `linkIds(recordId, fieldId)` from the derived
layer. Case 2 is case 1 with the table being a junction; nothing in the contract
distinguishes them except the editor's picker, which lists junction endpoints under a
"through *Bookings*" heading so the owner can see what he is picking.

An "**Unassigned**" lane is always last and shows events whose `laneIds` is empty.
It is what makes orphan bookings findable (Float does the same).

Not in v1: a lane reached through a backlink on the row table, or through a lookup.
If the owner asks, it is one more case in the same resolver.

### B5. What the chips print and how they look

- A chip is the source's **tint** (wash + stripe, the same vocabulary as grid colour
  rules: `colorRules.ts` paints), the label text, and — if the source is a junction
  — the pair label `Target › Verb` the rest of the app uses (`junctionLabel`).
- Legend chips along the top bar: one per source, "*Bookings* ●", click toggles that
  source off/on **for this browser** (per-browser like fold state; `client/prefs.ts`),
  never saved into the definition.
- Double-click a chip → the record opens in the tray (`open-record`). Single click
  selects (a selected chip gets the ring the canvas uses). No ⤢.
- Today is marked; weekends shaded lightly in month/week/resource.
- Nothing floats; the calendar body scrolls, the top bar does not.

### B6. Editing dates from the calendar

All through `store.mutate`, one batch, one Ctrl+Z, using the mutation contract's
`record.update` on the source record (never on the row record):

- **Drag a chip** to another day → start and end move together, duration kept.
- **Drag a chip's end edge** (month/week/resource) → end changes; start edge → start
  changes. Snaps to whole days. Dragging start past end is not allowed (clamp).
- **Draw** on empty days (month/week) or on a lane (resource) → a new record in the
  source table with start/end filled — and, on a lane, the lane link filled with the
  row record. If a calendar has several sources, a small picker asks which one
  ("New *Booking* / New *Milestone*"), the same picker as the kanban's "+" when a
  group has a choice. For a junction source the OTHER endpoint (the Project) is
  required, so creation opens the new record in the tray with the link picker focused
  on it rather than inventing a second dialog; the row is created immediately (so
  Ctrl+Z works) and the tray's existing editors do the rest.
- Pointer events via `client/recordDrag.ts`, like the kanban — not HTML5 drop.

Scope still applies to creation: a record made from a scoped calendar inherits the
scope link, exactly as a record made from a grouped grid or a board does.

### B7. Where it lives in the app

Mirror reports exactly (`App.vue` "reports" block, `NavContents.vue`, `state.ts`):

- `isCalendarsTable`, `calendarsOf`; tree lists "Calendars:" under each location
  after "Reports:", with a "+" that makes a `Calendars` table on first use
  (`schemaActions.createTable(name, 'calendar')` seeds the "Calendar" structured
  field).
- `view === 'calendar'`, `calendarId`, a hash route like reports (`router.ts`), the
  crumb, and the record tray keyed `calendar:<id>`.
- `CalendarView.vue` hosts: the top bar (layout buttons, month/week navigation
  ‹ today ›, legend chips, zoom for resource), and one of `MonthLayout.vue`,
  `WeekLayout.vue`, `AgendaLayout.vue`, `ResourceLayout.vue`. The four layouts share
  `CalendarChip.vue` and the drag/draw composable.
- `TableSettings.vue` gets the kind sentence: "▦ A table of calendars. Every record
  in it is a calendar: its “Calendar” field holds the definition."
- The new-table dialog's kind select gets the fourth choice.

### B8. The editor (record tray)

`CalendarEditor.vue`, drawn in the tray for the "Calendar" structured field, in the
style of `ReportEditor.vue` — picks only, no ids typed, one draft saved once:

- **Rows** well (optional): table select (non-utility tables), then the grid's
  filter/sort controls reused verbatim.
- **Sources** list, each a foldable well: table select; filter lines; Start (date
  fields of that table) and End ("— one day —" or a date field); Label (up to three,
  ordered, drag to reorder like the schema list); Tint (the six named tints as
  swatches, the same control colour rules use); "Tint by" (select fields of that
  table) revealing a choice→tint map when set; Lane (only when Rows is set: link
  fields targeting the rows table, junction endpoints under "through *X*").
- Add source · remove source (with the app's in-app confirm). Removing the last is
  refused with a hint.
- The layout and resource zoom are NOT in the editor; the top bar owns them and
  writes them into the definition (one `record.update`, debounced; they are
  "remembered", not "configured").

### B9. Tests

- `test/calendar.ts` (pure, red-checked first): definition validation cases from
  B2 one by one; `runCalendar` over the worked example; inclusive day counts; a
  one-day event; end-before-start → warn; `tintBy` mapping with an unlisted choice
  falling back to `tint`; lane resolution direct and through a junction; the
  Unassigned lane; `placeEvents` packing (three overlapping spans → three tracks,
  two disjoint → one track); `agendaGroups` multi-day listing; scope filtering.
- `test/structured.ts`: the server refuses a bad `calendar` shape on write, like T9
  does for reports.
- `test/calendarview.ts` (happy-dom, like `reportview.ts`): a calendar opens from
  the tree; layout buttons switch and persist; Resource disabled without rows; a
  chip drag emits one `record.update` with both dates moved; a draw on a lane
  creates a junction row with the computer endpoint set; legend toggle is
  per-browser; double-click opens the tray.

### B10. Worked example to build against

Tables: `Computers` (name, kind select, room), `Projects` (name, start, end — Projects
is the section's scope table), `Bookings` — a junction, `a` → Computers (single),
`b` → Projects (single), status select {Planned, Confirmed, Done}, start, end, note.
Also `Milestones` (name, date, project link) as a second, one-day source.

Calendar "Machine room":

```
rows:    Computers, sorted by name
sources: Bookings   start/end   label [Project (b), Status]  tint blue   tintBy status {Confirmed→green, Done→grey}   lane a
         Milestones date        label [Name]                 tint amber  lane — via Projects? NO: Milestones has no link to Computers
```

That last line is the deliberate edge: with Rows set, every source needs a lane, so
the editor refuses Milestones on this calendar and says why ("Milestones has no link
to Computers"). The owner makes a second calendar, "Deadlines", with Milestones +
Bookings and no rows — month/week/agenda only. Both are records in the same
`Calendars` table.

Expected: in October, Color 01 booked on Duke twice (two bars, one lane), Color 02
on Duke and Novak overlapping (two tracks), an unlinked booking in Unassigned. In
month layout the same bars span days; agenda lists them under their first day.

### B11. Build order

1. `contract/calendar.ts` + `test/calendar.ts`: def, validation, `runCalendar`,
   `placeEvents`, `agendaGroups`. **Stop for the owner's review of the shape.**
2. `sql/020_calendars.sql` (the kind; same two lines as 013), the `calendar` shape
   in `shapes.ts`, server validation on write, `createTable(.., 'calendar')`,
   `state.ts` helpers, tree + route + crumb + tray wiring, an empty `CalendarView`
   that lists `problems`. Something opens before anything draws.
3. Month and week layouts, read-only, from a hand-written definition. Legend.
4. Agenda layout.
5. The editor in the tray.
6. Drag to move, edge drag to resize, draw to create (month/week).
7. Resource layout: lanes, Unassigned, zoom, draw-on-lane creating the junction row.
8. Polish: today marker, weekend shade, keyboard ‹ › for period, print stylesheet
   (reports' print CSS is the template).

One patch per step is fine where a step is big (3, 6, 7); otherwise one patch per
round as usual.

### B12. Out of scope, on purpose

Times of day and timezones (the `date` type is the design, not a gap). Capacity and
over-allocation shading (needs a numeric capacity concept that does not exist yet —
Float's real feature, later). Recurring events. Rollups on calendars. A lane via a
backlink or lookup. iCal import/export (a plausible later export, like CSV on reports).
Colour rules on calendars beyond `tintBy` (when the conditional-colour feature grows
a calendar target, it slots in next to `tintBy`).
