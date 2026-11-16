/**
 * Notices and the log (client/desktop.ts, client/log.ts) — no server, no DOM.
 *
 *   npx tsx test/notices.ts
 *
 * The rule under test (the owner, Nov 16 2026): EVERY notice is logged, shown for
 * the same NOTICE_MS whatever its kind, and leaves by itself; the pointer over the
 * stack holds them; the log keeps the newest LOG_KEEP lines.
 */
const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };

let passed = 0, failed = 0;
const check = (name: string, ok: unknown, detail?: unknown) => { if (ok) { passed++; console.log(`  PASS  ${name}`); } else { failed++; console.log(`  FAIL  ${name}${detail !== undefined ? ` — ${String(detail)}` : ''}`); } };

async function main() {
  // Timers by hand: the rule is about ten real seconds.
  let now = 1_000_000; const timers: Array<{ at: number; fn: () => void }> = [];
  const realNow = Date.now; Date.now = () => now;
  (globalThis as any).setTimeout = (fn: () => void, ms = 0) => { timers.push({ at: now + ms, fn }); return timers.length; };
  const advance = (ms: number) => { now += ms; for (;;) { const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0]; if (!due) break; timers.splice(timers.indexOf(due), 1); due.fn(); } };

  const { notice, notices, dismiss, holdNotices, NOTICE_MS, NOTICE_LINGER_MS } = await import('../src/client/desktop');
  const { messageLog, logMessage, clearLog, unseenProblems, markLogSeen, logAsText, LOG_KEEP, LOG_KEY } = await import('../src/client/log');

  console.log('\nN1. One rule for every kind');
  notice('an info'); advance(1000); notice('a warning', 'warn'); advance(1000); notice('an error', 'error', [{ id: 'r1', label: 'a.mov' }]);
  check('all three are shown, newest first', notices.map((n) => n.kind).join() === 'error,warn,info');
  check('all three are in the log, with the kind and the record pills', messageLog.map((e) => e.kind).join() === 'error,warn,info' && messageLog[0].records?.[0].label === 'a.mov');
  advance(NOTICE_MS - 2001);
  check('nothing has left before its time', notices.length === 3);
  advance(1);
  check('the INFO leaves at its own ten seconds — not whichever notice was newest', notices.map((n) => n.text).join() === 'an error,a warning', notices.map((n) => n.text).join());
  advance(1000);
  check('the WARNING leaves by itself too, a second later', notices.map((n) => n.text).join() === 'an error');
  advance(1000);
  check('…and so does the ERROR', notices.length === 0);
  check('the log still has all three', messageLog.length === 3);

  console.log('\nN2. The pointer over the stack holds them');
  notice('read me', 'warn'); holdNotices(true); advance(NOTICE_MS + 5000);
  check('held: it stays past its time', notices.length === 1);
  holdNotices(false); advance(NOTICE_LINGER_MS - 1);
  check('released: it lingers a moment', notices.length === 1);
  advance(1);
  check('…then goes', notices.length === 0);
  notice('click me', 'error'); dismiss(notices[0].id);
  check('a click still dismisses at once', notices.length === 0);
  advance(NOTICE_MS);

  console.log('\nN3. The log');
  check('unseen counts warnings and errors, not infos', unseenProblems() === 4, unseenProblems());
  markLogSeen(); advance(10);
  check('looking at the log clears the count', unseenProblems() === 0);
  logMessage('later', 'error');
  check('…and a later problem counts again', unseenProblems() === 1);
  check('it is stored for the next launch', JSON.parse(mem.get(LOG_KEY)!)[0].text === 'later');
  check('as text: a stamp, the kind, the words', /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d  ERROR  later$/.test(logAsText().split('\n')[0]), logAsText().split('\n')[0]);
  for (let i = 0; i < LOG_KEEP + 20; i++) logMessage(`line ${i}`);
  check(`only the newest ${LOG_KEEP} are kept`, messageLog.length === LOG_KEEP && messageLog[0].text === `line ${LOG_KEEP + 19}` && JSON.parse(mem.get(LOG_KEY)!).length === LOG_KEEP);
  // Another tab wrote meanwhile: its line is not lost by this tab's next write.
  mem.set(LOG_KEY, JSON.stringify([{ id: 'other-tab', at: now, kind: 'warn', text: 'from the note page' }, ...JSON.parse(mem.get(LOG_KEY)!).slice(0, 5)]));
  logMessage('mine');
  check('a line another tab stored is kept when this tab writes next', messageLog[0].text === 'mine' && messageLog[1].text === 'from the note page');
  clearLog();
  check('clear empties it, here and in storage', messageLog.length === 0 && mem.get(LOG_KEY) === '[]' && unseenProblems() === 0);

  Date.now = realNow;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
void main();
