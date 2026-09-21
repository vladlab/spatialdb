/**
 * Apply pending migrations to the database named by DB_URL:  npm run migrate
 *
 * `scripts/db.sh migrate` does the same job for the private DEVELOPMENT cluster in
 * .pg/ (it shells out to psql over that cluster's socket, as the `postgres`
 * superuser). A real deployment uses the system's Postgres, reached by DB_URL as an
 * ordinary role — so this is the same runner in Node: same `sql/` files, same
 * `_migrations` table, same order. Either tool can pick up where the other left off.
 *
 * Each file runs in ONE TRANSACTION (Postgres DDL is transactional): a migration
 * that fails half-way leaves nothing behind, and is simply retried after the fix.
 *
 * The server itself never migrates. It refuses requests with a 503 naming the
 * pending files (server/migrations.ts) — migrating is an explicit deploy step, so a
 * restart can never restructure data by surprise.
 */
import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'sql');

async function main() {
  if (!process.env.DB_URL) { console.error('DB_URL is not set'); process.exit(2); }
  const client = new pg.Client({ connectionString: process.env.DB_URL });
  await client.connect();
  try {
    await client.query(`create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())`);
    const done = new Set((await client.query(`select name from _migrations`)).rows.map((r) => r.name as string));
    // [0-8]: numbered migrations. 9xx files are example data, never applied by this.
    const files = readdirSync(SQL_DIR).filter((f) => /^[0-8].*\.sql$/.test(f)).sort();
    const pending = files.filter((f) => !done.has(f));
    if (!pending.length) { console.log(`up to date (${files.length} migrations)`); return; }
    for (const name of pending) {
      process.stdout.write(`  applying ${name} … `);
      try {
        await client.query('begin');
        await client.query(readFileSync(join(SQL_DIR, name), 'utf8'));
        await client.query(`insert into _migrations (name) values ($1)`, [name]);
        await client.query('commit');
        console.log('ok');
      } catch (e) {
        await client.query('rollback').catch(() => {});
        console.log('FAILED — rolled back; nothing from this file was applied');
        throw e;
      }
    }
    console.log(`applied ${pending.length}`);
  } finally { await client.end(); }
}
main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
