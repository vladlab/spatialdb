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
2. **Structured fields** (newest) — all in the record tray, none of it seen:
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
