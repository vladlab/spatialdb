/**
 * Authentication — against a server with sign-in ON.
 *
 *   A1  passwords          hashing and verifying (no server)
 *   A2  the gate           what is reachable without a session, and what is not
 *   A3  sessions           login, cookie flags, logout, revocation, bearer tokens
 *   A4  guessing and CSRF  back-off; unknown users; cross-origin writes
 *   A5  roles              enforced by identity now, not by a stub
 *   A6  users              admin endpoints; the last admin; disabling; nothing in the log
 *   A7  the proxy seam     a trusted header, only when configured
 *   A8  the app            login screen → shell; a 401 mid-work keeps your edits
 */

import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from '../src/server/auth.js';
import { bootServer } from './harness.js';
import { mountApp } from './uiHarness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PORT = Number(process.env.TEST_PORT ?? 8809);
const API = `http://localhost:${PORT}`;
const PW = { admin: 'admin-password-1', editor: 'editor-password-1', viewer: 'viewer-password-1' };

/** A tiny cookie jar: what a browser does, by hand, so the flags can be inspected. */
class Client {
  cookie = ''; lastSetCookie = '';
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(API + path, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers } });
    const set = res.headers.get('set-cookie');
    if (set) { this.lastSetCookie = set; const [pair] = set.split(';'); this.cookie = pair.endsWith('=') ? '' : pair; }
    return { status: res.status, body: await res.json().catch(() => ({})) as any };
  }
  login(email: string, password: string, headers?: Record<string, string>) { return this.req('POST', '/api/auth/login', { email, password }, headers); }
}
const mutation = (m: unknown) => ({ clientId: randomUUID(), mutations: [{ id: randomUUID(), mutation: m }] });

async function main() {
  console.log('\nA1. Passwords');
  const h = await hashPassword('correct horse battery staple');
  check('a hash names its algorithm and cost (so both can change later without a migration)', /^scrypt\$131072\$8\$1\$/.test(h), h.slice(0, 30));
  check('the same password hashes differently each time (a salt per password)', h !== await hashPassword('correct horse battery staple'));
  check('the right password verifies; a wrong one, and no stored hash at all, do not',
    await verifyPassword('correct horse battery staple', h) && !(await verifyPassword('correct horse battery stapl', h)) && !(await verifyPassword('anything', null)));
  const t0 = Date.now(); await verifyPassword('x', null); const tUnknown = Date.now() - t0;
  const t1 = Date.now(); await verifyPassword('x', h); const tWrong = Date.now() - t1;
  check('an UNKNOWN user costs about what a wrong password does — the form cannot be used to list who exists',
    tUnknown > tWrong * 0.5 && tUnknown < tWrong * 2 && tWrong > 20, `unknown ${tUnknown}ms, wrong ${tWrong}ms`);

  const pool = new pg.Pool({ connectionString: process.env.DB_URL });
  await pool.query(`truncate tables, canvases, mutations, sections, sessions cascade`);
  await pool.query(`delete from users`);
  const server = await bootServer(PORT, { AUTH_DISABLED: '0' });
  try {
    console.log('\nA2. The gate');
    const anon = new Client();
    const me0 = await anon.req('GET', '/api/auth/me');
    check('with no users who can sign in, the server says SETUP is needed — and how', me0.status === 401 && me0.body.setup === true);
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      await pool.query(`insert into users (email, name, role, password_hash) values ($1,$2,$3,$4)`, [`${role}@test.local`, role, role, await hashPassword(PW[role])]);
    }
    const closed = await Promise.all(['/api/schema', '/api/canvases', '/api/sections', '/api/head', '/api/search?q=x', '/api/undoable', '/api/users',
      `/api/assets/${randomUUID()}`, `/api/tables/${randomUUID()}/records`, '/api/stream?since=0'].map(async (p) => [p, (await anon.req('GET', p)).status] as const));
    check('EVERY read needs a session — schema, records, search, history, the stream, uploaded files', closed.every(([, s]) => s === 401), closed.filter(([, s]) => s !== 401).map(([p, s]) => `${p}:${s}`).join(' '));
    check('and so do writes and uploads', (await anon.req('POST', '/api/mutate', mutation({ type: 'table.create', id: randomUUID(), name: 'x' }))).status === 401
      && (await fetch(`${API}/api/assets?name=a.png`, { method: 'POST', body: Buffer.from('x') })).status === 401);
    check('the health check stays open (a load balancer has no password)', (await anon.req('GET', '/api/health')).status === 200);
    check('nothing was written', (await pool.query(`select count(*)::int n from tables`)).rows[0].n === 0);

    console.log('\nA3. Sessions');
    const admin = new Client();
    const bad = await admin.login('admin@test.local', 'not-the-password');
    check('a wrong password is refused, without saying whether the email exists', bad.status === 401 && bad.body.error === 'wrong email or password'
      && (await new Client().login('nobody@test.local', 'whatever-it-is')).body.error === 'wrong email or password');
    const ok = await admin.login('Admin@Test.Local', PW.admin);
    check('the right one signs in (email is case-insensitive) and returns who you are', ok.status === 200 && ok.body.user.role === 'admin' && !('password_hash' in ok.body.user));
    check('the cookie is HttpOnly (script cannot read it) and SameSite=Lax', /HttpOnly/i.test(admin.lastSetCookie) && /SameSite=Lax/i.test(admin.lastSetCookie), admin.lastSetCookie);
    check('over plain HTTP it is NOT marked Secure — a browser would refuse to send it back, and login would silently fail on a LAN', !/;\s*Secure/i.test(admin.lastSetCookie));
    const https = new Client(); await https.login('admin@test.local', PW.admin, { 'X-Forwarded-Proto': 'https' });
    check('behind an HTTPS proxy it IS marked Secure', /;\s*Secure/i.test(https.lastSetCookie), https.lastSetCookie);
    const token = admin.cookie.split('=')[1];
    const stored = (await pool.query(`select token_hash from sessions`)).rows.map((r) => r.token_hash);
    check('the database holds only a HASH of the session token — a leaked backup contains no usable session', stored.length === 2 && !stored.includes(token) && stored.every((x: string) => /^[0-9a-f]{64}$/.test(x)));
    check('signed in, the API answers', (await admin.req('GET', '/api/schema')).status === 200 && (await admin.req('GET', '/api/auth/me')).body.user.email === 'admin@test.local');
    const bearer = await fetch(`${API}/api/schema`, { headers: { Authorization: `Bearer ${ok.body.token}` } });
    check('the same session works as a bearer token (for the Tauri client, which has no cookie jar)', bearer.status === 200);

    await pool.query(`update sessions set expires_at = now() - interval '1 second' where token_hash = (select token_hash from sessions order by created_at limit 1)`);
    check('an EXPIRED session is refused', (await admin.req('GET', '/api/schema')).status === 401);
    await admin.login('admin@test.local', PW.admin);
    await admin.req('POST', '/api/auth/logout');
    check('signing out ends the session ON THE SERVER, not just in the browser', (await fetch(`${API}/api/schema`, { headers: { Cookie: `spatialdb_session=${token}` } })).status === 401
      && admin.cookie === '');

    console.log('\nA4. Guessing, and cross-site requests');
    const guesser = new Client();
    const tries: number[] = [];
    for (let i = 0; i < 7; i++) tries.push((await guesser.login('editor@test.local', `guess-number-${i}`)).status);
    check('after five wrong passwords, further attempts are refused outright for a while', tries.slice(0, 5).every((s) => s === 401) && tries.slice(5).every((s) => s === 429), tries.join());
    check('…even with the RIGHT password (or it would just be a slower oracle)', (await guesser.login('editor@test.local', PW.editor)).status === 429);
    check('it is per address+email: someone else is not locked out by it', (await new Client().login('viewer@test.local', PW.viewer)).status === 200);

    await admin.login('admin@test.local', PW.admin);
    const evil = await admin.req('POST', '/api/mutate', mutation({ type: 'table.create', id: randomUUID(), name: 'planted' }), { Origin: 'https://evil.example' });
    check('a write whose Origin is ANOTHER SITE is refused, even with a valid session (CSRF)', evil.status === 403 && (await pool.query(`select 1 from tables where name = 'planted'`)).rowCount === 0);
    const same = await admin.req('POST', '/api/mutate', mutation({ type: 'table.create', id: randomUUID(), name: 'ours' }), { Origin: API });
    check('the same write from the app\'s own origin goes through', same.status === 200, JSON.stringify(same.body).slice(0, 160));
    const cors = await fetch(`${API}/api/schema`, { headers: { Origin: 'https://evil.example', Cookie: admin.cookie } });
    check('and there is no wildcard CORS header inviting other sites to read', !cors.headers.get('access-control-allow-origin'), cors.headers.get('access-control-allow-origin') ?? '');

    console.log('\nA5. Roles — by identity now');
    const editor = new Client(), viewer = new Client();
    // (the editor's address+email is still backed off from A4; a different address is a different key)
    await editor.login('editor@test.local', PW.editor, { 'X-Forwarded-For': '10.0.0.7' });
    await viewer.login('viewer@test.local', PW.viewer);
    const tId = (await pool.query(`select id from tables where name = 'ours'`)).rows[0].id;
    check('an editor can write data', (await editor.req('POST', '/api/mutate', mutation({ type: 'record.create', id: randomUUID(), tableId: tId, data: {} }))).status === 200);
    check('…but not change the schema', (await editor.req('POST', '/api/mutate', mutation({ type: 'table.create', id: randomUUID(), name: 'nope' }))).status === 403);
    check('a viewer can read', (await viewer.req('GET', '/api/schema')).status === 200);
    check('…and write nothing', (await viewer.req('POST', '/api/mutate', mutation({ type: 'record.create', id: randomUUID(), tableId: tId, data: {} }))).status === 403);
    const who = await pool.query(`select u.email from mutations m join users u on u.id = m.actor_id where m.type = 'record.create' order by m.seq desc limit 1`);
    check('the log records WHO — the editor, not "the first admin"', who.rows[0]?.email === 'editor@test.local', who.rows[0]?.email);

    console.log('\nA6. Managing users');
    check('only admins see the user list', (await editor.req('GET', '/api/users')).status === 403 && (await admin.req('GET', '/api/users')).body.length === 3);
    check('…and it never includes a password hash', !JSON.stringify((await admin.req('GET', '/api/users')).body).includes('scrypt'));
    const logBefore = (await pool.query(`select count(*)::int n from mutations`)).rows[0].n;
    const made = await admin.req('POST', '/api/users', { email: 'New.Person@test.local', name: 'New Person', role: 'editor', password: 'a-first-password' });
    check('an admin creates a user', made.status === 200 && made.body.email === 'new.person@test.local');
    check('a short password is refused, with the rule', /at least 10/.test((await admin.req('POST', '/api/users', { email: 'x@test.local', name: '', role: 'viewer', password: 'short' })).body.error ?? ''));
    check('a duplicate email is a clear 409', (await admin.req('POST', '/api/users', { email: 'new.person@test.local', name: '', role: 'viewer', password: 'another-password' })).status === 409);
    const np = new Client();
    check('the new user can sign in', (await np.login('new.person@test.local', 'a-first-password')).status === 200);
    await admin.req('PATCH', `/api/users/${made.body.id}`, { disabled: true });
    check('DISABLING someone signs them out at once — their open session stops working', (await np.req('GET', '/api/schema')).status === 401
      && (await new Client().login('new.person@test.local', 'a-first-password')).status === 401);
    check('…but their row stays: "who did this" must outlive their access', (await pool.query(`select disabled from users where id = $1`, [made.body.id])).rows[0].disabled === true);
    const adminId = (await admin.req('GET', '/api/auth/me')).body.user.id;
    const lastAdmin = await admin.req('PATCH', `/api/users/${adminId}`, { role: 'editor' });
    check('the LAST admin cannot be demoted or disabled — the app must not lock itself', lastAdmin.status === 409 && (await admin.req('PATCH', `/api/users/${adminId}`, { disabled: true })).status === 409, JSON.stringify(lastAdmin.body));
    const changed = await editor.req('POST', '/api/auth/password', { current: PW.editor, next: 'a-brand-new-password' });
    const editor2 = new Client(); await editor2.login('editor@test.local', 'a-brand-new-password', { 'X-Forwarded-For': '10.0.0.8' });
    check('you can change your own password (the current one is required)', changed.status === 200 && (await editor2.req('GET', '/api/auth/me')).status === 200
      && (await editor.req('POST', '/api/auth/password', { current: 'wrong-current-pw', next: 'yet-another-password' })).status === 403);
    check('NONE of this touched the mutation log — credentials are never logged or streamed',
      (await pool.query(`select count(*)::int n from mutations`)).rows[0].n === logBefore
      && (await pool.query(`select 1 from mutations where payload::text ilike '%password%' or payload::text like '%scrypt%'`)).rowCount === 0);
  } finally { await server.stop(); }

  console.log('\nA7. The proxy seam (AUTH_TRUSTED_HEADER)');
  const proxied = await bootServer(PORT, { AUTH_DISABLED: '0', AUTH_TRUSTED_HEADER: 'X-Remote-User' });
  try {
    const viaProxy = await fetch(`${API}/api/auth/me`, { headers: { 'X-Remote-User': 'viewer@test.local' } });
    check('configured, a trusted header names the user — no password, no cookie', viaProxy.status === 200 && (await viaProxy.json() as any).user.role === 'viewer');
    check('…but only a user who EXISTS here (the proxy says who; an admin decided whether)', (await fetch(`${API}/api/auth/me`, { headers: { 'X-Remote-User': 'stranger@elsewhere' } })).status === 401);
    check('…and not a disabled one', (await fetch(`${API}/api/auth/me`, { headers: { 'X-Remote-User': 'new.person@test.local' } })).status === 401);
  } finally { await proxied.stop(); }
  const plain = await bootServer(PORT, { AUTH_DISABLED: '0' });
  try {
    check('NOT configured, the same header is ignored — it is not a back door by default', (await fetch(`${API}/api/auth/me`, { headers: { 'X-Remote-User': 'admin@test.local' } })).status === 401);
  } finally { await plain.stop(); }

  console.log('\nA8. The app');
  await pool.query(`update users set password_hash = $2 where email = $1`, ['editor@test.local', await hashPassword(PW.editor)]);
  const ui = await mountApp(PORT, '', { AUTH_DISABLED: '0' });      // (truncates tables; users are left alone)
  const { w, until, untilDb, nav } = ui;
  try {
    check('not signed in, the app IS the login screen — no shell, no data requested', await until(() => w.find('.login').exists()) && !w.find('.app').exists() && !w.find('.errors').exists());
    const signIn = async (email: string, password: string) => {
      await w.find('.login input[type="email"]').setValue(email);
      await w.find('.login input[type="password"]').setValue(password);
      await w.find('.login form').trigger('submit');
    };
    await signIn('admin@test.local', 'wrong-password-here');
    check('a wrong password says so, and clears the password field', await until(() => /wrong email or password/.test(w.find('.login .error').text()))
      && (w.find('.login input[type="password"]').element as HTMLInputElement).value === '');
    await signIn('admin@test.local', PW.admin);
    check('the right one opens the app', await until(() => w.find('.app .tree').exists(), 8000) && !w.find('.login').exists());

    await w.find('.card.everything').trigger('click');
    await nav.tab('history');
    check('Settings shows who you are, and (to an admin) the users', await until(() => w.find('.settings .account').exists() && w.findAll('.settings .users tr').length >= 3)
      && /admin@test\.local/.test(w.find('.settings .account').text()), w.find('.settings').text().slice(0, 160));
    await w.find('.settings .add-user input[placeholder="name"]').setValue('Made In UI');
    await w.find('.settings .add-user input[type="email"]').setValue('ui.made@test.local');
    await w.find('.settings .add-user input[type="password"]').setValue('made-in-the-ui-1');
    await w.find('.settings .add-user').trigger('submit');
    check('an admin adds a user from Settings', (await untilDb(`select role from users where email = 'ui.made@test.local'`, (r) => r.length === 1))[0]?.role === 'editor'
      && await until(() => /Made In UI/.test(w.find('.settings .users').text())));
    await w.find('.settings .x').trigger('click');

    // THE ONE THAT MATTERS: the session ends while an edit is on its way.
    await pool.query(`delete from sessions`);
    await nav.newTable('Made while signed out');
    check('a session that ends mid-work brings the login screen back…', await until(() => w.find('.login').exists(), 8000));
    check('…and SAYS your change is still waiting — a 401 must never silently drop edits', await until(() => /unsaved change/.test(w.find('.login .kept').text())), w.find('.login').text());
    check('nothing was written while signed out', (await pool.query(`select 1 from tables where name = 'Made while signed out'`)).rowCount === 0);
    await signIn('admin@test.local', PW.admin);
    const saved = await untilDb(`select 1 from tables where name = 'Made while signed out'`, (r) => r.length === 1, 10_000);
    check('signing in again SENDS it — the work survived the timeout', saved.length === 1);

    await until(() => w.find('.app .tree').exists());
    await nav.tab('history');
    await until(() => w.find('.settings .sign-out').exists());
    await w.find('.settings .sign-out').trigger('click');
    check('Sign out returns to the login screen, and the session is gone from the server', await until(() => w.find('.login').exists())
      && (await untilDb(`select 1 from sessions`, (r) => r.length === 0)).length === 0);

    await signIn('editor@test.local', PW.editor);
    await until(() => w.find('.app .tree .settings-btn').exists(), 8000);   // Settings is in the tree's footer wherever you are
    await nav.tab('history');
    check('an EDITOR\'s Settings has no Users section', await until(() => w.find('.settings .account').exists()) && !w.find('.settings .users').exists());
  } finally { await ui.close(); await pool.end(); }

  await sleep(50);
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
// A throw ends the suite EARLY: the tally above then says "N passed, 0 failed" for the
// checks that ran, which reads as success. Say plainly that it is not.
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
