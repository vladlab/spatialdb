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

import { reactive, ref } from 'vue';

interface TauriGlobal {
  core: { invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> };
  webview: { getCurrentWebview(): { onDragDropEvent(cb: (e: { payload: DragDropPayload }) => void): Promise<() => void> } };
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

/** The handshake (`tools_available`). Null until asked; `tools: []` in a browser. */
export interface Available { version: string; tools: string[]; ffprobe: string | null; ffmpeg: string | null; platform: string }
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
 * Separate from `store.errors` (which is about the connection): a probe that
 * failed is news about a file, not about the database.
 */
export interface Notice { id: number; text: string; kind: 'info' | 'warn' | 'error'; at: number }
export const notices = reactive<Notice[]>([]);
let nextNotice = 1;
export function notice(text: string, kind: Notice['kind'] = 'info') {
  notices.unshift({ id: nextNotice++, text, kind, at: Date.now() });
  if (notices.length > 20) notices.length = 20;
  if (kind === 'info') setTimeout(() => dismiss(nextNotice - 1), 8000);
}
export function dismiss(id: number) { const i = notices.findIndex((n) => n.id === id); if (i >= 0) notices.splice(i, 1); }

/** Background work in flight, per record: "probing", "hashing". */
export const jobs = reactive(new Map<string, string>());
