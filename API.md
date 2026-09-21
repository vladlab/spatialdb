# API surface

Six endpoints. Writes go through exactly one of them.

## Writes

### `POST /api/mutate`

The entire write surface. Body is a `MutationRequest` (see `src/contract/mutations.ts`);
the batch is applied in **one transaction** — all or nothing.

```jsonc
{
  "clientId": "…",            // so you can ignore the echo of your own writes
  "mutations": [
    { "id": "…",              // idempotency key, client-generated
      "mutation": { "type": "record.create", "id": "…", "tableId": "…", "data": {…} } },
    { "id": "…",
      "mutation": { "type": "placement.add", "id": "…", "canvasId": "…",
                    "recordId": "…", "x": 100, "y": 200 } }
  ]
}
```

**Unknown keys are a 400, at every depth** — the envelope, each mutation, and
nested objects such as `moves[]`. The schemas are `z.strictObject`. They used to
strip unknown keys instead, which made a misspelt mutation a *successful no-op*:
`record.update` with `data:` in place of `set:` returned 200 and logged a row that
changed nothing. The trade-off is version skew — an older client throws on a
stream event carrying a field it does not know rather than half-applying it, so
client and server ship together. `MutationResponse` alone stays loose.

Response:

```jsonc
{ "seq": 1043, "applied": ["…"], "skipped": ["…"], "serverTime": "2026-…" }
```

`skipped` holds mutation ids that were already applied. Replaying a batch after
a dropped connection is therefore safe and cheap — which is the property that
makes an offline queue a small change later rather than a rewrite.

`seq` is the highest log position after the batch, and is **never 0**. A fully
skipped replay applied nothing, so it reports the current head — because the
client stores this as its stream watermark, and reporting 0 rewound that
watermark to the beginning of time on exactly the operation idempotency exists to
make safe.

Each applied mutation is broadcast as its own stream event. Skipped ids are
broadcast as nothing at all: they are not new changes, and re-broadcasting them
told every peer to re-apply old work.

**There is no generic table-CRUD endpoint, and PostgREST/Supabase auto-CRUD is
not exposed.** Both would let the UI bypass invariants the server enforces:
role gating on schema changes, **both** of a link's endpoints matching their
tables (source in the table that owns the field, target in the field's configured
target table), and record keys naming real fields — on create as well as update.

Field **values** are type-checked against their field's type — the rule lives in
`src/contract/values.ts`, shared with the client so a bad value is refused at the
cell before it is ever queued, and enforced in apply so the contract file is not
the only line of defence. The rules, and the decisions inside them:

- `text` / `long_text` / `file_path`: string. `number`: finite number.
  `checkbox`: boolean. `date`: a real `YYYY-MM-DD` calendar date as a string —
  no times, no timezones; a moment-in-time is a different field type, added when
  something needs it. `select`: one of `options.choices` when choices are
  configured. `multi_select`: an array of them, each at most once — it is a set
  stored as an array.
- `link` and `lookup` reject any value: relations are rows in `links`, and
  lookups are computed at read time. A value under either key is always a
  mistake, usually an import that flattened links into cells.
- **Nulls are rejected.** "Empty" has one representation — the key is absent,
  cleared via `record.update`'s `unset`. Two spellings of empty would make every
  read site check both forever.
- **Write-time only.** Rows that predate a rule (or arrived by SQL) are left
  alone and stay readable; a bad old value fails validation on the next edit of
  that field, which is the moment someone can actually fix it. A batch that
  fails validation is rejected as a whole (one transaction), and the client
  drops rejected 4xx batches rather than retrying them.

## Reads

| Endpoint | Returns | Notes |
|---|---|---|
| `GET /api/schema` | tables, each with its `fields` and `views` | Small, rarely changes. Cache hard; invalidate on any `table.*`/`field.*` from the stream. |
| `GET /api/canvases/:id/scene` | placements, records, drawable links, annotations, **`seq`** | **One round trip, one consistent snapshot.** ~2ms on the sample canvas. |
| `GET /api/tables/:id/records` | `{ records, hasMore, nextCursor, seq, links, labels }` | `limit` (default 200, clamped to 500). Walk with `after=<nextCursor>`; `offset` still works but is wrong for a walk — see below. |
| `GET /api/canvases/:id/unplaced` | `{ records, hasMore }` | The tray you drag from. Optional `tableId` filter. Same paging. |
| `GET /api/head` | `{ seq }` | Current log head, for a client that wants a watermark without loading a scene. |

`records` returns **links and labels alongside the rows**. A link is a row in
`links`, not a value in `records.data`, so a grid rendering `record.data[key]`
finds nothing for a link field and shows the column blank — while the canvas,
which reads the links table, draws the same relation as an arrow. `labels` carries
display names for far-end records in tables the client has not loaded, which would
otherwise render as raw UUIDs.

### Walking a whole table

The grid sorts and filters **on the client**, over the whole table (the reasoning
is at the top of `src/contract/views.ts`), so the client walks `records` to the
end: request, then pass `nextCursor` back as `after` until it is `null`.
50,000 rows is ~100 requests and ~3 s locally; the grid is usable from page one.

- **The cursor is opaque and server-minted.** It encodes the last row's
  `(created_at, id)`, with the timestamp taken as text in SQL. node-pg parses
  `timestamptz` into a JS `Date`, which drops microseconds — a client building a
  cursor from the `created_at` it was sent would skip or repeat rows that differ
  only below the millisecond. A cursor that does not decode is a **400**, not a
  silent restart from page one.
- **Do not walk with `offset`.** A row deleted from an already-served page shifts
  every later row up one, so the row that slid across the boundary is never
  served — and the stream cannot repair that, because nothing happened to it.
  `test/grid.ts` runs the same scenario both ways and asserts offset loses a row.
- **Each page reports the `seq` it was read at**, inside one `repeatable read`
  snapshot with its links and labels. A page is fetched while the stream is live,
  so an event can overtake the response: the client applies a delete at seq 900,
  then ingests a page read at 899 and resurrects the row permanently (the delete
  is now behind the watermark). Likewise a page can revert an edit the user typed
  mid-walk, whose echo is then skipped for being their own. The store tracks what
  it touched during a walk and `ingestPage` skips any row it knows something newer
  about than `page.seq`; unsent local writes count as newer than everything.
- **Creation order is total**, including within one batch, since
  `004_record_order.sql`. `now()` is per-transaction, so a batch of N creates used
  to share one timestamp and come back in uuid order.

### What a record is called: the primary field

`labels` in `GET …/records` (far ends of links to tables the client may not have
loaded) and every label the client computes itself follow ONE rule, in the fifth
shared contract file, **`src/contract/labels.ts`**:

> A record is named by its table's **primary field** — the first field, by
> `position`, of a plain-valued type (`text long_text number date select
> file_path`). Ties on position break by field name, compared by code point.

There is no `primary_field_id`. "Make this the primary field" is "move it first",
so it needs no migration, no new mutation, no undo capture, and cannot dangle. It
replaced "`data.name`, else the first string in `data`", which depended on jsonb
key order — not preserved — so an unnamed record could change label on reload.
**`name` is no longer special.** A record whose primary cell is empty is labelled
`(untitled)` by the server and by a short id on the client.

### Assets: files the database refers to

Screenshots in notes, attached PDFs, later waveform and QC images. **Not
mutations.** An upload writes a file and an index row; it produces no log entry
and no stream event. What goes through `/api/mutate` afterwards is a value that
mentions the returned `id`.

| | |
|---|---|
| `POST /api/assets?name=<url-encoded>` | Body is the raw file — no multipart. **201** `{ id, sha256, mime, bytes, width, height, name }` for a new file, **200** with the EXISTING asset for bytes already held. |
| `GET /api/assets/:id` | The bytes. `Cache-Control: public, max-age=31536000, immutable`, `ETag` (the hash; `If-None-Match` → 304), `nosniff`, `Content-Disposition: inline` with the name. |
| `GET /api/assets/:id/meta` | The row, without the bytes. |

- **Content-addressed.** One row and one file per distinct content, at
  `<assets dir>/ab/cd/<sha256>`. Same bytes → same `id`, whatever name they arrive
  under (the first name is kept; a name is a label). That is what makes
  `immutable` a promise the storage keeps.
- **The type is sniffed from the bytes**, never taken from `Content-Type`.
  Accepted: PNG, JPEG, GIF, WebP, PDF. **SVG is refused on purpose** — it can
  carry script and these are served from the app's own origin. Anything else: 415.
- **Streamed to disk**, hashed on the way; nothing is buffered in memory. The cap
  is `ASSET_MAX_MB` (default **500**). Over it is a **413** — sent after draining
  the rest of the upload, because resetting the connection mid-upload reaches a
  browser as a generic network error and the explanation is lost.
- **Location:** `SPATIALDB_ASSETS_DIR`, default `.pg/assets` — beside the Postgres
  data directory. `backup.sh` reads the same variable.
- `width`/`height` are read from the image header (no decoding, no dependency);
  null for PDFs and for anything unusual. A layout hint, not a fact to rely on.
- A row whose file is missing (a database restored without its assets directory)
  is a 404 that says so; re-uploading the same bytes heals it, same `id`.
- **Nothing deletes assets.** Values are the only record of what is in use, and a
  deleted record's undo capture may still name an asset. A sweep shares the
  log-retention decision (PLAN.md).
- Viewers cannot upload; reads are open to anyone who can reach the server.

### When the database is behind the code: 503

If `sql/` contains migrations that `_migrations` does not list, **every `/api`
call returns 503** with `{ error, pending: ["005_…sql"] }`, the error naming the
files and the fix (`./scripts/db.sh migrate`). It is a 503, not a 500, because it
is temporary and clients must treat it so: the store keeps the batch queued and
retries, and the server re-checks every 2 s, so applying the migration un-sticks
everything with no restart. Unexpected failures in `POST /api/mutate` are still
500, now with the underlying message in `detail`.

### Canvas config: what a canvas's cards show

`canvas.update` takes an optional `config`, validated against **`CanvasConfig`**
in `src/contract/canvasConfig.ts` on both sides and returned with the canvas list
and the scene:

```jsonc
{ "cardFields": { "<tableId>": ["<fieldId>", "…"] } }   // order = order on the card
```

Per canvas, per TABLE — "File cards on this board show codec and width" — not per
card. A table with no entry gets the default (first five fields, minus the
primary, which is the card's title). Replaced whole on update, like a view's
config; ids that no longer resolve are skipped at render time. Per-card things
(`collapsed`, size, z) stay on the placement.

### Lookup fields

A `lookup` field has no value of its own. It follows one of its table's link
fields and shows one field from the records at the far end:

```jsonc
{ "type": "field.create", "fieldType": "lookup",
  "options": { "via_field_id": "<a link field on THIS table>",
               "target_field_id": "<a field on the table that link points at>" } }
```

The rule is the sixth shared contract file, **`src/contract/lookups.ts`**.

- **Configuration is validated on write**, by the same function the field form
  runs: `via` must be a link field on the lookup's own table; `target` must be on
  the table that link points at, and must not itself be a `link` or `lookup` (no
  second hops, no chains). Applies to `field.create` and to `field.update` with
  `options`. Works in the same batch as the link field it follows.
- **Values are computed on the client**, which holds whole tables. Nothing is
  stored in `records.data` under a lookup's key, and writing to it is a 400.
  A lookup yields a LIST (one value per linked record, in link order, empty far
  cells skipped); the grid shows it comma-separated and sorts/filters by that
  text. Rollups (sum/min/max) are deliberately not an option on this type.
- **A lookup can BREAK and that is not an error.** Deleting the link field or the
  far field does not rewrite or delete lookups that depend on it; they resolve to
  "broken" until the delete is undone or the lookup is removed. Same reasoning as
  view configs.
- `resolveLookup` in `reads.ts` predates client-side tables and is unused.

### Health, version, and how the app is served

`GET /api/health` → `{ ok: true, version: "1.0.0+a1b2c3d" }` — open (no login). The
version is `package.json`'s plus the git commit when run from a checkout (or
`SPATIALDB_COMMIT`). It is how a client — the desktop app especially — knows which
build it is talking to.

In production (`NODE_ENV=production`, `npm start`) the SAME process serves the built
frontend: `/assets/*` immutable, everything else `index.html` with `no-cache`; every
non-API response carries a Content-Security-Policy whose `connect-src` deliberately
allows `ipc:` and `http://ipc.localhost` for the Tauri client. The server listens on
`127.0.0.1` unless `HOST` says otherwise, because it trusts proxy headers
(`X-Forwarded-Proto`, `X-Forwarded-For`, the optional SSO header). Production refuses
to start with `AUTH_DISABLED=1` or without a `dist/`. See `DEPLOY.md`.

### Signing in, users, and what this does NOT make safe

`sql/011_auth.sql`, `src/server/auth.ts`, `test/auth.ts`. **Everything under `/api`
needs a signed-in user** — reads, writes, the stream, uploaded files — except
`/api/auth/login`, `/api/auth/me`, `/api/auth/logout` and `/api/health`. 401 =
not signed in (`{ setup: true }` when nobody CAN sign in yet).

| | |
|---|---|
| `POST /api/auth/login` `{ email, password }` | sets the session cookie; returns `{ user, token }`. 401 never says whether the email exists. 429 after 5 failures per address+email, doubling back-off to 15 min. |
| `POST /api/auth/logout` | deletes the session on the server |
| `GET /api/auth/me` | `{ user }`, or 401 |
| `POST /api/auth/password` `{ current, next }` | your own; ends your other sessions |
| `GET /api/users` · `POST /api/users` · `PATCH /api/users/:id` | **admin.** `{ email, name, role, password }`; patch `name role disabled password`. Users are never deleted — disabled (signed out at once; the row stays because the log points at it). The last admin cannot be demoted or disabled. |

- **Identity** is decided in one place, `authenticate()`, in order: a trusted
  proxy header (`AUTH_TRUSTED_HEADER=X-Remote-User` — the SSO seam; the user must
  already exist here; enable it ONLY if the app is reachable solely through that
  proxy), `Authorization: Bearer <token>` (the login response's `token`; for the
  Tauri client), the session cookie, and `AUTH_DISABLED=1` (everyone is the first
  admin — development and the older test suites; the server warns loudly).
- **Passwords**: Node's scrypt, N=2¹⁷ r=8 p=1, 16-byte salt, constant-time compare,
  ≥10 characters, stored as `scrypt$N$r$p$salt$hash` so the cost or the algorithm
  can change by re-hashing at login. (argon2id is OWASP's first choice; it needs a
  native add-on, which is a recurring problem on NixOS. scrypt is their second.)
- **Sessions**: 256 random bits; the database holds only the SHA-256. Cookie is
  `HttpOnly; SameSite=Lax`, and `Secure` **only when the request arrived over
  HTTPS** (directly or `X-Forwarded-Proto`) — unconditionally Secure would make
  login fail silently on a plain-HTTP LAN. 30 days, sliding.
- **CSRF**: SameSite, plus any non-GET whose `Origin` names another host is 403.
  **No wildcard CORS** any more; `CORS_ORIGINS` lists exceptions.
- **None of this is a mutation.** The log is kept forever and streamed to every
  client; credentials must be in neither. Verified by test.
- **Roles** (unchanged, but now real): admin = schema, sections, users; editor =
  data; viewer = read. The mutation log's `actor_id` is the person who did it.

**What this does not do:** make the app fit for the public internet. It is custom,
unaudited software with file upload and a write API; there is no two-factor; nobody
is watching it. LAN or VPN (Tailscale/WireGuard). If it must be public, put an
identity-aware proxy with 2FA in front and use the trusted-header seam. Over plain
HTTP the password and session cross the network unencrypted — on NixOS, Caddy with
its internal CA is a few lines.

### `structured` values: shapes, manifests, audio layouts

`sql/012`, rules in the tenth shared contract file, **`src/contract/shapes.ts`**.
A `structured` field holds a JSON **object** whose SHAPE is named in the field's
options: `field.create { fieldType: 'structured', options: { shape } }`.

- `shape` must be one of **`manifest` · `audio_layout` · `json`**. An unknown name is a
  400 at field creation (not "generic JSON": a typo must not switch validation off —
  generic is spelled `json`). **A field's shape cannot be changed afterwards**; every
  stored value was validated against it.
- Every shape: strict objects (an unknown key is refused), at most **256 KB**.

```ts
type Hash = string;   // "<algo>:<hex>" — "sha256:…", "xxh64:…". The algorithm is IN the value.

type Manifest =
  | { kind: 'file';        size: number; hash?: Hash }
  | { kind: 'bundle';      members: { path: string; size: number; hash?: Hash }[]; source?: string }   // IMF / DCP; ≤ 2000 members
  | { kind: 'sequence';    pattern: string; first: number; last: number; count: number; gaps: [number, number][] }   // NEVER the file list
  | { kind: 'channel_set'; members: { path: string; channel: string }[] };                              // multi-mono mix

type AudioLayout = { tracks: { name: string; channels: string[]; language?: string }[] };
```

- **Member paths are relative to the record's own path** (a `file_path` field): no
  leading `/`, no `..`, no drive letter. Absolute paths are refused.
- An audio layout's TRACKS are the containers a vendor sees; 12 mono tracks and
  "5.1 + 3× stereo" are the same channels and a different layout. Channel labels are
  free text (vendors vary); `LAYOUT_PRESETS` supplies mono / 2.0 / 5.1 / 7.1. An empty
  layout is stored as NO value, not `{ tracks: [] }`.
- Sort, filter ("contains") and quick search use the value's one-line **summary**
  (`summarise`): `"4 tracks / 12 ch (5.1, 2.0, 2.0, 2.0)"`, `"86,395 frames 1001–87400,
  5 missing in 1 gap"`. Structured fields cannot be grouped by, or looked up.
- The Files CONVENTION (`FILES_STANDARD_FIELDS`: kind, path, manifest, file_count,
  total_size, hash, audio_layout, parent) is a convenience offered in Table settings,
  not a rule — nothing reads those keys. A number field with `options.format = 'bytes'`
  DISPLAYS as "120 GB"; the stored value is still a number.

**`POST /api/qc/audio-layout-diff`** `{ a, b }` → `LayoutDiff`. `a` = expected (a
spec), `b` = found (a file). Stateless; a thin wrapper over `diffLayouts` for callers
that cannot import TypeScript. 400 names which side is not a layout.

```ts
type LayoutDiff = { same: boolean; channelCount: [number, number];
  issues: { kind: 'count' | 'order' | 'grouping' | 'name' | 'language'; track?: number; detail: string }[] };
```
Reported most-serious first, each kind only when the ones above it are clean: `count`
(then nothing else), `order`, `grouping` (same channels, same order, contained
differently), and — only when the grouping matches — `name` / `language` per track.

### View grouping

`ViewConfig.groupBy?: fieldId[]` — at most two, outermost first; optional, and
absent means "not grouped" (every view saved before it existed). Grouping itself is
client-side and pure: `groupRows` in `src/contract/views.ts` turns an already
filtered and sorted list into headers interleaved with rows. A multi-valued field
(a link to two records, a multi-select) groups by the COMBINATION, so a record is
in exactly one group per level. Nothing about grouping is enforced by the server.

### Records inherit the context they are created in (client convention)

Not a server rule — a record is still `record.create` plus `link.add`s, sent in one
batch. The client's `createRecord` (`src/client/scope.ts`) adds, in the same batch:
the scoped project (membership), the value or links of the GROUP the record was
added under, and — for a record created on a canvas — a link to everything the
BOARD's record is a member of, through the new record's own membership field to the
same table. A script that wants the same behaviour sends the same links.

### Scope

Rules in the ninth shared contract file, **`src/contract/scope.ts`**. Scope is a way
of LOOKING: it lives in the browser (and the URL), is never written to the
database, and changes nothing for anyone else. What the server knows about:

- **`field.options.membership = true`** on a **link** field: "a record of this
  table BELONGS to the record it links to". Validated on `field.create` and
  `field.update`: link fields only, and **at most one membership field per table
  per target table** (400: "a table belongs through ONE field"). Scope uses ONLY
  flagged fields — never "any link to Projects" — and only DIRECT membership.
- A section's `scope_table_id` / `archived_field_id` (see Sections) say what a
  section is scoped by and which checkbox marks a scope record archived.
- **`GET /api/search`** takes `scopeTable=<tableId>&scope=<recordId|none|>`
  `&archived=<id,id>&showArchived=1`. With a scope table given it (a) leaves out
  records whose EVERY membership is to an archived record (unless `showArchived`),
  and (b) for a record/none scope, RANKS members first and marks every hit
  `inScope: true|false`. It never drops a hit for being out of scope. Without
  `scopeTable` it behaves exactly as before.
- Address: `?sc=<recordId|none>`.

Everything else — filtering the grid and the canvas picker, auto-linking records
created inside a scope (`record.create` + `link.add`, one client-side undo step),
narrowing the link picker — is the client applying that rule to tables it has
already loaded. There is no scoped LOADING yet; deliberately (rule 3 in the file).

### Boards: a canvas IS a record

`table.create` takes an optional **`kind: 'canvas'`** — "a table of boards". Every
record in such a table IS a canvas (`sql/010_boards.sql`). `kind` is set at
creation and cannot be changed.

- **Create a canvas:** `record.create` in a boards table. **Delete one:**
  `record.delete`. **Rename one:** `record.update` its primary field — a board has
  ONE name. `canvas.create` and `canvas.delete` are **retired**: still parseable
  (old log rows must replay — `test/stream.ts` §10) but refused with a 400 naming
  the replacement.
- **`canvases` is now only a board's STATE** (`viewport`, `config`), keyed by the
  record's id, and created **lazily** — by the first `placement.add`,
  `canvas.update` or `annotation.create` that targets the board. Those three
  refuse an id that is not a record in a boards table (`not a board`).
  `canvas.update` still accepts `name`/`description`/`position` from old log rows
  and ignores them.
- **Cascade, and the capture that mirrors it:** `canvases.id → records.id ON DELETE
  CASCADE`, then the original `placements`/`canvas_annotations → canvases`. So
  `record.delete` on a board, and `table.delete` on a boards table, capture the
  board's state, the cards ON it and its annotations (`grabBoards` in
  `capture.ts`); restore inserts `canvases` AFTER `records`. `test/undo.ts` §9b
  goes red if that capture is removed.
- **`GET /api/canvases`** → every board: `[{ id, table_id, data, config, viewport }]`
  (the record plus its state, defaults if it has none yet).
  **`GET /api/canvases/:id/scene`** is 404 only if the id is not a board; a board
  with nothing on it is an empty scene. The scene's `records` include the board's
  own record, since its name lives there.
- A board can be **placed on another board** like any record. Filing under a
  section is table membership; scoping to a project will be an ordinary link on
  the board's record. Neither needs anything canvas-specific.

### Sections

The app's navigation. `GET /api/sections` →
`[{ id, name, description, icon, color, table_ids, scope_table_id, archived_field_id, position }]`.

| Mutation | |
|---|---|
| `section.create` | `{ id, name, description?, icon?, color? }` |
| `section.update` | any of `name description icon color position`, plus `tableIds` (replaced WHOLE, in display order), `scopeTableId` and `archivedFieldId` (both nullable — `null` clears) |
| `section.delete` | `{ id }` — destructive, captured, undoable. Deletes the section ONLY. |

Admin-only, like schema changes. **A section is navigation and nothing else**: it
decides which tables and canvases the pickers and the home page offer, and which
results the palette ranks first. It does not filter data, links and lookups cross
sections freely, and it is **not a permission** — every table stays reachable
through "Everything" (`#/all/…`), the palette, and any link.

- A table may be in several sections, or none. `table_ids` has no foreign keys:
  an id that no longer resolves is skipped on read, so deleting a table needs no
  fix-up and undoing that delete puts it back in its sections.
- `scopeTableId` must be one of the section's own tables; `archivedFieldId` must be
  a **checkbox** field on that table. Both are checked against the row as it will
  be after the update, so they can be set together. Clearing the scope table
  clears the marker. (The scope FEATURE that uses them is not built yet.)
- **Canvases need nothing here.** A canvas is a record in a table of boards (see
  "Boards" below), so a section's canvases are simply the boards in its tables.
  (`config.sectionId`, which existed for one day in 009, was removed by 010.)

### Addresses

Client-side hash routes (`src/client/router.ts`) — nothing the server sees:
`#/` home · `#/all/<view>/<id>` · `#/s/<slug>-<sectionId>/<view>/<id>` · `?r=<recordId>`
opens that record's panel. The slug is decoration and ignored on parse, so links
survive renames. `<view>` is `canvas | table | schema | undo`.

### `rich_text` and `attachment` values

Rule in the eighth shared contract file, **`src/contract/richtext.ts`**: *a value
may REFER to a file; it may never CONTAIN one.*

- **`rich_text`** — a TipTap/ProseMirror document, stored as a JSON **object**
  `{ "type": "doc", "content": [...] }` (not a string; `long_text` is the plain
  string type and is unchanged). An image is
  `{ "type": "image", "attrs": { "assetId", "width", "height", "alt" } }` — **no
  `src`**; the renderer builds the URL from the id. Refused on write: a non-document,
  an image with a `src` or without a valid asset id, a `data:` URI in ANY
  attribute, a link whose target is not http(s)/mailto/tel/relative, and anything
  over 1 MB serialised. The node schema itself is not validated server-side.
- **`attachment`** — `["<asset id>", …]`, unique, at most 100.
- For both, **every asset id must exist** (`unknown asset: … — upload the file
  first`, 400). Upload with `POST /api/assets`, then write the value.
- The document is sent WHOLE on each save and replaces the previous value: last
  write wins. The editor saves on the way out, not per keystroke, and refuses to
  overwrite a value that changed since it was opened without asking.
- Sorting, filtering and quick search use the document's plain text
  (`richTextToPlain`); `/api/search` finds text inside notes too.

### Arrow style on a link field

`field.options.arrow = { color?: "#rrggbb", reversed?: boolean }` on a **link**
field, validated on write (`src/contract/arrows.ts`; anything else inside `arrow`
is a 400). It is on the FIELD so a relationship looks the same on every canvas.
`reversed` draws the arrowhead at the record that HOLDS the link — for a field
like "Previous version", stored on the newer record, the flow then reads
old → new. `field.update` replaces `options` whole, so send the link's
`target_table_id` along with it (the client merges; see `setArrowStyle`).
Which relationships are SHOWN on a canvas is not stored anywhere on the server.

### Backlink fields

The other end of a link, as a read-only field — seventh shared contract file,
**`src/contract/backlinks.ts`**.

```jsonc
{ "type": "field.create", "fieldType": "backlink",
  "options": { "source_field_id": "<a LINK field, on any table, whose target is THIS table>" } }
```

`Edits.inputs → Files` lives on the edit; a backlink on Files pointed at it shows
"Input to: OEV3, DCP v1". Validated on write (must be a link field, must point at
this table — the SAME table is allowed: "Previous version" ↔ "Next version").
Stores nothing; writing to it is a 400; computed on the client from links it
already holds; sortable and filterable by the linking records' labels; resolves to
"broken" if the source field is deleted, and heals if that delete is undone.
Not a paired second link field: that would be two copies of one fact.

### Search

`GET /api/search?q=<text>&tables=<id,id>&limit=<n≤100>` →
`{ results: [{ record: { id, table_id, data }, label }], fuzzy }`

Every table at once, including ones the client never opened — which is why this is
a server read and the grid's own search is not. **Every whitespace-separated term
must appear somewhere in the record's VALUES** (not its field names), any order,
case-insensitive; `%` and `_` are literal. `tables` restricts it; `tables` with no
`q` lists those tables' newest records; neither gives `[]`. If nothing matches
exactly, a trigram word-similarity pass runs and `fuzzy` is true ("mastr" finds
"master"). Ranked: label starts with a term > label has a word starting with it >
label contains it > matched elsewhere; then newest. Backed by a `pg_trgm` GIN index
on an EXPRESSION (`007`), not a generated column — `restore` re-inserts rows using
the column list from `pg_attribute`, and a generated column cannot be inserted
into. The expression in `reads.ts` must match the index's exactly.

### Creating fields from a script: set the position

`field.create` carries no `position` (nor does `table.create`), so a new field
lands at position 0 — the FIRST column, and therefore (if plain-valued) the
table's new PRIMARY field, renaming every record in it. The schema editor follows every create
with a `field.update { position: max + 1 }` in the same flush; anything else that
creates fields (a script, an importer, the Tauri client) should do the same.
Defaulting it on the server was considered and rejected: clients apply the
`field.create` event locally with position 0, so a server-side default would
leave every client's column order disagreeing with the database until reload.

### Views

A view is `{ id, table_id, name, config, position }`, delivered with the schema
and written with `view.create` / `view.update` / `view.delete`. `config` is
validated against `ViewConfig` in **`src/contract/views.ts`** — the fourth shared
contract file — on both sides:

```jsonc
{ "sort":    [{ "fieldId": "…", "dir": "asc" }],            // applied in order
  "filters": [{ "fieldId": "…", "op": "contains", "value": "reel" }],   // ANDed
  "hidden":  ["<fieldId>"] }
```

Ops are a closed set: `contains eq neq gt gte lt lte has empty notEmpty`. Entries
name fields by **id**, so renames never break a view. `view.update` replaces the
config whole. A view is shared — changing a filter changes it for everyone, as a
streamed mutation. Semantics (natural sort, empties last in both directions,
`neq` matching empty cells, select sorting by choice order) live in `applyView`
in the same file, and are pinned by `test/grid.ts` G1.

`field.delete` deliberately does **not** rewrite view configs: entries naming a
missing field are ignored at read time, which means undoing the delete brings the
sort or filter back, and no schema change can brick a view.

`scene` only returns links whose **both** endpoints are placed on that canvas —
those are the only ones that can be drawn, so filtering server-side keeps the
client from reasoning about danglers.

`scene` also runs its five reads inside one `repeatable read` transaction and
reports the log position it was taken at as **`seq`**. Both matter:

- Without the transaction they were five independent snapshots, so a concurrent
  delete landing mid-read could return a placement whose record was already gone.
- Without `seq`, "refetch, then resume the stream" always has either a gap
  (resume too late, miss changes) or an overlap (resume too early, re-apply what
  the snapshot already contained). A self-dating snapshot removes the guess, and
  is what makes `resync` recovery exactly correct.

Both list endpoints are **bounded**. `unplaced` previously had no limit at all,
which on a fresh canvas meant every record in the database in one response. They
order by `(created_at, id)` — the `id` tie-break is load-bearing, because records
created in one batch share a timestamp, and without it paging can skip or repeat
rows.

## Realtime

### `GET /api/stream?since=<seq>`

Server-sent events, defined in **`src/contract/events.ts`** — the read-side
sibling to `contract/mutations.ts`, and imported by client and server both so the
two cannot drift. Every event is parsed against it on the way out and on the way
in.

Two event kinds, discriminated on `kind`:

```jsonc
{ "kind": "mutation",
  "seq": 1043,                    // number, always. Its own, not the batch's.
  "id": "…",                      // the mutation's idempotency key
  "clientId": "…",                // camelCase, matching MutationRequest.clientId
  "type": "placement.move",       // == mutation.type, for routing
  "mutation": { … },              // the Mutation object the writer sent
  "appliedAt": "2026-…",
  "replay": false }               // true if catch-up. MUST NOT change how you apply it.
```

```jsonc
{ "kind": "resync", "reason": "too-far-behind", "head": 12043, "since": 4 }
```

The stream opens with a comment frame (`: open`), sent before anything else.
Proxies do not forward headers until the first body byte, and an up-to-date
client has nothing to replay — without this the first byte was the 25 s keepalive
and `fetch` sat unresolved for that long. Comment frames (this and `: ping`) carry
no meaning; skip any frame that does not start `data: `.

**One event per log row, never per batch.** A batch of five mutations produces
five events. Live and catch-up are byte-identical apart from `replay`, so there
is exactly one apply path — which is the property that makes reconnection and
(later) offline replay free rather than a rewrite. `test/stream.ts` asserts that
byte-identity over a real socket; it is the test that would have caught the
divergence this format replaced.

**Client rules, in order:**

1. **Drop `event.seq <= yourWatermark`.** Every event carries its own `seq`, so
   this alone protects you from double-applying, independent of step 2.
2. **Then skip `event.clientId === yourClientId`** — your own echo, already
   applied optimistically.
3. **On `kind: "resync"`**: discard local state and refetch. Take your new
   watermark from the **`seq` the snapshot itself reports** (see Reads), not from
   `head` — the snapshot is consistent and self-dating, so there is no window to
   replay and nothing to double-apply. `head` is for logging how far behind you
   were.

The server never sends a truncated catch-up. If you are further behind than it
will replay (1000 rows), you get `resync` and no rows at all — a silently
truncated prefix would leave you believing you were current while permanently
missing the gap.

An unparseable `?since=` is treated as `0`, not as `NaN`. A corrupt watermark
replays from the start rather than receiving nothing and looking healthy.

## Client write path

Implemented in `src/client/store.ts`; `src/client/state.ts` holds the apply
function it shares with the stream.

1. Generate the UUID locally and apply the mutation to local state **immediately**.
2. Push it onto a pending queue with an idempotency key.
3. Flush the queue on a ~100ms debounce to `POST /api/mutate`, one request at a
   time — concurrent flushes would let a later batch commit before an earlier
   one, and the log order is the audit trail.
4. On a 5xx or network fault, put the batch back and retry with backoff;
   idempotency makes that safe. On a **4xx, drop it** and surface the error — the
   server rejected the content, so retrying can only spin forever.

**Do NOT adopt the response `seq` as your stream watermark.** An earlier version
of this document said to, and it is wrong in a way that only bites when it
matters. The response `seq` is the log head after your batch, which can be higher
than events you have not yet received: if your batch takes seqs 10 and 12 while
another client takes 11, the response says 12. Adopt that while your stream
happens to be down and you reconnect with `?since=12`, never seeing 11.

The watermark advances **only** from stream events (which arrive in seq order) and
from snapshot reads that report their own position. The response `seq` is
diagnostic.

## Client read path

Take the watermark **before** fetching, not after.

`store.hydrate()` reads `/api/head` first, then `/api/schema` and
`/api/canvases`. That deliberately produces an *overlap*: catch-up will replay
events already reflected in the fetched rows. Overlap is free, because local apply
is idempotent. Reading the head afterwards would instead risk a *gap*, and a gap
is silent permanent divergence.

`/api/canvases/:id/scene` avoids both — it reports the position of its own
consistent snapshot, so there is nothing to replay and nothing to miss.

## Local apply must be idempotent

Applying the same mutation twice has to be indistinguishable from applying it
once. This is the third of three independent guards against double-application:

1. drop any event whose `seq` is at or below the watermark
2. skip any event whose `clientId` is your own
3. make every apply idempotent

Any one is sufficient. Requiring all three is how the system stays correct when
one regresses — and guard 2 already did, silently, which is what made the old
stream-shape bug duplicate records rather than merely look untidy.

Idempotency is mostly structural: state is keyed maps, so insert is naturally
upsert and delete is naturally a no-op on something already gone. `create` is
create-**if-absent**, never overwrite, so a replayed create cannot revert later
edits. Where the server has real conflict semantics — `placement.add`'s
`on conflict do update set x, y, z`, which leaves `w`/`h` alone — the client
mirrors them exactly. A disagreement there means clients converge on different
answers for a real user action (dragging a card onto a canvas it is already on).

A drag emits one `placement.move` per flush covering every selected card, not
one mutation per card per frame. Without that batching the mutation log becomes
unreadable noise and the audit trail is worthless.

## Undo

Destructive mutations capture the rows they destroy, cascades included, into
`mutations.undo`. See `sql/003_undo.sql` for why this rather than soft deletes,
and `src/server/capture.ts` for the cascade queries.

| Endpoint | Returns |
|---|---|
| `GET /api/undoable` | recent destructive mutations, newest first, with row counts and `undone_by` |
| `GET /api/mutations/:id/undo` | the captured rows, for building a `restore` from |

**There is no `POST /api/undo`, deliberately.** Undo is performed by sending a
`restore` mutation through `/api/mutate` like any other write. A dedicated
mutating endpoint would sit outside the mutation boundary, and undo would then
not stream to peers, not replay on reconnect, and not work offline.

```jsonc
{ "type": "restore", "id": "…", "undoOf": "<mutation id>", "rows": { … } }
```

`rows` groups whole captured rows by table (`tables`, `fields`, `records`,
`links`, …) plus one collection that is **not** a table: `record_values`, an
array of `{ record_id, key, value }`. `field.delete` strips its key from every
record's `data` in the same transaction (an orphaned key was unwritable), and
those stripped values are captured here — the records themselves were not
deleted, so whole-row capture is the wrong shape for them. Restore merges each
value back only where the record still exists, a field with that key exists
again, and the key is still absent — insert-only, one level down, so undo never
clobbers values typed under a re-created same-key field and never re-creates the
orphaned-key state.

Two things about that shape:

- **The rows travel in the payload.** Carrying only `undoOf` and letting the
  server look the capture up would be smaller and would break the single apply
  path — the client could not apply it, and neither could a peer receiving it over
  the stream. With the rows present, undo is an ordinary mutation: optimistic
  locally, streamed, replayed, idempotent.
- **One mutation, not N ordinary ones.** Undoing a `table.delete` of a
  2,000-record table would need thousands of `record.create`s, over a 500-per-batch
  cap, and `record.create` cannot restore `created_at`/`created_by` — an undo would
  silently rewrite authorship. One mutation carrying whole rows is atomic at any
  cascade size and restores byte-for-byte.

Restores are idempotent (`on conflict do nothing`) and skip rows whose foreign-key
parents are gone, because history is not a stack: delete a record, delete a canvas
it sat on, then undo the record, and the captured placement points at nothing. The
record comes back without that one placement rather than the undo failing.

Role gating is dynamic — `restore` needs `admin` only when it carries tables or
fields, otherwise `editor`. Static gating would have made undoing a `table.delete`
an editor's back door into the schema.

Cascades above 10,000 rows store counts instead of contents;
`GET /api/mutations/:id/undo` then returns **409** rather than an empty restore a
careless caller would send and believe worked. That is what dumps are for.

## Concurrency

Last-write-wins throughout, which at 3–10 people is sufficient:

- `record.update` merges **per field** (`data || patch`), so two people editing
  different fields of one record don't clobber each other. This removes most
  real-world conflicts without any CRDT.
- `placement.move` is last-write-wins per (canvas, record). Two people dragging
  the same card is a social problem, not a technical one.

## Auth

Session or JWT, `users.role` ∈ `admin` | `editor` | `viewer`.

- `admin` — schema mutations (`table.*`, `field.*`)
- `editor` — all data, link, canvas and placement mutations
- `viewer` — reads only

Currently a **dev stub**: `currentActor()` resolves to the first admin in the
users table. Replace before this is reachable by anyone but you.

Enforced server-side in `applyOne`. Postgres RLS can be layered underneath later
without changing this shape, if "everyone here is trusted" stops being true.
