/**
 * Hardening for facing a network — SECURITY-BRIEF.md, against a server with sign-in ON.
 *
 *   L1  request size        every body has a ceiling; uploads keep their own
 *   L2  sign-in under load  (S2) the scrypt gate, the per-address budget, the
 *                           per-account pause, a bounded memory of attempts
 *
 * Bodies are sent with node:http rather than fetch: the point is to send MORE than
 * the server will accept, with and without a Content-Length, and to watch the
 * server's memory while it happens.
 */

import pg from 'pg';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../src/server/auth.js';
import { bootServer } from './harness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PORT = Number(process.env.TEST_PORT ?? 8831);
const PW = { admin: 'admin-password-1', editor: 'editor-password-1' };
const MB = 1024 * 1024;

/** Resident memory of a process, in MB, from /proc (Linux, which is where this runs). */
const rssOf = (pid: number) => {
  try { return Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0) / 1024; } catch { return 0; }
};

interface Sent { status: number; body: any; headers: http.IncomingHttpHeaders }
/**
 * Send `size` bytes of JSON-ish body. `chunked` leaves out Content-Length. The
 * server may answer and close before the body is all sent; that is the point, and
 * a write error after the answer is not a failure.
 */
function send(method: string, path: string, opts: { size?: number; body?: string; chunked?: boolean; headers?: Record<string, string> } = {}): Promise<Sent> {
  return new Promise((resolve) => {
    const body = opts.body !== undefined ? Buffer.from(opts.body) : null;
    const size = body ? body.length : (opts.size ?? 0);
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) };
    if (!opts.chunked) headers['Content-Length'] = String(size);
    let status = 0, text = '', resHeaders: http.IncomingHttpHeaders = {}, done = false;
    const finish = () => {
      if (done) return; done = true;
      let j: any = {}; try { j = JSON.parse(text); } catch { j = { text }; }
      resolve({ status, body: j, headers: resHeaders });
    };
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path, headers, agent: false }, (res) => {
      status = res.statusCode ?? 0; resHeaders = res.headers;
      res.on('data', (d) => { text += d; });
      res.on('end', finish);
      res.on('error', finish);
      res.on('aborted', finish);
    });
    // The server answered and hung up mid-body (what it should do with too much):
    // the write fails, and whatever response arrived is the result.
    req.on('error', () => setTimeout(finish, 200));
    req.on('close', () => setTimeout(finish, 200));
    if (body) { req.end(body); return; }
    // Stream junk in 1 MB pieces, stopping once the server has answered.
    const piece = Buffer.alloc(Math.min(64 * 1024, Math.max(1, size)), 0x41);
    let sent = 0, paused = false;
    const pump = () => {
      if (status) { req.end(); return; }            // answered already: stop sending
      while (sent < size) {
        // A short pause after the first 128 KB, so an early answer is read before
        // the server hangs up on a client still writing (node's client otherwise
        // loses it). A server that does NOT answer early still gets the whole body.
        if (!paused && sent >= 128 * 1024) { paused = true; setTimeout(pump, 150); return; }
        const n = Math.min(piece.length, size - sent);
        sent += n;
        if (!req.write(n === piece.length ? piece : piece.subarray(0, n))) { req.once('drain', pump); return; }
      }
      req.end();
    };
    pump();
  });
}

async function login(email: string, password: string, ip: string): Promise<Sent> {
  return send('POST', '/api/auth/login', { body: JSON.stringify({ email, password }), headers: { 'X-Forwarded-For': ip } });
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DB_URL });
  await pool.query(`truncate tables, canvases, mutations, sections, sessions cascade`);
  await pool.query(`delete from users`);
  for (const role of ['admin', 'editor'] as const) {
    await pool.query(`insert into users (email, name, role, password_hash) values ($1,$2,$3,$4)`, [`${role}@test.local`, role, role, await hashPassword(PW[role])]);
  }
  // MUTATE_MAX_MB is lowered so the mutate limit can be crossed without a 64 MB test.
  const server = await bootServer(PORT, { AUTH_DISABLED: '0', MUTATE_MAX_MB: '2', ASSET_MAX_MB: '2', AUTH_TABLE_MAX: '20' });
  const pid = server.child.pid!;
  try {
    console.log('\nL1. Request size');
    const before = rssOf(pid);
    const big = await send('POST', '/api/auth/login', { size: 200 * MB });
    const after = rssOf(pid);
    check('200 MB sent to the login route with no session is refused with 413, in the app\'s own words',
      big.status === 413 && /larger than the 64 KB limit/.test(big.body.error ?? ''), `${big.status} ${JSON.stringify(big.body).slice(0, 120)}`);
    check('…and the server did not read it into memory', after - before < 40, `rss ${before.toFixed(0)} → ${after.toFixed(0)} MB`);

    const b2 = rssOf(pid);
    const chunked = await send('POST', '/api/auth/login', { size: 50 * MB, chunked: true });
    const a2 = rssOf(pid);
    check('the same with no Content-Length (chunked) is refused too', chunked.status === 413, String(chunked.status));
    check('…having read no more than the limit', a2 - b2 < 40, `rss ${b2.toFixed(0)} → ${a2.toFixed(0)} MB`);

    const small = await send('POST', '/api/auth/login', { size: 100 * 1024 });
    check('100 KB is already over the sign-in limit', small.status === 413, String(small.status));

    const b3 = rssOf(pid);
    const anonMutate = await send('POST', '/api/mutate', { size: 60 * MB, chunked: true });
    const a3 = rssOf(pid);
    // The server answers 401 within milliseconds and closes; node's http client can
    // lose an answer that arrives while it is still writing (curl does not), so the
    // status may read as 0 here. What matters is that nothing was buffered.
    check('an ANONYMOUS 60 MB chunked body to /api/mutate is turned away without being buffered',
      (anonMutate.status === 401 || anonMutate.status === 0) && a3 - b3 < 40, `${anonMutate.status}, rss ${b3.toFixed(0)} → ${a3.toFixed(0)} MB`);
    const anonSmall = await send('POST', '/api/mutate', { body: '{"clientId":"x","mutations":[]}' });
    check('…and a small anonymous one is a plain 401', anonSmall.status === 401, String(anonSmall.status));

    const ok = await login('admin@test.local', PW.admin, '10.1.0.1');
    check('a normal sign-in still works', ok.status === 200 && typeof ok.body.token === 'string', String(ok.status));
    const auth = { Authorization: `Bearer ${ok.body.token}` };

    // An upload over every JSON limit (1 MB) but under this suite's ASSET_MAX_MB (2).
    const pngOf = (bytes: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24), Buffer.alloc(bytes, 7)]);
    /** `chunked` sends it in 16 KB pieces with no Content-Length, as a browser streaming a file may. */
    const upload = (body: Buffer, chunked = false) => new Promise<number>((resolve) => {
      const req = http.request({ agent: false, host: '127.0.0.1', port: PORT, method: 'POST', path: '/api/assets?name=big.png',
        headers: { ...auth, ...(chunked ? {} : { 'Content-Length': String(body.length) }) } },
        (res) => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); });
      req.on('error', () => resolve(0));
      if (!chunked) { req.end(body); return; }
      let at = 0;
      const pump = () => { while (at < body.length) { const next = body.subarray(at, at += 16 * 1024); if (!req.write(next)) { req.once('drain', pump); return; } } req.end(); };
      pump();
    });
    const up = await upload(pngOf(1.5 * MB));
    check('a 1.5 MB upload still goes through (uploads keep their own ASSET_MAX_MB, not the 1 MB JSON limit)', up === 201 || up === 200, String(up));
    // An over-cap upload used to be able to crash the process: the temp file was
    // destroyed while a write was in flight, and the stream had no error listener.
    const burst = await Promise.all(Array.from({ length: 40 }, (_, i) => upload(pngOf(2 * MB + 4096 * i), i % 2 === 0)));
    const alive = await send('GET', '/api/health');
    check('a burst of over-cap uploads is refused, and the server is still up afterwards', burst.every((s) => s === 413 || s === 0) && alive.status === 200,
      `${burst.join(',')} health ${alive.status}`);

    // A real batch between the 1 MB and 2 MB limits.
    const tId = randomUUID(), fId = randomUUID();
    const setup = await send('POST', '/api/mutate', { headers: auth, body: JSON.stringify({ clientId: randomUUID(), mutations: [
      { id: randomUUID(), mutation: { type: 'table.create', id: tId, name: 'Big', singularName: 'Big', color: '', icon: '' } },
      { id: randomUUID(), mutation: { type: 'field.create', id: fId, tableId: tId, name: 'Note', key: 'note', fieldType: 'long_text', options: {}, required: false } },
    ] }) });
    const text = 'x'.repeat(4000);
    const batch = JSON.stringify({ clientId: randomUUID(), mutations: Array.from({ length: 400 }, () => (
      { id: randomUUID(), mutation: { type: 'record.create', id: randomUUID(), tableId: tId, data: { note: text } } })) });
    const applied = await send('POST', '/api/mutate', { headers: auth, body: batch });
    check(`a legitimate ${(batch.length / MB).toFixed(1)} MB batch under the mutate limit applies`, setup.status === 200 && applied.status === 200 && applied.body.applied?.length === 400,
      `${setup.status} ${applied.status} ${JSON.stringify(applied.body).slice(0, 160)}`);
    const over = await send('POST', '/api/mutate', { headers: auth, size: 3 * MB });
    check('a batch over MUTATE_MAX_MB is refused with 413, naming the limit', over.status === 413 && /2 MB limit/.test(over.body.error ?? ''), `${over.status} ${JSON.stringify(over.body)}`);
    const otherOver = await send('POST', '/api/compare', { headers: auth, size: 2 * MB });
    check('every other body-reading route has a 1 MB ceiling', otherOver.status === 413 && /1 MB limit/.test(otherOver.body.error ?? ''), `${otherOver.status}`);

    console.log('\nL2. Sign-in under load');
    // One address, a different email every time: the old back-off (address+email)
    // never saw a repeat, so this was unlimited.
    const sprayed: Sent[] = [];
    for (let i = 0; i < 11; i++) sprayed.push(await login(`spray${i}@test.local`, 'wrong-password', '10.2.0.1'));
    const t0 = Date.now(); const twelfth = await login('spray-last@test.local', 'wrong-password', '10.2.0.1'); const fast = Date.now() - t0;
    check('one address gets 10 attempts a minute whatever the email; the 11th is 429',
      sprayed.slice(0, 10).every((r) => r.status === 401) && sprayed[10].status === 429 && /from here/.test(sprayed[10].body.error ?? ''),
      sprayed.map((r) => r.status).join(','));
    check('…answered at once, without running scrypt, and with Retry-After', twelfth.status === 429 && fast < 150 && Number(twelfth.headers['retry-after']) > 0,
      `${twelfth.status} ${fast}ms retry-after=${twelfth.headers['retry-after']}`);

    // One account, a different address every time.
    const spread: number[] = [];
    for (let i = 0; i < 20; i++) spread.push((await login('editor@test.local', `guess-${i}`, `10.3.0.${i + 1}`)).status);
    const twentyFirst = await login('editor@test.local', 'guess-21', '10.3.1.1');
    const rightOne = await login('editor@test.local', PW.editor, '10.3.1.2');
    check('20 failures for one email from 20 addresses pause that account — the 21st, from a new address, is 429',
      spread.every((s) => s === 401) && twentyFirst.status === 429 && /this account/.test(twentyFirst.body.error ?? ''), `${spread.join(',')} → ${twentyFirst.status}`);
    check('…and so is the RIGHT password while the pause lasts', rightOne.status === 429 && Number(rightOne.headers['retry-after']) > 0, String(rightOne.status));
    const unknown: number[] = [];
    for (let i = 0; i < 21; i++) unknown.push((await login('nobody-at-all@test.local', `guess-${i}`, `10.4.0.${i + 1}`)).status);
    check('an email that does not exist is paused the same way (the pause says nothing about who exists)', unknown[19] === 401 && unknown[20] === 429, unknown.join(','));
    check('other accounts are unaffected', (await login('admin@test.local', PW.admin, '10.3.2.1')).status === 200);

    // A lockout survives a flood of junk entries (AUTH_TABLE_MAX is 20 here). The
    // back-off doubles from 2 s at the 5th failure, so wait it out to the 8th (16 s)
    // — long enough to outlast the flood. 10 attempts from this address in all.
    for (let i = 0; i < 5; i++) await login('admin@test.local', `wrong-${i}`, '10.5.0.1');
    for (const ms of [2100, 4100, 8100]) { await sleep(ms); await login('admin@test.local', `wrong-again-${ms}`, '10.5.0.1'); }
    const locked = await login('admin@test.local', PW.admin, '10.5.0.1');
    const filler: Promise<Sent>[] = [];
    for (let i = 0; i < 36; i++) {
      filler.push(login(`junk${i}@test.local`, 'x', `10.6.0.${i + 1}`));
      if (filler.length % 12 === 0) await Promise.all(filler.slice(-12));     // stay under the gate's waiting line
    }
    await Promise.all(filler);
    const stillLocked = await login('admin@test.local', PW.admin, '10.5.0.1');
    const isBackoff = (r: Sent) => r.status === 429 && /too many attempts/.test(r.body.error ?? '');
    check('a flood of junk sign-ins past the table\'s bound does NOT lift an existing lockout', isBackoff(locked) && isBackoff(stillLocked),
      `${locked.status} ${locked.body.error} → ${stillLocked.status} ${stillLocked.body.error}`);

    // Many at once: at most two verifications run, a few wait, the rest are told to come back.
    const base = rssOf(pid); let peak = base;
    const poll = setInterval(() => { peak = Math.max(peak, rssOf(pid)); }, 20);
    const t1 = Date.now();
    const flood = await Promise.all(Array.from({ length: 40 }, (_, i) => login(`flood${i}@test.local`, 'wrong-password', `10.7.0.${i + 1}`)));
    clearInterval(poll);
    const busy = flood.filter((r) => r.status === 429 && /busy/.test(r.body.error ?? '')).length;
    const tried = flood.filter((r) => r.status === 401).length;
    check('40 attempts at once: no more than 2 run with 16 waiting (18 answered), the other 22 are 429 "busy" with Retry-After',
      tried === 18 && busy === 22 && flood.filter((r) => r.status === 429).every((r) => Number(r.headers['retry-after']) > 0), `401×${tried} busy×${busy} in ${Date.now() - t1}ms`);
    check('…and memory stays bounded (the audit measured +530 MB for this)', peak - base < 330, `rss ${base.toFixed(0)} → peak ${peak.toFixed(0)} MB`);
    check('sign-in works again once the flood has passed', (await login('viewer-less@test.local', 'whatever-it-is', '10.7.1.1')).status === 401);
  } finally {
    await server.stop();
    await pool.end();
  }

  await sleep(50);
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
