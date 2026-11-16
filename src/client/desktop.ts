/**
 * The web app's side of the desktop client.
 *
 * The same page runs in a browser and in the Tauri window (the window loads it
 * from the server — TAURI-HANDOFF.md §2). In a browser none of this activates:
 * `window.__TAURI__` is undefined, `isDesktop()` is false, and the bundle carries
 * no Tauri code (the global is injected by the shell, `withGlobalTauri`).
 *
 * What the shell offers is a handful of FIXED-PURPOSE commands (src-tauri/src/lib.rs):
 * classify / probe / fingerprint on paths the user dropped, reveal on any path,
 * and a handshake saying which tools and which ffprobe this build has. Nothing
 * here can ask the shell to run a program.
 *
 * Coordinates: Tauri reports drag positions in PHYSICAL pixels; the DOM works in
 * CSS pixels. Divide by devicePixelRatio (the viznotes lesson).
 */

import { logMessage } from './log';
import { reactive, ref } from 'vue';

interface TauriGlobal {
  core: { invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> };
  webview: { getCurrentWebview(): { onDragDropEvent(cb: (e: { payload: DragDropPayload }) => void): Promise<() => void> } };
  /** Absent on an older shell (and in the test fake): then no events, nothing else changes. */
  event?: { listen<T>(name: string, cb: (e: { payload: T }) => void): Promise<() => void> };
}
type DragDropPayload =
  | { type: 'enter'; paths: string[]; position: { x: number; y: number } }
  | { type: 'over'; position: { x: number; y: number } }
  | { type: 'drop'; paths: string[]; position: { x: number; y: number } }
  | { type: 'leave' };

const tauri = (): TauriGlobal | null => (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__ ?? null;

export const isDesktop = () => tauri() !== null;

export function invoke<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const t = tauri();
  if (!t) return Promise.reject(new Error('not running in the desktop app'));
  return t.core.invoke<T>(cmd, args);
}

/** Subscribe to an event the shell emits (`hash-progress`). The unsubscribe; a no-op where there are no events. */
export async function listenEvent<T>(name: string, cb: (payload: T) => void): Promise<() => void> {
  const t = tauri();
  if (!t?.event) return () => {};
  return t.event.listen<T>(name, (e) => cb(e.payload));
}

/** The handshake (`tools_available`). Null until asked; `tools: []` in a browser. */
/** `analyzers`: id → the version of the program it runs, or null when it is not on this machine. */
export interface Available { version: string; tools: string[]; analyzers: Record<string, string | null>; ffprobe_path: string | null; platform: string }
export const available = ref<Available | null>(null);
export async function handshake(): Promise<Available | null> {
  if (!isDesktop()) return null;
  try { available.value = await invoke<Available>('tools_available'); }
  catch (e) { notice(`desktop: ${String(e)}`, 'error'); available.value = null; }
  return available.value;
}

/* ── the native drag ──────────────────────────────────────────────────────── */

/** Where files are being dragged over the window, in CSS pixels; App.vue draws the overlay. */
export const fileDrag = reactive({ active: false, x: 0, y: 0, count: 0 });

/**
 * Subscribe to the shell's drag-drop stream. `onDrop` receives CSS-pixel
 * coordinates. Returns the unsubscribe; a no-op in a browser.
 */
export async function listenFileDrops(onDrop: (paths: string[], clientX: number, clientY: number) => void): Promise<() => void> {
  const t = tauri();
  if (!t) return () => {};
  const css = (p: { x: number; y: number }) => ({ x: p.x / devicePixelRatio, y: p.y / devicePixelRatio });
  return t.webview.getCurrentWebview().onDragDropEvent(({ payload }) => {
    // Left on deliberately until the drop path is confirmed on Wayland and macOS:
    // the devtools console (right-click → Inspect Element in a debug build) shows
    // whether events arrive and at what coordinates.
    console.debug('[desktop] drag-drop', payload.type, 'position' in payload ? payload.position : '', 'paths' in payload ? payload.paths : '');
    if (payload.type === 'enter') { const p = css(payload.position); Object.assign(fileDrag, { active: true, x: p.x, y: p.y, count: payload.paths.length }); }
    else if (payload.type === 'over') { const p = css(payload.position); fileDrag.x = p.x; fileDrag.y = p.y; }
    else if (payload.type === 'leave') { fileDrag.active = false; }
    else { fileDrag.active = false; const p = css(payload.position); onDrop(payload.paths, p.x, p.y); }
  });
}

/* ── notices and jobs ─────────────────────────────────────────────────────── */

/**
 * What the tools are doing and what they have to say, for a small status strip.
 * The store's own errors (a rejected save, a dropped stream) arrive here too, as
 * `error` notices (App.vue, `store.onError`): one place to look, one log behind it.
 */
/**
 * `records`: pills the notice offers to OPEN — the record a dropped file already
 * is, say — in the tray, without leaving the canvas or the grid (the owner, Oct
 * 18: every conflict should offer "open" without going anywhere).
 */
export interface Notice { id: number; text: string; kind: 'info' | 'warn' | 'error'; at: number; records?: Array<{ id: string; label: string }> }
export const notices = reactive<Notice[]>([]);
let nextNotice = 1;
/**
 * ONE rule for every notice, whatever its kind (the owner, Nov 16 2026: some hung
 * until clicked, some left in seconds): it is written to the LOG (client/log.ts),
 * shown for NOTICE_MS, and goes. Nothing needs to be caught in time — the log in
 * the sidebar footer has it. While the pointer is over the stack nothing leaves
 * (you are reading); what came due meanwhile goes NOTICE_LINGER_MS after you move off.
 *
 * (Before: only `info` timed out, and its timer dismissed whichever notice was
 * NEWEST eight seconds later, not itself — so a warning could vanish early and an
 * info could stay for good.)
 */
export const NOTICE_MS = 10_000;
export const NOTICE_LINGER_MS = 2_000;
let held = false;
const overdue = new Set<number>();
const expire = (id: number) => { if (held) overdue.add(id); else dismiss(id); };
export function holdNotices(on: boolean) {
  held = on;
  if (on || !overdue.size) return;
  const ids = [...overdue]; overdue.clear();
  setTimeout(() => ids.forEach(expire), NOTICE_LINGER_MS);
}
export function notice(text: string, kind: Notice['kind'] = 'info', records?: Notice['records']) {
  const id = nextNotice++;
  logMessage(text, kind, records);
  notices.unshift({ id, text, kind, at: Date.now(), ...(records?.length ? { records } : {}) });
  if (notices.length > 20) notices.length = 20;
  setTimeout(() => expire(id), NOTICE_MS);
}
export function dismiss(id: number) { overdue.delete(id); const i = notices.findIndex((n) => n.id === id); if (i >= 0) notices.splice(i, 1); }

/**
 * Background work in flight, per record: what is running ("ffprobe", "Hash (md5)")
 * and WHERE it came from — a drop's follow-up steps (shown on the Path field) or a
 * manual step run from the record (shown on the field its ▶ sits on). One entry,
 * drawn in one place: drawing it on both read as the ▶ button doubling up.
 */
export interface Job { label: string; manual: boolean }
export const jobs = reactive(new Map<string, Job>());
