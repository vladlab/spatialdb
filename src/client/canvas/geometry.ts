/**
 * ============================================================================
 *  Canvas geometry — pure functions, no DOM, no Vue.
 * ============================================================================
 *
 *  Ported from viznotes' ArrowLayer, where the same maths was tangled up with
 *  DOM reads, a rect cache and drag state. Pulled out here because none of it
 *  needs any of that: given rectangles, produce anchor points and a path.
 *
 *  Separating it is not tidiness for its own sake. Arrow routing is the thing
 *  most likely to look subtly wrong (an arrow leaving the wrong edge, a curve
 *  that loops back on itself), and a pure module can be tested at a hundred
 *  positions in a millisecond instead of being eyeballed.
 */

export type AnchorSide = 'top' | 'bottom' | 'left' | 'right';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export const centerOf = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Outward normal of a side — which way an arrow leaves the box. */
export function anchorDirection(side: AnchorSide): Point {
  switch (side) {
    case 'top': return { x: 0, y: -1 };
    case 'bottom': return { x: 0, y: 1 };
    case 'left': return { x: -1, y: 0 };
    case 'right': return { x: 1, y: 0 };
  }
}

/** A point just outside the given side, offset so the line doesn't touch the card. */
export function anchorPoint(r: Rect, side: AnchorSide, offset = 4): Point {
  const c = centerOf(r);
  switch (side) {
    case 'top': return { x: c.x, y: r.y - offset };
    case 'bottom': return { x: c.x, y: r.y + r.h + offset };
    case 'left': return { x: r.x - offset, y: c.y };
    case 'right': return { x: r.x + r.w + offset, y: c.y };
  }
}

/**
 * Which sides two cards should connect through.
 *
 * viznotes picked the anchor nearest an arbitrary world point, which is right
 * for a hand-drawn arrow the user aimed. Links here are derived from data — no
 * one aimed them — so the pair is chosen by which combination gives the shortest
 * run. Comparing all sixteen combinations is trivial at this scale and avoids the
 * classic failure where two side-by-side cards connect top-to-top and the curve
 * loops over both of them.
 */
export function bestSides(from: Rect, to: Rect): { from: AnchorSide; to: AnchorSide } {
  const sides: AnchorSide[] = ['top', 'bottom', 'left', 'right'];
  let best = { from: 'right' as AnchorSide, to: 'left' as AnchorSide };
  let bestScore = Infinity;

  for (const a of sides) {
    for (const b of sides) {
      const pa = anchorPoint(from, a, 0);
      const pb = anchorPoint(to, b, 0);
      const dist = Math.hypot(pb.x - pa.x, pb.y - pa.y);

      // Prefer anchors that face each other: an arrow leaving the right edge and
      // arriving at the left edge should beat one leaving the right and arriving
      // at the right, even when the raw distance is similar.
      const da = anchorDirection(a);
      const db = anchorDirection(b);
      const ux = (pb.x - pa.x) / (dist || 1);
      const uy = (pb.y - pa.y) / (dist || 1);
      const facing = (da.x * ux + da.y * uy) + (db.x * -ux + db.y * -uy);

      const score = dist - facing * 120;
      if (score < bestScore) { bestScore = score; best = { from: a, to: b }; }
    }
  }
  return best;
}

/**
 * Cubic bezier leaving and arriving along the anchors' normals.
 *
 * Curvature scales with distance but is clamped: without the floor, near-touching
 * cards get a straight stub that leaves at the wrong angle; without the ceiling,
 * distant cards get a wild loop.
 *
 * The endpoint is pulled back so the stroke stops at the base of the arrowhead
 * rather than under its tip, which otherwise reads as a blunt end.
 */
export function bezierPath(
  a: Point, aSide: AnchorSide,
  b: Point, bSide: AnchorSide,
  headroom = 10,
): string {
  const d1 = anchorDirection(aSide);
  const d2 = anchorDirection(bSide);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const curve = Math.max(30, Math.min(dist * 0.4, 150));

  const c1 = { x: a.x + d1.x * curve, y: a.y + d1.y * curve };
  const c2 = { x: b.x + d2.x * curve, y: b.y + d2.y * curve };

  const ax = b.x - c2.x;
  const ay = b.y - c2.y;
  const alen = Math.hypot(ax, ay) || 1;
  const ex = b.x - (ax / alen) * headroom;
  const ey = b.y - (ay / alen) * headroom;

  return `M${a.x.toFixed(1)},${a.y.toFixed(1)} ` +
         `C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ` +
         `${c2.x.toFixed(1)},${c2.y.toFixed(1)} ` +
         `${ex.toFixed(1)},${ey.toFixed(1)}`;
}

/** Triangular arrowhead at `tip`, pointing along the side's normal. */
export function arrowheadPath(tip: Point, side: AnchorSide, size = 9): string {
  const d = anchorDirection(side);
  // Incoming direction is the inverse of the target's outward normal.
  const dx = -d.x;
  const dy = -d.y;
  const px = -dy;
  const py = dx;
  const baseX = tip.x - dx * size;
  const baseY = tip.y - dy * size;
  const half = size * 0.45;
  return `M${tip.x.toFixed(1)},${tip.y.toFixed(1)} ` +
         `L${(baseX + px * half).toFixed(1)},${(baseY + py * half).toFixed(1)} ` +
         `L${(baseX - px * half).toFixed(1)},${(baseY - py * half).toFixed(1)} Z`;
}

/** Do two rectangles overlap at all? Partial overlap counts, as in viznotes. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

/** Bounding box of a set of rects, or null when there are none. */
export function boundsOf(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Viewport transform that fits `rects` into a `vw`×`vh` viewport.
 *
 * Capped at 1 — zooming PAST 100% to fill the screen with three cards is
 * disorienting, and viznotes made the same call.
 */
export function fitTransform(
  rects: Rect[], vw: number, vh: number, pad = 60,
  minScale = 0.1, maxScale = 1,
): { x: number; y: number; scale: number } {
  const b = boundsOf(rects);
  if (!b || b.w <= 0 || b.h <= 0) {
    // A single zero-size rect still deserves to be centred rather than ignored.
    if (b) {
      const c = centerOf(b);
      return { x: vw / 2 - c.x, y: vh / 2 - c.y, scale: 1 };
    }
    return { x: 0, y: 0, scale: 1 };
  }
  const scale = Math.max(
    minScale,
    Math.min((vw - pad * 2) / b.w, (vh - pad * 2) / b.h, maxScale),
  );
  const c = centerOf(b);
  return { x: vw / 2 - c.x * scale, y: vh / 2 - c.y * scale, scale };
}

/** Screen → world. The inverse of the CSS `translate(x,y) scale(s)`. */
export function toWorld(
  clientX: number, clientY: number,
  rect: { left: number; top: number },
  t: { x: number; y: number; scale: number },
): Point {
  return {
    x: (clientX - rect.left - t.x) / t.scale,
    y: (clientY - rect.top - t.y) / t.scale,
  };
}

/**
 * Zoom about a fixed screen point.
 *
 * The invariant: the world point under the cursor stays under the cursor. Get
 * this wrong and the canvas drifts away as you zoom, which is the single most
 * noticeable way a canvas can feel broken.
 */
export function zoomAbout(
  t: { x: number; y: number; scale: number },
  screenX: number, screenY: number, nextScale: number,
): { x: number; y: number; scale: number } {
  const ratio = nextScale / t.scale;
  return {
    x: screenX - (screenX - t.x) * ratio,
    y: screenY - (screenY - t.y) * ratio,
    scale: nextScale,
  };
}

/**
 * The point halfway along the arrow `bezierPath` draws — where a selected arrow's
 * label sits. Same control points as `bezierPath` (keep the two in step); a cubic
 * at t = ½ is (a + 3·c1 + 3·c2 + b) / 8.
 */
export function bezierMid(a: Point, aSide: AnchorSide, b: Point, bSide: AnchorSide): Point {
  const d1 = anchorDirection(aSide);
  const d2 = anchorDirection(bSide);
  const curve = Math.max(30, Math.min(Math.hypot(b.x - a.x, b.y - a.y) * 0.4, 150));
  const c1 = { x: a.x + d1.x * curve, y: a.y + d1.y * curve };
  const c2 = { x: b.x + d2.x * curve, y: b.y + d2.y * curve };
  return { x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 };
}
