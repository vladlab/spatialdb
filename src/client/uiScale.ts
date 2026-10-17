/**
 * ============================================================================
 *  UI scale — one setting that sizes every pixel of the app, for the monitor it
 *  is on (Oct 17).
 * ============================================================================
 *
 *  A 4K desk and a laptop want different sizes of the same UI, and nothing in the
 *  app should have to know. So the scale is PER BROWSER (localStorage, like the
 *  other prefs — a server-side setting would make the two screens fight), and it
 *  is applied in one of two ways:
 *
 *  - In the DESKTOP client: the webview's own zoom (`setZoom`), which is the page
 *    zoom a browser's Ctrl+/− does — every coordinate the page sees is already in
 *    its own pixels, nothing below applies.
 *  - In a BROWSER: CSS `zoom` on the root element. Everything draws larger, in one
 *    line of CSS. But the browser keeps reporting the VIEWPORT's pixels to scripts:
 *    `clientX`, `getBoundingClientRect()`, `innerWidth` are all in viewport pixels,
 *    while a style set in px, `scrollLeft`, `offsetWidth` and the canvas transform
 *    are in the page's own (zoomed) pixels. Under zoom 1.5 a card dragged 150
 *    viewport pixels has moved 100 of its own. Measured, not assumed: Chromium 141
 *    reports rects and clientX scaled, and a `position: fixed; left: 100px` lands at
 *    150 — the same for zoom on <html> as on a wrapper (Firefox 126+ implements the
 *    same standardised zoom). So every place that turns a viewport measurement into
 *    a page pixel goes through `vp()` / `rectVp()` here — the pickers' fixed
 *    positions, the grid's column resize and reveal, the canvas's pointer maths.
 *    With the scale at 1 (and in the headless suites) they are identities.
 */
import { ref, watch } from 'vue';
import { isDesktop } from './desktop';

export const UI_SCALE_MIN = 0.75, UI_SCALE_MAX = 2, UI_SCALE_STEP = 0.05;
const KEY = 'spatialdb.prefs.uiScale';

const read = (): number => {
  try { const n = Number(localStorage.getItem(KEY)); return Number.isFinite(n) && n >= UI_SCALE_MIN && n <= UI_SCALE_MAX ? n : 1; } catch { return 1; }
};
/** The scale, 1 = as designed. Set it and the page follows (see `applyUiScale`). */
export const uiScale = ref(read());

/** True while the scale is a CSS zoom this page has to correct for (a browser, not the desktop client). */
let cssZoom = 1;

/** A viewport measurement (clientX, a rect's edge, innerWidth) as the page's own pixels. */
export const vp = (n: number) => n / cssZoom;
/** A DOMRect in the page's own pixels. */
export function rectVp(r: { left: number; top: number; right: number; bottom: number; width: number; height: number }) {
  const z = cssZoom;
  return { left: r.left / z, top: r.top / z, right: r.right / z, bottom: r.bottom / z, width: r.width / z, height: r.height / z };
}
/** The page's own pixels as viewport pixels — the inverse, for a value handed back to the browser or to a rect comparison. */
export const toVp = (n: number) => n * cssZoom;

async function apply(z: number) {
  if (isDesktop()) {
    cssZoom = 1;
    try { await (globalThis as { __TAURI__?: { webview: { getCurrentWebview(): { setZoom(f: number): Promise<void> } } } }).__TAURI__!.webview.getCurrentWebview().setZoom(z); }
    catch { /* an older build without the permission: the setting simply does nothing there */ }
    return;
  }
  if (typeof document === 'undefined') return;
  cssZoom = z;
  (document.documentElement.style as CSSStyleDeclaration & { zoom?: string }).zoom = z === 1 ? '' : String(z);
}

/** Called once by the app shell; applies the saved scale and follows changes. */
export function applyUiScale() {
  void apply(uiScale.value);
  watch(uiScale, (z) => { try { localStorage.setItem(KEY, String(z)); } catch { /* unavailable */ } void apply(z); });
}
