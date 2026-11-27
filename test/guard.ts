/**
 * The sign-in guard holds for EVERY route, under every spelling of its path.
 * SECURITY-BRIEF.md S3.
 *
 * The guard is a middleware mounted on `/api/*` (src/server/index.ts). Several
 * advisories against Hono and its node adapter in 2026 were about requests whose
 * path is spelled so that wildcard middleware is skipped while a route still
 * matches — an encoded line terminator, a backslash, a double-decoded slash. This
 * suite sends those spellings to the real server, signed in as nobody, and fails if
 * any of them reaches a handler.
 *
 * The route list is READ from index.ts, so a route added later is covered without
 * anyone remembering this file. Requests go over a raw socket: fetch normalises
 * paths, which is the opposite of the point.
 *
 * "Reached a handler" means: a 2xx answer that is data — JSON or the event stream.
 * The app's own index.html (the login screen, served for any unknown non-API path)
 * is not data and is allowed.
 */

import pg from 'pg';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { hashPassword } from '../src/server/auth.js';
import { bootServer } from './harness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const PORT = Number(process.env.TEST_PORT ?? 8833);
const OPEN = new Set(['/api/auth/login', '/api/auth/me', '/api/auth/logout', '/api/health']);
const ENCODINGS = ['%0a', '%0d', '%0A%0D', '%E2%80%A8', '%E2%80%A9', '%00', '%2f', '%5c', '\\', '%252f', '%09', ';x', '%3f', '%23'];
const PREFIXES = ['//api/', '/API/', '/./api/', '/x/../api/', '\\api\\', '/api\\', '/api//', '/%61pi/', '/ap%69/'];
const UUID = '00000000-0000-4000-8000-000000000000';

/** One request over a raw socket — the path goes out exactly as written. */
function raw(method: string, path: string): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve) => {
    const s = net.connect(PORT, '127.0.0.1');
    let buf = '';
    s.setEncoding('latin1');
    s.on('data', (d) => {
      buf += d;
      // An event stream never ends: the headers are enough to judge it.
      if (/content-type:\s*text\/event-stream/i.test(buf)) s.destroy();
    });
    const done = () => {
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(buf)?.[1] ?? 0);
      const type = /\r\ncontent-type:\s*([^\r\n;]+)/i.exec(buf)?.[1]?.toLowerCase() ?? '';
      resolve({ status, type, body: buf.slice(buf.indexOf('\r\n\r\n') + 4, 400) });
    };
    s.on('close', done);
    s.on('error', () => { /* closed underneath us: judge what arrived */ });
    s.setTimeout(3000, () => s.destroy());
    s.write(`${method} ${path} HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  });
}

async function main() {
  const src = readFileSync('src/server/index.ts', 'utf8');
  const routes = [...src.matchAll(/^app\.(get|post|patch|put|delete)\('([^']+)'/gm)].map((m) => [m[1].toUpperCase(), m[2]] as const);
  check('the route list was read from index.ts', routes.length >= 20 && routes.some(([, p]) => p === '/api/mutate'), String(routes.length));
  const guarded = routes.filter(([, p]) => !OPEN.has(p));

  const variants = new Set<string>();
  for (const [method, route] of guarded) {
    const filled = route.replace(/:id/g, UUID);
    variants.add(`${method} ${filled}`);
    for (const e of ENCODINGS) {
      if (route.includes(':id')) { variants.add(`${method} ${route.replace(/:id/g, `${UUID}${e}`)}`); variants.add(`${method} ${route.replace(/:id/g, e)}`); }
      variants.add(`${method} ${filled}${e}`);
      variants.add(`${method} ${filled.replace('/api/', `/api${e}/`)}`);
      variants.add(`${method} ${filled.replace('/api/', `/${e}api/`)}`);
      variants.add(`${method} ${filled.replace('/api/', `/api/${e}`)}`);
    }
    for (const p of PREFIXES) variants.add(`${method} ${filled.replace('/api/', p)}`);
  }

  const pool = new pg.Pool({ connectionString: process.env.DB_URL });
  await pool.query(`truncate tables, canvases, mutations, sections, sessions cascade`);
  await pool.query(`delete from users`);
  await pool.query(`insert into users (email, name, role, password_hash) values ('admin@test.local','admin','admin',$1)`, [await hashPassword('admin-password-1')]);
  const server = await bootServer(PORT, { AUTH_DISABLED: '0' });
  try {
    console.log(`\nG1. ${variants.size} spellings of ${guarded.length} guarded routes, signed in as nobody`);
    const leaks: string[] = [];
    const statuses = new Map<number, number>();
    for (const v of variants) {
      const [method, ...rest] = v.split(' ');
      const r = await raw(method, rest.join(' '));
      statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
      const data = r.type === 'application/json' || r.type === 'text/event-stream';
      if (r.status >= 200 && r.status < 300 && data) leaks.push(`${v} → ${r.status} ${r.type} ${r.body.slice(0, 80)}`);
    }
    check('no spelling of any guarded route answers with data', leaks.length === 0, `${leaks.length} leaks:\n    ${leaks.slice(0, 15).join('\n    ')}`);
    check('…and none of them crashed a handler (no 5xx)', ![...statuses.keys()].some((s) => s >= 500),
      [...statuses].map(([s, n]) => `${s}×${n}`).join(' '));
    console.log(`        statuses: ${[...statuses].sort((a, b) => a[0] - b[0]).map(([s, n]) => `${s}×${n}`).join(' ')}`);
    const plain = await raw('GET', '/api/schema');
    check('(control) the plain path is a 401', plain.status === 401, String(plain.status));
    const health = await raw('GET', '/api/health');
    check('(control) an open route still answers, and the server survived all of it', health.status === 200 && health.type === 'application/json', String(health.status));
  } finally {
    await server.stop();
    await pool.end();
  }
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
