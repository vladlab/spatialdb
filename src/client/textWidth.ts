/**
 * How wide a piece of text is, in CSS px — measured on a canvas, never in the DOM.
 *
 * A junction column lines its statuses up: in a grid column, and down a card, every
 * pair's status starts at the same x — just past the WIDEST other-end name. That
 * width has to be known for rows that are not rendered (the grid draws a window of
 * them) and must not change as you scroll, so it cannot come from measuring pills.
 * It is arithmetic over the labels instead: one `measureText` per distinct label,
 * remembered.
 *
 * Without a canvas (the headless suites) it falls back to an average glyph width —
 * good enough to lay out, and there is no layout there to get wrong.
 */

/** The app's font stack (App.vue, `body`) — what a pill's text is drawn in. */
export const UI_FONT = 'ui-sans-serif, system-ui, -apple-system, sans-serif';

let ctx: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, number>();

export function textWidth(text: string, px: number): number {
  const key = `${px}\n${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (ctx === undefined) {
    try { ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d'); } catch { ctx = null; }
  }
  let w = 0;
  if (ctx) { ctx.font = `${px}px ${UI_FONT}`; w = ctx.measureText(text).width; }
  if (!w) w = text.length * px * 0.56;
  if (cache.size > 20000) cache.clear();
  cache.set(key, w);
  return w;
}

/** A pill's own room around its text: 7px each side (App.vue, `.pill-main`), and a pixel of grace. */
const PILL_PAD = 15;
/**
 * The slot a column of pairs gives the other end: the widest of `labels` as a pill,
 * capped — one very long name must not push every status off the edge.
 */
export function pairSlot(labels: Iterable<string>, px: number, cap = 260): number {
  let w = 0;
  for (const l of labels) w = Math.max(w, textWidth(l, px));
  return w ? Math.min(Math.ceil(w) + PILL_PAD, cap) : 0;
}

/** What a jump arrow adds to a pill's width (App.vue, `.pill-jump`): the name's right padding becomes the arrow's 17px box, behind 5px. */
export const JUMP_PAD = 15;

/** A capsule's room around its text: 9px each side (App.vue, `.pill-status`), and a pixel of grace. */
const CAPSULE_PAD = 19;
/** The widest of `labels` as a status capsule — what a column of statuses needs to show every one whole. 0 with none. */
export function capsuleWidth(labels: Iterable<string>, px: number): number {
  let w = 0;
  for (const l of labels) if (l) w = Math.max(w, textWidth(l, px));
  return w ? Math.ceil(w) + CAPSULE_PAD : 0;
}
