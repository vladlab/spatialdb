/**
 * How tall a card is — by ARITHMETIC, never by measuring the DOM.
 *
 * Arrows, box selection and fit-to-view all work from card rectangles in world
 * space. The port from viznotes deliberately dropped DOM measurement (a note's
 * height there was content-driven, so every arrow redraw read layout). Cards
 * here used to get away with one constant, 108px, because they always showed the
 * same thing. They no longer do: a card has a title, a chosen list of fields,
 * and can be folded. So height is a FUNCTION of those — and RecordCard's CSS is
 * written to make the function true: every row is one fixed-height line that
 * clips with an ellipsis. If a row is ever allowed to wrap, arrows will attach
 * to where the card's edge would have been.
 *
 * These numbers are the contract between this file and RecordCard.vue's CSS
 * (which sets them as custom properties from here, so there is one copy).
 * `test/canvas.ts` pins the function; nothing can pin the CSS, so: change both.
 */

export const CARD_W = 240;         // the NARROWEST a card is by default — see `defaultCardWidth`
export const CARD_W_MAX = 720;     // …and the widest a title can make it; wider is a hand resize
export const CARD_HEAD_H = 22;     // the coloured table-name strip
export const CARD_TITLE_H = 26;    // the record's label (primary field)
export const CARD_TITLE_PX = 13;   // its font size — a notch above the rows' 12px, so the name reads first
export const CARD_TEXT_PX = 12;    // the rows
export const CARD_ROW_H = 18;      // one "key  value" line
export const CARD_BODY_PAD = 12;   // body padding, top + bottom
export const CARD_BORDER = 2;      // 1px top + 1px bottom
/**
 * One RICH TEXT block — a note with formatting and images, under the rows.
 *
 * A note has no natural height, and card height has to be arithmetic (arrows meet
 * the card's edge without measuring the DOM). So a block is a FIXED-height window
 * that scrolls inside itself: label (16) + content (132). Resize the card taller
 * and its blocks share the extra room; the arithmetic below is only the default.
 *
 * Blocks come AFTER every row, and rich fields are never rows — so a row's index,
 * which ports are computed from, is the same on every card of a table whether or
 * not that record happens to have a note.
 */
export const CARD_RICH_LABEL_H = 16;
export const CARD_RICH_H = CARD_RICH_LABEL_H + 132;

/**
 * THE LINK HANDLE — the one ⊕ a new link is dragged from. A circle whose CENTRE sits
 * `LINK_HANDLE_OUT` px diagonally outside the card's bottom-right corner: outside,
 * because inside that corner is the resize handle. RecordCard's CSS draws it from
 * these numbers and the canvas starts the drag line at `linkHandleAt`, so the line
 * leaves the dot whatever the card's size or fold.
 */
export const LINK_HANDLE_SIZE = 18;
export const LINK_HANDLE_OUT = 5;
export const linkHandleAt = (r: { x: number; y: number; w: number; h: number }) =>
  ({ x: r.x + r.w + LINK_HANDLE_OUT, y: r.y + r.h + LINK_HANDLE_OUT });

/* ── WIDTH ──────────────────────────────────────────────────────────────────
   A card is as wide as its NAME by default. The name is what a card is read for
   across a canvas, and a fixed 240px cut most filenames and most episode titles
   short; a wide card is better than a wide ellipsis. `w` on the placement (a hand
   resize, or a double-click on the edge) overrides this and is kept. Widths come
   from measuring text on an offscreen canvas (client/textWidth.ts), never the DOM,
   so arrows and the box selection work from the same numbers the card draws with. */

/** What the title line adds around its text: the fold button, its gap, the padding, the border. */
const TITLE_CHROME = 14 + 4 + 4 + 8 + 2 + 8;
/** A row's chrome around its value: the key column, the gap, the padding, the border. */
const ROW_CHROME = 76 + 8 + 16 + 2;
const clampW = (w: number) => Math.max(CARD_W, Math.min(CARD_W_MAX, Math.ceil(w)));

/** The width a card with no `w` of its own gets: its name, whole. */
export function defaultCardWidth(title: string, measure: (text: string, px: number, weight?: '' | 'bold') => number): number {
  return clampW(measure(title, CARD_TITLE_PX, 'bold') + TITLE_CHROME);
}
/** A row's own idea of its width: for `fitCardWidth`, the widest line it would draw. */
export interface RowWidth { text: string; lines?: string[]; count?: number; slot?: number; statusW?: number; ids?: string[] }
/**
 * Wide enough to show everything the card has on it — the double-click on its edge.
 * Capped like the default: a 2,000px note line is a reason to open the record, not
 * to make a card the width of the canvas.
 */
export function fitCardWidth(title: string, rows: RowWidth[], measure: (text: string, px: number, weight?: '' | 'bold') => number): number {
  let w = measure(title, CARD_TITLE_PX, 'bold') + TITLE_CHROME;
  for (const r of rows) {
    let v: number;
    if (r.slot !== undefined) v = r.slot + 6 + (r.statusW ?? 0);                 // a column of pairs: name slot, then statuses
    else if (r.count) v = measure(`${r.count} ${r.text}`, CARD_TEXT_PX) + 15;    // a count pill
    else {
      const lines = r.lines?.length ? r.lines : [r.text];
      v = Math.max(...lines.map((l) => measure(l, CARD_TEXT_PX))) + (r.ids?.length ? 15 + 24 : 0);   // a pill: its padding, and room for its ×
    }
    w = Math.max(w, v + ROW_CHROME);
  }
  return clampW(w);
}

/** Height of a card showing `rows` field lines. Folded: title only. */
/**
 * A row is usually one line. A link/backlink/lookup row with SEVERAL values is a
 * vertical list — one line per value, up to CARD_MAX_LINES, then one "+N more" line —
 * so `cardHeight` counts LINES, not rows. `rowLines` is the one place that rule lives.
 */
export const CARD_MAX_LINES = 6;
export interface RowShape { lines?: string[] }
export function rowLines(row: RowShape): number {
  const n = row.lines?.length ?? 1;
  return n <= 1 ? 1 : Math.min(n, CARD_MAX_LINES) + (n > CARD_MAX_LINES ? 1 : 0);
}
export const lineCount = (rows: RowShape[]): number => rows.reduce((n, r) => n + rowLines(r), 0);

/** Height for `rows` LINES (see `rowLines`) — the name is historical. */
export function cardHeight(rows: number, collapsed: boolean, rich = 0): number {
  const chrome = CARD_BORDER + CARD_HEAD_H + CARD_TITLE_H;
  return collapsed || (rows === 0 && rich === 0) ? chrome : chrome + CARD_BODY_PAD + rows * CARD_ROW_H + rich * CARD_RICH_H;
}

/**
 * A user-set height (dragged with the resize handle) wins when the card is
 * open — but never below what the ROWS need: a card sized by hand last month
 * does not get to overlap the three deliverables added today. Rich blocks are
 * the flexible part (they share what is left), so the floor counts rows only.
 * A FOLDED card ignores the height: folding exists to get a card out of the
 * way, and a folded card that kept its 400px height would defeat that.
 */
export function effectiveHeight(h: number | null, rows: number, collapsed: boolean, rich = 0): number {
  if (collapsed) return cardHeight(rows, true);
  if (h === null) return cardHeight(rows, false, rich);
  return Math.max(h, cardHeight(rows, false, 0));
}

/**
 * WHERE A ROW IS: the vertical centre of row `index`, measured from the card's top
 * edge — possible only because rows are fixed-height (see the header). Null when
 * the row is not actually visible: the card is folded, or it has been resized
 * shorter than its rows (the body clips).
 *
 * This was what arrows and link handles hung on while rows were PORTS. Neither does
 * any more — arrows meet the card's edge, and a link starts from the card's one
 * handle (`linkHandleAt`) — so nothing in the app calls it today. Kept, with its
 * tests, as the row arithmetic anything row-anchored will need again.
 */
export function rowPortY(index: number, cardH: number, collapsed: boolean, rows?: RowShape[]): number | null {
  if (collapsed || index < 0) return null;
  // Lines above this row (rows may be several lines tall); the port sits on its FIRST line.
  const above = rows ? lineCount(rows.slice(0, index)) : index;
  const y = CARD_BORDER / 2 + CARD_HEAD_H + CARD_TITLE_H + CARD_BODY_PAD / 2 + above * CARD_ROW_H + CARD_ROW_H / 2;
  return y + CARD_ROW_H / 2 <= cardH ? y : null;
}
