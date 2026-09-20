/**
 * Dragging RECORDS from somewhere onto something — one mechanism, many sources.
 *
 * Today: grid rows onto the canvas. The Tauri client's file drops and anything
 * else that needs to "put these records there" plug into the same two calls:
 *
 *     beginRecordDrag(records, pointerEvent, label)   // a source, on pointerdown
 *     registerDropTarget(el, (records, x, y) => …)    // a target, once, on mount
 *
 * It replaces the canvas's private tray-drag code, which was the same idea wired
 * to one source and one target. The tray itself is gone: it listed "the first
 * hundred unplaced records", which stops being useful the day a database has
 * more than a hundred. The command palette (you know what you want) and the
 * docked grid (you want to browse, sort and filter first) are its replacements.
 *
 * POINTER events, not HTML5 drag-and-drop, deliberately:
 *   - the canvas is already built on pointer events, and the two models fight
 *     over the same gestures;
 *   - HTML5 DnD gives no control over the drag image mid-flight and behaves
 *     differently per browser;
 *   - Tauri's native file-drop handler claims the webview's HTML5 drop events,
 *     so an app that also used them for internal drags would have to choose.
 *
 * A drag only BEGINS after the pointer has moved a few pixels, so a plain click
 * on a row still selects it.
 */

import { reactive } from 'vue';
import type { RecordRow } from './state';

const THRESHOLD = 5;

/** What the ghost shows. Reactive; App.vue renders it. Null when nothing is being dragged. */
export const dragGhost = reactive<{ active: boolean; x: number; y: number; label: string; count: number; over: boolean }>({
  active: false, x: 0, y: 0, label: '', count: 0, over: false,
});

type Drop = (records: RecordRow[], clientX: number, clientY: number) => void;
const targets = new Map<HTMLElement, Drop>();

/** Returns the un-register function — call it on unmount. */
export function registerDropTarget(el: HTMLElement, drop: Drop): () => void {
  targets.set(el, drop);
  return () => { targets.delete(el); };
}

function targetAt(x: number, y: number): [HTMLElement, Drop] | null {
  // Geometry, not elementFromPoint: the ghost and any overlay sit under the
  // pointer, and "is the pointer inside this target's box" is the actual question.
  for (const [el, drop] of targets) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return [el, drop];
  }
  return null;
}

/**
 * Call from a source's `pointerdown`. Nothing visible happens until the pointer
 * moves past the threshold; releasing before that is an ordinary click and
 * `onClick` (if given) runs instead.
 */
export function beginRecordDrag(
  records: () => RecordRow[], e: PointerEvent, label: (records: RecordRow[]) => string, onClick?: () => void,
) {
  if (e.button !== 0) return;
  const x0 = e.clientX, y0 = e.clientY;
  let dragging: RecordRow[] | null = null;

  const move = (ev: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < THRESHOLD) return;
      // Resolved NOW, not at pointerdown: the press itself may have changed the
      // selection, and the drag carries whatever is selected once it starts.
      dragging = records();
      if (!dragging.length) return stop();
      Object.assign(dragGhost, { active: true, label: label(dragging), count: dragging.length });
      document.body.style.userSelect = 'none';
    }
    dragGhost.x = ev.clientX; dragGhost.y = ev.clientY;
    dragGhost.over = targetAt(ev.clientX, ev.clientY) !== null;
  };
  const up = (ev: PointerEvent) => {
    const carried = dragging;
    stop();
    if (!carried) { onClick?.(); return; }
    targetAt(ev.clientX, ev.clientY)?.[1](carried, ev.clientX, ev.clientY);
  };
  const cancel = (ev: KeyboardEvent) => { if (ev.key === 'Escape') stop(); };
  function stop() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('keydown', cancel, true);
    document.body.style.userSelect = '';
    dragging = null;
    Object.assign(dragGhost, { active: false, over: false });
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('keydown', cancel, true);
}
