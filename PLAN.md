# Plan

Written down because it previously lived only in a chat log, which made every
handoff more expensive than it needed to be. Amend it in place as things change —
a stale plan in the repo is still better than an accurate one nobody can find.

## Phases

**0 — Foundations.** Postgres, a migration runner, backups, HTTP server with
`/api/mutate` wired to `applyBatch`, simplest possible auth.

*Status: mostly done, with the deviations and gaps listed below.*

**1 — Prove the loop. ★ The real checkpoint.** Client store: apply
optimistically, queue, flush on debounce, apply stream events through the one
path. Plus one ugly screen that lists records and creates one. No canvas, no
styling. When you can type a record and see it survive a refresh, the architecture
is validated.

*Status: done. `src/client/state.ts` (state + the one apply function),
`src/client/store.ts` (queue, flush, stream), `src/client/App.vue` (harness),
`test/store.ts` (44 assertions: idempotency across all 24 mutation types offline,
then two live stores converging through a real server).*

Verified: optimistic render before the request leaves; survives a refresh;
own echo not double-applied; two clients converge; per-field merge keeps
concurrent edits to different columns; a dropped connection reconnects at the
current watermark without duplicating; a resync rebuilds without losing queued
writes; a 4xx batch is dropped rather than retried forever.

Two corrections to earlier advice came out of building it, both now in API.md:

- **The stream watermark must not come from the mutate response.** That response
  `seq` is the log head after your batch, which can exceed events you have not
  received — if your batch takes seqs 10 and 12 while another client takes 11, it
  reports 12, and adopting it while your stream is momentarily down loses 11
  forever. The watermark advances only from stream events and from self-dating
  snapshot reads.
- **Take the watermark before fetching, not after.** Head-then-data produces an
  overlap, which idempotent apply absorbs for free. Data-then-head risks a gap,
  which is silent and permanent.

**2 — Canvas.** Port the viznotes canvas onto placements. Drag →
`placement.move`. Drag from the unplaced tray → `placement.add`. Links render as
arrows. Biggest phase, most familiar territory.

*Status: done.* Ported from viznotes — `useCanvas` → `canvas/useViewport.ts`
almost verbatim, `useBoxSelection` reworked to hit-test in world space rather than
against DOM rects, and the arrow maths pulled out of `ArrowLayer.vue` into a pure
`canvas/geometry.ts`.

**The one thing that had to change in the port.** viznotes mutates `note.pos` every
frame and debounces a save. Here that would mean every frame becoming a mutation:
~120 log rows per card for a two-second drag, each broadcast to every peer, and
undo meaning "go back one frame". So the gesture is split — positions are written
straight into local state during the drag (ephemeral, like the viewport, nothing
queued), and **one `placement.move` carrying every moved card** lands on drop. That
is what the `moves[]` array was designed for; the drag is the consumer e2e test 9
was waiting for.

Consequence worth knowing: a peer's edit to a card you are dragging is overwritten
by your drop. Same last-write-wins rule as everywhere else.

**Not ported:** viznotes' `NoteComponent` (1,589 lines — a note is a TipTap
document with nesting, containers and inline assets; a card here is a small
read-mostly summary of a row) and the container/reparent/asset-link machinery in
`useDrag`, which has no analogue in the placement model. The heavy editing surface
belongs in phase 3's grid.

Arrow geometry is pure and tested at 24 bearings — it is the thing most likely to
look subtly wrong rather than fail loudly.

**3 — Grid + schema editor.** Make data entry pleasant. The schema editor can
stay crude — few trusted people touch it, and tables can be seeded with SQL until
that annoys you. Field-value type checking probably belongs here.

*Status: done, crude as planned.* Three pieces:

- **Schema editor** (`client/components/SchemaEditor.vue`, the `schema` tab):
  create/rename/delete tables and fields, link-target picker, comma-separated
  choices for selects, ↑↓ field reordering. Keys and types are immutable after
  creation because the contract says so (changing either is a data migration
  wearing an edit's clothes). Creation order becomes presentation order by
  pairing each create with a `position` update in the same debounce flush —
  one batch, one transaction.
- **Typed grid cells** (`client/components/CellEditor.vue`): an editor per
  field type instead of phase 1's String()-everything input. Two conventions:
  empty input emits `unset` (the contract rejects nulls — one representation of
  empty), and an unticked checkbox stores `false` rather than unsetting,
  because "explicitly no" and "never answered" are different facts.
- **Value validation** (`contract/values.ts`, the third shared contract file):
  `validateValue(field, value)` runs in the cell before anything is queued AND
  in server apply, so the two cannot drift — the same structural move as
  `events.ts`. Write-time only: pre-existing rows are grandfathered and a bad
  old value surfaces on its next edit. Rules and reasoning in API.md.

Both known issues assigned to this phase were resolved on the way in (see
"Undo" below for the first): `field.delete` now strips its key rather than
orphaning it, and values are checked.

**4 — Realtime.** *Built early, during phase 0, as a side effect of wiring up the
server — and built wrong. Corrected before phase 1 rather than deferred; see
below.* What remains is whatever the client store needs in phase 1.

**5 — Desktop + media.** Tauri wrapper, `file_path` field, ffprobe agent,
reveal-in-folder.

**6 — Lookups + QC.** Wire `resolveLookup` into the UI so spec-vs-actual shows up
on the card. The payoff feature.

## Phase 0 — what actually happened

Deviations from the plan, none of them problems, but worth knowing:

- **Nix + `scripts/db.sh`, not Docker Compose.** Socket-only local cluster, no
  TCP port, nothing installed system-wide.
- **The migration runner is hand-rolled** — a loop in `db.sh` over `sql/[0-8]*.sql`
  with a `_migrations` table. No rollback. Adopting dbmate or node-pg-migrate is
  still the right move once a migration needs reverting; it isn't urgent.
- **Backups exist now** (`scripts/backup.sh`). This was the one genuine phase 0
  gap: `001_schema.sql` skipped soft deletes on the explicit stated assumption
  that nightly `pg_dump` existed, and it did not. Until it did, the system had no
  undo at any level — `record.delete` cascades to links and placements, there are
  no tombstones, and the mutation log records that a delete happened without
  retaining what was deleted. `./scripts/backup.sh cron` prints the nightly line;
  it does not install it. **Install it, then run `./scripts/backup.sh check`.**

  The first cron line this script emitted would have failed every night in
  silence. `XDG_RUNTIME_DIR` is unset under cron, so the socket path resolved to
  `/tmp/spatialdb-<hash>` while Postgres was listening on
  `$XDG_RUNTIME_DIR/spatialdb-<hash>`. It worked every time by hand. That is the
  entire failure mode of backups in one sentence, so `check` now re-runs a real
  dump under a stripped, cron-like environment instead of trusting that the
  interactive case generalises. Two more things were wrong with that line: `PATH`
  is minimal under cron, so a Nix-provided `pg_dump` is not found; and a
  `>> logfile` redirect is evaluated *before* the script runs, so a missing
  directory killed the job and destroyed the log that would have reported it.
  The script now writes its own log, after `mkdir -p`.

  `check` also flags the deeper problem: a socket under `XDG_RUNTIME_DIR` is
  deleted at logout, so a 03:15 backup of a hand-started cluster cannot outlive
  the session. Either `loginctl enable-linger`, or move the socket
  (`db.sh stop && PGHOST=/var/lib/spatialdb-sock db.sh start`), or run Postgres
  as a systemd service for anything holding real project data.

  Two related fixes came out of this:
  - `db.sh start` now rewrites `unix_socket_directories` when `PGHOST` disagrees
    with it. Previously that value was written once at `initdb`, so `PGHOST` only
    changed where the *client* looked — being told the socket had moved was a lie.
  - `backup.sh restore` evicts live connections before dropping (revoke, then
    terminate — terminate alone loses the race against a reconnecting pool). It
    used to fail with "database is being accessed by other users" exactly when it
    was needed, since the app being up is what makes you want a restore.
- **Auth is still a stub.** `currentActor()` returns the first admin, so a
  database with no users accepts no writes while reads keep working.
  `db.sh bootstrap` now creates just that user; `seed` is bootstrap + the worked
  example. They used to be one command, which conflated a hard prerequisite with a
  demonstration and meant there was no route to a working-but-empty database —
  the only way to get a usable system also handed you fictional deliverables to
  delete.

  The failure was also invisible: `currentActor()` was called OUTSIDE the mutate
  handler's try block, so its "no users exist" message escaped to Hono's default
  handler and came back as a bare "Internal Server Error". The one message written
  to explain the problem was the one you could never see. Now a 503 carrying the
  command to run — and 503 rather than 500 because the server is fine, it is
  unconfigured, which is both a truer status and one the client's retry path
  already handles correctly (writes queued before bootstrap land afterwards).
- **Tests run against `spatialdb_test`**, recreated from migrations on every
  `npm test`. They used to share the dev database and polluted it badly — one run
  took a seeded database from 1 canvas to 902, mostly `pad <uuid>` rows from the
  stream suite forcing the catch-up truncation branch. That padding was itself a
  fix for a weak test, which is worth remembering: a fix that solves its own
  problem can still create a new one somewhere nobody was looking. The suites also
  need to be free to delete tables, prune the log and roll the head backwards
  without anyone weighing whether it is safe.

## Undo — done, and what it does not replace

`001_schema.sql` skipped soft deletes on the stated assumption that nightly
`pg_dump` was cheaper recoverability. Half right. Dumps are disaster recovery;
they are a terrible undo, because restoring the whole database to 3am to recover
one record throws away everyone else's day — so nobody does it, the mis-click
stays unfixed, and the dump never served the purpose the comment claimed.

Both are needed, and they cover different failures:

| Failure | Recovered by |
|---|---|
| Mis-click: deleted record, table, canvas, link, placement | undo |
| App bug writing bad data | undo |
| Disk or filesystem failure | dump |
| Losing `.pg/data` | dump |
| A migration that destroys data | dump |
| Cluster corruption | dump |

Undo needs no tombstones, because the mutation log already recorded who changed
what and when — the only gap was that a delete kept nothing about its victim.
`003_undo.sql` adds a capture column; `src/server/capture.ts` records the rows a
delete is about to destroy, cascades included. Queries stay clean: no
`where deleted_at is null` anywhere.

Capturing the ACTION rather than marking STATE is also what makes cascades come
out right. A `deleted_at` on `links` cannot distinguish "removed because the
record went" from "removed on purpose last Tuesday", so un-deleting would
resurrect too much or too little. The log knows, because it recorded the action.

One invariant that is NOT automated and needs to stay in your head:
**when you add a cascading foreign key in `001_schema.sql`, add the matching query
to `src/server/capture.ts`.** Miss it and undo quietly restores a partial object —
the record comes back, one kind of relation does not, and nothing errors. The
column lists used to have the same problem and no longer do (restore reads them
from `pg_attribute`), but cascade semantics cannot be derived that way.

Design decisions worth revisiting if they chafe — all in `API.md`:
- `restore` carries whole rows in its payload, so undo is an ordinary mutation
  (optimistic, streamed, replayed, idempotent) rather than a special path.
- One `restore` rather than N `record.create`s: atomic at any cascade size, and
  `record.create` cannot restore `created_at`/`created_by`.
- Role gating is dynamic — admin only when the payload carries tables or fields.
- Cascades over 10,000 rows keep counts, drop contents, and refuse undo with a
  409. That case is what dumps are for.

**Still outstanding on the durability side**, and both matter more than they look:

- **`fsync = off` and `synchronous_commit = off`** in `db.sh`. Correct for a
  throwaway dev cluster, actively dangerous for real data — a power loss can
  corrupt the cluster, not merely lose recent transactions. The current config
  makes the dump-only column of that table *more* likely, not less. Flip it before
  this holds real project data.
- **cron should go.** A systemd timer is strictly better: `Environment=` is
  explicit so there is no invisible `XDG_RUNTIME_DIR`/`PATH` inheritance, output
  goes to the journal so failures are visible, `Persistent=true` catches runs
  missed while the machine was off, and `OnFailure=` can notify. Doing that also
  lets `backup.sh check` and most of `backup.sh cron` be deleted, since they exist
  only to work around cron's environment. Postgres itself should be a systemd unit
  at the same time, which fixes the socket-disappears-at-logout problem properly.

## Why realtime got corrected before phase 1

The stream was in the plan as phase 4, described as "mostly plumbing". It was
actually built during phase 0 while the server was being wired up, without the
attention phase 4 allocated to it, and it shipped with the live broadcast and the
catch-up replay speaking two different formats: per-batch vs per-mutation,
camelCase vs snake_case, `seq` as a number vs a string, and the sender id spelled
`clientId` in one and `client_id` in the other.

Consequences, all confirmed by test before being fixed:

- The client needed two apply paths, breaking the "live and reconnection are one
  mechanism" property the whole design rests on.
- Its echo-skip check matched neither spelling reliably, so on every reconnect it
  re-applied its own writes. Local apply is not idempotent, so that means
  duplicated records.
- A client more than 1000 changes behind received a silent truncated prefix, set
  its watermark from the last row it happened to get, went live, and skipped the
  gap permanently.

Fixing this before phase 1 rather than during phase 4 is not a reordering for its
own sake: the client store is the thing that consumes these events. Building it
against two shapes and then rewriting it is pure waste.

**Root cause worth remembering:** `contract/mutations.ts` is imported by both
client and server, so the write surface physically cannot drift. There was no
equivalent for the read surface — `broadcast(payload: unknown)` accepted anything
and `tsc` had nothing to say. The fix is structural, not vigilance:
`contract/events.ts` now does for events what `mutations.ts` does for mutations,
and `test/stream.ts` goes over a real socket, because `test/e2e.ts` calls
`applyBatch` directly and so never exercised the HTTP or SSE layer at all.

Look for the same class of error at any boundary with no shared type.

**Known asymmetry, now fixed:** link fields were invisible in the grid while the
same relations rendered as arrows on the canvas. Not a data problem — modelling
relations as rows is what makes endpoint validation and undo cascades possible —
but the grid read only `records.data` and links do not live there. `loadRecords`
now returns the page's links plus labels for far-end records, and the grid renders
them as removable chips with a picker. Worth remembering as a shape: when a view
reads only one of the two places state lives, the gap shows up as "the data looks
wrong" rather than as an error.

## Phase 3.5 — finishing the relational basics (in progress)

Phase 3 made tables creatable and cells typed. What it did not make is a grid you
would want to enter a few thousand rows into. Agreed order:

1. ~~Strict mutation contract.~~ *Done.* Unknown keys are rejected instead of
   stripped (see API.md). Found by a probe script that misspelt `set` as `data`
   and was told 200. Also: `multi_select` rejects duplicates. Worth keeping from
   this one — the first draft of the envelope test sent an empty batch, which is
   a 400 for being empty, so it passed with strictness switched OFF. It was only
   caught by reverting the fix and checking the new tests went red. Do that.
2. ~~Grid: whole-table loading, sort, filter, saved views.~~ *Done.*
   `contract/views.ts` (config schema + the pure `applyView`),
   `components/GridView.vue` (windowed rows, view tabs, sort/filter/hide menus,
   quick search), keyset paging and self-dating pages in `reads.ts`,
   `store.loadTable` as a whole-table walk, `test/grid.ts` (50 checks).

   **Client-side, reversing the first recommendation.** "Sort and filter on the
   server" was advice given before reading how the grid got its rows. It renders
   from the local store — that is why edits are instant and peers' rows appear —
   and a server query result would have been a second source of truth. Measured:
   walking 50k rows ~2.8 s, filter + 2-key sort of 50k ~170 ms, ~70 MB heap.
   The ceiling is tens of thousands of rows per table, not millions.

   Found on the way, none of them looked for:
   - **Views were write-only.** Mutations, local state and undo capture all
     handled them; no read endpoint returned them, so a saved view lasted until
     the next refresh. Now part of `/api/schema`.
   - **Creation order within a batch was random** (`now()` is per-transaction,
     so the uuid tie-break decided). Found because a test asserted "store order is
     creation order" and failed. `004_record_order.sql`. Matters for phase 5: a
     drag-in of 40 files is one batch.
   - **Two stale-page races**, both made reachable by turning one request into a
     hundred: a stream event overtaking a page, and a page reverting an unsent
     edit. See "Walking a whole table" in API.md.
   - A test of mine HUNG instead of failing when its fix was reverted: it held a
     pooled client across the suite, a check threw, and `pool.end()` in the catch
     waited on the client forever. Use the pool directly in suites.

   Not verified: **the grid has not been clicked in a browser** — there was none
   in the build sandbox. It typechecks, builds, and was server-rendered against a
   live store (view tab, filter, sort, hidden field, link chip, count all
   correct), which covers the template and computeds but not scrolling, the
   menus, or focus. First thing to do with it is use it.
   **Two bugs reported from first real use, both fixed:**
   - *The schema tab was empty.* Replacing the old grid in `App.vue` by slicing
     between two `<section>` tags also deleted the `<SchemaEditor>` tag that sat
     between them. The import survived, so nothing complained — and on a fresh
     database that left NO way to create a table. `noUnusedLocals` is now on:
     vue-tsc counts template usage, so an imported-but-unrendered component is a
     typecheck error (verified by deleting the tag again). Also: the table and
     canvas pickers were only initialised on mount, so creating your FIRST table
     left the table tab saying "no tables". They now follow the lists.
   - *"connecting" for ~25 s on a quiet database.* Proxies hold response headers
     until the first body byte; a client already at the head has nothing to
     replay; so the first byte was the 25 s keepalive. Measured through Vite's
     proxy: 25.03 s before, 13 ms after the server sends `: open` immediately.
     Invisible to every suite because they connect directly — the same "boundary
     with no test" shape as the stream-format bug. `test/stream.ts` §8 asserts on
     the first BODY byte for that reason.

   The pattern behind both: every suite drove the store or the HTTP API, and
   NOTHING mounted the UI. **`test/ui.ts` now does** (happy-dom +
   @vue/test-utils, approved as two devDependencies): the real App against an
   empty bootstrapped database — schema tab → table → typed fields → table tab →
   enter rows → header sort → search → delete → undo — asserting on the DOM and
   then on the SERVER, since an optimistic UI will show a row that never saved.
   It is not a browser: no layout, no paint, so it cannot see a clipped focus
   ring, and the grid's row windowing is not exercised by it.

   On its first real run it found two bugs nobody had reported:
   - **A typo in a number cell erased the value.** `<input type="number">`
     reports unparseable text as `''` (HTML spec, not a quirk), and `''` is how
     the grid spells "clear". So "refused at the cell" was only true at the
     server. Number cells are now text inputs with `inputmode="decimal"`.
   - **The undo tab was stale on open** — it listed once, before a just-made
     delete had flushed. It now follows `lastSeq`.
   Each of the four UI regressions was reverted in turn to confirm the suite goes
   red. Two of the suite's own first-draft mistakes are recorded in its comments:
   waiting on the "queued" badge (clears when a batch goes in flight, not when
   it lands), and clicking the undo TAB instead of the undo button.

   Revised order from here, after the first UI notes (see `UI-NOTES.md`):
   small fixes → grid keyboard/edit model → link picker → schema editing folded
   into the grid → lookup fields → canvas authoring → polish pass.

   **Done since:** the small fixes (selection ring, always-visible "Grid" tab,
   `lookup` hidden from the type list) and **the grid keyboard/edit model** —
   select-then-edit, as in Airtable; the table of keys is at the top of
   `GridView.vue` and the exit contract at the top of `CellEditor.vue`.
   `CellEditor` went from "every cell, always" to "one cell, while editing",
   which also removed a wall of live inputs from the DOM. Decided rather than
   defaulted: **Enter on the last row commits and stays put** — it does not
   create a record. Edits write nothing if nothing changed, so walking a column
   with Enter produces no log rows.

   Two bugs surfaced by testing it, each hidden behind the other:
   - The first header click lazily CREATES the saved view, and the grid treated
     that as "you switched views" — dropping the selection and the
     just-added-rows filter exemption.
   - With that fixed, the exemption turned out to override the SEARCH box too
     (it should only override the view's filter). It had only looked right
     because bug one kept clearing it by accident.

   `UI-NOTES.md` has a "needs eyes" list: what was built and tested headlessly
   but has never been seen in a real browser.

3. ~~Searchable link picker.~~ *Done.* `components/LinkPicker.vue`, replacing a
   `<select>` of every record in the target table. Type to filter (every term
   must match, anywhere in the record — a file is found by reel or codec as
   readily as by name), ↑/↓ + Enter to link, and it STAYS OPEN with the query
   cleared so linking several records is one gesture. Backspace on an empty
   query unlinks the last; Tab/Escape close, in the same exit contract as
   `CellEditor`. Typing on a selected link cell opens it already searching.
   Renders at most 50 rows but searches everything. Not built, and worth having:
   "+ create 'xyz'" when nothing matches.

   Also: `recordLabel` in `state.ts` replaces three copies of the "what do I call
   this record" rule (the picker would have been the fourth).

4. ~~Schema editing in the grid.~~ *Done*, and the explicit designer kept — on the
   condition that keeping it is free. It is: `client/schemaActions.ts` holds every
   schema operation and its validation; `FieldForm.vue` (add) and
   `FieldSettings.vue` (rename, choices, reorder, make primary, delete) are the
   only two field UIs. The grid shows them in popovers ("+" header, "▾" on each
   header); the schema tab shows the same two components as rows. Neither shell
   contains schema logic, so they cannot drift. The schema tab now shows ONE table
   (the one open in the grid, sharing its picker), with "all tables" a click away.
   "+" by the table picker creates a table. The key is derived and behind
   "advanced".

   **Primary field**, with no migration: a record is named by its table's first
   plain-valued field by position (`contract/labels.ts`, used by server and
   client). "Make primary" moves a field first. `name` is no longer special.
   This surfaced that NOTHING outside the UI sets field positions — the seeded
   example had every field at 0, which under the new rule labelled Files by
   "Codec". Seed fixed; a test fixture of mine failed the same way.
   **An existing database seeded before this change needs its fields reordered
   once** (or `db.sh reset && bootstrap && seed`).

   Not done: renaming or deleting a TABLE from the grid (schema tab only), and
   drag-to-reorder columns (the menu has ←/→).

   **Dev-loop fix, reported from use:** `npm run dev` was `dev:api & dev:client`.
   Ctrl-C only reached Vite; the backgrounded API survived every restart, the
   next run died with EADDRINUSE, and the app kept "working" because the new
   Vite proxied to last session's API. Now `scripts/dev.sh`: traps and kills its
   whole process group, and checks the port BEFORE starting (the API runs under
   `tsx watch`, which outlives its child crashing, so waiting for it to fail does
   not work — tried first). The server also logs "listening" from the listen
   callback now, instead of before the port is bound.

5. ~~Lookup fields.~~ *Done*, pulled forward from phase 6. `contract/lookups.ts`
   holds both halves: `lookupConfigError` (run by the field form AND by the server
   on write) and `lookupValues` (run by the grid). Computed on the client from the
   links index and the far records — no cache, so a peer editing the far record
   updates the cell live. `FieldForm` grew two dependent selects ("follow which
   link" → "show which field"); both schema UIs got them for free, which was the
   point of step 4. Lookup columns sort, filter and are found by quick search.
   A lookup whose link field or far field is deleted shows "broken lookup", not
   an empty cell, and repairs itself if that delete is undone.

   Decided: several linked records → all values, comma-separated. Rollups
   deferred until one is wanted; they would be their own field type.
   Not done: a lookup cannot be RE-POINTED from the UI (delete and re-add; it
   holds no data). Canvas cards do not show lookup values yet (step 6).

   This is the first half of spec-vs-actual: a File row can now show its
   Deliverable's required codec next to its own. The comparison itself — flagging
   the mismatch — is still phase 6.

## Phase 4 — what viznotes taught, and the plan from here

viznotes (github.com/vladlab/viznotes) is the project this grew out of; the
previous sessions had already ported its viewport, box selection and arrow maths.
Read again in September for what else to take. The owner's summary of why
spatialdb exists: *"cards should not be random notes with fields but entries in a
relational database — SOME things are great to be manual, but some relationships
should be formal."*

**Decisions taken from that conversation (the owner's, recorded so nobody
relitigates them):**

- **An arrow between two cards that comes from a link field is RELATIONAL; it is
  never created by a canvas gesture.** Ctrl-drag-to-link (viznotes' asset-link
  gesture) and "promote a drawn arrow into a link" were proposed and REJECTED:
  they muddy what is a database and what is a flowchart, and add edge cases.
  Relational fields are edited from the canvas the same way as from a table — by
  opening the record.
- **Manual arrows ARE wanted** — some flows are purely visual. They are
  `canvas_annotations` (kind `arrow`), not links, and must look different.
- **Arrow visibility:** relational arrows are `all` / `selected` (only those
  touching selected cards) / `off`; manual arrows get their own on/off when they
  exist. Per browser, per canvas — a way of looking, not a property of the board.
- **Folding on cards stays**, and matters more once cards hold rich text.
- **Nested containers are NOT ported.** In viznotes nesting is structure; here
  "belongs to" is a link, and a record can sit on several canvases, so a card
  cannot own its children. If the week-view feel is missed, the right shape is a
  card that LISTS its linked records.
- **`NoteComponent` is not ported** (1,589 lines of per-section rich text). Its
  rich-text pieces are — see step 3 below.
- **The Tauri half is already written**, in viznotes: `onDragDropEvent` with the
  devicePixelRatio correction, drop-onto-a-file-note to replace it with history,
  missing-file detection, ffprobe with timecode hunted across format/video/data
  streams, `showwavespic` waveforms, BS.1770 loudness with channel groups and
  cancel, reveal-in-folder via FileManager1 DBus with an xdg-open fallback.
  Phase 5 is a port, not research. Its "Path / Analysis / File History" text
  sections become ordinary fields here, and file history is free — the mutation
  log already holds every change to a path value.

**The order from here:**

1. ~~Record panel + canvas basics.~~ *Done* — below.
2. ~~Asset store.~~ *Done.* `sql/006_assets.sql`, `server/assets.ts`,
   `test/assets.ts` (35 checks), `store.uploadAsset` / `assetUrl` on the client.
   Content-addressed files beside the database (`.pg/assets`,
   `SPATIALDB_ASSETS_DIR`), an `assets` index table, `POST`/`GET /api/assets` —
   shapes in API.md. Uploads never touch the mutation log. Streamed to disk while
   hashed, so the cap is generous: **500 MB** (`ASSET_MAX_MB`) — the owner's call;
   it is an internal tool and the cap is there to stop an accident. Type sniffed
   from the bytes; PNG/JPEG/GIF/WebP/PDF; **SVG refused** (script, own origin).
   `backup.sh dump` now mirrors the directory — ONE additive mirror serves every
   dump, because the files never change — plus `restore-assets`, and `restore`
   warns if the database it brought back refers to files that are not on disk.
   Verified by losing the directory and getting it back.
   Found while testing: answering 413 by cancelling the upload RESETS the
   connection, which a browser shows as a vague network error; the server now
   drains the rest and then answers.
   Not done, deliberately: deleting assets (shares the log-retention decision);
   `db.sh reset` leaves `.pg/assets` alone.
3. **`rich_text` and `attachment` field types.** TipTap JSON (pasted email HTML
   survives; markdown does not), as a NEW type — `long_text` stays a plain
   string, scriptable and readable in psql. Images are asset references. Port
   from viznotes: `NoteTextSection`, `FormatBar`, `ImageNodeView`, the image-paste
   interceptor. Edited in the record panel AND on a card. Whole-field last-write-
   wins: save on blur, never let a remote change overwrite an editor being typed
   in, offer a choice if the value moved underneath. Real co-editing is out of
   scope. `attachment` = a list of asset ids; later the Tauri client writes
   waveform PNGs into one. Runtime dependency: `@tiptap/*`.
4. **Areas and labels** (title, colour, jump keys 1–9), then **manual arrows**
   with their visibility switch.
5. Polish pass (align/distribute, copy/paste, navigate-back, fixed column
   widths), then the Tauri client.

### How data should be modelled here — and the order it set (Sept 19)

A design conversation, recorded because it decides what gets built:

- **A ROLE BELONGS TO THE RELATIONSHIP, NEVER TO THE THING.** "Input", "output",
  "deliverable", "previous version" are not kinds of file or edit; they are how two
  records relate. One Files table, no type field: a texted master is an output of
  one timeline and an input to another simply by being linked from two fields.
- **One table + a Projects link, not a table per project.** Per-project tables
  break links (a link field targets ONE table), drift in schema, and make
  cross-project questions impossible. The real complaint — too much to browse —
  is solved in the interface: a **project scope** (switcher; scopes every table
  with a Projects link, plus search and pickers; new records auto-link; archived
  projects drop out). It also bounds whole-table loading: load only the scoped rows.
- **Lineage is formal.** OEV1 → OEV2 is a link from Edits to Edits; a transcode is
  a link from Files to Files ("derived from"). The two tests for formal vs. a
  drawn arrow: would it still be true on another canvas? would you ever ask a
  question of it? When a relationship needs ATTRIBUTES (preset, who, when), it has
  become a record and deserves a table — not before.
- Together they form a graph that will answer "a new mix arrived — what is stale?".

**Order agreed:** 1 backlinks · 2 command palette + server search · 3 per-field
arrow options and row PORTS · 4 grid beside the canvas with drag-in, then retire
the tray · 5 rich_text + attachment · 6 project scope · 7 areas, labels, manual
arrows, polish, Tauri.

**Ports (step 3), the owner's idea:** a folded card takes every arrow at its edge;
an unfolded one has each link field's arrows leave from that field's ROW, and
incoming arrows land on the matching BACKLINK row — link fields are output ports,
backlink fields input ports, as in a node editor. Cheap because card rows are
already arithmetic (`canvas/cardLayout.ts`). A port exists only for a field the
card shows; otherwise the arrow goes to the edge.

**1. Backlinks — done.** `contract/backlinks.ts`, migration `007`, a `backlink`
field type (read-only, computed, sortable/filterable, same-table allowed), and a
**"Referenced by"** section in the record panel listing EVERY incoming link
whether or not a backlink field exists for it. `client/derived.ts` now holds the
one link index (both directions) and label rule that the grid, canvas and panel
had each copied.

**2. Command palette — done.** Ctrl+K (or "⌕ find"). `table:text` scoping with
fuzzy table names (Tab completes), all-terms matching on the server with a typo
fallback, `GET /api/search` (API.md). On a canvas: Enter places at the cursor,
Shift+Enter places and stays open, a record already there is jumped to. Elsewhere:
opens the record. `>` and `@` are reserved for commands and canvas jumps.
Found on the way: **a record placed from outside the canvas arrived without its
links** (links come with a table or a scene; it came from neither), so its arrows
were missing until reload — true of the tray all along. The scene is now re-read
once the placement lands.
A lesson worth keeping: I announced an escaping bug in the search that did not
exist — the tool output I was reading was JSON-escaped, doubling every backslash.
The code was right; my "fix" matched nothing. It is now pinned by a test that goes
red when the escaping is removed, which is what should have settled it at once.

**3. Per-field arrows and row ports — done.**
- **Ports** (`ArrowLayer.vue`, `rowPortY` in `canvas/cardLayout.ts`): on an
  unfolded card a link field's arrows leave from that field's row, and land on
  the row of a BACKLINK field mirroring the same link, if the target card shows
  one. Folded, not showing the field, or resized shorter than the row → the
  card's edge, as before. Left/right edge only, chosen by where the other card is.
  No DOM measurement — it is the same arithmetic that sizes the card.
- **Colour and direction live on the link FIELD** (`options.arrow`,
  `contract/arrows.ts`, server-validated) — the owner's call: "inputs are blue"
  must mean the same on every board. Set from the field's ▾ menu or the schema
  tab (one component, so both got it). A port row wears a dot in that colour; a
  backlink row wears the colour of the link it mirrors.
- **Per-relationship visibility**: a ▾ beside "arrows: all" lists every
  relationship drawn on this canvas with its colour and count — a legend — and a
  tick box each. Per browser, per canvas, like the mode. Nothing is sent.
- The port tests were checked by removing ports: four go red.

Not done: choosing WHICH side a port uses; curved routing around cards; a port
for a field the card is not showing (by design — show the field).

**4. The grid docked beside the canvas; the tray retired — done.**
- **Dock** (`App.vue`): "▤ table" / Ctrl+B puts the FULL `GridView` beside the
  canvas — same views, sort, filter, search, schema editing. Left or bottom,
  flipped with one click / Ctrl+Shift+B (a wide table wants the bottom, a long one
  the side), resizable by the splitter. Open/side/size are remembered per browser.
- **Row selection** in the grid, separate from cell selection: click a row NUMBER,
  Shift+click a range, Ctrl+click to toggle, Ctrl+A for every row in the view.
- **Drag rows onto the canvas** (`client/recordDrag.ts`): one pointer-based drag
  service — sources call `beginRecordDrag`, targets `registerDropTarget` — that the
  Tauri file drop will reuse. Pointer events, not HTML5 DnD (reasons in the file).
  Several records land as a column in the grid's order; ones already on the canvas
  are skipped, not duplicated, and everything dragged ends up selected. The drop is
  one Ctrl+Z.
- Rows on the canvas carry a dot; **"not on canvas"** hides them (not part of the
  saved view — a shared view knows nothing about the canvas you have open).
- **The tray is gone.** It listed "the first hundred unplaced records". The palette
  (you know what you want) and the dock (browse, sort, filter first) replace it.
  `GET /api/canvases/:id/unplaced` and `store.unplaced` are now unused by the UI.

Found on the way — **a stale-read race of my own making.** After a drop the canvas
re-read the whole scene to pick up links. Press Ctrl+Z before that read returned,
and the older scene arrived afterwards and put the removed cards back. Same family
as the stale table page. `store.loadSceneLinks` now takes ONLY links, and throws
the answer away (and re-asks) if anything changed locally while it was in flight.
Caught because the test pressed Ctrl+Z immediately; a person would hit it on a
slow connection.

**5. `rich_text` and `attachment` — done.** Migration `008`; rule in
`contract/richtext.ts`; runtime deps `@tiptap/*` (approved).
- **`rich_text`**: TipTap, ported from viznotes (StarterKit, task lists, tables,
  an asset-backed image node) minus tiptap-markdown — values are JSON, because
  pasted email HTML does not survive markdown. Edited in the record panel
  (`RichTextEditor.vue`: toolbar, Ctrl+Enter saves, Escape abandons, clicking away
  saves), rendered read-only by `RichTextView.vue` from the SAME extension list.
  The panel has a wide mode (⇤) for it. In the grid and on cards it shows its
  first line; Enter on the cell opens the record.
- **Images**: paste a screenshot, drop a file, or paste HTML with embedded images —
  each goes to the asset store and becomes a node holding an asset ID. Images that
  live on another server (`https:`, `cid:` in a pasted email) cannot be read by the
  page; they are dropped AND THE EDITOR SAYS HOW MANY, with the fix (screenshot).
- **Two people, one note**: whole-value, last write wins — but never silently. The
  editor remembers the value it opened with; if that changed by save time it stops
  and offers "keep mine" / "take theirs". A colleague's save is never pushed into
  an editor someone is typing in.
- **`attachment`** (`AttachmentField.vue`): thumbnails, add by button / drop /
  paste, several files = one mutation, the same bytes twice = one entry. Removing
  a file removes it from the record, not from the store.
- The server checks every referenced asset EXISTS — the one rule the shared
  contract cannot make. Verified: a saved note with an image grew the mutation log
  by a few hundred bytes.
- TipTap is ~420 kB; it is loaded ON DEMAND (async components), so the app still
  starts at ~263 kB.

Found on the way: **Save reopened the editor.** The editor sits inside the field's
"click to edit" area; the Save click closed it, then bubbled and opened it again.
(The UI suite mounts a real ProseMirror in happy-dom — it works.)

Not done: rich text EDITING on a canvas card, and showing more than its first line
there — card height is arithmetic (`canvas/cardLayout.ts`), so a growing text block
needs the row model extended first. PDF/attachment previews beyond a thumbnail.

### Sections, a home page, and scope — the design (Sept 19–20)

The owner wants this to be an internal tool for more than projects — computers,
field drives, whatever comes next — usable by people who are not him. Agreed:

- **SECTIONS** (`sql/009_sections.sql`): a named part of the app listing which
  tables belong together, optionally naming one as its SCOPE table. Navigation
  ONLY: what is offered, never what exists. **Not a permission** — "Everything"
  always exists and always shows all. A table may be in several sections or none.
  Links, lookups, backlinks and the record panel ignore sections entirely.
- **SCOPE lives inside a section**: Home › Projects › Duke › Files. That answers
  "which table is the scope table, and where does its switcher live".
- **Scope rules (agreed, NOT YET BUILT):** a link field carries an explicit
  "membership" flag — only flagged fields scope a table, at most one per table and
  target; DIRECT membership only (no following Notes → Edits → Projects; give Notes
  its own Project link, auto-filled); scope is a FILTER over fully loaded tables
  first, server-side scoped loading only when a table needs it; an "Unassigned"
  entry so records with no project are never invisible; unscoped tables carry a
  badge; cross-scope links stay visible, marked; pickers and the palette default to
  the scope with an escape; new records made in a scope are auto-linked in the same
  step (creation is scattered across components today — route it through one
  function first); ~~canvases are tagged with their scope in their config~~ a board
  is a record, so it is scoped by an ordinary membership link like anything else; "archived"
  is a checkbox the section nominates on its scope table; one scope at a time;
  per browser. The palette RANKS by closeness (scope → section → all), never hides.

**Sections, home page, breadcrumb, addresses — done.**
- Migration `009`; `section.create/update/delete` (admin, streamed, undoable —
  `sections` joined `CAPTURED_TABLES`, capture, restore order and the client's
  restore); `GET /api/sections`; `sectionId` in `CanvasConfig`.
- `HomePage.vue` (a card per section + Everything + "new section"),
  `SectionSettings.vue` (name, icon, colour, tables, scope table, archived
  checkbox, canvases — every control writes at once).
- Breadcrumb in the header: `spatialdb › [section ▾] ⚙`. Pickers list the
  section's tables and the canvases filed under it; a table or canvas MADE in a
  section is filed there in the same undo step.
- **`client/router.ts`**: hash routes, no dependency. Reload keeps your place,
  back/forward work, and a record has a URL (`?r=`). Ids are the identity; the
  section's slug is decoration, so links survive renames.
- The palette ranks the current section's tables first and marks the rest; picking
  a record from elsewhere takes you to Everything rather than to a picker that
  cannot show its table.
- `test/sections.ts` (39 checks) and `test/uiHarness.ts`, a shared way to mount the
  app — `test/ui.ts` is near a five-minute budget and still has its own copy.

**A canvas is a record — done (the owner's idea, Sept 19).** "What if the list of
canvases was a table?" It replaces three special mechanisms with none: filing a
canvas under a section (009's `config.sectionId`, removed again after one day),
the planned per-canvas scope tag, and canvases being invisible to search. Of the
two shapes he proposed — a special `canvas` FIELD, or one special TABLE — neither:
a field splits identity (two names, orphans, two records pointing at one canvas)
and a single table cannot be in two sections. Built instead: a table-level
**`kind: 'canvas'`** — any table can be a table of boards; each record in it is a
canvas. Projects gets "Boards" (with a Project link), Computers gets "Rack
diagrams". Consistent with "a role belongs to the relationship".
- `sql/010_boards.sql`: `tables.kind`; `canvases` becomes a board's STATE only
  (name/description/position dropped), its id a cascading FK to `records`.
  Existing canvases are carried across KEEPING THEIR IDS (verified on the seeded
  database: one canvas, four placements, intact) into a "Canvases" boards table.
- State is created LAZILY (`ensureBoardState`), so making a board is a plain
  `record.create` from anywhere. `canvas.create`/`canvas.delete` retired but still
  parseable.
- The second-order cascade (record → canvases → placements, annotations) is
  mirrored in `capture.ts` and guarded by `test/undo.ts` §9b — five checks go red
  without it. This was the risk named before starting; the tests were written
  before the fixtures were migrated.
- UI: boards are rows in the grid ("▦ open" on each), the record panel has "open
  board", a board card's double-click / menu walks to that board, the canvas
  picker groups by boards table under Everything, "+ canvas" makes a "Boards"
  table in the current section if there is none, the schema tab has "a table of
  boards". The palette finds boards because they are records.
- Six suites' fixtures moved from `canvas.create` to a boards table
  (`boardsTableMutations` in `test/harness.ts`).

**Scope — done**, to the rules above. `contract/scope.ts` (the rule),
`client/scope.ts` (the current scope, provided to every component), `test/scope.ts`
(46 checks).
- **Breadcrumb level two**: `spatialdb › Projects ⚙ › [Duke ▾]` — All, each live
  project, Unassigned, and "show N archived". In the URL as `?sc=`, remembered per
  browser per section. Home cards list live projects as direct links.
- **The membership flag** is a tick box on a link field's settings (grid ⚙ and
  schema tab — one component). Ticking another link to the same target MOVES it.
  Server-enforced: link fields only, one per table per target.
- **The grid** filters under the view's own filter (views stay scope-free: one "QC
  failures" view works in every project), says "in Duke" or — for a table with no
  membership link — **"not scoped"**, and its empty state says how many records
  exist outside the scope. The scope table itself is never filtered.
- **Creation goes through one function** (`scope.createRecord`): the grid's add
  row, the canvas's double-click and "+ canvas" all use it, so a record made in a
  scope is a member of it in the same undo step. Boards needed nothing special.
- **Link picker**: this project's records first, "search all projects" one tick
  away. **Palette**: three rings — project, section, everything — ranked, never
  hidden; the server marks `inScope` and leaves out archived-only records.
- **Falls back to All** if the scoped project is deleted (its records become
  Unassigned — visible, not lost).

Not done, deliberately: scoped LOADING (rule 3 — add it when a table is big enough
to need it; the rule file is its spec); transitive membership; more than one scope
at a time; marking out-of-scope link chips (best-effort at most — the far record's
memberships are only known if its table happens to be loaded).


### The shell restructure (Sept 20) — from the owner's first long session with it

His notes, after using it for real: the header "needs love now that things are more
complex"; tabs should LOOK like tabs; remove Schema ("confusing — do everything in
Table, like Airtable"); rename Undo → History; per-tab controls belong in a bar
under the tabs; the dropdowns should be a left tray, as a TREE mirroring the
breadcrumb; the record panel should be a tray that shrinks the viewport, not a
float; the rich text editor is "jumpy — I'd rather see more UI than get lost";
rich text and images do not show on canvas cards; the view system is half-baked;
menus should close on an outside click; creating/deleting a record makes the
header jump; browser dialogs should be the app's own. And two canvas features —
see "Linking from the canvas" below.

**Order agreed:** 1 shell + tree + remove Schema + History · 2 record tray + a
steady rich text editor · 3 views in the tree · 4 rich text and images on cards ·
5 linking from ports (and removing links).

**1. The shell — done.**
- `App.vue` is now: top bar (breadcrumb · find · ↶↷ · status) / `NavTree` /
  tab bar (Canvas · Table · History) / viewport / record tray.
- **`NavTree.vue` + `NavContents.vue`**: sections › scopes › **TABLES** and
  **CANVASES** under their own subheaders (his call). One section expanded, one
  scope expanded; clicking a folder GOES there. The same tables appear under every
  project because a table does not belong to a project — its rows do. A table row
  opens the Table tab, a canvas row the Canvas tab; on the Canvas tab a table row
  offers ◧ (show it beside the canvas). ⚙ on a table row → `TableSettings.vue`.
  The four header dropdowns are gone; the breadcrumb stays as plain text and works
  with the tree hidden (☰).
- **Schema tab removed.** Fields were already edited in the grid (same
  components). What only lived there moved: rename/delete table, plus colour, icon
  and singular name — in the database since the first migration, never editable —
  into `TableSettings`; "a table of boards" into the new-table dialog.
  `SchemaEditor.vue` is deleted. Old `#/…/schema` and `#/…/undo` addresses redirect.
- **Context bar**: the canvas's controls moved from a floating bar at the bottom
  into a bar under the tabs, inside `CanvasView` and OUTSIDE the drawing surface —
  so the canvas's rectangle is exactly the canvas. The dock buttons are passed in
  through a slot. The grid's bar was already there.
- **Record tray**: a flex sibling of the viewport with a resize splitter, not
  `position: absolute`. The "wide" toggle is gone; drag the edge.
- **Status readout**: one fixed-width element ("saved" / "saving 3…"). The header
  jump was three badges appearing and disappearing.
- **`client/dialogs.ts` + `DialogHost.vue`**: the app's own prompt/confirm, async.
  All twelve call sites converted. Rule recorded in the file: ASK first, mutate
  after — an undo step is one synchronous run, and an `await` splits it. Dangerous
  confirms start with focus on Cancel.
- Sort/filter/fields menus close on an outside press.
- Tests: `navigator()` in `test/uiHarness.ts` — intent-level navigation ("open
  this table", "switch scope", answer the dialog) used by all three UI suites, so
  the next change to the shell is a change to one function. The dialog autopilot
  drives the real dialog's DOM.

**1b. Cleanups from the owner's screenshots — done.** The first time any of this
was SEEN. Tabs moved full-width above the tree; the ∗ and the empty icon slot
removed; a recessed "well" around the deepest unfolded level (his idea — a box has
an edge, indentation does not); a blue "scoped" tag on tables the scope narrows;
and the checkbox bug, which was a global `.grid input { width: 100% }` left over
from phase 1 stretching every checkbox inside the grid's popovers. Lesson for the
polish pass: `App.vue` still has UNSCOPED rules from the debug UI (`.grid th`,
`.grid td`, `.row-add`) — audit them; any of them can reach into a component that
happens to render inside a `.grid`.

**1c. I broke every canvas in step 1, and nothing noticed.** The header's CSS
rewrite replaced a block that also contained the canvas workspace's layout rules;
the canvas collapsed to zero height. The owner found it by opening one. Two things
came out of it: the STYLESHEET GUARD in `test/sections.ts` (the built CSS must
contain a rule for every layout-critical class — add to its list when adding a
layout container), and a working rule for me: when replacing a span of CSS or
template by index, DIFF THE SELECTORS before and after. That diff took one command
and listed exactly the five rules lost.

**1d. The tabs lasted a day — removed.** The owner, once the tree was real: "it's
obvious from what is on screen, both in the main body and in the sidebar, what
content we are on." Right: a tree that lists tables and canvases already says which
you opened; Canvas/Table tabs only repeated it. `view` is still state in `App.vue`
(and in the URL) — it is simply SET by what you click in the tree, not by a tab.
**History was demoted, not deleted**, into a new **Settings** dialog opened from a
footer at the bottom of the tree (`SettingsDialog.vue`). Kept because it does what
Ctrl+Z cannot: Ctrl+Z is this session and this person — a reload empties it, a
colleague's delete was never on it — while History is the server's record of every
delete with what it destroyed, restorable days later. It now says "Record deleted"
rather than `record.delete`, and when. Old `#/…/history` and `#/…/undo` addresses
open Settings. Settings is where app-wide things go from now on; a table, a section
and a canvas each keep their own ⚙ where they are listed.

**2. The steady rich text editor — done.** His note: "very jumpy… I'd rather see
more UI than get lost." The jump was structural — a rendered view swapped for an
editor on click, with a toolbar appearing — so it is gone structurally:
- The editor is ALWAYS mounted while the record is open. No view mode, no click to
  enter. Permanent toolbar. `RichTextView.vue` is no longer used by the tray (it
  is kept for cards — step 4).
- The writing area has a FIXED height (340px), changed only by dragging its bottom
  edge (`resize: vertical` + a ResizeObserver; remembered per browser). It scrolls
  inside itself; the fields below never move. The tray reserves that height while
  TipTap loads (it is an on-demand chunk), so its arrival does not jump either.
- A status word in the toolbar, in a fixed slot: saved · editing — saves when you
  click away · uploading… · needs your decision.
- Saves on the way out (focus leaves, Ctrl+Enter) — still one mutation per session
  of edits, not per keystroke. Escape with unsaved words puts back what was saved
  and does NOT close the tray; with none, it falls through and the tray closes.
- Two people: not editing → a colleague's save simply appears; editing → it is not
  pushed in, and saving over it stops to ask (keep mine / take theirs).
- **A hazard found while designing it:** the editor also saves as it UNMOUNTS (so
  jumping to another record never loses words) — and by then the panel is showing
  the NEXT record, so a save addressed to "the panel's record" writes the note onto
  the wrong one. The editor carries its own `recordId`, fixed at mount, and sends
  it with every save. Red-checked: addressed the old way, two tests fail.

**3. Views — done, and NOT in the tree.** I had proposed listing a table's views
under it in the tree; the owner, once the tree was real: "views belong in a
dropdown inside the table's toolbar — that's the right separation." The tree is
WHERE you are; a view is HOW you are looking at this table. `GridView`'s row of
view tabs (which looked like every other button in the bar — he could make a view
and then not find it) became one control, first in the toolbar: `VIEW  Grid ▾`.
It NAMES the view you are in before you open anything; opened, it LISTS them all,
ticks the current one, summarises each ("2 filters · sorted · 3 hidden"), and
offers rename / duplicate / delete per row and "+ new view — starts from this
one". A line at the bottom says the thing that was confusing him: views are
shared, and every change is saved as you make it. Autosave itself is unchanged.

**4. Rich text and images on canvas cards — done.** His note: "images and
formatting of rich text don't show up on canvas (images just say [image])."
A note has no natural height, and card height must stay ARITHMETIC — arrows meet
the card's edge, and ports the row, without measuring the DOM. So:
- A note is a BLOCK under the card's rows: a fixed-height window (`CARD_RICH_H` =
  16 label + 132) that scrolls inside itself, rendered by `RichTextView` (the same
  extension list as the editor, so headings, bold, tables and asset-backed images
  all show). `cardHeight(rows, collapsed, rich)` — resize the card taller and the
  blocks share the extra room via `flex`.
- **Rich fields are never rows.** Ports are computed from a field's row INDEX, and
  that index has to be the same on every card of a table. If a note were a row
  only when empty (or only when not), a link field below it would sit at a
  different height card to card. So rows = shown fields minus rich text, always;
  blocks = shown rich fields THAT HAVE A NOTE. A record with no note gets no block
  (and no 150px hole), which changes its height and nothing else.
- Read-only on the card; a note is written in the tray. The wheel scrolls a note
  only on a SELECTED card (otherwise it would swallow every pan that crossed one).
  Images do not take the pointer, so they cannot hijack a card drag; links in a
  note do not navigate.
- TipTap's renderer loads only on a canvas that actually shows a note.

**5. Linking from the canvas, selectable arrows, removing a link — done.** (The
decision this reverses, and why the narrower version is right, is recorded under
"Linking from the canvas" above.)
- **ADD**: a LINK row on an unfolded card has a handle at its right end (inside the
  card — `.card` clips its overflow, so anything hung outside the edge would not be
  drawn). Drag it: a line follows from the row's port; cards of the field's TARGET
  table are outlined, the one under the pointer solidly, and the line goes solid.
  Drop there → `link.add`, one Ctrl+Z. Wrong table, itself, a record already linked,
  or empty canvas → nothing, the line vanishes. Escape cancels. Only from a row you
  can SEE, so the field is never guessed. The server checks endpoints independently
  (`assertLinkEndpointsValid`), so the client rule is the second line of defence.
- **SEE**: arrows are clickable — a fat invisible `.arrow-hit` stroke opts back into
  pointer events on an SVG that otherwise takes none (the canvas beneath must still
  pan). A selected arrow is accent-coloured and LABELLED with its link field's name
  ("Outputs", "Based on"), at the curve's midpoint (`bezierMid`), counter-scaled so
  it reads the same at any zoom, its box sized from the character count.
  An arrow OR cards are selected, never both, so Delete is unambiguous.
- **REMOVE**: right-click an arrow → a menu naming the field and both ends → "Remove
  this link…" → the app's confirm dialog (focus on Cancel). Delete with an arrow
  selected asks the same question; nothing removes a link without asking. Undoable.
  The owner's words: "confusing to be able to add something but not remove it. But
  we have to be careful with the UI."
- A selection does not outlive its link (a peer, or your own Remove, may delete it).
- Red-checked: with the table rule disabled, four tests fail.

### Structured fields: manifests and audio layouts (Sept 21)

From a work order written in another chat (the owner designs his data there) and
reviewed here before building. **A Files record is a DELIVERED UNIT, not one OS
file**: an IMF/DCP folder, an image sequence, a multi-mono 5.1 mix and a single .mov
are each ONE record. Kind-awareness lives only in the desktop drop tool and the
renderer; schema and links stay uniform. The same field type carries audio track
layouts on Deliverables (the spec), Edits (as built) and Files (as probed), so they
can be compared — the first QC primitive.

Built: `sql/012`, `contract/shapes.ts` (the tenth shared contract file),
`StructuredField.vue` → `ManifestView.vue` (read-only: a manifest is written by a
tool) / `AudioLayoutEditor.vue` / a JSON escape hatch that saves only what the
contract accepts; `POST /api/qc/audio-layout-diff`; "Add standard Files fields" in
Table settings; `test/structured.ts` and ~35 checks in `test/grid.ts`.

My amendments to the work order, all accepted: an unknown shape is an ERROR (generic
is spelled `json`); hashes carry their algorithm (`sha256:…` — the hash choice is
still open in the Tauri handoff); member paths are relative to the record's
`file_path`; caps (256 KB, 2,000 members) because tables load whole; cards show the
SUMMARY row only (a full render would break computed card heights — the notes block
could host one later); the diff is a pure contract function with the endpoint as a
thin wrapper for Python; "compare with" is generic over ANY linked record with a
layout (a file targets one deliverable and satisfies another); copy/paste in the
editor (layouts are deliberately not a table — "a copyable value is enough" — so
copying a spec onto an edit must be one gesture; kept in-app because browsers refuse
clipboard access over plain HTTP); the standard-fields action adds only what is
missing, by key. Deferred to the Tauri chat: the drop tool that detects kind and
fills these; ffprobe → audio_layout; the sequence gap checker.

**A real bug found on the way, and a correction to something I told the owner.**
Ctrl+Z had NO inverse for creating a field, a table or a view (nor for table.update).
I had said undo covered "creating and deleting records and tables"; only records was
true. Worse than not-undoable: adding a field is `field.create` + `field.update`
(position), and only the second had an inverse — so Ctrl+Z after adding a field sent
it to position 0, the FIRST column, where it became the PRIMARY field and renamed
every record in the table. Found because the standard-fields test asserted "one
Ctrl+Z" and the fields stayed, re-ordered. Inverses added (`client/history.ts`);
guarded directly (add a field, Ctrl+Z, the first column is still Name) and
red-checked. Also: the layout editor now writes nothing when nothing changed (a name
re-typed as it was) — a no-op mutation is a log row, a broadcast and an undo step
that visibly does nothing.

### Kanban (Sept 22)

The owner: columns by a chosen attribute, LINK fields as valid columns; he floated a
"soft" board (a card in several columns) and/or single-link fields. A first cut did
both — honest multi-column cards with a move/add drag setting — and he pulled it the
same day: **"let's not break things before we build them. let's keep it traditional."**
What stands:
- **A board is a VIEW** (`config.kanban: { fieldId }`), so filters/sort/hidden fields
  and the views dropdown carry over; "+ new board" beside "+ new view". No migration:
  the config key is the kind.
- **Columns only from a single-valued field**: a select, or a link ticked "single".
  Every card in exactly one column; a drag MOVES it (one batch, one Ctrl+Z); drop on
  "(none)" clears. A board whose field loses its tick falls back to the grid.
- **Link fields can be "single"** (`options.single`, beside "membership" in field
  settings): server-refused second link; every client path replaces through ONE
  helper (`client/links.ts`). This is the half of the "soft" idea that survived, and
  it is what makes links usable as columns at all.
- Drag uses the pointer-based drag service (each column a drop target). "+" per column
  creates a record already in it. Cards show the view's shown fields under the
  primary; double-click or ⤢ opens the record.
- Found on the way: "+ new view — starts from this one" copied the board's `kanban`
  key, so a grid made from a board was a board. Fixed; tested.
- NOT seen: any of it — `UI-NOTES`.

### Small annoyances (Sept 22)

- **Compare left the audio-layout cell** (the owner: "I consider it not built yet —
  we will do something on the canvas or in reports; it shouldn't be here").
  `diffLayouts` and `POST /api/qc/audio-layout-diff` stay; only the UI went.
  Validation/compare is now an OPEN DESIGN, to be had with reports or the canvas.
- **Follow a link**: every link and backlink pill (grid and tray) has a ⤢ that opens
  the linked record in the tray. Its space is always reserved and it is revealed on
  hover — nothing shifts.
- **The docked grid is GONE** (the owner: "later on I want a split pane system, but a
  special dock grid doesn't jive"). Removed: the toggle, the side flip, the splitter,
  Ctrl+B, the ◧ in the tree, the "on this canvas" dot and "not on canvas" filter.
  KEPT for split panes, with no UI path and NO test until then: `client/recordDrag.ts`
  and the canvas's multi-record drop (`placeMany`). Row selection in the grid is kept
  and tested. When split panes are designed, start from those.
- **Canvas defaults — built, replacing board inheritance.** The owner found "a board
  inherits from its record's membership links" (Sept 20) inelegant and obtuse: it
  needed a link field on the boards table, ticked membership, filled in on the board's
  record — schema work, invisible on the canvas. His idea: "on a canvas I could
  straight up choose: if a table has this [link], set it to x", usable "for an already
  built project by someone who's not designing this thing." Built:
  - `defaults: [{ tableId, recordId }]` in the canvas's existing settings (NOT a field
    on the boards table — boards are stored exactly as before).
  - A BAR at the top of every canvas: `New records here → [Works Ep 101 ×] [Projects
    Duke ×] + add`, plus the breadcrumb's scope as a chip, so the bar is the whole
    answer. A switch turns the canvas's defaults off — per browser; the list is shared.
  - Set by right-clicking a card ("Link new records here to this") or "+ add" (a table
    that something links to, then a searchable picker). No schema knowledge needed.
  - Which field: the table's only link to that table; else the one ticked membership;
    else AMBIGUOUS → skipped, and the bar says "Files has 2 links to Works" (an admin
    ticks one). Never guessed. `defaultLinkField`, shared and pure.
  - The old mechanism is REMOVED (`boardMemberships`): one mechanism, and it is visible.
  - Found on the way: (1) the bar's setup read the canvas config through a `const`
    helper declared below it — a TDZ error that would have stopped every canvas
    opening; hoisted. (2) `saveCardFields` wrote `config: { cardFields }`, which would
    have WIPED the defaults on any card-field change; both writers now merge. (3)
    `field.create` defaulted position to 0, so an API-created field could tie with and
    alphabetically displace the PRIMARY field; the server (and the client's mirror) now
    append. The third one matters for the desktop tools and any script.

### From `npm run dev` to a real deployment (Sept 20)

Prompted by the desktop-client chat asking "who serves the frontend?" — the owner:
*"I have spent all this time not thinking about it at all. Right now everything is
npm run dev."* Decided: **the server serves the whole frontend, like a real web app;
the desktop window loads it from the server; the desktop's tools do local work and
read/write through the API.** Internal only. Target: `vsrv` (NixOS), which already
runs Caddy for a domain he owns (DNS at Namecheap).

Built and tested (`test/prod.ts`, `npm run test:prod`):
- `server/web.ts`: one process serves `dist/` and the API. Hashed assets immutable;
  `index.html` never cached (it names the current build); a missing asset is a 404,
  not the app's HTML handed to a `<script>` tag.
- **Loopback by default** (`HOST`). The auth code trusts three proxy headers; that is
  only sound if the proxy is the only way in. The other chat's advice was good and
  missed this.
- A **CSP** set by the app (not the Caddyfile: versioned and tested with it), with
  Tauri's IPC schemes allowed and a DO-NOT-REMOVE comment.
- `version` in `/api/health`. Production refuses to start with sign-in off, or with
  no `dist/`.
- `npm start` (plain `tsx`, no watch — `tsx` moved to runtime dependencies; a second
  build config to keep in step buys nothing at this scale). `npm run migrate`
  (`server/migrateCli.ts`): the same `sql/` files and `_migrations` table as `db.sh`,
  but against `DB_URL` and one transaction per file — `db.sh` and `backup.sh` were
  hard-wired to the private dev cluster. `backup.sh dump` now honours `DB_URL`.

Written but NOT verifiable here — `DEPLOY.md`: NixOS Postgres / systemd / Caddy /
backup timer, the Namecheap record step by step, and three certificate paths
(A: vsrv's Caddy is already public → same mechanism, site restricted to LAN source
addresses; B: DNS-01 — Namecheap's API needs 20 domains or $50 balance/spend and a
whitelisted IPv4; C: Caddy's internal CA). Which path depends on how vsrv's Caddy
gets certificates today — asked, not yet answered.

### The owner's data model, and "a new record inherits its context" (Sept 20)

**His schema for deliverables** — arrived at by asking "what questions do I want
answered?" (Did we satisfy every deliverable of this work? Which files were
delivered? Delivered vs scoped in the bid?):
- **Works** (an episode, a feature, a trailer): a Project link.
- **Deliverables**: the shared catalogue ("ProRes 4444 texted", "DCP 2K Flat").
  A Work links to the deliverables wanted of it; ep 101 also links the DCP, ep 106
  the sister-network version.
- **Files** carry a Project link, a Work link, and — only when the file IS a
  deliverable — a Deliverable link. THE FILE IS THE EVIDENCE: a file with both
  links says "this satisfied that, for this episode".
- I had proposed a line-item table (one row per work × deliverable). He pushed back,
  rightly: entry cost is paid every day, and his model needs nothing entered up
  front. What it gives up (facts about a pair BEFORE a file exists) is mostly
  recovered with the app's own idiom — ROLES ARE LINK FIELDS: Work gets
  "Deliverables (bid)" and "Deliverables (added)"; overages are the second field.
  Rule to keep: a file with a Deliverable link belongs to exactly ONE work.
  Line items can be generated from these links later if per-pair due dates or
  sign-off are ever needed. A **DeliveryPacket** table (an event: files, recipient,
  method, date) is under consideration and complements this.
- **REPORTS are their own project** (his call: "reports are how I want to get data
  out of this system"). His first report — works › each work's EXPECTED
  deliverables › the files, with empty deliverables showing — is a three-way join
  that plain grouping cannot do (a deliverable with no files has no rows). Counts
  and rollup fields belong to that project too. Not built; not to be crept into.
- **No nested scope** (his call). What replaced the wish for it is below.
- A local LLM to turn pasted text into field values was discussed and TABLED. The
  shape that fits: schema → JSON schema → constrained output → validated by
  `contract/values.ts` → shown as a reviewable, undoable proposal; mentions of
  records resolved by the app's search, never by the model. Never auto-write.

**One principle, built: a new record inherits the context it is created in.**
All through ONE function, `createRecord` in `client/scope.ts`, in the same
synchronous run as the create (one Ctrl+Z):
- **SCOPE** — already built: inside a project, it joins the project.
- **GROUP** — new. Views gained `groupBy` (≤ 2 levels; `contract/views.ts`:
  `groupRows`, shared and pure). The grid draws a header per group — field, value,
  COUNT, fold, "+" — at the same height as a row, so windowing is unchanged; arrow
  keys step over headers. "+" on a header creates a record WITH that group's value:
  the select choice, the checkbox state, or links to the group's records, for every
  level above it. A multi-valued field groups by the COMBINATION ("Ep 101, Ep 102"),
  Airtable's rule: a record is never in the grid twice. Empty group last. Choosing a
  level does not group by anything until a field is picked.
- **BOARD** — new, and with NO new setting. A canvas is a record (010), so: a record
  created on a board joins whatever the board belongs to — for each MEMBERSHIP link
  on the board's record (to table T), a link through the new record's own membership
  field to T, if it has one. Give Boards a Work membership link, set it on the
  Episode 101 board, and files made there are Episode 101 files. The same explicit
  flag scope uses, so the field is never guessed. (A table may have one membership
  link per TARGET table, so Files → Projects and Files → Works coexist.)

**A real bug found on the way — last write did not win ON SCREEN.** The store
skipped its own echoed mutations. If a colleague's write COMMITTED just before
yours but REACHED you just after, their event overwrote your optimistic value and
your echo — the one event that would have restored it — was ignored: the database
held your value, your screen showed theirs, until a reload. Any last-write-wins
value: a cell, a view's config, a section's table list. It had shown up once as a
"flaky" sections test, which I wrongly waved through. Fixed the standard way:
events are applied in log order (own echoes included — every mutation is
idempotent), then everything of ours the log has not confirmed (`unechoed`) is
re-applied on top. `test/store.ts` B8 was written first and failed first.
Knock-on: the rich text editor compared documents as JSON strings, and Postgres
returns jsonb with keys re-ordered — an identical note looked changed the moment it
came back through the stream. It compares canonically now.
Also: a UI suite that THROWS used to print "N passed, 0 failed" and look green;
it now prints SUITE ABORTED.

### Authentication (Sept 20) — the owner paused the UI work for this, rightly

"I feel like I'm making a mistake leaving out authentication and users." The
choice he posed — a simple gate, or real users — was not really a choice: users,
roles, role enforcement and an actor on every logged mutation had existed since
001; only IDENTITY was fake ("the first admin"). A gate would have protected the
door and left the log saying nothing. Built: real identity, conventional parts
only (his instruction: rely on well-tested libraries and conventions).
- `sql/011`, `server/auth.ts` (one `authenticate()`; scrypt from Node core;
  hashed session tokens; conditional `Secure`; Origin check; login back-off;
  equal-time unknown users), `server/userCli.ts` + `scripts/user.sh` (the FIRST
  admin is made at a terminal — no open set-up page to race for), user endpoints
  that are deliberately NOT mutations.
- Client: `LoginPage.vue`; `store.auth/me/login/logout/call`; Settings grew "You"
  (change password, sign out) and, for admins, "Users". History shows who.
- **Two bugs the tests found, both of which would have bitten on day one:**
  (1) after signing in, NOTHING LOADED — signing in unmounts the login screen in
  the same tick, and Vue drops events from unmounted components, so "signed-in"
  never arrived; entry is now driven by a watch on the auth state. (2) a **401
  used to DROP your queued edits** (the store treats 4xx as "the server rejected
  the content"); a session expiring mid-work would have silently lost work. 401 now
  puts the batch back, shows the login screen saying "N unsaved changes are
  waiting", and signing in sends them (`start()` had to learn to flush what was
  already queued).
- Also removed: wildcard CORS, a leftover from before the dev proxy.
- NOT built, on purpose: per-section / per-table permissions (identity first; that
  is its own design, server-enforced — sections are navigation, not security);
  2FA; a read-only UI for viewers (the server refuses their writes; the client
  still offers the controls, then rolls back with an error — worth a pass);
  password reset by email.
- Existing suites run with `AUTH_DISABLED=1` (the harness sets it); `test/auth.ts`
  boots a server with sign-in ON and attacks it.

**Linking from the canvas — this REVERSES a recorded decision.** Earlier: "an
arrow from a link field is never created by a canvas gesture" (rejecting
ctrl-drag-card-onto-card, which guessed the field and fell back to a drawn arrow).
The owner now wants, and I agree with, a narrower thing: drag from a VISIBLE link
field's port (so the field is never guessed) onto a card of the link's target
table (validated; anything else does nothing). Removal must exist too — "confusing
to be able to add but not remove" — and carefully: select the arrow, right-click,
Delete, confirm. A selected arrow shows its link field's name ("outputs",
"based on"). Step 5.

### Step 1 — record panel and canvas basics (done)

- **`RecordPanel.vue`**: every field of one record in a side panel, with the
  grid's own editors (`CellEditor`, `LinkPicker`), so a value is edited one way
  everywhere. From the grid: Space, or ⤢ by the row number. From the canvas:
  double-click, Enter, or automatically after creating a card. It is a panel,
  not a modal — click another row or card and it follows. Opening from the canvas
  walks the record's table first: a scene only carries links with BOTH ends on
  the canvas, so without that a record's link fields looked empty.
  `long_text` is multi-line here (Enter = newline, Ctrl+Enter commits).
- **Canvas:** double-click empty space creates a record + placement in one flush
  and opens the panel on its name. With several tables it asks which — once;
  after that it assumes the same table (Alt+double-click to be asked). Cards are
  titled by the primary field, fold (per placement), and show link and lookup
  values. Right-click menus on cards and on the canvas.
- **Which fields a card shows is per canvas, per table** — `canvases.config`
  (`005_canvas_config.sql`, `contract/canvasConfig.ts`, a new `config` key on
  `canvas.update`). Default: the first five fields minus the primary.
- **Card height is arithmetic** (`canvas/cardLayout.ts`): arrows attach to a
  computed edge, so every card row is one fixed-height line. RecordCard takes its
  metrics from that file; if a row is ever allowed to wrap, arrows will miss.
- **Relational arrow visibility**: all / selected / off, in the canvas controls.

Found on the way:
- **My menu helper closed the menu and THEN ran an action that read it** — every
  menu item was a no-op. Caught by the UI suite on its first run.
- **Every new canvas was half-initialised (pre-existing).** Opening a canvas
  fetches its scene; one you just created is not on the server yet, so that was a
  404 — thrown inside `onMounted`, skipping fit-to-view and keyboard focus. No
  banner; Space/F/Delete were simply dead until you clicked. My first TWO tests
  for the fix passed with the fix removed (wrong symptom each time). Only
  reverting the fix showed that. Third time: assert on focus.

**Reported from first use of step 1, all fixed:**

- *Toggling card fields filled the banner with `500 internal error`, retrying
  forever.* Migration 005 had not been applied — and the app hid that three ways.
  (1) **The server never noticed it was ahead of the database.** Now
  `server/migrations.ts` compares `sql/` with `_migrations` and, while anything is
  pending, answers every API call with a **503 naming the files and the command**;
  it re-checks every 2 s, so running `db.sh migrate` fixes it with no restart.
  (2) **The 500 said only "internal error"** — it now carries the database's
  message as `detail`. (3) **The client added a banner line per retry**; now one
  line, rewritten in place, saying how many changes are queued and that none are
  lost, cleared on success. Verified end to end: un-migrated database → one clear
  line, change held → migrate → queue drains, banner clears. `npm run dev` also
  applies pending migrations at start now (they only ever add; a deploy should
  still run `db.sh migrate` deliberately).
  Why it LOOKED fine until then: extracting new code under a running `npm run
  dev` restarts the server but hot-swaps the client without re-hydrating, so the
  canvas already in memory kept working until the first write to the new column.
- *"Unplace and other canvas movement need undo."* **Ctrl+Z / Ctrl+Shift+Z,
  app-wide** (`client/history.ts`, stacks in `store.ts`, ↶ ↷ in the header). The
  undo TAB only ever covered deletes, because only deletes need the server to
  capture anything; every other change can be inverted by the client, which is
  looking at the previous state when it makes the change. Covers move, resize,
  fold, place/unplace (position, size AND fold come back), cell edits, links,
  card-field and view settings, field rename/reorder; undoing a create deletes;
  undoing a DELETE asks the server to restore it, so Ctrl+Z works across both
  kinds. One synchronous run of mutations = one step (creating a card is two
  mutations, one Ctrl+Z). Left to the browser while typing in a field.
  Session-local, and last-write-wins against peers — stated in the file header.
  **The trap, caught by checking rather than by testing:** drags and resizes write
  local state every frame and emit one mutation on drop, so at emit time state
  already held the DESTINATION and the inverse would have been a no-op. Each
  gesture now restores its starting values just before emitting. Reverting that
  one line turns exactly one UI test red.
  Not covered: redo of an undone delete; camera moves (deliberately).
- *The ⤢ on hover made rows jitter* — it swapped `display` with the row number,
  re-measuring the cell. Now absolutely positioned over a fixed-width cell.
- *"(3)" after the canvas name* was its card count. Now " · 3 cards", and nothing
  at all for a canvas not opened this session (the count is only known then).

- *Ctrl-C printed "[tsx] Previous process hasn't exited yet. Force killing..."
  three times.* tsx prints that per EXTRA signal while stopping its child, and it
  was getting four: the terminal's SIGINT to the whole foreground group, npm
  forwarding it, `kill 0` from dev.sh's trap, npm forwarding that. `dev.sh` now
  runs the binaries directly (no npm wrapper), each in its own session (`setsid`)
  so Ctrl-C reaches only the script, which sends each child ONE SIGTERM and waits;
  the server has a real SIGTERM handler (close the pool, exit; SSE streams are not
  waited for — they never end). 205 ms, nothing left, no complaints. Tested with
  SIGTERM: a backgrounded test script inherits SIGINT as ignored and bash cannot
  trap that, so the literal Ctrl-C is the one path only a real terminal exercises.

**Assets will live beside the database data** (owner's call) — a sibling of the
Postgres data directory, overridable by environment variable.

Not done here: editing a value directly ON a card (it opens the panel instead),
and dragging existing records in from anywhere but the tray.

## Open decisions

Not bugs — things that need a call before they become user-visible.

- ~~**Field value types.**~~ *Resolved in phase 3:* `contract/values.ts`,
  enforced on both sides, write-time only — existing rows untouched, by explicit
  decision (no meaningful data yet).
- **`resolveLookup` in `reads.ts` is dead code.** Lookups are computed on the
  client now. Delete it, or keep it as the seed of a server-side version if a
  table ever outgrows whole-table loading — but decide, rather than let it rot.
- **`seq` is assigned at INSERT, not COMMIT.** Under heavy concurrency a reader
  could observe a gap. At 3–10 users this is vanishingly unlikely and
  last-write-wins tolerates reordering; the cheap fix if it ever matters is a
  transaction-scoped advisory lock in the apply path. Noted in
  `002_mutation_log.sql`.
- **Log retention — now a three-way decision.** The log grows without bound.
  Pruning is safe for catch-up (clients further behind get a `resync`), but it
  also breaks idempotency for any pruned mutation id — the dedup check is
  `select 1 from mutations where id = $1` and the row is gone — and it throws away
  undo capacity. So three windows are actually one number:
  how far behind a client may be and still replay; how long an offline queue may
  hold unsent mutations; how far back you can undo. Nothing enforces this. Decide
  it deliberately rather than discover it.
- ~~**`field.delete` leaves orphaned keys in `records.data`.**~~ *Resolved:*
  the delete now strips its key in the same transaction, the stripped values are
  captured as `record_values`, and restore merges them back under three guards
  (record exists / a field with that key exists / key still absent). "Field
  deletion loses no data" stayed true; the unwritable-key state is gone. The
  capture invariant in `capture.ts` gained a sibling: a mutation that MODIFIES
  rows destructively (not only one that deletes them) also needs its capture.
- **`required` is stored and never enforced.** `values.ts` says so in a comment;
  nothing else does. Either enforce it on create/unset or drop the column.
- **Records page size.** The walk is ~100 requests for 50k rows because pages
  clamp at 500. Raising the clamp for cursor walks is an easy 3–4× if load time
  ever annoys; left alone because the bound was put there deliberately.
- **Filters are AND-only.** OR needs a tree and a tree editor. If it arrives,
  `ViewConfig` should grow a version field in the same change.
- **`npm audit` flags `hono` (moderate) and a transitive `nanoid` (high).** Both
  predate the UI-suite dependencies and both have non-breaking fixes
  (`npm audit fix`). None of the hono advisories touch a feature this server
  uses except the CORS one, and CORS is dev-only here — but bump before this is
  reachable by anyone else.
- **Single-process fan-out.** Correct for one server. More than one instance
  means switching to Postgres `LISTEN`/`NOTIFY`; the wire format does not change,
  so clients won't notice.
