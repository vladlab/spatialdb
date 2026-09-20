/**
 * Is the database behind the code?
 *
 * Migrations are applied by `scripts/db.sh migrate`, not by the server — on
 * purpose: a server that alters tables on boot is a server that can brick
 * production data by being restarted. But that leaves a gap this file closes.
 * Pull new code, forget to migrate, and nothing SAID so: reads and writes that
 * touched a new column died with a bare `500 internal error`, the client retried
 * the doomed batch forever, and every write behind it queued up unseen. It has
 * now cost time twice (the handoff notes list the first; the `config` column on
 * canvases was the second, reported from real use).
 *
 * So the server checks, and while anything is pending it answers every API call
 * with a 503 that names the files and the command. 503 rather than 500 because
 * it IS temporary, and the client treats it that way: the queue holds, nothing is
 * dropped, and the moment `db.sh migrate` has run the next retry goes through —
 * no restart needed, because the check is repeated while it is failing.
 *
 * The file pattern and the `_migrations` table are db.sh's; keep them in step.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'sql');

/** Same glob as db.sh: 0xx–8xx are migrations; 9xx is the optional seed. */
function migrationFiles(): string[] {
  try { return readdirSync(SQL_DIR).filter((f) => /^[0-8].*\.sql$/.test(f)).sort(); }
  catch { return []; }   // no sql/ beside the server (a packaged deploy): nothing to compare
}

export async function pendingMigrations(pool: pg.Pool): Promise<string[]> {
  const files = migrationFiles();
  if (!files.length) return [];
  try {
    const { rows } = await pool.query(`select name from _migrations`);
    const applied = new Set(rows.map((r) => r.name as string));
    return files.filter((f) => !applied.has(f));
  } catch (e) {
    // 42P01: _migrations does not exist — a database db.sh has never touched.
    if ((e as { code?: string }).code === '42P01') return files;
    throw e;
  }
}

/**
 * Cached so a healthy server pays nothing: once the answer is "none pending" it
 * is never asked again (migrations only ever get AHEAD of a running server by
 * deploying new code, which restarts it). While something IS pending, re-check
 * at most every 2s, so running the migration is picked up without a restart.
 */
export function migrationGate(pool: pg.Pool) {
  let clean = false, lastCheck = 0, pending: string[] = [];
  return async function check(): Promise<string[]> {
    if (clean) return [];
    if (Date.now() - lastCheck > 2000) {
      pending = await pendingMigrations(pool);
      lastCheck = Date.now();
      if (!pending.length) clean = true;
    }
    return pending;
  };
}
