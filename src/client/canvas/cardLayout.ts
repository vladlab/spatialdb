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

export const CARD_W = 240;
export const CARD_HEAD_H = 22;     // the coloured table-name strip
export const CARD_TITLE_H = 26;    // the record's label (primary field)
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

/** Height of a card showing `rows` field lines. Folded: title only. */
export function cardHeight(rows: number, collapsed: boolean, rich = 0): number {
  const chrome = CARD_BORDER + CARD_HEAD_H + CARD_TITLE_H;
  return collapsed || (rows === 0 && rich === 0) ? chrome : chrome + CARD_BODY_PAD + rows * CARD_ROW_H + rich * CARD_RICH_H;
}

/**
 * A user-set height (dragged with the resize handle) wins when the card is
 * open. A FOLDED card ignores it: folding exists to get a card out of the way,
 * and a folded card that kept its 400px height would defeat that.
 */
export function effectiveHeight(h: number | null, rows: number, collapsed: boolean, rich = 0): number {
  return collapsed ? cardHeight(rows, true) : (h ?? cardHeight(rows, false, rich));
}

/**
 * PORTS. On an unfolded card, a link field's arrows leave from that field's ROW
 * and incoming arrows land on the matching backlink row — link fields are output
 * ports, backlink fields input ports, as in a node editor. This is the vertical
 * centre of row `index`, measured from the card's top edge; it is only possible
 * because rows are fixed-height (see the header).
 *
 * Returns null when the row is not actually visible: the card is folded, or it
 * has been resized shorter than its rows (the body clips). An arrow aimed at a
 * clipped row would end in mid-air, so the caller falls back to the card's edge.
 */
export function rowPortY(index: number, cardH: number, collapsed: boolean): number | null {
  if (collapsed || index < 0) return null;
  const y = CARD_BORDER / 2 + CARD_HEAD_H + CARD_TITLE_H + CARD_BODY_PAD / 2 + index * CARD_ROW_H + CARD_ROW_H / 2;
  return y + CARD_ROW_H / 2 <= cardH ? y : null;
}
