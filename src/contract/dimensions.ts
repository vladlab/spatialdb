/**
 * ============================================================================
 *  `dimensions` — a frame size, width × height, as ONE value.
 * ============================================================================
 *
 *  Nobody wants to type a width and a height as two numbers in two columns (the
 *  owner, Oct 17), and a spec that says "3840×2160" is one fact, not two. So one
 *  field type, stored as its CANONICAL text — "1920×1080", the multiplication
 *  sign U+00D7 between two positive integers, no spaces — which sorts naturally
 *  (the grid's collator is numeric: 1280×720 < 1920×1080 < 3840×2160), filters
 *  as text ("contains 2160"), reads in a report and a CSV as written, and
 *  compares to a spec's by plain equality.
 *
 *  Sanitising is PARSING, not a list of every resolution anyone ever delivered:
 *  what a person types is read leniently — "1920x1080", "1920 x 1080",
 *  "1920×1080", "1920*1080", "1920, 1080", "1920 1080" — and written back in the
 *  one spelling. Anything that is not two positive whole numbers is refused with
 *  a reason at the cell. ffprobe's width and height arrive already joined
 *  (probe.rs `dimensions`), stored as coded — anamorphic is not the display size,
 *  as the two plain outputs always were.
 */

/** The canonical form, and the only one `validateValue` accepts. */
export const DIMENSIONS_RE = /^([1-9]\d{0,5})×([1-9]\d{0,5})$/;

export interface Dimensions { w: number; h: number }

/** Two positive whole numbers with something between them, or null. */
export function parseDimensions(text: unknown): Dimensions | null {
  if (typeof text !== 'string') return null;
  const m = /^\s*(\d{1,6})\s*(?:[x×X*,:]|by|\s)\s*(\d{1,6})\s*$/i.exec(text);
  if (!m) return null;
  const w = Number(m[1]), h = Number(m[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

/** "1920×1080" — the stored spelling. */
export const formatDimensions = (d: Dimensions): string => `${d.w}×${d.h}`;

/** The canonical text for what was typed, or null when it is not a size. */
export function canonicalDimensions(text: unknown): string | null {
  const d = parseDimensions(text);
  return d ? formatDimensions(d) : null;
}

/** Why `value` is not a stored dimensions value, or null. */
export function dimensionsError(key: string, value: unknown): string | null {
  return typeof value === 'string' && DIMENSIONS_RE.test(value) ? null : `'${key}' must be a frame size, width × height, like 1920×1080`;
}
