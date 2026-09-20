/**
 * Pan and zoom. Ported from viznotes' useCanvas, with the maths moved into
 * geometry.ts and the `settings` store dependency dropped — scroll mode is a
 * local ref here rather than reaching into a global.
 *
 * The viewport is deliberately NOT part of the mutation stream. `canvases.viewport`
 * exists in the schema and could be persisted, but broadcasting pan/zoom would
 * mean every wheel tick becomes a mutation, and would yank other people's screens
 * around. Per-client, ephemeral, until there's a reason otherwise.
 */

import { reactive, ref, computed, type Ref } from 'vue';
import { fitTransform, toWorld, zoomAbout, type Rect } from './geometry.js';

const MIN_SCALE = 0.1;
const MAX_SCALE = 3;

export type ScrollMode = 'mouse' | 'touchpad';

export function useViewport(containerRef: Ref<HTMLElement | null>) {
  const transform = reactive({ x: 0, y: 0, scale: 1 });
  const isPanning = ref(false);
  const scrollMode = ref<ScrollMode>('touchpad');
  const panStart = { x: 0, y: 0 };

  const rect = () =>
    containerRef.value?.getBoundingClientRect() ?? { left: 0, top: 0, width: 800, height: 600 };

  function clientToWorld(clientX: number, clientY: number) {
    return toWorld(clientX, clientY, rect(), transform);
  }

  function apply(next: { x: number; y: number; scale: number }) {
    transform.x = next.x;
    transform.y = next.y;
    transform.scale = next.scale;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const zooming = e.ctrlKey || e.metaKey || scrollMode.value === 'mouse';

    if (zooming) {
      // Multiplicative, so each tick is a constant PROPORTION rather than a
      // constant amount — at 10% zoom a fixed step would be enormous. The
      // exponent form also means a touchpad's small deltas give fine control for
      // free. 0.999^100 ≈ 0.9, so one wheel notch is about 10%.
      const factor = Math.pow(0.999, e.deltaY);
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, transform.scale * factor));
      const r = rect();
      apply(zoomAbout(transform, e.clientX - r.left, e.clientY - r.top, next));
    } else {
      transform.x -= e.deltaX;
      transform.y -= e.deltaY;
    }
  }

  /** Middle mouse pans, as in viznotes. Space+drag is handled by the caller. */
  function onPointerDown(e: PointerEvent) {
    if (e.button !== 1) return;
    e.preventDefault();
    isPanning.value = true;
    panStart.x = e.clientX - transform.x;
    panStart.y = e.clientY - transform.y;
    (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
  }

  function startPan(e: PointerEvent) {
    isPanning.value = true;
    panStart.x = e.clientX - transform.x;
    panStart.y = e.clientY - transform.y;
  }

  function onPointerMove(e: PointerEvent) {
    if (!isPanning.value) return;
    transform.x = e.clientX - panStart.x;
    transform.y = e.clientY - panStart.y;
  }

  function onPointerUp() {
    isPanning.value = false;
  }

  function zoomBy(factor: number) {
    const r = rect();
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, transform.scale * factor));
    apply(zoomAbout(transform, r.width / 2, r.height / 2, next));
  }

  function resetZoom() {
    const r = rect();
    apply(zoomAbout(transform, r.width / 2, r.height / 2, 1));
  }

  function fit(rects: Rect[]) {
    const r = rect();
    apply(fitTransform(rects, r.width, r.height));
  }

  /** Centre on a set of rects without changing zoom. */
  function centerOn(rects: Rect[]) {
    if (!rects.length) return;
    const r = rect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const q of rects) {
      minX = Math.min(minX, q.x); minY = Math.min(minY, q.y);
      maxX = Math.max(maxX, q.x + q.w); maxY = Math.max(maxY, q.y + q.h);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    transform.x = r.width / 2 - cx * transform.scale;
    transform.y = r.height / 2 - cy * transform.scale;
  }

  const transformCSS = computed(
    () => `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
  );

  /**
   * Dot grid, drawn as a CSS background rather than elements.
   *
   * Modulo on the offset means the pattern repeats seamlessly no matter how far
   * you pan — one fixed-size div, not a grid of nodes that would have to grow
   * with the canvas.
   */
  const gridStyle = computed(() => {
    const s = transform.scale;
    const spacing = 30 * s;
    const dot = Math.max(1, 1.5 * s);
    return {
      backgroundImage: `radial-gradient(circle, var(--canvas-dot) ${dot}px, transparent ${dot}px)`,
      backgroundSize: `${spacing}px ${spacing}px`,
      backgroundPosition: `${transform.x % spacing}px ${transform.y % spacing}px`,
    };
  });

  const zoomPercent = computed(() => Math.round(transform.scale * 100));

  return {
    transform, isPanning, scrollMode, transformCSS, gridStyle, zoomPercent,
    clientToWorld, onWheel, onPointerDown, onPointerMove, onPointerUp, startPan,
    zoomIn: () => zoomBy(1.2),
    zoomOut: () => zoomBy(1 / 1.2),
    resetZoom, fit, centerOn,
  };
}
