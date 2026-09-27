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
