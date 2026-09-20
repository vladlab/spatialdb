/**
 * ============================================================================
 *  Dragging cards.
 * ============================================================================
 *
 *  Ported from viznotes' useDrag, keeping its interaction feel — a 4px
 *  threshold before a click becomes a drag, pointer capture so the gesture
 *  survives leaving the window, and rAF-batched position updates — but with a
 *  different relationship to persistence.
 *
 *  ── THE ONE THING THAT HAD TO CHANGE ──────────────────────────────────────
 *
 *  viznotes mutates `note.pos` on every frame and calls `markNoteDirty(note, 100)`
 *  to debounce a save. That is right for a local file. Here it would be wrong:
 *  every frame that went through `store.mutate()` would queue a mutation, so a
 *  two-second drag would put ~120 rows in the log per card, broadcast every one
 *  of them to every peer, and make undo mean "go back one frame".
 *
 *  So the gesture is split:
 *
 *    DURING the drag, positions are written straight into local state. No
 *    mutation, nothing queued, nothing sent. It is ephemeral UI state, exactly
 *    like the viewport.
 *
 *    ON DROP, one `placement.move` carrying every moved card. One log row, one
 *    broadcast, one undo step, one statement server-side.
 *
 *  This is what `placement.move` taking a `moves[]` array was always for — it is
 *  why e2e test 9 moves ten cards in a single mutation. The drag is the consumer
 *  that design was waiting for.
 *
 *  Consequence worth knowing: a peer's edit to a card you are dragging will be
 *  overwritten by your drop, because last-write-wins and your drop is last. That
 *  is the same rule as everywhere else in the system, and at this team size it is
 *  the right trade.
 */

import { ref } from 'vue';
import type { Mutation } from '../../contract/mutations.js';
import { placementKey, type PlacementRow, type State } from '../state.js';

const DRAG_THRESHOLD = 4;

export interface DragDeps {
  state: State;
  canvasId: () => string | null;
  getTransform: () => { x: number; y: number; scale: number };
  selected: Set<string>;
  mutate: (m: Mutation) => void;
  /** Highest z on the canvas, so a dragged card comes to the front. */
  topZ: () => number;
}

interface Dragged {
  recordId: string;
  placement: PlacementRow;
  startX: number;
  startY: number;
}

export function useCardDrag(deps: DragDeps) {
  const isDragging = ref(false);
  const draggingIds = ref<Set<string>>(new Set());

  let items: Dragged[] = [];
  let startClient = { x: 0, y: 0 };
  let moved = false;
  let raf: number | null = null;
  let pending: PointerEvent | null = null;
  let captureEl: HTMLElement | null = null;
  let capturedPointer: number | null = null;

  function cleanup() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (captureEl && capturedPointer !== null) {
      captureEl.removeEventListener('lostpointercapture', onLostCapture);
      try { captureEl.releasePointerCapture(capturedPointer); } catch { /* already gone */ }
    }
    captureEl = null;
    capturedPointer = null;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    pending = null;
    items = [];
    moved = false;
    isDragging.value = false;
    draggingIds.value = new Set();
  }

  function start(recordId: string, e: PointerEvent) {
    if (e.button !== 0) return;
    const canvasId = deps.canvasId();
    if (!canvasId) return;

    // A stuck drag from a previous gesture would silently capture this one.
    if (items.length) cleanup();

    // Dragging a card that is part of a multi-selection moves the whole
    // selection; dragging an unselected card moves just that card.
    const ids = deps.selected.has(recordId) && deps.selected.size > 1
      ? [...deps.selected]
      : [recordId];

    items = [];
    for (const id of ids) {
      const p = deps.state.placements.get(placementKey(canvasId, id));
      if (p) items.push({ recordId: id, placement: p, startX: p.x, startY: p.y });
    }
    if (!items.length) return;

    startClient = { x: e.clientX, y: e.clientY };
    moved = false;

    // Pointer capture: without it, dragging fast enough to outrun the card — or
    // off the window edge — drops the gesture and leaves a card stranded.
    captureEl = e.currentTarget as HTMLElement;
    capturedPointer = e.pointerId;
    try { captureEl.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
    captureEl.addEventListener('lostpointercapture', onLostCapture);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function onLostCapture() {
    // Losing capture without a pointerup would otherwise leave `isDragging` true
    // forever and the card following the cursor with no way to put it down.
    if (items.length) commit();
  }

  function onMove(e: PointerEvent) {
    if (!items.length) return;

    if (!moved) {
      const dx = Math.abs(e.clientX - startClient.x);
      const dy = Math.abs(e.clientY - startClient.y);
      // Below the threshold this is still a click. Without it, a one-pixel
      // wobble while clicking would emit a placement.move and clutter the log
      // (and the undo list) with moves nobody made.
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
      moved = true;
      isDragging.value = true;
      draggingIds.value = new Set(items.map((i) => i.recordId));
    }

    pending = e;
    if (!raf) raf = requestAnimationFrame(frame);
  }

  /**
   * Coalesce pointer events into one write per animation frame.
   *
   * Pointer events can fire well above display rate, and each one dirties
   * reactive state that re-renders cards and re-routes every arrow attached to
   * them. Batching bounds that to the frame rate.
   */
  function frame() {
    raf = null;
    const e = pending;
    if (!e || !items.length) return;

    const scale = deps.getTransform().scale || 1;
    // Screen delta ÷ scale: at 50% zoom the pointer moves twice as far on screen
    // as the card should move in world space.
    const dx = (e.clientX - startClient.x) / scale;
    const dy = (e.clientY - startClient.y) / scale;

    // Straight into local state — NOT through store.mutate(). See the header.
    for (const it of items) {
      it.placement.x = it.startX + dx;
      it.placement.y = it.startY + dy;
    }
  }

  function onUp() {
    commit();
  }

  function commit() {
    const canvasId = deps.canvasId();
    const done = items;
    const didMove = moved;
    cleanup();

    if (!didMove || !canvasId || !done.length) return;

    // Nothing actually changed — a drag out and back to the same spot. Don't
    // write a no-op mutation.
    const changed = done.filter(
      (d) => d.placement.x !== d.startX || d.placement.y !== d.startY,
    );
    if (!changed.length) return;

    // Bring the dragged set to the front, matching viznotes' bringToTop. Done
    // here rather than on pointerdown so a plain click doesn't churn z-order.
    let z = deps.topZ();
    const moves = changed.map((d) => ({
      recordId: d.recordId,
      x: Math.round(d.placement.x),
      y: Math.round(d.placement.y),
      z: ++z,
    }));
    // Put the cards BACK where the drag started before issuing the move. The drag
    // has been writing x/y into local state every frame (see the header), so by
    // now state already holds the destination — and store.mutate() builds the
    // Ctrl+Z inverse by reading state just before it applies a change. Left
    // alone, the inverse of this move would be "move to where it already is" and
    // undo would silently do nothing. Same tick, so nothing renders in between.
    for (const d of changed) { d.placement.x = d.startX; d.placement.y = d.startY; }
    deps.mutate({ type: 'placement.move', canvasId, moves });
  }

  return { isDragging, draggingIds, start, cancel: cleanup };
}
