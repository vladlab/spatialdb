/**
 * ============================================================================
 *  API server.
 * ============================================================================
 *
 *  Thin by design. All it does is: figure out who is asking, unwrap the
 *  request, and hand off to applyBatch (writes) or the loaders (reads). Any
 *  logic that lives here instead of in apply.ts/reads.ts is a bug waiting to
 *  happen, because the offline path will never run it.
 */

import { serve } from '@hono/node-server';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import pg from 'pg';
import { MutationRequest } from '../contract/mutations.js';
import { StreamEvent, toMutationEvent } from '../contract/events.js';
import { applyBatch, MutationError, type Actor } from './apply.js';
import type { Context } from 'hono';
import {
  AUTH_DISABLED, authenticate, createSession, crossOrigin, destroySession, hashPassword, loginBlockedFor,
  noteLoginFailure, noteLoginSuccess, passwordProblem, verifyPassword, type AuthUser,
} from './auth.js';
import { migrationGate } from './migrations.js';
import { parseScope } from '../contract/scope.js';
import { AssetError, findAsset, openAsset, storeAsset } from './assets.js';
import { Readable } from 'node:stream';
import {
  loadSchema, loadScene, loadRecords, loadUnplaced, loadHead, mutationsSince,
  loadUndo, loadUndoable, BadCursor, searchRecords,
} from './reads.js';

const DB_URL = process.env.DB_URL;
if (!DB_URL) {
  console.error('DB_URL is not set. Run inside `nix develop`, or: export DB_URL="$(./scripts/db.sh url)"');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DB_URL });
const app = new Hono();

// Dev only: the Vite client runs on a different port.
// No wildcard CORS. It dated from before the dev proxy, when the browser talked to
// :8787 directly; now everything is same-origin, and identity travels in a cookie,
// so "any site may call this API" is the wrong default. CORS_ORIGINS (comma-
// separated) names the exceptions — the Tauri client's origin, when it exists.
const corsOrigins = (process.env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
if (corsOrigins.length) app.use('/api/*', cors({ origin: corsOrigins, credentials: true }));

// Refuse to half-work against a database that is behind this code — see
// migrations.ts. Logged once per distinct set, not once per request.
const pendingNow = migrationGate(pool);
let warnedFor = '';
app.use('/api/*', async (c, next) => {
  const pending = await pendingNow();
  if (!pending.length) return next();
  if (warnedFor !== pending.join()) {
    warnedFor = pending.join();
    console.error(`\nThe database is BEHIND this code — not applied: ${pending.join(', ')}\n  fix:  ./scripts/db.sh migrate\n`);
  }
  return c.json({
    error: `The database is behind the code. Run ./scripts/db.sh migrate (not applied: ${pending.join(', ')}). Nothing is lost — queued changes go through once it has run.`,
    pending,
  }, 503);
});

/* ────────────────────────────────────────────────────────────────────────────
 *  Identity — src/server/auth.ts decides who a request is; this enforces it.
 *
 *  EVERYTHING under /api needs a signed-in user except: logging in, asking who
 *  you are, and the health check. That includes the event stream and uploaded
 *  files — an asset URL used to be readable by anyone who had it.
 * ──────────────────────────────────────────────────────────────────────────*/
type Vars = { Variables: { user: AuthUser } };
const OPEN = new Set(['/api/auth/login', '/api/auth/me', '/api/auth/logout', '/api/health']);

app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && crossOrigin(c)) {
    return c.json({ error: 'cross-origin request refused' }, 403);
  }
  if (OPEN.has(c.req.path)) return next();
  const user = await authenticate(pool, c);
  if (!user && AUTH_DISABLED) {
    // Sign-in is off and there is still nobody to be: the database has no users at
    // all. 503, not 401 — the server is unconfigured, and no login form will fix it.
    return c.json({ error: 'no users exist — run: ./scripts/db.sh bootstrap' }, 503);
  }
  if (!user) {
    // Distinguish "nobody can log in yet" from "you are not logged in": the first
    // is fixed at a terminal, not at the login form.
    const any = await pool.query(`select 1 from users where password_hash is not null and not disabled limit 1`);
    return c.json(any.rowCount
      ? { error: 'sign in required' }
      : { error: 'no user can sign in yet — create one: ./scripts/user.sh add <email> <name> admin', setup: true }, 401);
  }
  (c as unknown as Context<Vars>).set('user', user);
  return next();
});

const userOf = (c: Context): AuthUser => (c as unknown as Context<Vars>).get('user');
const currentActor = (c: Context): Actor => { const u = userOf(c); return { id: u.id, role: u.role }; };

/* ────────────────────────────────────────────────────────────────────────────
 *  Writes — the single entry point
 * ──────────────────────────────────────────────────────────────────────────*/

app.post('/api/mutate', async (c) => {
  const parsed = MutationRequest.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'invalid mutation batch', detail: parsed.error.issues }, 400);
  }

  const db = await pool.connect();
  try {
    // INSIDE the try. This used to sit above it, so the one error written
    // specifically to tell you what was wrong — "no users exist" — was the one
    // error you could never see: it escaped to Hono's default handler and came
    // back as a bare "Internal Server Error". An unconfigured database looked
    // exactly like a crash.
    const actor = currentActor(c);
    const { events, ...result } = await applyBatch(db, parsed.data, actor);

    // One event per applied mutation, already in the canonical shape. This
    // handler no longer decides what an event looks like — that lives in
    // contract/events.ts, which is also what catch-up goes through. There is
    // deliberately nothing to get creative with here.
    for (const event of events) broadcast(event);

    return c.json(result);
  } catch (err) {
    if (err instanceof MutationError) {
      // `as ContentfulStatusCode` rather than `as 400`: the cast used to name one
      // specific code, which typechecked but lied about every other status the
      // class can carry (403 role refusals, and now 503).
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    console.error(err);
    // Say what went wrong. This used to be a bare "internal error", which hid the
    // one sentence ("column \"config\" does not exist") that would have explained
    // the failure to the person looking at it. Everyone who can reach this server
    // is trusted with its schema; revisit with auth.
    return c.json({ error: 'internal error', detail: String((err as Error)?.message ?? err) }, 500);
  } finally {
    db.release();
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 *  Reads
 * ──────────────────────────────────────────────────────────────────────────*/

app.get('/api/schema', async (c) => {
  const db = await pool.connect();
  try { return c.json(await loadSchema(db)); } finally { db.release(); }
});

app.get('/api/canvases/:id/scene', async (c) => {
  const db = await pool.connect();
  try {
    const scene = await loadScene(db, c.req.param('id'));
    return scene ? c.json(scene) : c.json({ error: 'no such canvas' }, 404);
  } finally { db.release(); }
});

app.get('/api/canvases/:id/unplaced', async (c) => {
  const db = await pool.connect();
  try {
    return c.json(await loadUnplaced(db, c.req.param('id'), c.req.query('tableId'), {
      limit: Number(c.req.query('limit') ?? 200),
      offset: Number(c.req.query('offset') ?? 0),
    }));
  } finally { db.release(); }
});

app.get('/api/tables/:id/records', async (c) => {
  const db = await pool.connect();
  try {
    return c.json(await loadRecords(db, c.req.param('id'), {
      limit: Number(c.req.query('limit') ?? 200),
      offset: Number(c.req.query('offset') ?? 0),
      after: c.req.query('after') || undefined,
    }));
  } catch (e) {
    // A mangled cursor is the caller's bug. Restarting from page one instead
    // would look like success and quietly re-serve the whole table.
    if (e instanceof BadCursor) return c.json({ error: e.message }, 400);
    throw e;
  } finally { db.release(); }
});

/* ────────────────────────────────────────────────────────────────────────────
 *  Assets — see assets.ts. NOT mutations: an upload writes a file and an index
 *  row and produces no log entry and no stream event. What travels through
 *  /api/mutate afterwards is a value that mentions the returned id.
 * ──────────────────────────────────────────────────────────────────────────*/

app.post('/api/assets', async (c) => {
  try {
    const actor = currentActor(c);
    if (actor.role === 'viewer') return c.json({ error: 'viewers cannot upload' }, 403);
    // The name rides in the query string (URL-encoded), so the BODY is nothing
    // but the file — no multipart parsing, and it can be streamed straight to
    // disk. Only the last path segment is kept: a name is a label, never a path.
    const name = (c.req.query('name') ?? '').split(/[\\/]/).pop() ?? '';
    const { asset, created } = await storeAsset(pool, c.req.raw.body, name, actor.id);
    // 200 for a file already held (same bytes → same asset), 201 for a new one.
    return c.json(asset, created ? 201 : 200);
  } catch (e) {
    if (e instanceof AssetError) return c.json({ error: e.message }, e.status);
    if (e instanceof MutationError) return c.json({ error: e.message }, e.status as ContentfulStatusCode);
    console.error(e);
    return c.json({ error: 'upload failed', detail: String((e as Error)?.message ?? e) }, 500);
  }
});

app.get('/api/assets/:id/meta', async (c) => {
  const a = await findAsset(pool, c.req.param('id'));
  return a ? c.json(a) : c.json({ error: 'no such asset' }, 404);
});

app.get('/api/assets/:id', async (c) => {
  const a = await findAsset(pool, c.req.param('id'));
  if (!a) return c.json({ error: 'no such asset' }, 404);
  const etag = `"${a.sha256}"`;
  // IMMUTABLE, and that is a promise the storage keeps: the bytes behind an id
  // are addressed by their own hash and are never rewritten. So a browser may
  // cache them for a year and never ask again — which is what makes a canvas of
  // image-bearing cards cheap to reopen.
  const headers: Record<string, string> = {
    'Content-Type': a.mime,
    'Content-Length': String(a.bytes),
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.name || a.id)}`,
  };
  if (c.req.header('if-none-match') === etag) return c.body(null, 304, headers);
  const stream = await openAsset(a);
  if (!stream) {
    // The row exists and the file does not: a restore that brought back the
    // database but not the assets directory. Say so; do not pretend it is absent.
    console.error(`asset ${a.id}: file missing on disk (${a.sha256}) — was the assets directory restored?`);
    return c.json({ error: 'the asset is indexed but its file is missing from the assets directory' }, 404);
  }
  return c.body(Readable.toWeb(stream) as ReadableStream, 200, headers);
});

/** Sections — the app's navigation. Small, and every client needs all of them. */
app.get('/api/sections', async (c) => {
  const { rows } = await pool.query(
    `select id, name, description, icon, color, table_ids, scope_table_id, archived_field_id, position
       from sections order by position, name`);
  return c.json(rows);
});

/** Search every table — see searchRecords in reads.ts. `tables` is a comma list of ids. */
app.get('/api/search', async (c) => {
  const db = await pool.connect();
  try {
    const scopeTableId = c.req.query('scopeTable') ?? '';
    const within = /^[0-9a-f-]{36}$/i.test(scopeTableId) ? {
      scopeTableId, scope: parseScope(c.req.query('scope')),
      archived: (c.req.query('archived') ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)),
      showArchived: c.req.query('showArchived') === '1',
    } : undefined;
    return c.json(await searchRecords(db, c.req.query('q') ?? '',
      (c.req.query('tables') ?? '').split(',').filter(Boolean), Number(c.req.query('limit') ?? 30), within));
  } finally { db.release(); }
});

/** The current log head — a watermark for clients that haven't loaded a scene. */
app.get('/api/head', async (c) => {
  const db = await pool.connect();
  try { return c.json({ seq: await loadHead(db) }); } finally { db.release(); }
});

/* ────────────────────────────────────────────────────────────────────────────
 *  Undo
 *
 *  Read-only. Undo is performed by POSTing a `restore` mutation like any other
 *  write — there is deliberately no POST /api/undo. An endpoint that mutated
 *  directly would bypass the mutation boundary, and then undo would not stream to
 *  peers, would not replay on reconnect, and would not work offline.
 * ──────────────────────────────────────────────────────────────────────────*/

/** What is there to undo — the recent destructive tail of the log. */
app.get('/api/undoable', async (c) => {
  const db = await pool.connect();
  try {
    return c.json(await loadUndoable(db, Number(c.req.query('limit') ?? 50)));
  } finally { db.release(); }
});

/** The captured rows for one mutation, for building a `restore` from. */
app.get('/api/mutations/:id/undo', async (c) => {
  const db = await pool.connect();
  try {
    const undo = await loadUndo(db, c.req.param('id'));
    if (!undo) {
      return c.json({ error: 'no undo capture for that mutation' }, 404);
    }
    if (undo.truncated) {
      // 409, not 200-with-a-flag: the client asked for something that does not
      // exist, and a caller that ignores the flag would send an empty restore and
      // believe it worked.
      return c.json({
        error: 'cascade was too large to capture — restore from a backup instead',
        counts: undo.counts, total: undo.total,
      }, 409);
    }
    return c.json(undo);
  } finally { db.release(); }
});

app.get('/api/canvases', async (c) => {
  // Every BOARD: the records of every table of kind 'canvas', each with its state
  // if it has any yet. The client needs them all up front — the canvas picker
  // lists boards by name, and a name is a record's primary field — and there are
  // few of them (boards are made by hand).
  const { rows } = await pool.query(
    `select r.id, r.table_id, r.data,
            coalesce(c.config, '{}'::jsonb) as config, coalesce(c.viewport, '{}'::jsonb) as viewport
       from records r
       join tables t on t.id = r.table_id and t.kind = 'canvas'
       left join canvases c on c.id = r.id
      order by r.created_at, r.id`);
  return c.json(rows);
});

/* ────────────────────────────────────────────────────────────────────────────
 *  Realtime
 *
 *  In-process fan-out, which is correct for a single server process. If this
 *  ever runs more than one instance, swap this for Postgres LISTEN/NOTIFY —
 *  the wire format doesn't change, so clients won't notice.
 * ──────────────────────────────────────────────────────────────────────────*/

type Subscriber = (event: StreamEvent) => void;
const subscribers = new Set<Subscriber>();

/**
 * Every event leaving this process goes through here, and every one is parsed
 * against the contract on the way out.
 *
 * The parse is not defensive programming for its own sake. The shape divergence
 * this whole change exists to fix was invisible precisely because the old
 * `broadcast(payload: unknown)` accepted anything and `tsc` had nothing to say
 * about it. Now a malformed event throws at the point it is produced, in dev,
 * with a stack trace — rather than showing up as a duplicated card on someone's
 * canvas a week later.
 */
function broadcast(event: StreamEvent) {
  const checked = StreamEvent.parse(event);
  for (const send of subscribers) {
    try { send(checked); } catch { /* a dead connection cleans itself up */ }
  }
}

app.get('/api/stream', async (c) => {
  // A junk query string used to become NaN, and `seq > NaN` silently matches
  // nothing — a client with a corrupt watermark got an empty catch-up and
  // believed it was current. Treat anything unparseable as "from the start".
  const raw = Number(c.req.query('since'));
  const since = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;

  return c.newResponse(
    new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const write = (data: unknown) => {
          try { controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`)); }
          catch { /* closed underneath us */ }
        };

        // Say something IMMEDIATELY. Proxies (Vite's dev proxy, and nginx by
        // default) do not forward response headers until the first body byte, and
        // a client that is already up to date has nothing to replay — so the
        // first byte used to be the 25-second keepalive below. `fetch` does not
        // resolve without headers, so the UI sat on "connecting" for exactly one
        // keepalive interval, on precisely the quietest databases: a fresh one,
        // or any client that was current. Direct connections flushed at once,
        // which is why no test saw it. A comment frame is ignored by every SSE
        // parser, including ours (store.ts skips anything not starting `data: `).
        controller.enqueue(enc.encode(': open\n\n'));

        /**
         * Subscribe BEFORE catching up, and hold live events in a buffer until
         * catch-up finishes.
         *
         * The old order was catch-up first, then subscribe. Anything that
         * committed in the window between those two steps was broadcast to a
         * subscriber list this client wasn't on yet, and had a seq past the
         * watermark the client just adopted — so it was never delivered by
         * either path. Small window, silent, permanent.
         *
         * Buffering closes it. Overlap is fine because every event carries its
         * own seq, so anything catch-up already sent is dropped on flush.
         */
        let buffer: StreamEvent[] | null = [];
        let highest = since;

        const send: Subscriber = (event) => {
          if (buffer) { buffer.push(event); return; }
          if (event.kind === 'mutation') {
            if (event.seq <= highest) return;   // already delivered by catch-up
            highest = event.seq;
          }
          write(event);
        };
        subscribers.add(send);

        const keepalive = setInterval(() => {
          try { controller.enqueue(enc.encode(': ping\n\n')); } catch { /* closed */ }
        }, 25_000);

        c.req.raw.signal.addEventListener('abort', () => {
          clearInterval(keepalive);
          subscribers.delete(send);
          try { controller.close(); } catch { /* already closed */ }
        });

        // Catch-up: everything the client missed while it was away, in the same
        // shape as everything that follows it.
        const db = await pool.connect();
        try {
          const { rows, truncated, ahead, head } = await mutationsSince(db, since);
          if (truncated || ahead) {
            // Say so, loudly, in both cases. A truncated prefix or a silent open
            // connection both leave the client believing it is current.
            write(StreamEvent.parse({
              kind: 'resync',
              reason: truncated ? 'too-far-behind' : 'ahead-of-head',
              head,
              since,
            }));
            highest = head;
          } else {
            for (const row of rows) {
              const event = toMutationEvent(row, true);
              highest = event.seq;
              write(event);
            }
          }
        } finally { db.release(); }

        // Drain anything that arrived during catch-up, then go direct.
        const queued = buffer;
        buffer = null;
        for (const event of queued) send(event);
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    },
  );
});

/* ────────────────────────────────────────────────────────────────────────────
 *  Signing in, and managing users.
 *
 *  NOT mutations. The mutation log is kept forever and streamed to every client;
 *  a password — even hashed — belongs in neither. So none of this is undoable or
 *  live: a role change takes effect on that person's next request, and the user
 *  list is fetched when Settings opens.
 * ──────────────────────────────────────────────────────────────────────────*/
const clientAddr = (c: Context) => (c.req.header('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { email?: unknown; password?: unknown };
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const key = `${clientAddr(c)}|${email}`;
  const wait = loginBlockedFor(key);
  if (wait) return c.json({ error: `too many attempts — try again in ${wait}s` }, 429);

  const { rows } = await pool.query(
    `select id, email, name, role, password_hash from users where lower(email) = $1 and not disabled`, [email]);
  const u = rows[0];
  // verifyPassword runs the full computation even when `u` is undefined.
  if (!(await verifyPassword(password, u?.password_hash ?? null)) || !u) {
    noteLoginFailure(key);
    return c.json({ error: 'wrong email or password' }, 401);       // never says WHICH
  }
  noteLoginSuccess(key);
  const token = await createSession(pool, c, u.id);
  // The token is also returned, for clients that cannot hold a cookie (Tauri): they
  // send it back as `Authorization: Bearer`. Browsers ignore it; theirs is HttpOnly.
  return c.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role }, token });
});

app.post('/api/auth/logout', async (c) => { await destroySession(pool, c); return c.json({ ok: true }); });

app.get('/api/auth/me', async (c) => {
  const user = await authenticate(pool, c);
  if (user) return c.json({ user, authDisabled: AUTH_DISABLED });
  const any = await pool.query(`select 1 from users where password_hash is not null and not disabled limit 1`);
  return c.json({ user: null, setup: !any.rowCount && !AUTH_DISABLED }, 401);
});

app.post('/api/auth/password', async (c) => {
  const me = userOf(c);
  const body = await c.req.json().catch(() => ({})) as { current?: unknown; next?: unknown };
  const problem = passwordProblem(body.next);
  if (problem) return c.json({ error: problem }, 400);
  const { rows } = await pool.query(`select password_hash from users where id = $1`, [me.id]);
  if (!(await verifyPassword(String(body.current ?? ''), rows[0]?.password_hash ?? null))) {
    return c.json({ error: 'your current password is not right' }, 403);
  }
  await pool.query(`update users set password_hash = $2 where id = $1`, [me.id, await hashPassword(body.next as string)]);
  // Every OTHER session of yours ends: changing a password is what you do when you
  // think someone else has it.
  await pool.query(`delete from sessions where user_id = $1`, [me.id]);
  await createSession(pool, c, me.id);
  return c.json({ ok: true });
});

const adminOnly = (c: Context) => (userOf(c).role === 'admin' ? null : c.json({ error: 'admins only' }, 403));
const ROLES = ['admin', 'editor', 'viewer'];

app.get('/api/users', async (c) => {
  const no = adminOnly(c); if (no) return no;
  const { rows } = await pool.query(
    `select u.id, u.email, u.name, u.role, u.disabled, u.created_at, (u.password_hash is not null) as has_password,
            (select max(s.last_seen_at) from sessions s where s.user_id = u.id) as last_seen
       from users u order by u.disabled, lower(u.name), lower(u.email)`);
  return c.json(rows);
});

app.post('/api/users', async (c) => {
  const no = adminOnly(c); if (no) return no;
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return c.json({ error: 'that is not an email address' }, 400);
  if (!ROLES.includes(b.role as string)) return c.json({ error: 'role must be admin, editor or viewer' }, 400);
  const problem = passwordProblem(b.password);
  if (problem) return c.json({ error: problem }, 400);
  try {
    const { rows } = await pool.query(
      `insert into users (email, name, role, password_hash) values ($1,$2,$3,$4) returning id, email, name, role`,
      [email, String(b.name ?? '').trim(), b.role, await hashPassword(b.password as string)]);
    return c.json(rows[0]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return c.json({ error: 'someone already has that email' }, 409);
    throw e;
  }
});

app.patch('/api/users/:id', async (c) => {
  const no = adminOnly(c); if (no) return no;
  const id = c.req.param('id');
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  if (b.role !== undefined && !ROLES.includes(b.role as string)) return c.json({ error: 'role must be admin, editor or viewer' }, 400);
  if (b.password !== undefined) { const p = passwordProblem(b.password); if (p) return c.json({ error: p }, 400); }

  // Never leave the app with nobody who can administer it.
  const losingAdmin = (b.role !== undefined && b.role !== 'admin') || b.disabled === true;
  if (losingAdmin) {
    const others = await pool.query(`select 1 from users where role = 'admin' and not disabled and id <> $1 limit 1`, [id]);
    const target = await pool.query(`select role from users where id = $1`, [id]);
    if (target.rows[0]?.role === 'admin' && !others.rowCount) return c.json({ error: 'this is the last admin — make someone else an admin first' }, 409);
  }
  const { rows } = await pool.query(
    `update users set
       name = coalesce($2, name), role = coalesce($3, role), disabled = coalesce($4, disabled),
       password_hash = coalesce($5, password_hash)
     where id = $1 returning id, email, name, role, disabled`,
    [id, typeof b.name === 'string' ? b.name.trim() : null, b.role ?? null, typeof b.disabled === 'boolean' ? b.disabled : null,
     b.password !== undefined ? await hashPassword(b.password as string) : null]);
  if (!rows.length) return c.json({ error: 'no such user' }, 404);
  // Disabled, or given a new password by an admin: whoever was signed in as them is out.
  if (b.disabled === true || b.password !== undefined) await pool.query(`delete from sessions where user_id = $1`, [id]);
  return c.json(rows[0]);
});

app.get('/api/health', (c) => c.json({ ok: true }));

const port = Number(process.env.PORT ?? 8787);
if (AUTH_DISABLED) {
  console.warn('\n  ⚠  AUTH_DISABLED=1 — nobody has to sign in; every request is the first admin.\n     For development and tests ONLY. Never on a machine others can reach.\n');
}
// Expired sessions are already refused; this only stops them accumulating.
const sweep = () => void pool.query(`delete from sessions where expires_at < now()`).catch(() => {});
sweep();
setInterval(sweep, 3_600_000).unref();

// Announce from the listen CALLBACK, and handle the one failure everyone hits.
// This used to log "api listening" on the line after serve() — i.e. before the
// port was bound — so a taken port printed the success message and THEN a
// stack trace. A taken port almost always means a previous dev server is still
// running (see scripts/dev.sh for how that used to happen on every Ctrl-C).
const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`api listening on http://localhost:${port}`);
});
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(
    `\nPort ${port} is already in use — most likely an API server left over from an earlier run.\n` +
    `  find it:  ss -ltnp | grep ${port}\n` +
    `  stop it:  pkill -f src/server/index.ts\n` +
    `or run this one elsewhere with PORT=… (and point vite.config.ts at it).\n`);
  process.exit(1);
});

/* ── shutdown ────────────────────────────────────────────────────────────────
   Without a handler Node dies on SIGTERM wherever it happens to be — mid-query,
   pool open. Usually harmless, but it also meant `tsx watch` could not tell the
   server had stopped deliberately. Close the pool, then go. Open SSE streams are
   NOT waited for: `server.close()` would block on them forever (a stream is a
   response that never ends), and the process exiting closes the sockets anyway —
   clients see a dropped connection and reconnect from their watermark, which is
   exactly the path they take for any other outage. The timer is a backstop for a
   query that will not finish. */
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  setTimeout(() => process.exit(0), 1500).unref();
  void pool.end().catch(() => {}).finally(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
