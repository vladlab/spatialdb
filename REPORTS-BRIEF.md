# Brief: reports — how data gets OUT of spatialdb

A design, agreed with the owner on Sept 27 2026, for the session that builds it.
Nothing here is built. Read `API.md` first; the idioms this leans on (roles are link
fields; derived values are computed, not stored; the file is the evidence; a canvas
IS a record) are all established there and in `PLAN.md`.

**Source of truth:** <https://github.com/vladlab/spatialdb>, `main`.

The owner's framing, which decides several choices below: spatialdb is vibe-coded and
has no team to maintain it in perpetuity. The database's job is to track complex
data while a project runs, answer questions about it, and — when the project wraps —
produce reports that can be **archived and read by others without the app**.
Reports are how data leaves the system.

## 1. What a report is: a walk, not a query

The schema's idiom is "roles are link fields." The matching report primitive is not a
join builder; it is **a tree walk along links**. A report definition is a nested list
of *levels*. Each level says: from every record at the parent level, follow these
link fields into that table, keep the records matching these filters, show these
fields, sort them so, and compute these rollups over my children.

The owner's first report in that language:

```
Works                                          root; scope filters it to the project
├─ via "Deliverables (bid)"   → Deliverables   role: bid
│    └─ via backlink Files.deliverable → Files,  PINNED: Files.work = the Work above
└─ via "Deliverables (added)" → Deliverables   role: added
     └─ (same)
```

Rendered:

```
Ep 101                                     4 of 5 delivered
  ProRes 4444 texted   [bid]     ep101_prores_v2.mov   2026-09-14
                                 ep101_prores_v1.mov   superseded
  DCP 2K Flat          [added]   — nothing yet —
Ep 102
  ProRes 4444 texted   [bid]     — nothing yet —
```

**Since junctions (Sept 30 2026):** `Files.deliverable` is no longer a link — the
relation is a junction, "Delivery", whose rows carry the status. The report is the
same shape, its last level reached THROUGH the junction (§3a):

```
Works
└─ via "Deliverables"              → Deliverables
     └─ via Deliverables."Delivery" ⇄ Files (through the Delivery pairs),
        PINNED: Files.work = the Work above;  pair: Status
```

```
Ep 101                                        2 expected · 1 satisfied
  ProRes 4444 texted   ep101_prores_v2.mov   Accepted
                       ep101_prores_v1.mov   Rejected
  DCP 2K Flat          — nothing —
```

Three things come free from the walk:

- **Empty groups exist.** The walk descends from the *parent's* link, so a
  deliverable with no files is a node with zero children — shown. The expectation
  lives on the Work, not on Files; this is exactly what `groupRows` cannot do.
- **The three-way join is one small rule.** A level may be *pinned* to an ancestor
  ("must also link, through Files.work, to the Work two levels up"). That is the
  generic form from the old brief, stated once and reusable anywhere.
- **Bid vs added is two sibling descents** through two link fields, each tagged with
  a role. Nothing about "bid" is known to the code.

The manifest report is the degenerate case: one level, Files, filters
`deliverable notEmpty` and `status = accepted`, fields path / hash / size, sorted by
Work. Same machinery, depth one.

## 2. Three layers, kept apart

The reason this will not calcify into one use is the same reason `compareRecords`
serves badges, side-by-side and an endpoint: one definition, one result, many
consumers.

1. **Definition** — the walk (§3). Names fields by id, as views do.
2. **Result** — `runReport(def, store, scope) → ReportNode`, a pure function in
   `src/contract/reports.ts` (the twelfth shared contract file), computed on the
   client over the loaded tables like lookups and compare. Plain nested data:
   `{ record, roles, cells, rollups, children }`. It knows nothing about rendering.
3. **Renderings** — consumers of the tree: a read-only on-screen outline (freed from
   the grid's fixed row height and windowing); print CSS for PDF; a flattener to CSV
   (each leaf row with its ancestor columns repeated — what a producer wants in a
   spreadsheet); raw JSON for scripts.

A new rendering, or a new rollup op, touches one layer.

## 3. The definition shape

```ts
ReportDef = { v: 1, root: Level }

Level = {
  id: string                       // so pins and rollups can name a level
  table: uuid                      // root only; a descent's table is implied by `via`
  fields: uuid[]                   // EXPLICIT columns — see below
  filters: FilterEntry[]           // reused from contract/views.ts, verbatim
  sort:    SortEntry[]             // same
  rollups: Rollup[]
  children: Descent[]
}

Descent = Level & {
  via: { fieldId: uuid, role?: string }[]   // ONE OR MORE link fields into the SAME
                                            // table; forward links (on the parent) or
                                            // backlinks (on the child) — the field's
                                            // owner table says which
  pins?: { fieldId: uuid, levelId: string }[]   // the record must ALSO link, through
                                                // fieldId, to the ancestor record at
                                                // levelId
}

Rollup = {
  id: string, label: string
  op: 'count' | 'countWhere' | 'sum' | 'min' | 'max' | 'list'
  over: string                     // a child level's id
  fieldId?: uuid                   // sum / min / max / list
  where?: FilterEntry[]
       | { rollup: string, op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq', value: number }
}
```

### 3a. Through a junction

```ts
Descent = Level & {
  via:  { fieldId, role? }[]       // a fieldId may also be a JUNCTION COLUMN on the
                                   // parent's table: through the pair rows, to the
                                   // other end's table
  pins?: …
  pair?: { fields: uuid[], filters: FilterEntry[] }   // fields of the junction table
}
ReportNode    += pair?: { id, tableId, cells }         // the pair row, and pair.fields read from it
ReportSection += pairTableId?
```

- **The junction column is the `via`** — the backlink on the endpoint table that
  mirrors the junction's `a`/`b`, which is already "the relation" to the grid, the
  canvas and the comparison. No flag, no new field kind: the walk recognises it from
  `tables.junction`. The level lands on the OTHER END; the pair rows are not a level.
- **Pins are unchanged.** They apply to the landed records (Files.work = the Work
  above), which is what made the junction-table-as-a-level walk unusable: a pair row
  has no Work link, so every episode's pairs listed under a shared deliverable.
- **`pair` is explicit**, like `fields`: tick the junction's Status to show it; a
  pair filter ("Status is Accepted") drops the records no pair of which passes.
- **Rollups may test and read pair fields** of the child they run over:
  `accepted = countWhere files where Delivery › Status = Accepted`, and one level up
  `satisfied = countWhere deliverables where rollup accepted > 0`.
- **One pair per node.** A record reached by several pair rows at one level appears
  once, carrying its first row (its first PASSING row under a pair filter).
- **`pair` needs one junction**: every `via` of the level through the same one.
- The junction's endpoint LINK still works as a `via` into the junction table — a
  report about the pairs themselves — and an ordinary backlink is still not a `via`.
- CSV: pair columns sit beside the record, named by the junction
  ("Files: Delivery Status").

- **A pin may go through a junction too** (Sept 30, same day). The report turned
  round — group by deliverable, then by episode:

  ```
  Deliverables
  └─ via backlink Work."Requested Deliverables" → Works
       └─ via backlink Files.work → Files,
          PINNED: paired with the Deliverable above through Delivery;  pair: Status
  ```

  `pins[].fieldId` may be the junction column on the level's table or on the
  ancestor's (they say the same thing; the editor offers the junction once). The
  record must have a pair row with the ancestor record. A level with plain `via`
  links and exactly ONE junction among its pins reads `pair` from that pin; a via
  through a junction wins; two junctions among the pins is no single pair. The
  junction pin and a plain link between the same tables (Files."Deliverable Target")
  are different questions — "delivered against" vs "meant for" — and both are offered.

Pinned in `test/reports.ts` R11–R12 (pure) and `test/reportview.ts` V6–V7 (server,
outline, editor).

Decisions inside the shape, each agreed:

- **`fields` is explicit, not `hidden`.** A view hides fields so that a new field
  appears by default; a report is a document and must never gain a column by itself.
- **Several `via` links per descent**, role-labelled, rather than one link and a
  sibling per role. A record reached through two links at one level appears ONCE,
  with both roles listed. Pins apply to every `via`.
- **Pins name a level `id`**, not "N levels up", so inserting a level does not
  silently re-target a pin.
- **A rollup may test a child's rollup.** "4 of 5 delivered" is
  `countWhere` over Deliverables where `{ rollup: 'files', op: 'gt', value: 0 }`,
  beside a plain `count`. Rollups are evaluated bottom-up.
- **Closed sets, as always.** Filter ops are `FILTER_OPS`; rollup ops are the six
  above. A need the sets cannot express adds an op to a set (a contract change,
  reviewed), not a formula language — the same call as compare.
- **Unknown field ids are ignored at read time**, as views do, so `field.delete`
  never bricks a report and undoing the delete brings the column back.
- **Scope filters the root level only.** Descendants are reached by links, and a
  file linked to an in-scope work is in the report whether or not it carries the
  project link itself. (It should; the report is not the place to enforce that.)

Rules to pin in tests: once-with-both-roles; pins on every via; an empty level is
still a node; bottom-up rollups; a cycle in the definition (a descent back into an
ancestor table is fine — a level whose *records* recur is not walked twice) is a
validation error at write, not a hang at read.

## 4. Where a report lives: it is a record

As boards are records (`tables.kind = 'boards'`), reports are records: a table kind
`reports`, each record one report, its definition a `structured` value of a new
shape `report`, validated by the same zod on both sides. No migration; `data` is
jsonb. What this buys, for nothing: a report has link fields (to a Project), sits in
a section, respects scope, can be placed on a canvas, carries a rich-text description
— and its archived snapshots are attachments on the same record (§5).

A grid or kanban view is NOT a report. Views stay in the table toolbar.

## 5. Live definition, frozen snapshot

Two needs, two things:

- **The definition is live** and shared, and parameterised by scope: one
  "Deliverables status" report serves every project. Open it inside a scope and it
  runs for that project, now.
- **A snapshot is a run at a moment.** The client runs the report, renders the
  self-contained HTML (inline CSS, no script, print-ready), the CSV and the JSON, and
  uploads them through the asset store that exists, as `attachment` values on the
  report record. **No new wire format**: this is `apply` writing an attachment value
  like any other. HTML with inline CSS is readable in twenty years without spatialdb,
  which is the honest answer to "no team in perpetuity." A snapshot records the scope,
  the definition it was run from, and the log `seq` it saw.

QC (COMPARE-BRIEF §1) is the same shape — an event that produces a document — and
should reuse the snapshot path when it arrives.

## 6. CSV export of any table — the bonus

The flattener is one function over a `ReportNode`. A grid view is a one-level
report, so "Export CSV" in the table toolbar is `applyView` → wrap as a root node →
flatten → download. Client-side, no endpoint. Grouped views flatten the same way
(group values become leading columns). Kanban exports as its grid.

## 7. What this is not, yet

- Not a formula or expression language.
- Not server-side. Whole tables load client-side (`contract/views.ts`, top). If a
  headless run is ever wanted — scheduled snapshots, Python — the same pure function
  runs on the server and an endpoint is designed then, in `API.md`.
- Not charts. Not a page-layout designer: the first rendering is a clean printable
  outline; a logo and per-work page breaks are a later pass if a client ever reads one.
- Not a virtual "4 of 5" field on the Work card. Rollups are shown in reports only
  for now; the function is written so a lookup-like field could call it later.
- Not a DeliveryPacket. The owner is adding that table soon; the "delivered on" and
  "superseded" cells in the example will come from it or from a Files status, and the
  report just shows the field either way.

## 8. Build order

Status: steps 1–4 built (Sept 27–28, 2026): `contract/reports.ts` with
`test/reports.ts` (pure, 50 checks); `sql/013`, the `report` kind and shape, the
new-table dialog's kind select, and the server's schema check on every write
(`test/structured.ts` T9); step 3, `ReportView.vue` + `ReportOutline.vue` — a report
is a view of the app with an address, listed under "Reports" in the tree, drawn live
from the store (`test/reportview.ts`); step 4, the level editor in the tray
(`ReportEditor.vue`, `ReportLevelEditor.vue`) — picks only, no ids typed, a draft saved
once (`test/reportview.ts` V5). Owner to test the editor by hand.

Sept 30, 2026: the walk goes THROUGH junctions (§3a), by `via` and by pin —
contract, server check, outline and editor; `test/reports.ts` R11–R12,
`test/reportview.ts` V6–V7. Steps 5 and 6 are still to build.

1. `contract/reports.ts`: `ReportDef` zod, `runReport`, the flattener, tests (pure;
   red-checked, including the worked example below). **Stop for the owner's review
   of the shape** — the standing rule.
2. The `reports` table kind and the `report` structured shape, with server
   validation on write (field/table existence, `via` all into one table, pins to
   real ancestors, rollups over real children, no unwalkable cycle).
3. The on-screen outline renderer, read-only, from a hand-written definition — so
   there is something to see before the editor exists.
4. The level editor in the record tray: a tree of levels; per descent a link picker
   (forward and backlink fields of the parent's table, grouped by target table),
   role text, pins offered from the ancestors that the child's table links to;
   fields, filters and sort reuse the grid's controls; rollups a small form.
5. Exports: JSON, CSV (and the grid toolbar's Export CSV), print stylesheet.
6. Snapshot: render, upload, attach — one batch, one Ctrl+Z.

Worked example to build against: Projects › Works (Deliverables (bid),
Deliverables (added), Project link) › Deliverables › Files (project, work,
deliverable links; path, size, status, delivered date). The report in §1, plus the
accepted-files manifest, plus a bid-vs-added count per work.
