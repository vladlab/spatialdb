/**
 * ============================================================================
 *  Authentication: who is this request?
 * ============================================================================
 *
 *  Deliberately small and conventional. Nothing here is novel, and nothing should
 *  be — every primitive is Node's own `crypto` (OpenSSL underneath) or Hono's
 *  cookie helper:
 *
 *    passwords   scrypt, N=2^17 r=8 p=1 (OWASP's recommendation for scrypt), a
 *                random 16-byte salt per password, compared in constant time.
 *                argon2id is OWASP's first choice; it needs a native add-on, and
 *                prebuilt native add-ons are a recurring problem on NixOS, which is
 *                where this runs. scrypt is their second choice and is in Node. The
 *                stored value names its algorithm and cost, so this can change
 *                later by re-hashing at login.
 *    sessions    256 random bits in an HttpOnly, SameSite=Lax cookie; only the
 *                SHA-256 is stored (sql/011). `Secure` is set when the request
 *                arrived over HTTPS — NOT unconditionally, or login would silently
 *                fail on a plain-HTTP LAN, where browsers refuse Secure cookies.
 *    CSRF        SameSite=Lax, plus: a state-changing request whose Origin header
 *                names a different host is refused. No wildcard CORS.
 *    guessing    failed logins are counted per address+email and backed off.
 *                Unknown emails cost the same time as wrong passwords (a dummy
 *                hash is verified), so the login form does not say who exists.
 *
 *  ONE function decides identity — `authenticate()` — and it tries, in order:
 *
 *    1. a trusted proxy header (AUTH_TRUSTED_HEADER, e.g. X-Remote-User) — the
 *       seam for SSO: Authelia, authentik, Tailscale, oauth2-proxy. Only enable it
 *       when the app is reachable ONLY through that proxy; anyone who can reach
 *       the app directly can otherwise type the header themselves.
 *    2. `Authorization: Bearer <token>` — the same sessions, for the Tauri client.
 *    3. the session cookie.
 *    4. AUTH_DISABLED=1 — development and the older test suites: everyone is the
 *       first admin, as it always was. The server says so loudly at startup.
 *
 *  What this is NOT: a reason to put the app on the public internet. See API.md.
 */

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type pg from 'pg';

export interface AuthUser { id: string; email: string; name: string; role: 'admin' | 'editor' | 'viewer' }

const COOKIE = 'spatialdb_session';
const SESSION_DAYS = 30;
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, keylen: 32 };
export const MIN_PASSWORD = 10;

/* ── passwords ─────────────────────────────────────────────────────────── */

function scrypt(password: string, salt: Buffer, N: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem: scrypt needs ~128·N·r bytes; Node's default cap (32 MB) is below N=2^17.
    scryptCb(password.normalize('NFKC'), salt, keylen, { N, r, p, maxmem: 256 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parts = (stored ?? DUMMY_HASH).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const want = Buffer.from(hash, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), Number(N), Number(r), Number(p), want.length);
  // `stored === null` still ran the full computation above: an unknown email and a
  // wrong password take the same time.
  return stored !== null && got.length === want.length && timingSafeEqual(got, want);
}
/** A real hash of a random password nobody knows — what unknown users are "verified" against. */
let DUMMY_HASH = 'scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
void hashPassword(randomBytes(24).toString('base64')).then((h) => { DUMMY_HASH = h; });

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return `a password needs at least ${MIN_PASSWORD} characters`;
  if (password.length > 200) return 'that password is too long';
  return null;
}

/* ── sessions ──────────────────────────────────────────────────────────── */

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const isHttps = (c: Context) =>
  new URL(c.req.url).protocol === 'https:' || (c.req.header('x-forwarded-proto') ?? '').split(',')[0].trim() === 'https';

export async function createSession(pool: pg.Pool, c: Context, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `insert into sessions (user_id, token_hash, expires_at, user_agent)
     values ($1, $2, now() + make_interval(days => $3), $4)`,
    [userId, sha256(token), SESSION_DAYS, (c.req.header('user-agent') ?? '').slice(0, 300)]);
  setCookie(c, COOKIE, token, {
    httpOnly: true, sameSite: 'Lax', path: '/', secure: isHttps(c), maxAge: SESSION_DAYS * 86400,
  });
  return token;
}

export async function destroySession(pool: pg.Pool, c: Context) {
  const token = tokenOf(c);
  if (token) await pool.query(`delete from sessions where token_hash = $1`, [sha256(token)]);
  deleteCookie(c, COOKIE, { path: '/' });
}

function tokenOf(c: Context): string | undefined {
  const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')?.[1];
  return bearer ?? getCookie(c, COOKIE);
}

/* ── who is this request? ──────────────────────────────────────────────── */

export const AUTH_DISABLED = process.env.AUTH_DISABLED === '1';
const TRUSTED_HEADER = (process.env.AUTH_TRUSTED_HEADER ?? '').toLowerCase();

const USER_COLS = `u.id, u.email, u.name, u.role`;

export async function authenticate(pool: pg.Pool, c: Context): Promise<AuthUser | null> {
  if (TRUSTED_HEADER) {
    const email = c.req.header(TRUSTED_HEADER)?.trim().toLowerCase();
    if (email) {
      // The account must already exist here: the proxy says WHO you are, an admin
      // of this app decided WHETHER you are let in, and as what.
      const { rows } = await pool.query(`select ${USER_COLS} from users u where lower(u.email) = $1 and not u.disabled`, [email]);
      return rows[0] ?? null;
    }
  }
  const token = tokenOf(c);
  if (token) {
    const { rows } = await pool.query(
      `update sessions s
          set last_seen_at = now(),
              -- slide the expiry, at most once an hour (no write per request)
              expires_at = case when s.last_seen_at < now() - interval '1 hour'
                                then now() + make_interval(days => $2) else s.expires_at end
         from users u
        where s.token_hash = $1 and s.expires_at > now() and u.id = s.user_id and not u.disabled
    returning ${USER_COLS}`, [sha256(token), SESSION_DAYS]);
    if (rows[0]) return rows[0];
  }
  if (AUTH_DISABLED) {
    const { rows } = await pool.query(`select ${USER_COLS} from users u order by (u.role = 'admin') desc, u.created_at limit 1`);
    return rows[0] ?? null;
  }
  return null;
}

/* ── guessing ──────────────────────────────────────────────────────────── */

/**
 * In memory, per process: a restart forgets it, which is fine for a small internal
 * tool (and the scrypt cost alone limits guessing to a few per second per core).
 * 5 free attempts per address+email, then each failure doubles the wait, to 15 min.
 */
const failures = new Map<string, { n: number; until: number }>();
export function loginBlockedFor(key: string): number {
  const f = failures.get(key);
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
}
export function noteLoginFailure(key: string) {
  const f = failures.get(key) ?? { n: 0, until: 0 };
  f.n++;
  if (f.n >= 5) f.until = Date.now() + Math.min(15 * 60_000, 2_000 * 2 ** (f.n - 5));
  failures.set(key, f);
  if (failures.size > 10_000) failures.clear();      // a flood must not become a memory leak
}
export const noteLoginSuccess = (key: string) => { failures.delete(key); };

/* ── CSRF ──────────────────────────────────────────────────────────────── */

/** For state-changing requests: if the browser says where it came from, it must be here. */
export function crossOrigin(c: Context): boolean {
  const origin = c.req.header('origin');
  if (!origin) return false;                          // same-origin GETs, curl, the Tauri client
  const allowed = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.includes(origin)) return false;
  try {
    const host = c.req.header('x-forwarded-host') ?? c.req.header('host');
    return new URL(origin).host !== host;
  } catch { return true; }
}
