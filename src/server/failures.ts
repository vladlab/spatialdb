/**
 * ============================================================================
 *  What a failed batch tells the client that sent it.
 * ============================================================================
 *
 *  The client's queue acts on exactly two things in the answer (store.ts `flush`):
 *
 *    the STATUS   4xx  "this content will never be accepted" — stop sending it
 *                 5xx  "try again" — the batch stays queued and is retried
 *    `failed`     the idempotency key of the ONE mutation the batch died on, so
 *                 the client can drop that action and send the rest again,
 *                 instead of losing (4xx) or holding up (5xx) everything that
 *                 happened to be queued beside it.
 *
 *  So the status has to be TRUE, and for a long time it was not. Anything that was
 *  not a MutationError — which is to say every error Postgres itself raised — came
 *  back as 500, "try again", including the ones no retry can fix:
 *
 *    - a card placed for a record a colleague deleted a second ago (foreign key)
 *    - a row added to, or a view saved on, a table an admin just deleted
 *    - text with a NUL in it, which jsonb cannot hold (a metadata tag off a file)
 *
 *  The client retried each of those every ten seconds, forever, with every later
 *  edit queued behind it in memory under a banner saying "queued, not lost" —
 *  until the tab was reloaded, and then they were lost.
 *
 *  Postgres says which kind of failure it was: the SQLSTATE class. That is what
 *  this file reads.
 */

import { MutationError } from './apply.js';

export interface Failure {
  status: number;
  body: { error: string; detail?: string; failed?: string };
}

/** The mutation a thrown error belongs to — attached by applyBatch (apply.ts). */
const failedOf = (err: unknown): string | undefined => {
  const id = (err as { mutationId?: unknown } | null)?.mutationId;
  return typeof id === 'string' ? id : undefined;
};

/** An integrity violation, in the words of someone using the app. `detail` keeps Postgres's own. */
function integritySentence(code: string): string {
  if (code === '23503') {
    return 'it refers to something that no longer exists — most likely deleted by someone else a moment ago';
  }
  if (code === '23505') return 'something with that id or key already exists';
  if (code === '23502') return 'a required value is missing';
  return 'the database refused it';
}

/**
 * Network-ish failures between this process and Postgres, as Node reports them.
 * These carry no SQLSTATE; they are the textbook "try again".
 */
const TRANSIENT_NODE = new Set(['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN']);

export function failureOf(err: unknown): Failure {
  const failed = failedOf(err);
  const withFailed = <T extends object>(body: T) => (failed ? { ...body, failed } : body);

  if (err instanceof MutationError) {
    return { status: err.status, body: withFailed({ error: err.message }) };
  }

  const e = (err ?? {}) as { code?: unknown; message?: unknown };
  const message = String(e.message ?? err);
  const code = typeof e.code === 'string' ? e.code : '';

  // A five-character code is a SQLSTATE; its first two characters are the class.
  if (/^[0-9A-Z]{5}$/.test(code)) {
    const cls = code.slice(0, 2);

    // 23 — integrity constraint violation. Deterministic: the same batch fails the
    // same way until the DATA changes, and the data is not this client's to change.
    if (cls === '23') {
      return { status: 409, body: withFailed({ error: `not saved: ${integritySentence(code)}`, detail: message }) };
    }
    // 22 — data exception (a value Postgres cannot store), 54 — program limit
    // exceeded (a value too large for it). Equally deterministic.
    if (cls === '22' || cls === '54') {
      const error = code === '22P05'
        ? 'not saved: the text contains a NUL character (\\u0000), which the database cannot store'
        : 'not saved: a value in it cannot be stored';
      return { status: 400, body: withFailed({ error, detail: message }) };
    }
    // 08 connection, 40 rollback (deadlock, serialization), 53 out of resources,
    // 55 lock not available, 57 operator intervention (shutdown, cancel), 58 system
    // error: the batch was fine and the moment was not. NO `failed` — nothing about
    // this says one mutation is to blame, and the client must not drop anything.
    if (['08', '40', '53', '55', '57', '58'].includes(cls)) {
      return { status: 503, body: { error: 'the database is not available right now', detail: message } };
    }
    // Anything else from Postgres (a syntax error, an undefined column the
    // migration gate did not catch): a bug on this side. 500, and it names the
    // mutation — the client gives a mutation that crashes the server three times
    // running up as unsaveable rather than queueing behind it forever.
    return { status: 500, body: withFailed({ error: 'internal error', detail: message }) };
  }

  if (TRANSIENT_NODE.has(code) || /Connection terminated|connection.*(closed|lost|timeout)|timeout exceeded when trying to connect/i.test(message)) {
    return { status: 503, body: { error: 'the database is not available right now', detail: message } };
  }

  // A TypeError and friends: a bug in apply. Same reasoning as the last SQL case.
  return { status: 500, body: withFailed({ error: 'internal error', detail: message }) };
}
