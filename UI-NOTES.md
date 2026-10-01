# UI notes

First impressions and friction, written down while they are still noticeable —
after a week of use you stop seeing half of them. Triaged into three kinds,
because each is handled at a different time:

- **Bug** — wrong, or stops you working. Jumps the queue.
- **Friction** — works, but fights you. Worth knowing early, because it changes
  how the NEXT piece gets built.
- **Polish** — spacing, colour, consistency. Saved for one pass once the screens
  stop moving (after canvas authoring); done together it comes out consistent.

Add to this freely. One line is enough; screenshots help, because the build
sandbox has no browser and `test/ui.ts` cannot see layout or paint.


## When you come back — a checking order

**Adding links, in the tray and in the picker (Oct 1)** — owner: a full link field
has no good way to add more (a junction's has its "add another…" line); and in the
picker "it's not clear what's already in and what's being searched", with the pills
laid out differently while adding.
1. Every link field in the tray ends with the way in: "add a Deliverable…" when
   empty, "add another Deliverable…" when not ("change the …" on a link ticked
   single). The noun is the TARGET table's singular name — set one on the table if it
   reads "add another Deliverables…".
2. Click it (or the field): the pills above do not move. The line becomes the search
   ("+ find in Deliverables…") and the results hang under the field as a dropdown,
   over what is below — nothing in the tray shifts. Enter links and stays open; the
   new link appears as a pill above. × on a pill still removes it while searching.
3. Backspace on an empty search no longer unlinks in the tray (it still does in the
   grid's picker, where the chips are in the box with you).
4. The grid's picker (and the canvas ones) now has two sections: LINKED — darker,
   the chips — then ADD, the search line and its results. Is the pair of labels
   right, or too much?
5. Not touched: the hint beside each result still lists every value of the record,
   raw created-at timestamp included ("2026-10-01T16:07:55.972Z · Vlad"). Say if the
   system fields should be left out of it.

**The grid follows the keyboard (Oct 1)** — owner: "when navigating fields on a table
with arrows the view doesn't scroll". Two things, one of them older than it looked:
1. SIDEWAYS there was no scrolling at all. Arrows, Tab / Shift+Tab (including the wrap
   to another row), add-record and duplicate now bring the cell's column into view —
   out from under the pinned `#` and primary when going left, not just to the edge.
   A mouse click on a half-visible cell does NOT scroll (nothing moves under the pointer).
2. DOWN it scrolled, but a pixel short per row: leftover global `.grid` table rules
   in App.vue gave every cell a top and left border the grid never asked for, so rows
   were 31px while the scroll arithmetic counts 30. Forty rows down, the selection
   was a row below the window. Those rules are gone — which also means the lines
   between cells are 1px now, not 2. Say if you preferred the heavier lines; that is a
   one-line change made on purpose rather than by accident.

**Video layout — a new structured shape (Oct 1)** — a mini EDL on a record: what is
on the file and where. Add a field → structured → "Video layout", open a record.
1. Enter a head build the way a spec writes it: Black, type its start
   (`59:27:00` completes to 00:59:27:00) and `3s`; Bars and tone `15s`; Slate `10s`;
   Black `5s`; Program, start `1:00:00:00`. Starts you did NOT type are greyed behind
   a ↳ — is typed-versus-worked-out clear enough at a glance?
2. Program should wear a ✓ and the line under the list say the head adds up. Change
   a length: the ✓ goes, and a gap (amber, hatched block in the strip) or an overlap
   (red, outlined block) says by how much. They are warnings — the value saves either way.
3. Length cell: `3s`, `1m30s`, `72f`, `00:00:03:00`, a bare number (seconds), `open`
   for "length unknown", EMPTY for a marker. A bare `300` is 300 seconds, not Resolve's
   3:00 — say if you would rather it were digits-from-the-right.
4. The strip is NOT true to time (a log of the length; open blocks a fixed width) so
   3s of black and a 90-minute program are both readable. Right call, or do you want
   a true-scale toggle?
5. Markers: add Marker, name it, type a start. Several close together stack on up to
   three rows above the strip — does that hold with your real FFOA/LFOA/2-pop sets?
6. Typed timecodes print under the strip only where there is room (the list has them
   all). On an as-built layout with every start typed, is that enough, or too sparse?
7. The ENDS column hides when the tray is narrow (an end is the next item's start,
   shown there). Widen the tray and it returns.
8. Grid cells and canvas cards show a mini strip before the one-line summary.
9. 29.97 / 59.94: tick drop-frame — starts are rewritten with `;`, a start on a skipped
   label moves to the next that exists. Arithmetic is on the LABELS: a minute of bars
   from 00:58:30;00 ends at 00:59:30;00 (not ;02). Is that what you expect of a spec?
10. Not built: comparing a file's layout with a spec's (the `kind` is there to match
    on), and filling a File's layout from the desktop client.

**The report outline, tightened (Sept 30)** — owner: "Deliverables 3, followed by
Deliverables… so much negative space and repeated headers that it is hard to read."
There was no technical reason for the doubling. Now:
1. No separate heading over a section: the header row's first cell is the label and
   count ("FILES 3"), and the row exists only when the level has columns to name
   (Status, Path, rollups) or its node has several child sections. Label-only levels
   have no header; the faint first line ("Deliverables › Work › Files") names them.
2. An empty section is one faint line — "— no files —".
3. Columns hug their content (file and Status side by side, not at opposite edges),
   and line up across every section of a level. Does that hold with your real names
   — and is a long Path, cut at 320 px with an ellipsis, still right for a report?
4. Rules only between top-level records; nesting is the indent and its left line.
5. Still repeated: "FILES n · Status" above each non-empty Files section. Now that
   the columns line up it could be drawn once per top-level record instead — say if
   you want that.

**Reports through a junction (Sept 30)** — Work › Deliverables › Files again, now
that File→Deliverable is the Delivery junction. In a report's definition:
1. Under the Deliverables level, "+ descend into…" lists **Delivery ⇄ Files · through
   Delivery** (the junction column). Tick THAT one, not "Delivery.Deliverable ←
   Delivery" (which is the pair rows as a level — hover either for the difference).
   Is the pair of entries clear enough, or should the ⇄ one sort first / read differently?
2. "pinned to" then offers **Work through Files.Work** — tick it; a shared
   deliverable should list only the files of the Work it sits under.
3. A new **pair** block under it: the junction's own fields (Status, Notes, Created…).
   Tick Status → each file shows its status in a column right after its name.
   "+ pair filter" → "Status is Accepted" keeps only accepted files.
4. On the Deliverables level, "+ rollup" → count where → the field list now ends with
   **Delivery › Status** etc. "accepted" = count where Delivery › Status is Accepted;
   then on Works, count where its rollup accepted > 0 = satisfied.
5. Layout to look at: the pair column is drawn in the primary text colour to set it
   off from the file's own (secondary) columns — enough, or does it want a header hint?
6. **The other way round — Deliverables › Work › Files.** Root Deliverables; descend
   via "Work.Requested Deliverables ← Work"; descend via "Files.Work ← Files". On
   that Files level "pinned to" now offers **Deliverable ⇄ paired through File
   Deliveries** (beside "Deliverable through Files.Deliverable Target", which is the
   plain link — "meant for", not "delivered against"). Tick the ⇄ one and the **pair**
   block appears on this level too, Status and all.
7. A second level now shows "pinned to — nothing to pin to yet…" instead of no block
   at all. Useful, or noise on every two-level report?

**Grid columns (Sept 29)** — pinned, resizable, reorderable; all of it layout, none
of it visible to `test/ui.ts`:
1. **Pinning.** Widen a table past the window and scroll right: `#` and the ★ primary
   column must stay put, with the other cells sliding UNDER them (opaque; check on a
   hovered row, a selected row, and a fresh blue row). The primary has a 2px right
   border as its edge. The `#` column is a fixed 56 px — the primary's `left` offset;
   if a row number ever needs more than five digits, both numbers move together.
   Group headers were already sticky-left; check they still are with the pins.
   (Sept 29, second pass: hover on a pinned cell no longer shows the cells underneath —
   every row-state colour is translucent and is now layered on the app background.)
2. **Resize.** The handle is a 9 px strip on a header's right edge (lights up accent
   on hover, `col-resize` cursor). Drag it; the column follows live and the width is
   saved on release — to the VIEW, for everyone, and NOT as an undo step (Ctrl+Z
   after a resize should undo your last edit). Double-click the handle = auto width.
   A resized column is exact; an unresized one still auto-sizes within 120–420 px.
   (Second pass: the first drag no longer jumps — the saved width is the column's
   border-box width, the same number the handle measures.)
   Does the header text clip sensibly on a narrow column? (It is `nowrap`; a very
   narrow column may keep the header's width — say if that looks wrong.)
2b. **Sort is the ⇅.** A header is no longer a sort button: a faint ⇅ appears on hover
   at its right; click it (shift adds a sort). Once sorted it shows ▲/▼ and stays
   visible. This is what stopped a resize from ending in a sort of the column beside it.
3. **Reorder.** Drag a header ≥4 px: it dims, and an accent bar on another header
   shows the side it lands on. A short press still sorts. The primary cannot be picked
   up and nothing lands left of it. The same order is in the **fields** menu with ↑↓,
   and the menu says where the DEFAULT order lives.
4. **Table settings → Field order** (folded) is the schema's own order: ↑↓ there move
   `position` — this is what the tray, cards, the picker and a never-arranged view
   show, and what decides the ★. The ⚙ header popover no longer has ← →.

**The desktop client (Sept 27)** has a checking order of its own at the end of
`DESKTOP.md`; nobody has opened its window yet. Also unseen in the web app: the
**Desktop tools** section at the bottom of Table settings (`ToolSettings.vue` — a
four-column row per output; the dialog grew to 560 px and scrolls), the drop overlay
and notices strip (`App.vue`, desktop only), and the `⤴ show` button in the record
panel (desktop only).

Five steps have landed since anyone last LOOKED at the app (the owner said he could
not check each one). Everything below passes its tests; none of it has been seen.
Ordered by how likely I think it is to be wrong, most likely first — so the first
ten minutes find the most.

**Before anything:** `./scripts/backup.sh dump`, then `npm ci`, then create your
login — `./scripts/user.sh add you@example.com "Your Name" admin` — or the app will
show you that command and nothing else.

1. **Signing in through YOUR setup.** Tested against a bare server only. If you run
   behind a proxy, it must pass `Host` and `X-Forwarded-Proto`; symptoms if not:
   login "succeeds" and you are immediately signed out again (cookie refused), or
   every save is a 403 "cross-origin request refused" (Host rewritten).
2. **Comparison** (newest). In a link field's ⚙: the "compare" tick and the PAIRS
   editor (three selects and a param per row — is it legible in the popover, or does
   it need its own dialog?). In the tray: the strip under the header (✓/✗, side by
   side, seed from), ⚠ beside fields, and the SIDE-BY-SIDE table (five columns at
   tray width — this one I expect to need reworking). On a card: ⚠ at the end of a row.
3. **The kanban board** — views ▾ → "+ new board". Columns are 240px, cards
   show the shown fields; does the drag ghost read over a column, does the column
   highlight, is "(none)" obviously a drop zone? Also the "single" tick beside
   "membership" in a link field's ⚙.
3. **The canvas's defaults bar** — a slim row under the canvas's controls:
   a switch, "New records here →", chips, "+ add". Does it read as information
   first and a control second? Is the right-click entry ("Link new records here to
   this") discoverable? The "+ add" popover holds a table menu and the link picker —
   check it is not clipped by the canvas.
3. **Structured fields** — all in the record tray, none of it seen:
   the AUDIO LAYOUT editor (a small table of tracks: tick box, number, format, name,
   channels, language, ↑ ↓ split ×; then add-preset buttons, merge, copy, paste; then
   "compare with" and its verdict box — green border when it matches, red with the
   issues listed when not). Is it legible at your tray width? The MANIFEST view (a
   scrolling member table for a DCP; a frame-range line for a sequence). And in Table
   settings, "Add standard Files fields…".
3. **Grouping.** `group` in a table's toolbar. Headers are the same height as
   rows and span the full width; check they read as headers, that "+" on a header is
   findable, and that scrolling a long grouped table stays smooth (the header rows
   are inside the windowing).
3. **Boards inherit**: give your boards table a Work link, tick "membership" on it
   (and on Files' Work link), set it on a board, then double-click that canvas to
   create a file — it should arrive already linked to the work.
4. **The link handle on cards** (step 5). A 10px ring at the right end of a link row,
   shown on hover. Pure positioning, never seen. If you cannot find it or cannot grab
   it, say so — it is a few lines of CSS.
3. **Clicking arrows** (step 5). 14px invisible hit width. Too greedy (steals pans) or
   too stingy (cannot select)? Does the label box fit its text?
4. **Notes on cards** (step 4). Text size at your zoom, image scaling, wheel behaviour
   (scrolls the note only on a SELECTED card).
5. **The steady editor** (step 2). Does ANYTHING move when you click in, type, save?
   Drag its bottom edge to resize. And the two clipboard paths that no test can
   reach: paste a screenshot; paste an email.
6. **The view dropdown** (step 3): `VIEW Grid ▾`, first in the table's toolbar.
7. **Settings** (bottom of the tree): You / Users / History.

If something is broken, the most useful report is a screenshot plus what you
clicked — that is what found the checkbox bug and the blank canvas.

## Open

From the Sept 20 session. Numbers are the agreed build order (PLAN.md).

| # | Kind | Note | Plan |
|---|---|---|---|
| — | Polish | The ⚙ beside the section in the breadcrumb: "don't love where it lives, no better idea — leave it". | It moved anyway: it is on the section's row in the tree now. Revisit if that is no better. |
| 6 | By design | A field's type cannot be changed. | Unchanged. |

## Needs eyes (built, tested headlessly, never SEEN)

- LINKING ON THE CANVAS — everything here is positional, and none of it has been seen:
  * the HANDLE: a 10px ring at the right end of a link row, inside the card's
    padding, appearing when you hover the row or select the card. Is it findable?
    Is it where you would reach for it? (It is always on the RIGHT, even when the
    arrow for that row leaves from the left.)
  * the dragged line should start at that row and follow the pointer; valid cards get
    a dashed outline, the one under the pointer a solid one.
  * arrows should be easy to hit (14px invisible hit width) without getting in the
    way of panning; a selected arrow turns accent-coloured with a label at its middle.
    Check the label's box fits its text — its width is ESTIMATED from the character
    count (6.6px each), not measured.
- NOTES ON CARDS — a fixed 132px window under the rows. Check: text size (11px) is
  readable at your usual zoom; an image scales to the card's width; the wheel
  scrolls the note when the card is SELECTED and pans otherwise; resizing the card
  taller gives the note the room; and arrows still meet the right rows.
- SIGNING IN — the login screen (centred box), Settings → You / Users. Try: a wrong
  password; signing out; and the one that matters — leave a tab open until the
  session is gone (or delete your row from `sessions`), make an edit, and check the
  login screen says your change is waiting and that signing in saves it.
- THE STEADY EDITOR — check nothing moves when you click into it, type, or save;
  that the bottom edge drags to resize (and is remembered); that the status word
  ("saved" / "editing — saves when you click away") is noticeable but quiet; and
  that 340px is a sensible default height in a tray of your usual width.
- THE NEW SHELL — all of it is layout. The tree (240px), the tab bar, the canvas's
  context bar now at the TOP, the tray with its splitter on the right, the status
  readout (should never change width), the dialogs (centred, focus in the field;
  a delete confirm should open with focus on Cancel).

`test/ui.ts` has no layout and no paint. These work in it and are unverified in a
real browser — if one is off, it goes in the table above.

- The selection ring: drawn, unclipped, and visibly different while editing (green)
  and when the grid does not have keyboard focus (grey).
- Keyboard scrolling: arrowing past the bottom or top edge should scroll the row
  into view, clear of the sticky header. Pure arithmetic, untestable without layout.
- Clicking a checkbox and then using the arrow keys. Focus is handed back to the
  grid in code; happy-dom does not move focus on click, so this was never exercised.
- A second click on a selected cell opening the editor, and the editor's text
  being selected so that typing replaces it.
- The sort / filter / fields dropdowns (still not driven by any test).
- The column-header popovers ("⚙" field settings, "+" add field): same
  fixed-position-from-a-rectangle approach as the link picker, so same risk. The
  "+" one is right-aligned so it should not run off the screen edge. The ⚙ only
  appears on HOVER over a header — check it is discoverable enough.
- The record panel: a 420px drawer over the right edge. Check it does not cover
  what you are working on (it overlays; it does not push the grid/canvas aside),
  and that the link picker opening INSIDE it is positioned sensibly.
- Canvas: card heights are computed, not measured — check the arrows actually
  meet the card edges, especially on folded cards and cards with 0 or many rows.
  Also the right-click menu position, and whether double-click-to-create lands
  the card under the cursor.
- SCOPE — the second breadcrumb: `› [All Projects ▾]`, turning accent-coloured when
  narrowed. Check it reads as "where I am", that the "in Duke" / "not scoped" badge
  in the grid toolbar is noticeable without shouting, and that the "membership"
  tick box on a link field's settings is findable. To try it: a section with a
  scope table (section ⚙), and a link field to that table with membership ticked.
- BOARDS AS RECORDS — after migrating, your canvases are rows in a "Canvases" table
  (kind: boards). Check: the canvas picker still lists them by name; "▦ open" on a
  row goes to the board; renaming the row renames the canvas everywhere; a board
  placed on another board opens it on double-click (the record panel is then
  reached from the right-click menu → "Open record").
- HOME and the BREADCRUMB — the first thing a colleague sees. Cards in a grid; the
  ⚙ on a card appears on hover (admin). In the header, "spatialdb › [section ▾] ⚙":
  check the section dropdown reads as a breadcrumb and not as a form control, and
  that the address bar changes as you move (and that Back does what you expect).
- RICH TEXT — the editor mounts and saves in the tests, but nobody has SEEN it.
  Check: typing feels right; the toolbar buttons light up for the current format;
  Ctrl+B/I work; pasting a screenshot (Print Screen, then Ctrl+V) drops an image
  in; pasting an email keeps its tables; the ⇤ button widens the panel. Pasting is
  the part happy-dom cannot exercise at all — the clipboard path is untested.
- ATTACHMENTS — thumbnails at 96×72, the × on hover, drop highlighting.
- THE DOCK — all layout, none of it visible to the tests. "▤ table" on a canvas:
  the grid should take the left ~460px with a draggable splitter; the ◧/⬓ button
  (or Ctrl+Shift+B) moves it to the bottom. Check the canvas still fills the rest
  and still pans/zooms correctly after a resize, and that the record panel (right)
  does not fight the dock (left).
- DRAGGING ROWS: press a row NUMBER and drag onto the canvas. A ghost should follow
  the pointer, brighten over the canvas, and the cards should land with their
  top-left at the drop point. In the tests every element is 0×0, so "did it land
  where I dropped it" has never actually been observed.
- PORTS — the thing most worth looking at. Unfold two linked cards that show the
  link field (and, on the target, a backlink field): the arrow should run from one
  ROW to the other, at the rows' vertical centres, touching the card edge. Fold
  either and it should move to that card's edge. Check a card you have resized.
- Arrow colours against the dark canvas, the coloured dot on port rows, and the
  legend popover (▾ beside "arrows: all") opening ABOVE the control bar.
- The command palette: centred near the top, dimmed backdrop. Check the result rows
  read well (label · table · other values) and that "on this canvas" is visible.
  "At the cursor" means where the pointer last was over the canvas — check a
  placed card lands where you expect, and that Shift+Enter cascades sensibly.
- Backlink chips (italic, like lookups) in the grid and as clickable chips in the
  panel's field and its "Referenced by" section.
- Lookup cells: italic and slightly dimmed to read as "not yours to edit". Check
  that distinction is visible but not distracting.
- The link picker's POSITION: it is `position: fixed`, placed from the cell's
  on-screen rectangle, which is all zeros headlessly. It should open exactly over
  the cell it edits, and close if you scroll the grid underneath it.
- The column-width fix: entering edit mode should no longer change any column's
  width. Verified only as a mechanism (the value stays in the DOM, hidden, under
  the editor) — not as pixels.

## Fixed

| Note | What it was |
|---|---|
| Links and backlinks rendered four different ways (bordered chips in the grid, italic button chips in the tray, plain draggable text on cards, joined text on kanban) — confusing. | ONE pill everywhere (`RecordPill.vue`, global `.pills`/`.pill` styles in App.vue): at rest just the name; hover the cell / field / card row and every name becomes a bordered pill; hover one and its ⤢ (open) and × (remove the link — or delete the pair, on a junction column) show, space reserved so nothing shifts. Click opens; in the tray and on cards a press that moves drags the record onto a canvas. Backlink pills stay italic. Not seen rendered — check the card rows: a pill sits 6px in from where plain text sat. |
| Some pills had ⤢ and some (junction pairs) did not; a click anywhere on a pill opened the record — easy to hit while selecting or dragging. | Every pill has the ⤢ on hover and ONLY the ⤢ opens (like a column sorting only from its glyph); a click on the name does nothing, a still press on a draggable pill does nothing. A junction pair's pill also has ✎ (change its status — grid, tray, and now the canvas card, anchored at the card). Pair label order flipped to "Texted Master › Uploaded": the deliverable is the intent, the status follows. |
| No way to duplicate a record or copy a value between records. | **Duplicate** (`duplicate.ts`): Ctrl+D on the selected rows, ⧉ on the row handle beside ⤢, ⧉ in the tray header, "Duplicate record" in the card menu. Copies every value but created_at/created_by (the copy is created now, by you), the outgoing links, not backlinks, not junction pairs, not placements; the primary text gets " (copy)"; not offered on junction tables. One Ctrl+Z. The grid jumps to the copy wherever the view's sort puts it; the card menu places the copy beside the original. **Copy/paste** (`cellClipboard.ts`): Ctrl+C / Ctrl+V on a grid cell or a focused tray field — like data only (text group, number, date, checkbox, select if the target HAS the choice, multi-select, link if both point at the same table — replaces all, a single target takes the first). Goes through the system clipboard as text, so it pastes out to a spreadsheet and plain text pastes into text/number/date cells; anything refused says why in a notice and writes nothing. Ranges and resolving pasted names to links: later. The row-handle column widened 56→68px for the second glyph. |
| Ctrl+V popped a "Paste" button (Firefox) that had to be clicked before the paste went through. | `navigator.clipboard.readText()` asks for permission, and Firefox answers with that button on every read. Copy and paste now go through the browser's `copy` / `paste` EVENTS on the focused grid or tray field — text via `clipboardData`, no permission, no prompt; the in-app value still rides alongside. |
| Schema work with many fields meant one column header at a time; Table settings was neglected (the singular-name input had lost its label — that was the mystery "(optional)" box — and "Add standard Files fields" was a hard-coded convenience nobody asked for). | Table settings is now the schema editor: the field list is its body — grip to drag (rows slide, one batch on release, the ★ previews which field would become the primary), ★ / name / type / one-line summary, ↑↓ for the keyboard, ⚙ unfolds the field's full settings (rename, choices, arrows, compare, delete) under the row, and "+ add field" is the same form as the grid's, kept open so Enter adds and the focus returns for the next. Singular name labelled again. "Add standard Files fields" removed, with its contract constant; File drop creates the fields its recipe needs on its own. Wider dialog. Not seen rendered — check the drag feel and the row density. |
| Audio layout editor: a hint in every cell ("name — Full mix, M&E, Dialog…", "lang") made ten tracks the busiest thing in the tray. In the comparison, a layout pair showed as truncated JSON on both sides — useless for seeing what differed. | Editor: a header row (#, format, name, channels, lang), empty cells. Comparison: a structured value reads as its summary everywhere ("2 tracks / 8 ch (5.1, 2.0)"), and side-by-side draws a layout pair TRACK BY TRACK — found left, expected right, aligned by track number, format · name · channels · lang, the tracks the diff points at (or beyond the shorter layout, or all of them for a count/order/grouping issue) in red — with the diff's own issue lines beneath. |
| The record tray read as "heading, then box" per field — a tall list of pairs, intimidating on a big record. | The label is a TAB on its box: same border and background, sitting 1px into the box so its bottom edge opens into it, the box without its top-left radius — one shape per field. ★ and the compare ⚠ ride in the tab. Focus / editing / read-only colour the tab and box together (CSS vars on the field). Rich-text blocks get the same tab with the editor's 6px radius. Same height as before; the gain is grouping, not density. |
| A hand-resized card did not grow when a link row grew (three deliverables added to a Work drew over each other). | A stored height is a FLOOR-checked minimum now: `effectiveHeight` = max(user height, what the rows need); rich blocks stay the flexible part. |
| Links in the tray wrapped in a flow — a long deliverable name was unreadable. In the grid, eight links looked like three. | Tray: links, backlinks and pairs one per LINE. Grid: `CellPills` MEASURES — the pills that fit at natural width show, the rest are hidden and a **+N** badge at the cell's right edge says how many (none when all fit); re-measured on column resize. A first cut shrank three pills to stubs, which made a full cell look empty. The badge opens the record. Referenced-by in the tray stays a flow. |
| A card row with several values was one row tall (`.card-field { height: --row-h }`) whatever the arithmetic counted — the values drew over the rows below, resize or not. | `.card-field.tall` is `height: auto`; `.card-line` is one `--row-h`, the unit `cardLayout.rowLines` counts. Pre-existing; the pills only made it visible. |
| A reload, or coming back with the browser's Back, landed on Home. | Not the router: during hydration the pickers watcher set `tableId`, the URL mirror fired with the section still null, and wrote `#/` over the real address a tick before it was read. The mirror now never writes a HOME route before boot. Also: a bare address (no hash — the desktop window) opens where you last were. `test/route.ts` — the first cold start on a deep link. |
| Tray hard to parse; tan header kept white text | Fields and the comparison strip in recessed wells; contrast-based text flip. The value boxes inside the well keep their old tone — judge whether they want a step lighter |
| Arrows from field rows; hover-dimming flicker; one-line link rows; light headers with light text | Arrows from the card edge; modes always/focus/off with selection-based dimming; vertical link lists; luminance-flipped header text — none of it seen rendered |
| An open record closed when going to a canvas or another section | Persists across all navigation (only closes if the board being opened IS that record) |
| Link pills' ⤢ too small to hit; the wheel mode reset to trackpad per canvas | The whole pill opens the record (× removes); wheel mode remembered per browser |
| Field settings popover off screen for the rightmost columns | Popover measures itself and stays on screen |
| "+ new view" / "+ new board" different designs | Same style |
| Matching compared fields showed nothing | Green ✓; and the cue now also in grid cells and board cards |
| Port dots astride the card edge | Inset 4px |
| Canvas defaults switch re-defaulting per canvas | One session-wide switch |
| "+ add" in the defaults bar stuck on the last picker | Resets |
| Board hid the plain grid | Permanent built-in Grid |
| The docked grid "doesn't jive" with a future split-pane system. | Removed entirely. **Check the canvas still fills its area** — its wrapper element went with the dock, and a collapsed canvas is exactly what the headless tests cannot see. |
| No way to follow a linked pill to its record. | ⤢ on every link / backlink pill, grid and tray; opens the record on the right. |
| Compare did not belong in the audio layout cell. | Removed; the diff function and endpoint remain for a future validation area. |
| Links could not be made or removed on the canvas; arrows did not say what they were. | Drag from the handle on a link row to a card of the right table to link; click an arrow to select it and see its field's name; right-click it → Remove this link… → confirm. |
| Rich text and images did not show on canvas cards ("[image]"). | A note is now a formatted block under the card's rows, images included, in a fixed-height window that scrolls inside itself. To see it: right-click a card → "Fields on … cards…" and tick the rich text field. |
| The view system was half-baked: you could make views but not see a list of them. | The view tabs looked like any other toolbar button. One control now — `VIEW Grid ▾` — names the current view and, opened, lists them all with rename / duplicate / delete and what each one does. In the table's toolbar, not the tree (the owner's call). |
| The rich text editor was jumpy. | It swapped a rendered view for an editor on click, and a toolbar appeared. Now it is always mounted, with a permanent toolbar, a fixed height you resize by dragging, and a status word instead of things moving. |
| Canvas / Table / History tabs "don't make sense anymore" now that the sidebar exists. | Removed. The tree is the navigation. History moved into Settings, a footer at the bottom of the tree. |
| **Canvases completely broken after the shell rewrite**: blank, no dot grid, no interaction, the browser's context menu on right-click. | Rewriting the header's CSS deleted the block it sat in — which also held `.workspace`, `.dock`, `.splitter` and `.drag-ghost`. With no `.workspace` sizing the canvas had ZERO HEIGHT. 800 tests stayed green: happy-dom has no layout. Restored, and `test/sections.ts` now has a STYLESHEET GUARD — every class the layout depends on must have a rule in the built CSS. (Its first version was fooled by a comment mentioning `.workspace`; it strips comments now, and was red-checked.) |
| The "▤ table" button in the canvas's bar was a raw white browser button. | It is passed into CanvasView through a slot, and scoped CSS does not reach slot content. Styled with `:slotted()`. |
| Checkboxes in field settings ("membership", "advanced") sat in the middle with their label at the far right. | A leftover GLOBAL rule from the phase-1 debug grid, `.grid input { width: 100% }`. The popovers are inside the grid's `<table>`, so every checkbox became a full-width box with its tick drawn in the centre. Removed; found from the owner's screenshot — invisible to the headless tests. |
| "Projects" looked indented one step too far next to "Everything". | The tree reserved an icon slot even for a section with no icon, while Everything had its ∗. The slot exists only when there is an icon; the ∗ is gone. |
| The tabs sat beside the tree, so they read as belonging to the selected row. | Full width, above the tree: tabs are the broad choice, the tree is where within it. |
| Going from a scope's contents back up to its sibling ("Duke 101" → "Unassigned") was not visible. | The deepest unfolded level sits in a recessed WELL: darker, inset shadow, an accent rule down the left. (His idea.) |
| Nothing said which tables a scope narrows. | A "scoped" tag in the accent colour, beside the existing grey "boards" tag. |
| Creating or deleting a record made the header jump. | "N queued" / "N in flight" badges appearing and disappearing. One fixed-width status readout now. |
| Canvas / Table / Schema / Undo were buttons. | Real tabs: Canvas · Table · History. Schema removed; its table-level controls are in the tree's ⚙ → Table settings. |
| Per-tab controls were mixed into the header. | A context bar under the tabs: the grid's, and the canvas's (moved up from a floating bar). |
| Tables and canvases were dropdowns. | A left tree: sections › scopes › Tables / Canvases. ☰ hides it. |
| The record panel floated over the right edge, covering the "+" column. | A tray beside the viewport, resizable. |
| Sort / filter / fields menus stayed open. | Any press outside closes them. |
| Browser dialogs. | The app's own, everywhere. |
| Backlink chips in the record panel were unreadable (dark on dark). | They are `<button>`s, and a button does not inherit text colour — the browser's default near-black was showing. Explicit accent colour now; the grid's were `<span>`s and unaffected. |
| The field-settings ▾ in a column header looked like part of the sort arrow. | It is a ⚙ now. |
| Toggling card fields → a wall of `500 internal error`. | Migration 005 not applied, and nothing said so. Server now answers 503 naming the file and command; one banner line instead of one per retry; `npm run dev` applies pending migrations. |
| Unplace and canvas movement had no undo. | Ctrl+Z / Ctrl+Shift+Z everywhere, plus ↶ ↷ in the header. Moves, resizes, folds, place/unplace, cell edits, links, settings; deletes too (via the server). |
| The ⤢ over the row number jittered the grid. | It changed layout on hover; now it only changes paint. |
| "(3)" after the canvas name. | Card count — now " · 3 cards". |
| Selection box cut off at the left and right edges. | It was the browser's focus ring on an `<input>` inside a wrapper that must clip. The ring is now an inset outline on the cell itself. |
| Enter flashed the field and did nothing. | Every cell was a permanently live input. Now select-then-edit: arrows/Tab move, Enter/F2/typing edit, Enter commits and moves down (stays put on the last row), Tab right, Shift+Tab left, Escape cancels, Delete clears, Space ticks. |
| Entering edit mode made the whole column wider, snapping back on commit. | Auto-layout table + an `<input>`'s built-in ~20-character preferred width. The value now stays rendered (hidden) under an absolutely-positioned editor, so it keeps sizing the column. Fixed per-column widths (resizable, as in Airtable) are the proper long-term answer — polish pass. |
| `lookup` fields could not be configured. | Built: pick a link to follow and a far field to show. Read-only, live, sortable, filterable; shows "broken lookup" if what it depends on is deleted. |
| Schema tab listed every table at once. | Field editing moved into the grid's column headers; the schema tab stays as the explicit designer, showing one table (the open one) with "all tables" a click away. Both are the same two components. |
| One table showed a "Grid" view tab and another did not. | Views are created lazily on the first sort/filter/hide. A placeholder "Grid" tab now always shows. |
| Schema tab was empty; no way to create a table on a fresh database. | The `<SchemaEditor>` tag was deleted from `App.vue` during the grid extraction. `noUnusedLocals` and `test/ui.ts` U1 now guard it. |
| "connecting" for ~25 s. | Proxies hold headers until the first body byte; an idle stream's first byte was the keepalive. Server now opens with a comment frame. |
| Table tab said "no tables" after creating the first one. | Pickers were only initialised on mount. |
| Typing a non-number into a number cell ERASED the existing value. | `<input type="number">` reports garbage as `''`, which the grid reads as "clear". Found by `test/ui.ts`, not by a person. |
| Undo tab said "nothing destructive yet" right after a delete. | Listed once on open, before the delete had flushed. Now follows the stream. Found by `test/ui.ts`. |
