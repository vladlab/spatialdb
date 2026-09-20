/**
 * How a LINK FIELD's relationships are drawn on a canvas.
 *
 *     field.options.arrow = { color?: "#rrggbb", reversed?: boolean }
 *
 * It lives on the FIELD, not on the canvas: "inputs are blue, outputs are orange"
 * should mean the same on every board, or colour stops carrying information.
 * (Which arrows are VISIBLE is the opposite — a way of looking, per person, per
 * canvas — and is kept in the browser. See CanvasView.)
 *
 * `reversed` exists because a link's direction is about where the DATA lives,
 * not which way the story flows. "Previous version" sits on OEV2 and points at
 * OEV1 — the right way to store it, since a version knows what it replaced — but
 * the flow you want to SEE runs OEV1 → OEV2. Reversed draws the arrowhead at the
 * record that holds the link.
 *
 * Shared so the server refuses a malformed style on write and the client reads
 * one tolerantly (an unknown colour format is ignored, never an error).
 */

export interface ArrowStyle { color?: string; reversed?: boolean }

const HEX = /^#[0-9a-f]{6}$/i;

export function arrowStyleOf(f: { options?: Record<string, unknown> | null }): ArrowStyle {
  const a = f.options?.arrow;
  if (!a || typeof a !== 'object') return {};
  const { color, reversed } = a as Record<string, unknown>;
  return {
    ...(typeof color === 'string' && HEX.test(color) ? { color } : {}),
    ...(reversed === true ? { reversed: true } : {}),
  };
}

/** Why `options.arrow` is not acceptable, or null. Absent is fine. */
export function arrowStyleError(options: Record<string, unknown> | null | undefined): string | null {
  const a = options?.arrow;
  if (a === undefined) return null;
  if (!a || typeof a !== 'object' || Array.isArray(a)) return 'arrow must be an object';
  for (const [k, v] of Object.entries(a)) {
    if (k === 'color') { if (typeof v !== 'string' || !HEX.test(v)) return 'arrow.color must look like #3b82f6'; }
    else if (k === 'reversed') { if (typeof v !== 'boolean') return 'arrow.reversed must be true or false'; }
    else return `arrow has no setting called '${k}'`;
  }
  return null;
}
