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

/* ── the gate on verification (SECURITY-BRIEF S2) ──────────────────────────
   One verification costs ~380 ms of CPU and ~128 MB of memory, on purpose: that is
   what makes a stolen hash slow to crack. It also made the login form a lever: the
   audit's 40 concurrent attempts peaked at 613 MB. So at most VERIFY_MAX run at
   once, process-wide, a few wait their turn, and the rest are told to come back —
   WITHOUT running scrypt. Memory stays bounded (~VERIFY_MAX × 128 MB) and libuv's
   thread pool, which file reads share, is never filled by sign-ins.
   Only verification is gated: hashing is done by admins and the CLI. */
const VERIFY_MAX = 2;
const VERIFY_QUEUE_MAX = 16;
let verifying = 0;
const verifyQueue: Array<() => void> = [];

/** Sign-in is saturated right now; the caller answers 429 and runs nothing. */
export class LoginBusy extends Error { constructor() { super('sign-in is busy — try again in a moment'); } }

async function gated<T>(work: () => Promise<T>): Promise<T> {
  if (verifying >= VERIFY_MAX) {
    if (verifyQueue.length >= VERIFY_QUEUE_MAX) throw new LoginBusy();
    await new Promise<void>((r) => verifyQueue.push(r));   // the slot is handed over, not re-counted
  } else verifying++;
  try { return await work(); }
  finally {
    const next = verifyQueue.shift();
    if (next) next(); else verifying--;
  }
}

export function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  return gated(() => verifyUngated(password, stored));
}

async function verifyUngated(password: string, stored: string | null): Promise<boolean> {
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
 * tool. Three independent limits, checked in this order by the login route:
 *
 *   per ADDRESS     10 attempts a minute, whatever the email — so one source
 *                   cannot try one password against every account, and cannot fill
 *                   the verification gate's waiting line on its own.
 *   per ADDRESS +   5 free failures, then each one doubles the wait, to 15 min. The
 *   EMAIL           original rule, unchanged.
 *   per EMAIL       20 failures within 15 minutes from ANY addresses pause that
 *                   account's sign-in for 1 minute, doubling to 15. Counted for
 *                   unknown emails too, so it says nothing about who exists. The
 *                   trade (the owner's call, Nov 26 2026): someone who knows a
 *                   colleague's email can keep their sign-in paused; sessions they
 *                   already have are untouched.
 *
 * Each is a BOUNDED table. It used to be cleared outright at 10,000 entries, which
 * let a flood of junk emails lift every lockout in place; now entries that are not
 * blocking anyone go first, and only then the oldest.
 */
const TABLE_MAX = Math.max(10, Number(process.env.AUTH_TABLE_MAX) || 10_000);

class Bounded<V> {
  private m = new Map<string, V>();
  constructor(private blocking: (v: V, now: number) => boolean) {}
  get(k: string) { return this.m.get(k); }
  delete(k: string) { this.m.delete(k); }
  get size() { return this.m.size; }
  set(k: string, v: V) {
    this.m.delete(k);                                  // re-insert: insertion order is age
    if (this.m.size >= TABLE_MAX) {
      const now = Date.now();
      for (const [key, val] of this.m) if (!this.blocking(val, now)) this.m.delete(key);
      // Everything left is an active lockout: drop the oldest few, never all.
      for (const key of this.m.keys()) { if (this.m.size < TABLE_MAX) break; this.m.delete(key); }
    }
    this.m.set(k, v);
  }
}

const secondsUntil = (t: number) => Math.max(1, Math.ceil((t - Date.now()) / 1000));

/* per address+email — the original back-off */
const failures = new Bounded<{ n: number; until: number }>((f, now) => f.until > now);
export function loginBlockedFor(key: string): number {
  const f = failures.get(key);
  return f && f.until > Date.now() ? secondsUntil(f.until) : 0;
}
export function noteLoginFailure(key: string) {
  const f = failures.get(key) ?? { n: 0, until: 0 };
  f.n++;
  if (f.n >= 5) f.until = Date.now() + Math.min(15 * 60_000, 2_000 * 2 ** (f.n - 5));
  failures.set(key, f);
}
export const noteLoginSuccess = (key: string) => { failures.delete(key); };

/* per address — every attempt counts, right or wrong */
const ADDRESS_PER_MINUTE = 10;
const attempts = new Bounded<{ n: number; start: number }>((a, now) => now - a.start < 60_000 && a.n >= ADDRESS_PER_MINUTE);
/** Count one attempt from `addr`; seconds to wait when it is over budget, else 0. */
export function addressAttempt(addr: string): number {
  const now = Date.now();
  let a = attempts.get(addr);
  if (!a || now - a.start >= 60_000) a = { n: 0, start: now };
  a.n++;
  attempts.set(addr, a);
  return a.n > ADDRESS_PER_MINUTE ? secondsUntil(a.start + 60_000) : 0;
}

/* per email, from any address */
const ACCOUNT_FAILURES = 20;
const ACCOUNT_WINDOW = 15 * 60_000;
const accounts = new Bounded<{ n: number; first: number; until: number }>((a, now) => a.until > now);
export function accountBlockedFor(email: string): number {
  const a = accounts.get(email);
  return a && a.until > Date.now() ? secondsUntil(a.until) : 0;
}
export function noteAccountFailure(email: string) {
  const now = Date.now();
  let a = accounts.get(email);
  if (!a || (now - a.first > ACCOUNT_WINDOW && a.until <= now)) a = { n: 0, first: now, until: 0 };
  a.n++;
  if (a.n >= ACCOUNT_FAILURES) a.until = now + Math.min(15 * 60_000, 60_000 * 2 ** (a.n - ACCOUNT_FAILURES));
  accounts.set(email, a);
}
export const noteAccountSuccess = (email: string) => { accounts.delete(email); };

/**
 * Whose attempt is this? The first entry of CLIENT_IP_HEADER (default
 * X-Forwarded-For), as the proxy in front set it. Behind a Cloudflare tunnel, set
 * CLIENT_IP_HEADER=cf-connecting-ip — otherwise every user arrives from cloudflared's
 * own address and shares one budget. Like every header trusted here, only sound
 * when that proxy is the only way in (the server listens on loopback for this).
 */
const CLIENT_IP_HEADER = (process.env.CLIENT_IP_HEADER || 'x-forwarded-for').toLowerCase();
export const clientAddr = (c: Context) => (c.req.header(CLIENT_IP_HEADER) ?? '').split(',')[0].trim() || 'local';

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
