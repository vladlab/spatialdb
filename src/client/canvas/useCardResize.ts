/**
 * Resizing cards, and rubber-band selection.
 *
 * Both ported from viznotes (useResize / useBoxSelection) with the same
 * split as useCardDrag: live feedback writes local state directly, and one
 * mutation lands on release.
 */

import { ref, reactive, computed } from 'vue';
import type { Mutation } from '../../contract/mutations.js';
import { placementKey, type PlacementRow, type State } from '../state.js';
import { rectsIntersect, type Rect } from './geometry.js';

export type ResizeHandle = 'e' | 's' | 'se';

const MIN_W = 120;
const MIN_H = 60;

export interface ResizeDeps {
  state: State;
  canvasId: () => string | null;
  getTransform: () => { x: number; y: number; scale: number };
  mutate: (m: Mutation) => void;
  /** Rendered size, for cards whose w/h are null (auto-sized by content). */
  measure: (recordId: string) => { w: number; h: number } | null;
}

export function useCardResize(deps: ResizeDeps) {
  const isResizing = ref(false);
  const resizingId = ref<string | null>(null);

  let target: PlacementRow | null = null;
  let handle: ResizeHandle = 'se';
  let startClient = { x: 0, y: 0 };
  let startW = 0;
  let startH = 0;
  /** The STORED size at drag start — nullable, unlike startW/H which are measured. */
  let origW: number | null = null;
  let origH: number | null = null;
  let raf: number | null = null;
  let pending: PointerEvent | null = null;

  function cleanup() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    pending = null;
    target = null;
    isResizing.value = false;
    resizingId.value = null;
  }

  function start(recordId: string, h: ResizeHandle, e: PointerEvent) {
    const canvasId = deps.canvasId();
    if (!canvasId || e.button !== 0) return;
    e.stopPropagation();   // or the card drag starts too
    e.preventDefault();

    const p = deps.state.placements.get(placementKey(canvasId, recordId));
    if (!p) return;

    target = p;
    handle = h;
    resizingId.value = recordId;
    isResizing.value = true;
    startClient = { x: e.clientX, y: e.clientY };

    // w/h are nullable — a card with no explicit size is laid out by its content.
    // Seed from the rendered box so the first drag pixel doesn't jump the card to
    // some default.
    const m = deps.measure(recordId);
    startW = p.w ?? m?.w ?? 240;
    startH = p.h ?? m?.h ?? 120;
    origW = p.w; origH = p.h;

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function onMove(e: PointerEvent) {
    pending = e;
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function frame() {
    raf = null;
    const e = pending;
    if (!e || !target) return;
    const scale = deps.getTransform().scale || 1;
    const dx = (e.clientX - startClient.x) / scale;
    const dy = (e.clientY - startClient.y) / scale;

    if (handle.includes('e')) target.w = Math.max(MIN_W, Math.round(startW + dx));
    if (handle.includes('s')) target.h = Math.max(MIN_H, Math.round(startH + dy));
  }

  function onUp() {
    const canvasId = deps.canvasId();
    const p = target;
    const id = resizingId.value;
    cleanup();
    if (!canvasId || !p || !id) return;
    if (p.w === startW && p.h === startH) return;   // no-op
    const w = p.w ?? undefined, h = p.h ?? undefined;
    // Restore the stored size before issuing the update, so the Ctrl+Z inverse —
    // read from state by store.mutate() — is the ORIGINAL size (null = auto)
    // rather than the size the drag has already written. See useCardDrag's drop.
    p.w = origW; p.h = origH;
    deps.mutate({ type: 'placement.update', canvasId, recordId: id, w, h });
  }

  return { isResizing, resizingId, start, cancel: cleanup };
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Box selection
 *
 *  viznotes hit-tested against DOM rects via getBoundingClientRect. This works in
 *  world space instead, against placement coordinates: no DOM reads, so no forced
 *  layout per frame, and cards scrolled out of view still select correctly.
 * ──────────────────────────────────────────────────────────────────────────*/

export interface BoxSelectDeps {
  clientToWorld: (x: number, y: number) => { x: number; y: number };
  /** World rects of every card on the canvas. */
  cardRects: () => Array<{ recordId: string } & Rect>;
  selected: Set<string>;
}

export function useBoxSelection(deps: BoxSelectDeps) {
  const active = ref(false);
  const startScreen = reactive({ x: 0, y: 0 });
  const endScreen = reactive({ x: 0, y: 0 });
  let startWorld = { x: 0, y: 0 };
  let dragged = false;
  let additive = false;

  const THRESHOLD = 5;

  /** Screen-space rect for the overlay. Drawn outside the transform. */
  const displayRect = computed(() => {
    if (!active.value) return null;
    return {
      left: Math.min(startScreen.x, endScreen.x),
      top: Math.min(startScreen.y, endScreen.y),
      width: Math.abs(endScreen.x - startScreen.x),
      height: Math.abs(endScreen.y - startScreen.y),
    };
  });

  function start(e: PointerEvent) {
    startScreen.x = endScreen.x = e.clientX;
    startScreen.y = endScreen.y = e.clientY;
    startWorld = deps.clientToWorld(e.clientX, e.clientY);
    additive = e.shiftKey || e.ctrlKey || e.metaKey;
    dragged = false;
    active.value = false;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function onMove(e: PointerEvent) {
    if (!dragged) {
      if (Math.abs(e.clientX - startScreen.x) < THRESHOLD &&
          Math.abs(e.clientY - startScreen.y) < THRESHOLD) return;
      dragged = true;
      active.value = true;
    }
    endScreen.x = e.clientX;
    endScreen.y = e.clientY;
  }

  function onUp(e: PointerEvent) {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (!dragged) { active.value = false; return; }

    const endWorld = deps.clientToWorld(e.clientX, e.clientY);
    const box: Rect = {
      x: Math.min(startWorld.x, endWorld.x),
      y: Math.min(startWorld.y, endWorld.y),
      w: Math.abs(endWorld.x - startWorld.x),
      h: Math.abs(endWorld.y - startWorld.y),
    };

    if (!additive) deps.selected.clear();
    for (const card of deps.cardRects()) {
      // Intersection, not containment — you should not have to lasso a card
      // entirely to catch it.
      if (rectsIntersect(box, card)) {
        if (additive && deps.selected.has(card.recordId)) deps.selected.delete(card.recordId);
        else deps.selected.add(card.recordId);
      }
    }
    active.value = false;
  }

  return { active, displayRect, start };
}
