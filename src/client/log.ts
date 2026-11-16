/**
 * THE LOG — everything the app has had to say, kept so a notice can go away.
 *
 * The owner, Nov 16 2026: "can we have an error log so i can just read past errors
 * without worrying about them disappearing? … with a log we can timeout all errors
 * automatically because we can go back and reference them."
 *
 * So: EVERY notice (client/desktop.ts `notice`) and every store error (a rejected
 * save, a dropped stream — client/store.ts `fail`) is written here first, and only
 * then shown for a few seconds. The log is the record; the notice is the tap on
 * the shoulder.
 *
 * Per browser, like the theme and the folds: localStorage, the newest LOG_KEEP
 * lines, surviving a reload and a restart of the desktop app. Not on the server —
 * "ffprobe could not read /mnt/…" is news about this machine's afternoon, not a
 * fact about the data. Several tabs share the one list (the full-page note is a
 * tab of its own): each write re-reads what is stored, and a `storage` event from
 * another tab refreshes this one.
 */
import { reactive, ref } from 'vue';

export type LogKind = 'info' | 'warn' | 'error';
export interface LogEntry { id: string; at: number; kind: LogKind; text: string; records?: Array<{ id: string; label: string }> }

export const LOG_KEY = 'spatialdb.log';
export const LOG_SEEN_KEY = 'spatialdb.log.seen';
export const LOG_KEEP = 500;

const local = typeof localStorage !== 'undefined' ? localStorage : undefined;

function read(): LogEntry[] {
  try {
    const v = JSON.parse(local?.getItem(LOG_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((e) => e && typeof e.text === 'string' && typeof e.at === 'number').slice(0, LOG_KEEP) : [];
  } catch { return []; }
}
function write() { try { local?.setItem(LOG_KEY, JSON.stringify(messageLog)); } catch { /* full or unavailable: the session's list still stands */ } }

/** Newest first. */
export const messageLog = reactive<LogEntry[]>(read());

/** When the log was last LOOKED at: warnings and errors newer than this are the footer's count. */
export const logSeenAt = ref<number>((() => { try { return Number(local?.getItem(LOG_SEEN_KEY)) || 0; } catch { return 0; } })());
export const unseenProblems = () => messageLog.filter((e) => e.kind !== 'info' && e.at > logSeenAt.value).length;
export function markLogSeen() {
  logSeenAt.value = Date.now();
  try { local?.setItem(LOG_SEEN_KEY, String(logSeenAt.value)); } catch { /* unavailable */ }
}

let n = 0;
export function logMessage(text: string, kind: LogKind = 'info', records?: LogEntry['records']) {
  // Another tab may have written since this one last read: take its lines first.
  const stored = read();
  if (stored.length && stored[0].id !== messageLog[0]?.id) messageLog.splice(0, messageLog.length, ...stored);
  messageLog.unshift({ id: `${Date.now().toString(36)}-${(n++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), kind, text, ...(records?.length ? { records } : {}) });
  if (messageLog.length > LOG_KEEP) messageLog.length = LOG_KEEP;
  write();
}

export function clearLog() { messageLog.length = 0; write(); markLogSeen(); }

/** The log as text, for pasting into a message: "2026-11-16 13:24:05  WARN  …". */
export function logAsText(entries: readonly LogEntry[] = messageLog): string {
  const p = (x: number) => String(x).padStart(2, '0');
  const stamp = (at: number) => { const d = new Date(at); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
  return entries.map((e) => `${stamp(e.at)}  ${e.kind.toUpperCase().padEnd(5)}  ${e.text}`).join('\n');
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === LOG_KEY) messageLog.splice(0, messageLog.length, ...read());
    if (e.key === LOG_SEEN_KEY) logSeenAt.value = Number(e.newValue) || 0;
  });
}
