# Brief: the Resolve timeline tool

> **Status (Oct 26):** R1 (contract) on main as `36f4dd5`. R2 (shell) + R3
> (settings) + R5 (the menu item) delivered together as `resolve-shell-settings.patch`,
> with R4's run cut short on purpose: the picker reads the timeline and a dialog
> shows what was read and where each output is mapped — NOTHING is written yet, so
> the reading can be checked against a real Resolve first (DESKTOP.md "Needs eyes"
> 8); the owner ran it against his Resolve: "all works so far". R4 (the write,
> Inputs add-only with the derived warning — R1.5 as amended) delivered as
>  `resolve-write.patch`, on main as `ffb0676`. The tray block (R1.3) delivered as
> `resolve-tray.patch`: lengths at the record's own rate (its mapped Frame rate /
> Drop frame), in frames where there is none; ⤴ show on clips with a file. Left of
> R7 step 6: `describe` wording (fine as it reads), nothing else outstanding. Decided on the way: the script names each API call it makes so a
> wrong name fails readably; clip ends are start + duration (GetEnd only checked);
> the readout lists the raw frame numbers while the reader is new.

A design agreed with the owner on Oct 26 2026, for the session that builds it.
Nothing here is built. Read `TAURI-HANDOFF.md` (§3 the tools principles), `DESKTOP.md`,
`API.md` "Tools" and `src/contract/tools.ts` first: the idioms this leans on (the
server KNOWS about a tool and never runs it; a recipe is data that routes analyzer
outputs to fields; tools write ordinary mutations with a `via` tag; one patch per
round, built on what the owner last confirmed applied) are established there.

**Source of truth:** <https://github.com/vladlab/spatialdb>, `main` (at writing:
`e4be74a`, "calendars: month and week layouts; Bookings is a plain table").

Standing rules that apply throughout (UI-NOTES.md has the long form):

- Ask the owner any question that comes from reading the code before building;
  stop for his review after the contract step (R1).
- Nothing jumps or shifts; more UI beats getting lost. In-app dialogs only
  (`client/dialogs.ts`): ask FIRST, mutate after. No ⤢ icons on new work.
- The desktop client does all the work and hands the app correctly formatted data.
  The server sends nothing executable: no script, no arguments, no paths.
- Deliver as `git format-patch` mailbox output against the main the owner confirms,
  one patch per round, new files included.
- The Resolve scripting API names used below are from memory of the 19/20 docs.
  Before writing `resolve_read.py`, read the README that ships with the owner's
  Resolve (`/opt/resolve/Developer/Scripting/README.txt`) and ask about anything
  that differs; do not improvise a method name.

---

## R0. What it is

A second desktop TOOL beside File drop: **"Resolve timeline"**. Enabled per table in
⚙ Table settings → Desktop tools, with an output→field mapping like File drop's.
Run from a record: right-click a grid row, a canvas card or a kanban card →
**"Ingest info from Resolve…"**. The desktop client asks the running Resolve (its
scripting API, through the host's `python3`) for the chosen timeline, maps what it
got through the table's recipe, and writes ONE `record.update` onto that record —
after confirming any overwrite of a value the record already holds.

What it reads: the timeline's name, size, frame rate, start timecode, and its audio
tracks (each track's format and the clips on it). Read-only in every sense: Resolve
is the source of truth; nothing is written back to Resolve; the ingested track block
is not editable in the app — change it in Resolve and ingest again.

The owner's framing: *"similar to file drop, we enable and do some field mapping.
Same as file tool, desktop client does all the work and presents the app correctly
formatted data."*

---

## R1. The contract (`contract/tools.ts`, `contract/shapes.ts`)

### R1.1 A second tool id

```ts
export const TOOL_IDS = ['file_drop', 'resolve'] as const;
export const TOOL_NAMES = { file_drop: 'File drop', resolve: 'Resolve timeline' };
```

`tables.tools.resolve` is a `Recipe` like File drop's — presence means enabled,
replaced whole on `table.update { tools }`, field ids without foreign keys — with
per-tool rules in `toolsProblem`:

- exactly one step, and its analyzer is `resolve`;
- no `runs_on`, no `when`, no `into_manifest` on that step (they mean nothing here);
- `REQUIRED` is per tool: File drop still needs `filesystem.path`; Resolve requires
  nothing (an empty map is how a recipe starts out, as today).

`defaultRecipe` becomes `defaultRecipe(toolId)`: `{ steps: [{ analyzer: 'resolve',
map: {} }] }` for Resolve. `pruneTools`, `describe`, `resolveMap`, `mappedData`,
`fieldAccepts` work unchanged. `describe` prints "For the chosen timeline: Resolve
20.1 → Timeline name → Name, Frame rate → FPS, …" (the handshake's version slot is
the running Resolve's version when known, see R2).

### R1.2 The analyzer

```ts
const RESOLVE: Analyzer = {
  id: 'resolve', name: 'Resolve timeline', program: 'python3',
  how: 'asks the running DaVinci Resolve, through its scripting API, about one timeline of the open project',
  defaultRunsOn: {},
  outputs: [
    { key: 'resolve.version',  name: 'Resolve version',   type: 'text',   note: 'provenance: GetVersionString() of the Resolve that answered' },
    { key: 'project',          name: 'Project',           type: 'text',   note: 'the open project\'s name' },
    { key: 'timeline_name',    name: 'Timeline name',     type: 'text' },
    { key: 'dimensions',       name: 'Dimensions',        type: 'dimensions', note: 'timelineResolutionWidth × Height as ONE value, "1920×1080"' },
    { key: 'width',            name: 'Width',             type: 'number' },
    { key: 'height',           name: 'Height',            type: 'number' },
    { key: 'frame_rate',       name: 'Frame rate',        type: 'number', note: 'timelineFrameRate, 3 decimals: 23.976, 25, 29.97 — as ffprobe\'s frame_rate stores it' },
    { key: 'drop_frame',       name: 'Drop frame',        type: 'checkbox', note: 'timelineDropFrameTimecode' },
    { key: 'start_timecode',   name: 'Start timecode',    type: 'text',   note: 'GetStartTimecode(): "00:59:30:00"; ";" before the frames at a drop base' },
    { key: 'end_timecode',     name: 'End timecode',      type: 'text',   note: 'EXCLUSIVE: the label of the frame after the last (video_layout\'s "exclusive out")' },
    { key: 'duration',         name: 'Duration',          type: 'text',   note: 'HH:MM:SS:FF at the timeline\'s rate, non-drop (as ffprobe\'s)' },
    { key: 'duration_frames',  name: 'Duration (frames)', type: 'number' },
    { key: 'audio_tracks',     name: 'Audio tracks',      type: 'structured:timeline_audio', note: 'every audio track with its format and the clips on it (R1.3)' },
    { key: 'audio_layout',     name: 'Audio layout',      type: 'structured:audio_layout', note: 'DERIVED from the tracks (R1.4) so a layout compare can read it; leave unmapped to skip' },
    { key: 'audio_files',      name: 'Audio files',       type: 'link',   note: 'the clips\' media files as records of the LINKED table, found by exact absolute path (R1.5)' },
  ],
};
```

`OUTPUT_TYPES` gains `'structured:timeline_audio'` and `'link'`; `ACCEPTS` gains
`'structured:timeline_audio' → structured/timeline_audio` and `link → link`
(`fieldAccepts` already lets a VOCABULARY output into any link; a `link` output is
the same permission with a different resolver — by path, not by name).

Rules carried over from File drop, verbatim: an output the table has no field for
is not written; an output the script could not determine is left untouched, never
written as null; a `select` output is written only when the value is a choice (none
of these outputs are selects, so nothing to do); a tool never creates a row or
changes a schema.

### R1.3 The `timeline_audio` shape (new, in `shapes.ts`)

```ts
export const TimelineAudio = z.strictObject({
  tracks: z.array(z.strictObject({
    index:   z.number().int().positive(),                  // Resolve's 1-based track index
    name:    z.string().max(80),                           // GetTrackName: "A1", "Mix", "M&E"
    format:  z.string().min(1).max(16),                    // GetTrackSubType AS RESOLVE SAYS IT: mono, stereo, 5.1, 5.1film, 7.1, 7.1film, adaptiveN
    clips:   z.array(z.strictObject({
      name:   z.string().max(255),                         // the item's name as on the timeline
      path:   z.string().max(1024).optional(),             // the media pool item's "File Path"; absent for a generator / tone with no file
      start:  z.string(),                                  // timecode label, the item's first frame on the timeline
      end:    z.string(),                                  // timecode label, EXCLUSIVE (the frame after the last), like video_layout
      frames: z.number().int().nonnegative(),
    })).max(500),
  })).max(128),
});
```

- Registered beside the others: `SHAPES`, `SHAPE_LABELS` ("Timeline audio"),
  `FIELD_FORM_SHAPES` (a person may make such a field by hand, like `audio_layout`),
  `structuredError`, the 256 KB cap. Clip timecodes are checked for their FORM only
  (eight digits, `isTcLabel` in `contract/timecode.ts`): the base they count at is
  another field of the record (Frame rate, Drop frame), and a shape never reads a
  second field. A base-aware check belongs to the compare engine.
- `summarise('timeline_audio', v)`: `A1 stereo · A2 5.1 · A3 stereo (3)` — track
  name and format, clip count in brackets only when it is not 1; `detail = true`
  (search, filter, sort) names every clip, so a mix file's name finds the record. The plain line is what cards, grid cells and the
  folded tray block print.
- Tray block (`StructuredField.vue` → a small `TimelineAudioView.vue`): a read-only
  nested table in the junction-table style — a header row per track (name · format), one row per clip (name, start, end, duration as a label). A clip
  with a `path` shows the ⤴ show button `file_path` values get. Fold state per
  browser like every block field. No editor: the field form offers the shape, but
  the value only ever comes from the tool (a hand-made field of this shape shows
  "set by the Resolve tool" in place of an editor).

### R1.4 The derived `audio_layout`

A pure function, `layoutFromTimeline(ta: TimelineAudio): AudioLayout`, in
`shapes.ts` beside `LAYOUT_PRESETS`. One track per Resolve track, in track order,
named after it, channels by format:

| Resolve format | channels |
|---|---|
| `mono` | `M` |
| `stereo` | `L R` |
| `5.1` | `L R C LFE Ls Rs` (the preset) |
| `5.1film` | `L C R Ls Rs LFE` — as Resolve orders it |
| `7.1` | `L R C LFE Ls Rs Lrs Rrs` (the house preset) |
| `7.1film` | `L C R Ls Rs Lrs Rrs LFE` — house labels, Resolve's order |
| `adaptiveN` (N = 1…36) | `ch1 … chN` |
| anything else | one `?` channel and a problem string, so a compare fails on the count rather than passing on a guess |

Mute is NOT read anywhere in this tool (the owner, Oct 26): what is muted is
ephemeral and says nothing worth tracking — every track is ingested, every track
is in the derived layout. This is the
bridge to what exists (`diffLayouts`, the audio-layout summary and editor): the
owner does not need a compare today, but mapping this output costs one row in the
recipe and makes one possible later.

### R1.5 Link resolution by path — ADDS, never removes; mismatches are MARKED

(Amended Oct 26, evening, with the owner: the field this lands in is his general
**Inputs** link on Edits — every file an online edit was made from, picture
included — not a dedicated audio-files field. So the tool may not own the field,
and the warning must know which inputs are audio.)

`audio_files` is a `link` output whose VALUE is the list of distinct clip paths.
Routing: for a link field, the target table's path column is the one its own File
drop recipe maps `filesystem.path` to (`pathKeyOf`); if the target table has no
such column, the output is skipped with a notice ("*Files* has no path column for
the tool to match on"). A clip path that matches a record's path EXACTLY links it
(`link.add`); a path already linked is left alone; one that matches nothing is
reported ("not linked — no record of *Files* at /mnt/…") and NEVER creates a row.
**Nothing is ever unlinked by the tool**, so a link made by hand survives every
ingest and this field never appears in the overwrite dialog. A `single_target`
link field takes the first match and reports the rest.

**The warning** (`contract/resolveLinks.ts`, pure; shown through
`derived.fieldVerdicts` as the compare engine's `VerdictMark`, kind `warn`): for a
record of a table with the Resolve tool on, whose recipe maps BOTH `audio_files`
(→ the link field) and `audio_tracks` (→ the Audio tracks field), every linked
File that IS AUDIO and whose path is NOT among the clip paths of the record's
Audio tracks value is marked — on the pill, with the reason as its tooltip
("EP101_Mix_v2.wav is an audio input but is not on the timeline as last read from
Resolve"), and on the field as a whole (the grid cell, the tray row, the card row)
so a column of edits can be scanned. Derived live, never stored: re-ingest or
relink and it updates itself.

Which linked Files are audio, in order: (1) the Files table's Media column, when
its File drop recipe maps `filesystem.media` — the owner's is mapped; (2) else the
path's extension: wav, aif, aiff, bwf, flac, mp3, aac, ac3, ec3, m4a (NOT mxf: a
picture MXF cannot be told apart without the Media column); (3) neither → not
checked, no mark. A picture input is never flagged. A linked audio File whose path
column is empty is marked with its own reason ("has no path, so it cannot be
checked against the timeline"). No Audio tracks value on the record yet (never
ingested) → no marks at all, never a false warning. The reverse direction — a
clip on the timeline with no File record — stays an ingest-time notice.

### R1.6 Tests (`test/tools.ts`, `test/structured.ts`)

- `toolsProblem`: `resolve` with one step passes; two steps, a `runs_on`, a `when`,
  a `file_drop` analyzer under `resolve` each fail with the named reason; a
  `file_drop` recipe is unchanged by any of this (every existing check still runs).
- `fieldAccepts`: `timeline_audio` only into a structured field of that shape;
  `audio_files` into any link.
- `TimelineAudio`: a good value; an unknown key refused; a 9-digit label refused.
- `summarise` cases including the `(3)` count and an empty track list ("no audio
  tracks").
- `layoutFromTimeline`: every row of the R1.4 table; `adaptive6` → six channels; an unknown format → `ch1` plus the problem.
- The server refuses a bad `timeline_audio` value on write (like T9 for reports).

**Stop here for the owner's review of the contract: the outputs, the shape, the
derivation table, the link rule.**

---

## R2. The shell (`src-tauri/`)

### R2.1 Two commands

```rust
/// What the open project has: for the picker in R4. Fast; no timeline is read.
#[tauri::command] async fn resolve_timelines() -> Result<ResolveProject, String>
    // { version: "20.1.0", project: "Duke", timelines: ["EP101_OEV3", …], current: Option<String> }

/// One timeline, whole, as the analyzer's outputs (R1.2 keys) — `None` for the current.
#[tauri::command] async fn resolve_read(timeline: Option<String>) -> Result<Outputs, String>
```

Both are in `generate_handler!`, `build.rs`'s command list (the Oct 19 lesson:
`allow-resolve-timelines`, `allow-resolve-read`), and `grant`'s permissions.
Nothing here touches disk, so `Allowed` does not apply. The only value crossing
from the page is a timeline NAME, chosen from the list the shell itself returned;
it is passed as one `argv` element, never through a shell.

### R2.2 The script

`src-tauri/src/tools/resolve.rs` embeds `src-tauri/src/tools/resolve_read.py` with
`include_str!` and runs the host's first `python3` on `PATH` with the script on
STDIN (`python3 - list` / `python3 - read <name>`), reading one JSON document from
stdout. Nothing is written to disk; nothing comes from the server. The script:

1. Imports `DaVinciResolveScript` (the `RESOLVE_SCRIPT_API` / `RESOLVE_SCRIPT_LIB`
   convention, set by the shell as environment for the child, see R2.3).
2. `resolve = DaVinciResolveScript.scriptapp("Resolve")` — `None` means Resolve is
   not running, or external scripting is off: the error says both, with the
   preference path (Preferences → System → General → External scripting using: Local).
3. `pm.GetCurrentProject()` — `None` → "no project is open".
4. `list`: `GetVersionString()`, the project name, `GetTimelineByIndex(i).GetName()`
   for `1..=GetTimelineCount()`, and `GetCurrentTimeline()`'s name.
5. `read`: the timeline by name (the current one when none given); then
   `GetName`, `GetSetting("timelineResolutionWidth"/"Height"/"timelineFrameRate"/
   "timelineDropFrameTimecode")`, `GetStartTimecode`, `GetStartFrame`/`GetEndFrame`,
   and for `1..=GetTrackCount("audio")`: `GetTrackName`, `GetTrackSubType`, and `GetItemListInTrack("audio", i)` → per item `GetName`,
   `GetStart`, `GetEnd`, `GetDuration`, `GetMediaPoolItem().GetClipProperty("File
   Path")` (absent when there is no media pool item or the property is empty).
6. Prints the R1.2 outputs. Timecode labels are made in Rust from frame numbers and
   the rate/drop pair (`timecode.rs` is new; port `framesToTc` from
   `contract/timecode.ts` and test it against the same cases), NOT by string
   arithmetic in Python; `frame_rate` is parsed to 3 decimals; `dimensions` is
   `"W×H"` exactly as `contract/dimensions.ts` wants it.

Unit tests in `resolve.rs` run the parser over a captured JSON fixture (no Resolve
in CI); the script itself is exercised by the owner (R6).

### R2.3 Finding Resolve

Hardcoded per platform, with an environment override that wins:

| | module dir (`RESOLVE_SCRIPT_API`) | library (`RESOLVE_SCRIPT_LIB`) |
|---|---|---|
| Linux (Rocky) | `/opt/resolve/Developer/Scripting` | `/opt/resolve/libs/Fusion/fusionscript.so` |
| macOS | `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting` | `/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so` |
| override | `SPATIALDB_RESOLVE_API` | `SPATIALDB_RESOLVE_LIB` |

The shell sets `PYTHONPATH=<module dir>/Modules` and `RESOLVE_SCRIPT_LIB` for the
child. The handshake (`tools_available`) reports the `resolve` analyzer as the
`python3` version when both python3 and the library file are found, else `None`
("not on this machine") — it does NOT try to talk to Resolve at startup. The
running Resolve's version is learned at R4 step 1 and shown in the picker.

---

## R3. The settings UI (`ToolSettings.vue`)

The section becomes a list of the two tools, each with its own switch. For Resolve:
the Steps view shows the one step without "runs on", "when" or "into the manifest";
Add/remove step and reorder are absent; the mapping grid, JSON and Summary are the
same component. `recipe` / `defaultRecipe` / `toolsProblem` calls are keyed by tool
id instead of hardcoding `file_drop` (lines 133–208 today). The Summary's version
slot reads the handshake like File drop's does.

---

## R4. The run (`client/tools/resolveIngest.ts`)

Entry: `ingestFromResolve(store, recordId)`. Steps 1–3 are BUILT (the picker, the
read); this round replaces the readout dialog with the write.

1. `invoke('resolve_timelines')`. Any error → one notice, done.
2. The picker: **Read timeline** [select, the current timeline preselected] *from
   project "Duke" · Resolve 20.1* — Read / Cancel. Always shown.
3. `jobs.set(recordId, { label: 'Resolve', manual: true })`, `invoke('resolve_read',
   { timeline })`.
4. Map: `resolveMap(step, fields)`, `mappedData(outputs, map, fields)`; `audio_layout`
   derived in the page from `audio_tracks` (`layoutFromTimeline`; its problems are
   notices); the link output through the path resolver of R1.5 (the target table
   loaded like `loadVocabularyTables` does for vocabulary links).
5. **Conflict check**, pure and tested (`conflicts(record, data, fields)`): for
   every mapped NON-link field, compare what the record holds with what would be
   written — deep-equal for structured values. Fields that are empty or equal are
   not conflicts. If there are any, ONE confirm dialog: *Overwrite 3 fields on
   "EP101_OEV3"?* with a list `Field · old → new` (structured values by their
   summary), **Overwrite / Cancel** — all or nothing, like the drop's Replace /
   Cancel. Cancel writes nothing at all, not even the non-conflicting fields or
   the links.
6. One `store.mutate({ type: 'record.update', id, set: data, unset: [] }, { via:
   'resolve' })` plus the `link.add`s in the same batch, undoable: one Ctrl+Z.
   Then notices: "EP101_OEV3: Resolve done — 6 fields, 2 files linked"; "not
   written — …" per skipped output; "not linked — …" per unmatched path. An empty
   row just imports.
7. `jobs.delete(recordId)`.

History shows "via Resolve timeline" (`TOOL_NAMES`). The readout dialog of the
R2/R3 build goes away; the raw frame numbers it showed are no longer needed once
the reading has been seen to be right (the owner, Oct 26: "all works so far").

---

## R5. The trigger

"Ingest info from Resolve…" appears in three menus, only when `isDesktop()` and the
record's table has `tools.resolve`:

- the grid's row menu (`GridView.vue` `rowMenu`; for a multi-row selection the item
  is absent — one record at a time);
- the canvas card menu (`RecordCard.vue` emits `menu`; `CanvasView.vue` builds it);
- the kanban card: it has no context menu today, so it gets one with this single
  item (the same `ctx` styling), opened on `contextmenu` like the card's.

Closing the menu, then acting, as both existing menus do (`menuDo`).

No "New record from Resolve" on empty space (the owner, Oct 26: no). The tool
only ever writes onto a record that exists.

---

## R6. Tests and what needs eyes

- `test/resolve.ts` (pure): the conflict check — empty record → no conflicts; equal
  values → none; a changed number, a changed structured value, a changed link set
  → each listed with old and new; the dialog text builder. Link resolution: exact
  path matches; a near miss (trailing slash, case) does not; the target table
  without a path column is skipped with the right notice; `single_target` takes the
  first.
- `test/filedrop.ts`-style run through the real app and server with `invoke` FAKED
  (`uiHarness.ts`): the menu item is absent in the browser and on a table without
  the tool; present otherwise; the picker shows the fake project's timelines with
  the current one selected; Read on an empty record emits one `record.update` with
  every mapped field and `via: 'resolve'`; Read on a record with one differing
  field shows the overwrite dialog, Cancel writes nothing, Overwrite writes all;
  History says "via Resolve"; the tray block renders the summary and unfolds to
  the table.
- `cargo test`: the JSON parser over the fixture; `framesToTc` at 23.976, 25,
  29.97 DF against the TypeScript cases.
- **Needs eyes** (nobody has run this with a real Resolve; say so in DESKTOP.md):
  the script against the owner's Resolve — the method names of R2.2, what
  `GetTrackSubType` returns for his tracks, whether `GetClipProperty("File Path")`
  is absolute on his mounts, a timeline with tone + mix on one track, an
  `adaptive` track; Rocky's `/opt/resolve` paths; `python3` on `PATH`
  importing the module.

---

## R7. Build order

1. R1: contract + shape + derivation + tests. **Stop for the owner's review.**
2. R2: `resolve.rs`, `resolve_read.py`, `timecode.rs`, the two commands, build.rs,
   grant, the handshake slot; a `cargo test` fixture. DESKTOP.md gets a section.
3. R3 + R5: Table settings for the second tool; the three menu items wired to a
   stub that shows the picker and a notice with the raw outputs — something runs
   end to end before mapping exists.
4. R4: mapping, link resolution, the conflict dialog, the batch, notices, History.
5. R1.3's tray block and the summary on cards/grid.
6. Polish: the ⤴ show on clip rows; `describe` wording; API.md "Tools" and
   VOCABULARIES untouched; UI-NOTES "needs eyes" updated.

One patch per round, as usual.

---

## R8. Out of scope, on purpose

Video tracks and their items (a `video_layout` from the timeline is a plausible
later output, next to `audio_layout`); markers; render and delivery settings;
writing anything back to Resolve; reading `.drt` / `.drp` files without Resolve
running; ingesting several timelines in one go; creating a new record from Resolve;
editing the ingested track block in the app; a timecode FIELD TYPE (labels stay
text, as ffprobe's do); FFI to `fusionscript.so` from Rust (python3 on PATH is the
decision; revisit only if the module becomes a problem on a platform).
