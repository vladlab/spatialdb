/**
 * Browser-local PREFERENCES: ways of working, not facts about the data. Nothing here
 * is shared or saved to the server. Each is a ref that persists in localStorage
 * (survives a reload) or sessionStorage (this tab, this session).
 */
import { ref, watch, type Ref } from 'vue';

function stored(store: Storage | undefined, key: string, initial: boolean): Ref<boolean> {
  const read = (): boolean => { try { const v = store?.getItem(key); return v === null || v === undefined ? initial : v === '1'; } catch { return initial; } };
  const r = ref(read());
  watch(r, (v) => { try { store?.setItem(key, v ? '1' : '0'); } catch { /* unavailable */ } });
  return r;
}
const local = typeof localStorage !== 'undefined' ? localStorage : undefined;
const session = typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;

/** In the tree, list the tables that belong to a project ("scoped") above the rest. */
export const scopedFirst = stored(local, 'spatialdb.prefs.scopedFirst', false);

/**
 * Canvas defaults switched OFF — one switch for every canvas, for this tab's session.
 * (It was per canvas, per browser, and re-defaulted to ON on every canvas you opened.)
 */
export const canvasDefaultsOff = stored(session, 'spatialdb.prefs.canvasDefaultsOff', false);
/**
 * CARD ANIMATIONS (CANVAS-BRIEF.md C1): an examined card flies up from its place and
 * turns over when flipped. Off, both are a plain fade — for a slow machine, or taste.
 * The OS's "reduce motion" turns them off too, whatever this says (CardExamine.vue).
 */
export const cardAnimations = stored(local, 'spatialdb.prefs.cardAnimations', true);

/**
 * THEME (theme.css): dark or light, for this browser — like the UI scale, a monitor
 * thing, not an account thing. Applied as `data-theme` on <html>; index.html sets the
 * same attribute from the same key before the first paint, so a light browser never
 * opens dark for a frame. The key and the two names are shared with that script.
 */
export const THEMES = ['dark', 'light', 'experimental'] as const;
/**
 * 'experimental' is the LIGHT theme with a variant on top (theme.css, the block under
 * `data-variant="experimental"`): the look of the Nov 14 2026 canvas mockup the owner
 * liked — lighter cards on the same paper, deeper shadows, the table as a colour chip
 * and a label instead of a coloured strip. `data-theme` stays "light", so every token
 * it does not override is the light theme's.
 */
export const THEME_LABELS: Record<(typeof THEMES)[number], string> = { dark: 'dark', light: 'light', experimental: 'light (experimental)' };
export type Theme = (typeof THEMES)[number];
export const THEME_KEY = 'spatialdb.prefs.theme';
const readTheme = (): Theme => { try { const v = local?.getItem(THEME_KEY); return v === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } };
export const theme = ref<Theme>(readTheme());
/** Called once by the app shell: applies the saved theme and follows changes. */
export function applyTheme() {
  const set = (t: Theme) => {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    el.setAttribute('data-theme', t === 'experimental' ? 'light' : t);
    if (t === 'experimental') el.setAttribute('data-variant', t); else el.removeAttribute('data-variant');
  };
  set(theme.value);
  watch(theme, (t) => { try { local?.setItem(THEME_KEY, t); } catch { /* unavailable */ } set(t); });
}
