/**
 * Serving the FRONTEND, and the headers a real deployment wants.
 *
 * In development Vite serves the app and proxies /api here. In production there is
 * ONE process: this server serves the built `dist/` as well as the API, so the
 * client and the server are always the same version and a deploy is one step.
 * A reverse proxy (Caddy) sits in front for TLS only — see DEPLOY.md.
 *
 *   /assets/*     Vite's content-hashed files. The name changes when the content
 *                 does, so they are cached forever (`immutable`).
 *   everything    `index.html`, NEVER cached — it is the file that names the current
 *   else (GET)    hashed assets; a cached copy would pin a browser to an old build.
 *                 Hash routing (#/…) means the server only ever sees "/", but any
 *                 other non-API path gets the app too rather than a bare 404.
 *
 * Nothing here is behind the login: the login screen is part of the app. Every
 * piece of DATA is under /api, which is.
 */

import type { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CONTENT-SECURITY-POLICY. The app loads nothing from anywhere but its own origin,
 * so say so: an injected <script src="https://evil…"> or an inline script simply
 * will not run.
 *
 *   style-src 'unsafe-inline'   Vue sets element styles (`:style`) everywhere — card
 *                               positions, column widths. Inline STYLES, not scripts.
 *   img-src data: blob:         colour swatches and upload previews.
 *   connect-src ipc: http://ipc.localhost
 *        *** DO NOT REMOVE. *** The desktop client (Tauri) loads this same page from
 *        this same server, and its native calls travel over these two schemes. Tighten
 *        this line and the desktop app's tools fail with no visible error, while the
 *        browser version keeps working — the worst kind of breakage to diagnose.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ipc: http://ipc.localhost",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function serveFrontend(app: Hono, distDir = join(process.cwd(), 'dist')): boolean {
  const indexPath = join(distDir, 'index.html');
  if (!existsSync(indexPath)) return false;

  app.use('*', async (c, next) => {
    await next();
    if (c.req.path.startsWith('/api/')) return;
    c.header('Content-Security-Policy', CSP);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
  });

  app.use('/assets/*', serveStatic({
    root: distDir,
    onFound: (_path, c) => { c.header('Cache-Control', 'public, max-age=31536000, immutable'); },
  }));
  // Anything else Vite copied to dist/ (a favicon, say).
  app.use('*', async (c, next) => {
    if (c.req.method !== 'GET' || c.req.path.startsWith('/api/') || c.req.path === '/') return next();
    return serveStatic({ root: distDir })(c, next);
  });

  app.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'not found' }, 404);
    // A missing hashed asset is a 404, not the app: answering a <script> request with
    // HTML produces a baffling syntax error instead of an honest "not found" (what a
    // browser holding a page from BEFORE a deploy sees when it asks for old files).
    if (c.req.path.startsWith('/assets/')) return c.text('not found', 404);
    c.header('Cache-Control', 'no-cache');
    // Read per request: a deploy replaces dist/, and the running server should hand
    // out the NEW index.html without needing a restart to notice.
    return c.html(readFileSync(indexPath, 'utf8'));
  });
  return true;
}

/** "1.0.0+a1b2c3d" — the package version and, when run from a git checkout, the commit. */
export function appVersion(root = process.cwd()): string {
  let version = '0.0.0';
  try { version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? version; } catch { /* keep default */ }
  const commit = process.env.SPATIALDB_COMMIT ?? gitHead(root);
  return commit ? `${version}+${commit.slice(0, 7)}` : version;
}
function gitHead(root: string): string {
  try {
    const head = readFileSync(join(root, '.git', 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return head;
    return readFileSync(join(root, '.git', head.slice(5)), 'utf8').trim();
  } catch { return ''; }
}
