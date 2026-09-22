# spatialdb

A small relational database whose second view is a **manual canvas**: records
from different tables, placed by hand, in space.

## Getting started

```bash
nix develop        # postgres + node on PATH, env configured
npm install        # first time only
db.sh start        # cluster + database + migrations
db.sh seed         # the worked example (3 tables, 1 canvas)
npm run dev        # api :8787  +  client :5173
```

Open <http://localhost:5173>. **Open it twice** — each tab is its own client, so
you can watch one tab's writes arrive in the other over the stream while each
ignores the echo of its own.

Without Nix: install PostgreSQL 16 and Node 22 yourself, then
`export DB_URL="$(./scripts/db.sh url)"` and use the same commands. The flake
only supplies the toolchain — all behaviour lives in `scripts/db.sh`.

## Documents

| | |
|---|---|
| `API.md` | the wire contract — what any client talks to |
| `PLAN.md` | decisions and their reasons, in the order they were made |
| `UI-NOTES.md` | what has been built but never SEEN, and a checking order |
| `DEPLOY.md` | from `npm run dev` to a real LAN service: system Postgres, Caddy, HTTPS, NixOS |
| `TAURI-HANDOFF.md` | for the session that builds the desktop client and its tools |
| `COMPARE-BRIEF.md` | the comparison engine, designed and not built: rules on the link field, seeding, the deliverables chain |
| `REPORTS-BRIEF.md` | for the session that designs reports |

## Signing in

Since migration 011 the app needs you to sign in. **Create the first admin at a
terminal** (there is deliberately no set-up page):

```bash
./scripts/user.sh add you@example.com "Your Name" admin     # asks for a password, without echo
./scripts/user.sh passwd you@example.com                    # reset one
./scripts/user.sh list
```

Everyone else is added from **Settings → Users** (bottom of the tree) by an admin.
`AUTH_DISABLED=1 npm run dev` turns sign-in off — development only; the server says
so loudly. See API.md for what signing in does and does **not** make safe.

## Layout

```
PLAN.md                phases, status, open decisions
UI-NOTES.md            first-impression UI notes, triaged: bug / friction / polish
flake.nix              dev toolchain (thin — logic lives in scripts/)
scripts/db.sh          postgres lifecycle: start/stop/reset/migrate/bootstrap/seed/psql
scripts/backup.sh      pg_dump + uploaded-files mirror, rotation, verify, restore, cron self-check
sql/                   migrations, applied in filename order
  001_schema.sql         core tables
  002_mutation_log.sql   idempotency + catch-up + audit
  003_undo.sql           delete capture, so undo needs no tombstones
  004_record_order.sql   creation order is total, even within one batch
  005_canvas_config.sql  per-canvas card settings
  006_assets.sql         index of uploaded files (the bytes live in .pg/assets)
  012_structured.sql     the `structured` field type (manifests, audio layouts)
  011_auth.sql           passwords and sessions (users and roles existed since 001)
  010_boards.sql         a canvas IS a record: tables.kind, canvases = board state
  009_sections.sql       sections — the home page's navigation
  008_rich_text_attachments.sql  the `rich_text` and `attachment` field types
  007_backlinks_and_search.sql  the `backlink` field type; trigram search index
  900_example.sql        the worked example (not a migration; run via `db.sh seed`)
src/
  contract/mutations.ts  ★ THE write surface — imported by client AND server
  contract/events.ts     ★ THE stream surface — same deal, for reads
  contract/values.ts     ★ field value rules — cell editor AND server apply
  contract/views.ts      ★ saved-view config + applyView, the grid's sort/filter
  contract/labels.ts     ★ what a record is CALLED — the primary-field rule
  contract/lookups.ts    ★ lookup fields — config rule (both sides) + value computation
  contract/canvasConfig.ts ★ which fields a canvas's cards show
  contract/backlinks.ts  ★ backlink fields — the other end of a link
  contract/arrows.ts     ★ a link field's arrow colour and direction
  contract/shapes.ts     ★ structured values: shapes, summaries, layout operations, the layout diff
  contract/scope.ts      ★ scope: the membership flag and "is this record in scope"
  contract/richtext.ts   ★ rich text + attachment values: refer to files, never contain them
  contract/values.ts     ★ what a VALUE may be, per field type — same deal again
  server/
    apply.ts             the only code that writes
    capture.ts           what a destructive mutation is about to destroy
    reads.ts             schema / scene / grid / lookup loaders
    index.ts             HTTP + SSE
  client/
    state.ts             local state + the ONE idempotent apply function
    derived.ts           links, lookups, backlinks as values — ONE link index and label rule
    fuzzy.ts             the palette's table matching and `table:text` parsing
    dialogs.ts           ask() / confirmDialog() — async, styled, queued
    scope.ts             the current scope — filter, auto-link on create, search ranking
    router.ts            hash routes: a place, a table, a record all have an address
    richtext/            TipTap extension list (asset-backed images) and paste handling
    recordDrag.ts        dragging records onto something — one service, any source
    history.ts           Ctrl+Z: the inverse of a mutation, computed client-side
    schemaActions.ts     every schema operation + validation, shared by both schema UIs
    store.ts             optimistic writes, queue, flush, stream consumption
    canvas/
      geometry.ts        pure maths: anchors, bezier routing, fit, zoom
      useViewport.ts     pan/zoom (ported from viznotes useCanvas)
      useCardDrag.ts     drag N cards -> ONE placement.move on drop
      useCardResize.ts   resize + rubber-band selection
    components/
      CanvasView.vue     the canvas, tray, controls
      RecordCard.vue     one placed record
      ArrowLayer.vue     links rendered as arrows
      GridView.vue       the grid: views, sort, filter, windowed rows
      NavTree.vue / NavContents.vue   the left tray: sections › scopes › Tables / Canvases
      SettingsDialog.vue app-wide settings; History (restore deletes) lives here
      TableSettings.vue  a table's name, look, and deletion (⚙ in the tree)
      DialogHost.vue     the app's own prompt/confirm (client/dialogs.ts)
      HomePage.vue / SectionSettings.vue   the front door: sections, and what is in each
      CommandPalette.vue Ctrl+K — find any record anywhere; place it on a canvas
      RichTextEditor.vue / RichTextView.vue   a note, written and read (TipTap, loaded on demand)
      AttachmentField.vue files on a record
      KanbanView.vue      a view whose body is columns of cards
      StructuredField.vue / ManifestView.vue / AudioLayoutEditor.vue   structured values in the tray
      RecordPanel.vue    one record, every field, editable — opened by grid AND canvas
      CellEditor.vue     the editor for ONE cell, mounted only while editing
      LinkPicker.vue     searchable picker for link cells
      FieldForm.vue      add a field (the grid's "+" column header)
      FieldSettings.vue  edit a field (⚙ on a column header)
      Popover.vue        anchored panel for the grid's header menus
      CellEditor.vue     one grid cell, edited the way its field type wants
    App.vue              shell: canvas / table / schema / undo
test/harness.ts        spawns and RELIABLY kills the server for the suites
test/e2e.ts            apply-layer suite against a real database
test/store.ts          client store: idempotency + two-client convergence
test/undo.ts           capture, cascades, FK safety, role gating
test/canvas.ts         geometry + placement mutations through a real server
test/stream.ts         HTTP + SSE suite against a real server
test/grid.ts           view semantics, keyset paging, whole-table walk, saved views
test/assets.ts         upload, identity, serving, limits — real files in a temp dir
test/sections.ts       routes, section mutations, home → section → pickers, deep links
test/scope.ts          the membership rule, the server's part, and scope in the app
test/uiHarness.ts      mounts the app headlessly for UI suites
test/ui.ts             the real App in a simulated DOM, driven by clicks, from an EMPTY db
```

The three `contract/` files are the important ones, and for the same reason:
each is imported by client AND server, so neither side can drift from the other.
`mutations.ts` defines every legal write; `events.ts` defines every event that
comes back; `values.ts` defines what a value may be for its field's type, so the
cell that refuses "banana" and the server that would reject it are running the
same function. The stream format got out of step precisely because the second
file did not exist yet — the live broadcast and the catch-up replay each
invented their own shape. See PLAN.md.

## Everyday commands

| | |
|---|---|
| `db.sh start` | postgres up, database created, migrations applied |
| `db.sh stop` | shut it down |
| `db.sh reset` | drop and rebuild from migrations |
| `db.sh psql` | SQL shell |
| `db.sh url` | connection string |
| `npm run dev` | api + client via `scripts/dev.sh`; Ctrl-C stops BOTH, and it refuses to start if port 8787 is taken |
| `npm test` | all fourteen suites (against an isolated `spatialdb_test`) |
| `npm run test:e2e` | apply layer only (no server needed) |
| `npm run test:store` | client store + two-client convergence |
| `npm run test:undo` | delete capture and undo |
| `npm run test:canvas` | canvas geometry + placement round-trip |
| `npm run test:stream` | stream contract over HTTP (boots its own server) |
| `npm run test:grid` | sort/filter semantics, paging, table walk, views |
| `npm run test:assets` | the asset store: upload, dedupe, serving, limits |
| `npm run test:sections` | sections, home page, addresses |
| `npm run test:scope` | scope |
| `npm run build` / `npm start` | build the frontend into `dist/`; run ONE production process serving it and the API (DEPLOY.md) |
| `./scripts/deploy.sh` | update a running deployment: back up, pull, install, build, stop, migrate, start, check (DEPLOY.md §8) |
| `npm run migrate` | apply pending migrations to the database named by `DB_URL` (a real deployment; `db.sh migrate` is the dev cluster's) |
| `npm run test:structured` | structured fields in the app: layout editor, compare, manifests, standard Files fields |
| `npm run test:kanban` | the board: columns by select and link, move/add, single links |
| `npm run test:prod` | the server as deployed: built frontend, cache headers, CSP, loopback bind |
| `npm run test:auth` | signing in, sessions, roles, users — against a server with sign-in ON |
| `npm run test:ui` | mounts the app headlessly and clicks through it (happy-dom; no layout or paint) |
| `npm run typecheck` | `tsc` (server) + `vue-tsc` (client) |
| `npm run backup` | timestamped dump + prune |

**Tests never touch the dev database.** `npm test` recreates `spatialdb_test` from
migrations first. They used to share, and they are not polite guests: one run
turned a freshly seeded database of 1 canvas into 902, most of it log padding from
the stream suite. Cleanup-after-yourself was the tempting fix and is the wrong one
— a suite that fails partway skips its cleanup, which is exactly when you least
want your dev data disturbed. `./scripts/db.sh testdb` provisions it by hand.

The cluster's **data** lives in `.pg/` — delete it to start completely fresh.
Nothing is installed system-wide, and it can't collide with a Postgres you
already run because the dev cluster is **socket-only** (no TCP port).

The **socket** deliberately lives outside the project, under
`$XDG_RUNTIME_DIR/spatialdb-<hash-of-path>`. `nix develop` copies the flake's
source tree into the Nix store, and the store cannot hold a Unix socket:

```
error: file '.../.pg/socket/.s.PGSQL.5432' has an unsupported type
```

A running database inside the tree would make the project impossible to enter.
`db.sh status` prints both paths if you need them.

**Run `git init` early.** Without it Nix treats this as a `path:` flake and
copies the *entire* directory into the store on every enter — including
`.pg/data`. As a git repo it honours `.gitignore` instead, which is both much
faster and much safer.

## Notes for later

- **TypeScript is pinned to 5.x on purpose.** TS 7 (the Go rewrite) removed
  `typescript/lib/tsc`, which `vue-tsc` still depends on. Unpin once the Vue
  toolchain supports it.
- **`fsync` is off** in the dev cluster — fine for a throwaway database, never
  for anything you care about.
- **Auth is a stub.** `currentActor()` in `src/server/index.ts` resolves to the
  first admin user. Replace with a real session before this is reachable by
  anyone but you.

  A consequence worth knowing: a database with **no users accepts no writes**,
  while reads keep working — so an unconfigured database looks like a
  half-broken one. `./scripts/db.sh bootstrap` creates the user and nothing else;
  `seed` does that plus the worked example. Writes attempted before bootstrap
  return **503** with the command to run, and the client retries them, so nothing
  typed into the app while unconfigured is lost.

  `reset && bootstrap` gets you a working, genuinely empty database. Tables and
  fields are created from the **schema** tab (phase 3); `seed` remains the
  fastest way to get the worked example.
- **The nightly backup is not installed for you, and printing the line is not
  installing it.** `./scripts/backup.sh cron` PRINTS a crontab line; you then
  paste it with `crontab -e`, and — this is the part that matters —
  **run `./scripts/backup.sh check`**, which re-runs the dump under a stripped,
  cron-like environment and tells you whether the scheduled job would actually
  have worked. Three separate things made the naive crontab line fail silently
  every night: `XDG_RUNTIME_DIR` is unset under cron so the socket path resolved
  somewhere Postgres wasn't listening; `PATH` is minimal so a Nix-provided
  `pg_dump` isn't found; and a `>> logfile` redirect in the crontab line is
  evaluated *before* the script runs, so a missing directory killed the job and
  the log that would have told you. `check` catches all three. This matters more than it looks:
  `001_schema.sql` skips soft deletes on the stated assumption that dumps exist,
  so until the job is installed there is no undo at any level — deletes cascade,
  nothing is tombstoned, and the mutation log records that a delete happened
  without retaining what was deleted. Verify restores occasionally too:
  `backup.sh verify <file>` reads the archive, and `backup.sh restore <file>`
  is the real thing.
- **Realtime fan-out is in-process**, which is correct for one server. If it
  ever runs more than one instance, switch to Postgres `LISTEN`/`NOTIFY` — the
  wire format doesn't change, so clients won't notice.
