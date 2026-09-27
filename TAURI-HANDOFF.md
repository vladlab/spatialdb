# Handoff: the desktop client (Tauri) and its tools

For a new session that will build spatialdb's desktop client. Written at the end of
the long session that built the server and the web app, by the assistant that built
them, for an assistant (or person) who was not there.

**Read in this order:** this file → `API.md` (the wire contract — what the client
talks to) → `README.md` (layout, commands) → the parts of `PLAN.md` named below.
`PLAN.md` is organised by history, not by what you need; do not read it end to end.

**Source of truth:** <https://github.com/vladlab/spatialdb> — `main`. Start every
session from the repo, not from a tarball or from anyone's memory of the code.

---

## 1. What is being built

The owner (Vladimir — a colorist running a small film/TV post house, 3–10 people,
NixOS, strong sysadmin and Resolve-scripting background) wants a desktop app that
**connects to the spatialdb server and adds TOOLS that need a real machine**:

| Tool | What it does | Kind |
|---|---|---|
| **File drop** | Drop files onto a table or canvas → records, with path, size, hash, and ffprobe/ffmpeg data filled in; later waveform / QC images as attachments | ingest |
| **Resolve timeline reader** | Python, via Resolve's scripting API: read a timeline and populate edit records, linked to the file records they use | ingest |
| **QC** | Read a record's file, write results and images back onto it | enrich |
| *(open a file)* | Launch the file a record points at, from the record | action |

His words: *"an app that connects to the server, and then has several tools that the
server is aware of… it should know that there's such a tool as file drop. We can then
enable its use on a specific table."*

**Decided:**
- It is **the existing Vue web app in a native window, plus the tools** — not a
  separate small utility. Dropping a file onto a table means seeing the table.
- **One repo.** `src-tauri/` beside what exists (Tauri's convention, and the layout of
  the owner's own *viznotes*: Vue 3 + Tauri 2 + Rust — lean on his patterns).
- **Branches, not repos:** this work on a `tauri` branch; UI fixes continue on `main`
  from another chat. Overlap should be tiny (`src-tauri/` is new; UI fixes are Vue).
  **When the client needs a SERVER change, make it deliberately, in one commit, and
  merge it across — never as a side effect of client work.**

## 2. DECIDED: the window loads the app FROM THE SERVER (option A)

The owner settled this on Sept 20: *"the server should be a full server of frontend,
the app should load its frontend from the server, and the things in the app will be
tools that do local work, and then read/write from our db via api."* The server side
of that is built — see `DEPLOY.md` and `src/server/web.ts`: one process serves the
built frontend and the API, `/api/health` reports a `version`, and the
Content-Security-Policy already allows Tauri's IPC (`connect-src … ipc:
http://ipc.localhost` — it carries a DO-NOT-REMOVE comment and a test). Option B is
kept below only to record why it was not chosen.

**The question was: does the Tauri window load the app from the server, or bundle its own copy?**

**A. Load from the server** (the window points at `https://spatialdb.lan/`; native
capabilities are exposed to that origin through Tauri's remote-domain capability
scope).
- Same origin as today → **the session cookie just works**, including for `<img>`
  tags (see the asset problem below). No CORS, no bearer plumbing.
- The client is ALWAYS the server's matching version → the version-skew problem
  largely disappears. One deploy updates everyone.
- Costs: IPC must be explicitly allowed for a remote origin (get the capability scope
  exactly right — this is the security boundary; allow ONE configured origin, never a
  wildcard); the app cannot open without the server (acceptable: it is a client of a
  LAN database); the server address must be configurable on first run.

**B. Bundle the frontend** (`tauri://localhost` origin talks to the server cross-origin).
- Works offline-ish (the store already queues writes and retries).
- Costs, all real:
  - **Cookies will not flow**: `SameSite=Lax` cookies are not sent on cross-site
    `fetch` POSTs. The login response already returns a bearer `token` for this case
    and `authenticate()` accepts `Authorization: Bearer` — but `src/client/store.ts`
    does **not** send that header yet. Every `fetch` in it (and the stream, and
    uploads) would need it.
  - **Images break**: notes and attachments render `<img src="/api/assets/:id">`, and
    an `<img>` tag cannot send an Authorization header. Assets require auth. You would
    need signed short-lived asset URLs, or a Tauri custom protocol that proxies them.
  - The Tauri origin must be listed in `CORS_ORIGINS` (it doubles as the CSRF
    allow-list — see `crossOrigin()` in `src/server/auth.ts`), and differs by
    platform (`tauri://localhost` vs `http://tauri.localhost` on Windows).
  - Desktop apps update on their own schedule → you need the version handshake (§6).

**Chosen: A.** For a LAN tool administered by one person, it removes three hard
problems (auth, images, versioning) in exchange for one careful piece of config: the
Tauri capability that allows native calls from EXACTLY ONE origin — the deployed
HTTPS name (`DEPLOY.md` step 2). That name is the security boundary.

## 3. The tools concept — principles to hold

These were agreed with the owner. Treat them as constraints, not suggestions.

1. **The server KNOWS about tools; it never RUNS them, and never sends anything to
   execute.** The set of tools is compiled into the client. The server's only role is
   "File drop is enabled on table *Files*, with this field mapping". No commands, no
   scripts, no arguments for ffmpeg or Python ever come from the server — otherwise
   anyone who compromises the server runs code on every workstation.
2. **Tools write ORDINARY MUTATIONS.** `record.create`, `record.update`, `link.add`,
   and the asset store for images — the same `POST /api/mutate` batches the web app
   sends. No special write path. That is what makes undo, the live stream, History,
   scope and validation work for tool-created data for free — and it means a plain
   script with a login token can do the same job (the Resolve reader could start life
   as exactly that).
3. **Tool-created records inherit context like any other.** Go through
   `createRecord` in `src/client/scope.ts`: a file dropped while scoped to a project
   joins the project; dropped on the Episode 101 board, it joins Episode 101
   (PLAN.md: "a new record inherits the context it is created in").
4. **Slow work fills in afterwards.** Hashing 200 GB or probing a file takes minutes.
   The record appears at once (path, size); hash, duration, codec, waveform arrive as
   they finish, each as its own small `record.update`. Show progress in the client;
   never block the drop.
5. **Two kinds of tool, one mapping idea.** INGEST tools create records from outside
   (files, a timeline). ENRICH tools add to a record that exists (QC). Both declare
   the OUTPUTS they produce (name + value type); the owner maps outputs → fields.
6. **Provenance.** Tag tool-written batches so History can say "via File drop". The
   mutation log has `actor_id` and `client_id` today; a `via` tag is NOT built (§6).

## 4. What already exists that you will use

- **The mutation contract** — `src/contract/mutations.ts` (strict: unknown keys are a
  400). Shared by server and client; import it, do not re-describe it.
- **Value rules** — `src/contract/values.ts`: what each field type accepts. A tool's
  output must pass these or the batch is refused whole. Notably `file_path` (a path
  string — see §5 on what that string should be), `number`, `select` (must be one of
  the field's choices), `date`, `attachment` (asset ids), `rich_text`.
- **The asset store** — `POST /api/assets?name=` (raw body) → `{ id, sha256, mime,
  bytes, width, height }`; content-addressed, deduplicated. **PNG/JPEG/GIF/WebP/PDF
  only, 500 MB cap.** Waveform and QC images fit; MEDIA FILES DO NOT BELONG HERE — a
  record points at media by path. An `attachment` value is a list of asset ids and
  every id must exist (upload first, then write the value).
- **Search** — `GET /api/search` (all-terms + pg_trgm typo fallback, table-scoped):
  what the client should use to find "the record this file already is".
- **The store** — `src/client/store.ts`: optimistic queue, idempotency keys, retry,
  stream with manual reconnect. It uses `fetch` + `ReadableStream` rather than
  `EventSource` specifically so it runs unchanged in Node and Tauri. It takes a
  `baseUrl`. A 401 keeps queued edits and shows the login screen.
- **The drag service** — `src/client/recordDrag.ts`: `beginRecordDrag` /
  `registerDropTarget`. Built with this client in mind: the canvas and (soon) the grid
  are drop targets; a native file drop should end in the same place. It uses POINTER
  events on purpose — **Tauri's native file-drop handler claims the webview's HTML5
  drop events**, so the app never depended on them. Use Tauri's drag-drop event for
  files, then hand the result to the same targets.
- **Auth** — `src/server/auth.ts`, `API.md` "Signing in". Bearer tokens work
  server-side today. Roles: admin (schema, sections, users), editor (data), viewer.
- **Migration gate** — the server returns 503 naming the pending file if the database
  is behind the code. The client should surface that, not retry blindly.

## 5. Open decisions (bring these to the owner; do not guess)

1. ~~§2 — load from server vs bundle~~ — decided: load from the server.
2. ~~The same file, seen twice~~ — decided (Sept 27): match on the exact absolute
   path within the table → update that record and say so; dropped ONTO a record of
   the table → update that record (placeholders); otherwise a new record. Hash
   matching later.
3. ~~Which hash~~ — xxh3 by default, computed last and only when a hash field is
   mapped; the algorithm is in the value (`xxh3:…`), so SHA-256 can be a second
   output later without touching old rows.
4. ~~Paths across machines~~ — plain absolute paths; the finishing systems share a
   mount convention. No storage-root mapping.
5. ~~Where probing runs~~ — the host's own ffprobe/ffmpeg (and Resolve + Python for
   the timeline reader); a clear error if missing. No sidecars, no server agents.
6. **The Resolve reader's runtime** — still open; file drop first.
7. **Distribution** — NixOS (flake package), AppImage for Fedora/Rocky, macOS; Windows
   maybe later. Under A the app rarely needs rebuilding.
8. **Outputs and the drop pipeline** — decided (Sept 27): classify (Rust, before any
   write) → create at once (path, kind, manifest, counts, context links) → enrich
   afterwards (ffprobe facts, then hash). One Files table. Outputs are listed in
   `contract/tools.ts`.

## 6. Server-side work the tools need — BUILT (Sept 27, `tauri` branch, to merge to `main`)

Small, no Rust, and it touches shared contract files — so do it first, deliberately,
as its own reviewed commit (the owner reviews wire-format changes before anything is
built on them; that is a standing rule of this project):

- **`src/contract/tools.ts`** — the shared definition of each tool: id, name, kind
  (ingest / enrich), the outputs it produces with their value types, and what a valid
  mapping is. Shared three ways: the SERVER validates a mapping on write, the WEB UI
  lets an admin configure it (Table settings → a "Tools" section, in
  `TableSettings.vue`) even though only the desktop can run it, and the DESKTOP reads
  it to run the tool.
- **Storing a table's tool settings** — likely a `tools` jsonb on `tables` plus a field
  in `table.update`, or its own mutation. Follow the precedent of `tables.kind`
  (sql/010) and `sections` (sql/009): no foreign keys into field ids, validated on
  write, read tolerantly. If a delete can cascade into it, `capture.ts` must mirror
  that (the one invariant nothing enforces — see PLAN.md).
- **Validation**: a mapped field must exist on that table and accept the output's
  type (reuse `validateValue`'s notion of types).
- **A `via` tag** on mutation batches, recorded in the log and shown in History.
- **A version handshake** (only if §2 is B): an endpoint saying which contract version
  the server speaks; the client refuses to run against a mismatch.

**Status:** all of the above except the version handshake (not needed under A) is
built: `sql/014_tools.sql`, `src/contract/tools.ts`, `table.update { tools }`,
`MutationRequest.via`, `ToolSettings.vue` in Table settings, `test/tools.ts` (64
checks). See API.md "Tools". Decisions taken with the owner on the way: ONE Files
table (not per-kind tables); no raw ffprobe kept, only mapped outputs; N loose files
that form no sequence/bundle/channel set become N records (capped, one Ctrl+Z);
dropping a file ONTO an existing record of the table updates that record (a
placeholder made before the file existed); same absolute path already in the table
→ update it and say so; a tool's follow-up writes are queued `undoable: false`.

## 7. The data the tools write into

So the first tool is built against the real schema, not an imagined one
(PLAN.md: "The owner's data model"):

- **Projects › Works** (an episode, a feature) **› Files / Edits**. Files carry a
  Project link and a Work link, both flagged **membership** (scope and board
  inheritance fill them in). A file that IS a deliverable also links to a
  **Deliverable** (a shared catalogue entry) — *the file is the evidence* that the
  deliverable was satisfied for that work. A **DeliveryPacket** table (an event: files,
  recipient, method, date) is being considered.
- Files use lineage self-links ("Previous version") — a re-export is a new record
  linked to the old one, which bears on decision 2.
- Boards (canvases) are RECORDS in tables of `kind: 'canvas'` (sql/010). "One canvas
  per work" is how he works.

## 8. How this project is run — keep doing it

- **Tests, then red checks.** 11 suites, ~960 checks (`npm test`; see README). When a
  test passes first time, break the code on purpose and confirm it fails. This has
  caught real bugs repeatedly — including tests that could not fail.
- **The headless UI tests cannot see layout.** happy-dom has no layout or paint. A
  deleted CSS block once blanked every canvas while 800 tests stayed green. Anything
  positional is unverified until the owner looks; say so, and keep `UI-NOTES.md`'s
  "needs eyes" list current. Screenshots from him are the best bug reports.
- **The owner cannot always check each step.** Be honest about what is verified and
  what is not; never imply something was seen. He values being told "I broke this".
- **Wire-format changes stop for review** before anything is built on them.
- **Comments explain WHY**, and record the bug that taught the lesson.
- **Docs are part of the work:** `API.md` (contract), `PLAN.md` (decisions and
  reasons), `UI-NOTES.md` (what needs eyes), `README.md` (layout).
- **Dialogs:** `client/dialogs.ts` — ask FIRST, mutate after (an `await` splits an undo
  step). **Security-sensitive code** uses well-tested primitives and conventions.
- **NixOS**: Postgres is socket-only; `npm ci`; native add-ons are a liability.
- **The app is not for the public internet** (API.md says why). A desktop client does
  not change that.

## 9. What "done" looks like for a first milestone

A file dropped onto the Files table in the desktop app becomes a record with its path
and size at once; ffprobe data and a hash arrive shortly after; it is linked to the
scoped project; it is one Ctrl+Z; History says it came from File drop; dropping the
same file again does what decision 2 says; and none of it required the server to run
or send anything executable.
