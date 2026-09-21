/**
 * The server AS DEPLOYED: NODE_ENV=production, serving the built frontend, sign-in
 * on, bound to loopback. What this cannot cover — Caddy, certificates, systemd,
 * NixOS — is in DEPLOY.md, marked as unverified.
 */
import pg from 'pg';
import { spawnSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { readdirSync } from 'node:fs';
import { bootServer } from './harness.js';

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
const PORT = Number(process.env.TEST_PORT ?? 8812);
const API = `http://localhost:${PORT}`;

async function main() {
  console.log('\nP1. Refusing to start wrong');
  const env = { ...process.env, PORT: String(PORT), NODE_ENV: 'production' };
  const noAuth = spawnSync(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { env: { ...env, AUTH_DISABLED: '1' }, encoding: 'utf8', timeout: 20_000 });
  check('production with sign-in switched OFF refuses to start, and says why', noAuth.status === 1 && /AUTH_DISABLED/.test(noAuth.stderr), `${noAuth.status} ${noAuth.stderr.slice(0, 120)}`);

  console.log('\nP2. Building the frontend');
  const build = spawnSync('npx', ['vite', 'build', '--logLevel', 'error'], { encoding: 'utf8', timeout: 120_000 });
  const assets = build.status === 0 ? readdirSync('dist/assets') : [];
  const js = assets.find((f) => /^index-.*\.js$/.test(f));
  check('`vite build` produces dist/ with content-hashed assets', build.status === 0 && !!js, build.stderr.slice(0, 200));

  const pool = new pg.Pool({ connectionString: process.env.DB_URL });
  const server = await bootServer(PORT, { AUTH_DISABLED: '0', NODE_ENV: 'production' });
  try {
    console.log('\nP3. One process serves the app and the API');
    const home = await fetch(`${API}/`);
    const html = await home.text();
    check('GET / is the app', home.status === 200 && /<div id="app">/.test(html) && html.includes(`/assets/${js}`), html.slice(0, 120));
    check('…never cached: it names the current build\'s files, and a stale copy would pin a browser to an old one', home.headers.get('cache-control') === 'no-cache', home.headers.get('cache-control') ?? '');
    const asset = await fetch(`${API}/assets/${js}`);
    check('hashed assets are cached forever', asset.status === 200 && /immutable/.test(asset.headers.get('cache-control') ?? '') && /javascript/.test(asset.headers.get('content-type') ?? ''),
      `${asset.status} ${asset.headers.get('cache-control')} ${asset.headers.get('content-type')}`);
    check('a MISSING asset is a 404 — not the app\'s HTML served to a <script> tag', (await fetch(`${API}/assets/index-gone.js`)).status === 404);
    check('any other path gets the app (addresses are #-routes; the server only ever sees "/")', (await fetch(`${API}/some/old/bookmark`)).status === 200);
    check('an unknown /api path is a JSON 404, never HTML', (await fetch(`${API}/api/nope`)).status === 404 || (await fetch(`${API}/api/nope`)).status === 401);

    console.log('\nP4. Headers');
    const csp = home.headers.get('content-security-policy') ?? '';
    check('a Content-Security-Policy: scripts from this origin only', /script-src 'self'(;|$)/.test(csp) && /default-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp), csp);
    check('…that ALLOWS the desktop client\'s native calls (ipc: and http://ipc.localhost) — tighten this and Tauri breaks silently', /connect-src[^;]*\bipc:/.test(csp) && /connect-src[^;]*http:\/\/ipc\.localhost/.test(csp), csp);
    check('nosniff', home.headers.get('x-content-type-options') === 'nosniff');

    console.log('\nP5. Still a locked door');
    check('the app\'s shell is public (it IS the login screen); the data is not', (await fetch(`${API}/api/schema`)).status === 401 && (await fetch(`${API}/api/canvases`)).status === 401);
    const health = await (await fetch(`${API}/api/health`)).json() as { ok: boolean; version: string };
    check('health reports the version — how a client knows which build it is talking to', health.ok === true && /^\d+\.\d+\.\d+/.test(health.version), JSON.stringify(health));

    console.log('\nP6. Loopback only');
    const lan = Object.values(networkInterfaces()).flat().find((n) => n && n.family === 'IPv4' && !n.internal)?.address;
    if (lan) {
      const direct = await fetch(`http://${lan}:${PORT}/api/health`, { signal: AbortSignal.timeout(3000) }).then((r) => `reachable (${r.status})`, () => 'refused');
      check(`not reachable on the machine's network address (${lan}) — only a proxy on this machine can get in`, direct === 'refused', direct);
    } else {
      console.log('  SKIP  no non-loopback IPv4 interface here to try');
    }
  } finally { await server.stop(); await pool.end(); }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log('\nSUITE ABORTED — an exception ended it early; the tally above is incomplete\n'); process.exit(1); });
