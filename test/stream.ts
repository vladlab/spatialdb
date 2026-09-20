/**
 * ============================================================================
 *  Stream tests — over HTTP, against a running server.
 * ============================================================================
 *
 *  These exist because their absence is why the shape divergence shipped.
 *
 *  test/e2e.ts calls applyBatch() directly with a PoolClient. It is a good
 *  suite and it passed the whole time — but it never opens a socket, so
 *  `broadcast()` and the entire `/api/stream` handler were untested code. The
 *  live payload and the catch-up payload could differ in field names,
 *  granularity, and even the type of `seq`, and nothing anywhere would notice.
 *
 *  So the load-bearing assertion here is not "events arrive". It is
 *  "a live event and its replay are byte-identical apart from the replay flag".
 *  That is the property the client's single apply path depends on.
 *
 *  Run: npm run test:stream   (boots its own server on a spare port)
 */

import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { pendingMigrations, migrationGate } from '../src/server/migrations.js';
import { boardsTableMutations, bootServer, type ServerHandle } from './harness.js';
import { createStore } from '../src/client/store.js';
import { StreamEvent } from '../src/contract/events.js';

const PORT = Number(process.env.TEST_PORT ?? 8799);
const API = `http://localhost:${PORT}`;

let pass = 0;
/** The table of boards this suite's canvases live in — see harness.boardsTableMutations. */
const BOARDS = randomUUID();

let fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

/* ── a minimal SSE client ──────────────────────────────────────────────────*/

interface Tap {
  events: StreamEvent[];
  close: () => void;
}

async function tap(since: number): Promise<Tap> {
  const res = await fetch(`${API}/api/stream?since=${since}`);
  if (!res.body) throw new Error('no stream body');
  const reader = res.body.getReader();
  const events: StreamEvent[] = [];

  (async () => {
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (!chunk.startsWith('data: ')) continue;   // keepalive comment
          // Parse through the contract. An off-contract event fails the test
          // here rather than becoming a duplicated card later.
          events.push(StreamEvent.parse(JSON.parse(chunk.slice(6))));
        }
      }
    } catch { /* closed */ }
  })();

  return { events, close: () => void reader.cancel().catch(() => {}) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mutate(clientId: string, mutations: unknown[]) {
  const res = await fetch(`${API}/api/mutate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, mutations }),
  });
  if (!res.ok) throw new Error(`mutate failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/* ── fixtures ──────────────────────────────────────────────────────────────*/

const pool = new pg.Pool({ connectionString: process.env.DB_URL });

async function ensureAdmin() {
  const db = await pool.connect();
  try {
    const { rows } = await db.query(`select 1 from users limit 1`);
    if (!rows.length) {
      await db.query(
        `insert into users (email, name, role) values ('stream@local','Stream','admin')`);
    }
  } finally { db.release(); }
}

let server: ServerHandle | undefined;

/* ── the suite ─────────────────────────────────────────────────────────────*/

async function main() {
  await ensureAdmin();
  server = await bootServer(PORT);

  const me = randomUUID();
  const other = randomUUID();
  const canvasName = `stream test ${Date.now()}`;
  // Every canvas below is a record in this table of boards (sql/010).
  await mutate(other, boardsTableMutations(BOARDS).map((mutation) => ({ id: randomUUID(), mutation })));

  console.log('\n1. Live and replay are the SAME shape');
  const head0 = (await (await fetch(`${API}/api/head`)).json()).seq as number;

  const liveTap = await tap(head0);
  await sleep(300);

  const canvasA = randomUUID();
  const canvasB = randomUUID();
  await mutate(other, [
    { id: randomUUID(), mutation: { type: 'record.create', id: canvasA, tableId: BOARDS, data: { name: `${canvasName} A` } } },
    { id: randomUUID(), mutation: { type: 'record.create', id: canvasB, tableId: BOARDS, data: { name: `${canvasName} B` } } },
  ]);
  await sleep(600);
  liveTap.close();

  // A two-mutation batch is TWO events, not one batch summary. The old
  // broadcast emitted a single per-batch object; catch-up emitted one row per
  // mutation. That mismatch is the whole reason this file exists.
  const live = liveTap.events.filter((e) => e.kind === 'mutation');
  check('a 2-mutation batch produced 2 live events', live.length === 2,
    `got ${live.length}`);

  const replayTap = await tap(head0);
  await sleep(600);
  replayTap.close();
  const replayed = replayTap.events.filter((e) => e.kind === 'mutation');
  check('the same batch replays as 2 catch-up events', replayed.length === 2,
    `got ${replayed.length}`);

  // THE assertion. Identical apart from `replay`.
  if (live.length === 2 && replayed.length === 2) {
    const strip = (e: any) => JSON.stringify({ ...e, replay: null });
    const identical = live.every((e, i) => strip(e) === strip(replayed[i]));
    check('live and replayed events are identical apart from `replay`', identical,
      identical ? '' : `\n    live:   ${strip(live[0])}\n    replay: ${strip(replayed[0])}`);
    check('`replay` distinguishes them', !live[0].replay && replayed[0].replay);
    check('seq is a number on both paths',
      typeof live[0].seq === 'number' && typeof replayed[0].seq === 'number');
    check('one field name for the sender on both paths',
      live[0].clientId === other && replayed[0].clientId === other);
  }

  console.log('\n2. A client can recognise its own echo — live AND on replay');
  // This is the bug that silently duplicated records. The old live event used
  // `clientId` and the old catch-up row used `client_id`, so whichever name the
  // client checked, it failed to recognise itself on one of the two paths.
  const before = (await (await fetch(`${API}/api/head`)).json()).seq as number;
  const mineTap = await tap(before);
  await sleep(300);
  const mineCanvas = randomUUID();
  await mutate(me, [
    { id: randomUUID(), mutation: { type: 'record.create', id: mineCanvas, tableId: BOARDS, data: { name: `${canvasName} mine` } } },
  ]);
  await sleep(600);
  mineTap.close();
  const liveMine = mineTap.events.filter((e) => e.kind === 'mutation');
  check('own write is identifiable live', liveMine.length === 1 && liveMine[0].clientId === me);

  const replayMine = await tap(before);
  await sleep(600);
  replayMine.close();
  const rm = replayMine.events.filter((e) => e.kind === 'mutation');
  check('own write is identifiable on replay, by the SAME field',
    rm.length === 1 && rm[0].clientId === me,
    rm.length ? `clientId=${(rm[0] as any).clientId}` : 'no event');

  console.log('\n3. No event is delivered twice across the catch-up/live handover');
  // Subscribing happens before catch-up now, with buffering, so a write landing
  // mid-handover is delivered exactly once rather than dropped by both paths.
  const t3start = (await (await fetch(`${API}/api/head`)).json()).seq as number;
  const raceTap = await tap(t3start);
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (const id of ids) {
    await mutate(other, [
      { id: randomUUID(), mutation: { type: 'record.create', id, tableId: BOARDS, data: { name: `${canvasName} race` } } },
    ]);
  }
  await sleep(800);
  raceTap.close();
  const seqs = raceTap.events.filter((e) => e.kind === 'mutation').map((e: any) => e.seq);
  check('every write during handover arrived', seqs.length >= 3, `got ${seqs.length}`);
  check('no duplicate seq delivered', new Set(seqs).size === seqs.length,
    `seqs=${seqs.join(',')}`);
  check('seqs arrive in ascending order',
    seqs.every((s, i) => i === 0 || s > seqs[i - 1]), `seqs=${seqs.join(',')}`);

  console.log('\n4. Too far behind → an explicit resync, never a silent prefix');
  // The catch-up limit is 1000 rows, so this branch only runs on a log longer
  // than that. Left to chance it silently took the "short log" path on a fresh
  // database and asserted the easy case instead — a test that can quietly choose
  // the branch it verifies is not a test. So: pad the log first, deterministically.
  const LIMIT = 1000;
  const need = LIMIT + 50 - Number(
    (await pool.query(`select count(*)::int as n from mutations`)).rows[0].n);
  if (need > 0) {
    console.log(`  (padding the log with ${need} rows to reach the truncation threshold)`);
    // `canvas.update` on ONE canvas, not `canvas.create` a thousand times.
    //
    // The first version created a canvas per row, which meant a single test run
    // left ~900 junk canvases behind — they showed up in the app's canvas picker
    // as `pad <uuid>`. Tests now run against their own database so it would no
    // longer leak, but there is still no reason to create a thousand entities to
    // exercise a log-length branch. Updates are log rows without rows anywhere
    // else, which is exactly what is wanted here.
    const padCanvas = randomUUID();
    await mutate(randomUUID(), [{
      id: randomUUID(),
      mutation: { type: 'record.create', id: padCanvas, tableId: BOARDS, data: { name: 'pad target' } },
    }]);
    for (let sent = 0; sent < need - 1; sent += 400) {
      const chunk = Math.min(400, need - 1 - sent);
      await mutate(randomUUID(), Array.from({ length: chunk }, (_, i) => ({
        id: randomUUID(),
        mutation: {
          type: 'canvas.update', id: padCanvas, description: `pad ${sent + i}`,
        },
      })));
    }
  }
  const totalRows = Number(
    (await pool.query(`select count(*)::int as n from mutations`)).rows[0].n);
  check('log is long enough to force truncation', totalRows > LIMIT, `${totalRows} rows`);

  const resyncTap = await tap(0);   // since=0 against a log with far more rows
  await sleep(1200);
  resyncTap.close();
  const resync = resyncTap.events.find((e) => e.kind === 'resync');
  const gotRows = resyncTap.events.filter((e) => e.kind === 'mutation').length;

  check('resync event emitted', !!resync);
  check('NO truncated prefix sent alongside it', gotRows === 0, `got ${gotRows} rows`);
  if (resync && resync.kind === 'resync') {
    check('resync reports the log head', resync.head >= totalRows - 5,
      `head=${resync.head} total=${totalRows}`);
    check('resync echoes back what was asked for', resync.since === 0);
  }

  // And the other side of the boundary: a client just barely behind gets a real
  // replay, not a resync. Both branches, every run.
  const nearHead = totalRows - 5;
  const shortTap = await tap(nearHead);
  await sleep(800);
  shortTap.close();
  check('a client just behind gets a replay, not a resync',
    !shortTap.events.some((e) => e.kind === 'resync') &&
      shortTap.events.filter((e) => e.kind === 'mutation').length > 0,
    `${shortTap.events.length} events`);

  console.log('\n5. A watermark AHEAD of the log head gets a resync, not silence');
  // `seq > <past the end>` matches nothing, which at the row level is
  // indistinguishable from "up to date" — so the server used to send zero events,
  // hold the connection open, and let the client sit there believing it was
  // current. Not exotic: restoring from a dump moves the head BACKWARDS, so every
  // connected client is instantly ahead of it. Pruning does the same.
  const headNow = Number((await (await fetch(`${API}/api/head`)).json()).seq);
  const aheadTap = await tap(headNow + 500);
  await sleep(1200);
  aheadTap.close();

  const aheadResync = aheadTap.events.find((e) => e.kind === 'resync');
  check('a resync arrives rather than silence', !!aheadResync,
    `${aheadTap.events.length} events`);
  if (aheadResync && aheadResync.kind === 'resync') {
    check('reason distinguishes it from being behind',
      aheadResync.reason === 'ahead-of-head', aheadResync.reason);
    check('it reports the real head', aheadResync.head === headNow,
      `head=${aheadResync.head} actual=${headNow}`);
    check('and echoes the impossible watermark back', aheadResync.since === headNow + 500);
  }

  // Exactly at the head is NOT ahead — that is simply being up to date, and must
  // stay a quiet open connection rather than a resync loop.
  const atHeadTap = await tap(headNow);
  await sleep(900);
  atHeadTap.close();
  check('a watermark exactly at the head does NOT trigger a resync',
    !atHeadTap.events.some((e) => e.kind === 'resync'),
    JSON.stringify(atHeadTap.events[0] ?? null));

  console.log('\n6. A corrupt watermark replays from the start, it does not go quiet');
  // `Number('garbage')` is NaN and `seq > NaN` matches nothing, so a client with
  // a corrupt watermark used to receive an empty catch-up and believe it was
  // current. Now anything unparseable is treated as 0.
  const junkRes = await fetch(`${API}/api/stream?since=not-a-number`);
  const junkReader = junkRes.body!.getReader();
  // Accumulate for a moment rather than taking the first chunk: the first chunk
  // is now the `: open` comment frame (see section 8), and the claim here is
  // about the DATA that follows it.
  let junk = '';
  const junkDeadline = sleep(1500).then(() => null);
  for (;;) {
    const r = await Promise.race([junkReader.read(), junkDeadline]);
    if (!r || r.done) break;
    junk += new TextDecoder().decode(r.value);
    if (junk.includes('data: ')) break;
  }
  junkReader.cancel().catch(() => {});
  check('junk `since` produces output rather than silence', junk.length > 0);
  check('and it is on-contract', /"kind":"(mutation|resync)"/.test(junk),
    junk.slice(0, 120));

  console.log('\n7. A misspelt mutation is refused, not accepted as a no-op');
  // The contract used plain z.object, which STRIPS unknown keys. So
  // `record.update` sent with `data:` instead of `set:` parsed to an empty
  // update, returned 200 and logged a row that did nothing. This has to go over
  // HTTP: the strictness lives in MutationRequest.parse, which e2e.ts never calls.
  const raw = (mutations: unknown[], extra: Record<string, unknown> = {}) =>
    fetch(`${API}/api/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: me, mutations, ...extra }),
    });
  const headBefore = (await (await fetch(`${API}/api/head`)).json()).seq as number;

  const typo = await raw([{ id: randomUUID(),
    mutation: { type: 'canvas.update', id: canvasA, nmae: 'typo' } }]);
  check('an unknown key on a mutation is a 400', typo.status === 400, `got ${typo.status}`);
  check('and the error names the key',
    JSON.stringify(await typo.json()).includes('nmae'));

  const nested = await raw([{ id: randomUUID(),
    mutation: { type: 'placement.move', canvasId: canvasA,
                moves: [{ recordId: randomUUID(), x: 1, y: 2, zz: 3 }] } }]);
  check('strictness reaches nested objects (moves[])', nested.status === 400, `got ${nested.status}`);

  // Carries an otherwise VALID mutation. The first version of this check sent an
  // empty batch, which is a 400 for being empty — it passed with strictness
  // switched off, i.e. it tested nothing.
  const envelope = await raw([{ id: randomUUID(),
    mutation: { type: 'canvas.update', id: canvasA, name: `${canvasName} env` } }],
    { clientID: 'wrong-case' });
  check('and the envelope itself', envelope.status === 400, `got ${envelope.status}`);

  const headAfter = (await (await fetch(`${API}/api/head`)).json()).seq as number;
  check('none of them wrote a log row', headAfter === headBefore,
    `${headBefore} -> ${headAfter}`);

  // The control: the same mutation spelt correctly still works, so the 400s
  // above are about the key and not about canvas.update being broken.
  const okRes = await raw([{ id: randomUUID(),
    mutation: { type: 'canvas.update', id: canvasA, name: `${canvasName} A2` } }]);
  check('the correctly spelt version is accepted', okRes.status === 200, `got ${okRes.status}`);

  console.log('\n8. An idle stream speaks at once');
  // Proxies hold response headers until the first body byte. A client already
  // at the head has nothing to replay, so the first byte used to be the 25 s
  // keepalive — and behind Vite's dev proxy the UI said "connecting" for exactly
  // that long. Connecting directly (as this suite does) flushes headers at once
  // and hid it, so assert on the BODY: that is what a proxy waits for.
  const idleHead = (await (await fetch(`${API}/api/head`)).json()).seq as number;
  const idleAbort = new AbortController();
  const t0 = Date.now();
  const idle = await fetch(`${API}/api/stream?since=${idleHead}`, { signal: idleAbort.signal });
  const firstChunk = await Promise.race([
    idle.body!.getReader().read().then((r) => new TextDecoder().decode(r.value)),
    sleep(3000).then(() => null),
  ]);
  idleAbort.abort();
  check('a stream with nothing to replay sends a first byte within 3s',
    firstChunk !== null, `nothing after ${Date.now() - t0}ms`);
  check('and it is a comment frame, which every SSE parser ignores',
    firstChunk?.startsWith(':') === true, JSON.stringify(firstChunk));

  console.log('\n9. A database behind the code is NAMED, not a bare 500');
  // Pull new code, forget `db.sh migrate`: writes touching a new column died with
  // "500 internal error" and the client retried forever. Reported from real use.
  check('an up-to-date database has nothing pending', (await pendingMigrations(pool)).length === 0,
    (await pendingMigrations(pool)).join());
  const newest = (await pool.query(`select name from _migrations order by name desc limit 1`)).rows[0].name as string;
  await pool.query(`delete from _migrations where name = $1`, [newest]);
  try {
    check('an unapplied file is reported by name', (await pendingMigrations(pool)).join() === newest,
      (await pendingMigrations(pool)).join());
    const gate = migrationGate(pool);
    check('the gate reports it', (await gate()).join() === newest);
    await pool.query(`insert into _migrations (name) values ($1)`, [newest]);
    check('and keeps reporting for a moment (it re-checks at most every 2s)…', (await gate()).length === 1);
    await sleep(2100);
    check('…then notices the migration has run, with no restart', (await gate()).length === 0);
  } finally {
    await pool.query(`insert into _migrations (name) values ($1) on conflict do nothing`, [newest]);
  }

  console.log('\n10. Retired mutations still replay');
  // canvas.create / canvas.delete were retired by sql/010 (a canvas is a record).
  // The LOG still holds them, the stream re-validates every row it sends with the
  // strict contract, and a client catching up across the change has to get past
  // them. So they stay parseable — planted here exactly as an old server wrote one.
  const beforeLegacy = (await (await fetch(`${API}/api/head`)).json()).seq as number;
  const legacyId = randomUUID();
  await pool.query(
    `insert into mutations (id, client_id, type, payload)
     values ($1, $2, 'canvas.create', $3::jsonb)`,
    [randomUUID(), other, JSON.stringify({ type: 'canvas.create', id: legacyId, name: 'made before 010', description: '' })]);
  const legacyTap = await tap(beforeLegacy);
  await sleep(500);
  const got = legacyTap.events.filter((e) => e.kind === 'mutation' && (e.mutation as { id?: string }).id === legacyId);
  check('an old canvas.create row is streamed, on-contract, not dropped or fatal', got.length === 1, `${got.length} events; ${legacyTap.events.length} total`);
  legacyTap.close();

  const catchingUp = createStore({ baseUrl: API });
  await catchingUp.hydrate();
  catchingUp.lastSeq.value = beforeLegacy;      // "I was last here before the migration"
  catchingUp.start();
  await sleep(800);
  check('a client catching up ACROSS it applies nothing for it and reports no error',
    catchingUp.errors.value.length === 0 && !catchingUp.state.canvases.has(legacyId) && catchingUp.lastSeq.value > beforeLegacy,
    catchingUp.errors.value.join(' | '));
  catchingUp.stop();

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await server?.stop();
  await pool.end();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await server?.stop();
  await pool.end().catch(() => {});
  process.exit(1);
});
