/**
 * Per-browser state for calendars (VIEWS-BRIEF.md B5): which SOURCES are switched
 * off in the legend, per calendar. A way of looking, not a fact about the data —
 * never saved into the definition, never shared. localStorage, so it survives a
 * reload; every access guarded, so a browser that refuses storage just forgets.
 */
import { reactive } from 'vue';

const KEY = 'spatialdb.calendar.hidden';
const local = typeof localStorage !== 'undefined' ? localStorage : undefined;

function load(): Record<string, string[]> {
  try { const v = JSON.parse(local?.getItem(KEY) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
const state = reactive<Record<string, string[]>>(load());
function persist() { try { local?.setItem(KEY, JSON.stringify(state)); } catch { /* unavailable */ } }

/** The source ids switched off on this calendar, in this browser. */
export function hiddenSources(calendarId: string): ReadonlySet<string> {
  return new Set(state[calendarId] ?? []);
}
export function toggleSource(calendarId: string, sourceId: string) {
  const now = new Set(state[calendarId] ?? []);
  if (now.has(sourceId)) now.delete(sourceId); else now.add(sourceId);
  if (now.size) state[calendarId] = [...now]; else delete state[calendarId];
  persist();
}

/*
 * WHERE YOU WERE LOOKING, per calendar: the anchor day of the period on screen. Per
 * browser, like the toggles — two people looking at one calendar look at different
 * months. Absent = today.
 */
const ANCHOR_KEY = 'spatialdb.calendar.anchor';
function loadAnchors(): Record<string, string> {
  try { const v = JSON.parse(local?.getItem(ANCHOR_KEY) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
const anchors = reactive<Record<string, string>>(loadAnchors());

/** Today, in THIS computer's time zone — the day the person looking at it is in. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function anchorOf(calendarId: string): string {
  const a = anchors[calendarId];
  return typeof a === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a) ? a : localToday();
}
export function setAnchor(calendarId: string, iso: string) {
  anchors[calendarId] = iso;
  try { local?.setItem(ANCHOR_KEY, JSON.stringify(anchors)); } catch { /* unavailable */ }
}
