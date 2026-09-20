/**
 * Create a user, or reset a password, from a terminal:  ./scripts/user.sh
 *
 * This is how the FIRST admin comes to exist. There is deliberately no "set up
 * your account" page: an open setup page is a race anyone on the network can win.
 * Being able to run this means you already have the database — which is the
 * real authority here.
 *
 *   ./scripts/user.sh add <email> <name> [admin|editor|viewer]
 *   ./scripts/user.sh passwd <email>
 *   ./scripts/user.sh list
 *
 * The password is read from the terminal without echo (or from stdin, for
 * scripting: `echo "$PW" | ./scripts/user.sh add …`). It is never an argument:
 * arguments are visible in `ps` and end up in shell history.
 */
import pg from 'pg';
import { createInterface } from 'node:readline';
import { hashPassword, passwordProblem } from './auth.js';

function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => { let buf = ''; process.stdin.on('data', (d) => { buf += d; }); process.stdin.on('end', () => resolve(buf.replace(/\r?\n$/, ''))); });
  }
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Swallow the echo: readline writes each keystroke through _writeToOutput.
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => { if (s.includes(prompt)) process.stdout.write(prompt); };
    rl.question(prompt, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

async function main() {
  const [cmd, email, name, role = 'editor'] = process.argv.slice(2);
  const pool = new pg.Pool({ connectionString: process.env.DB_URL });
  try {
    if (cmd === 'list') {
      const { rows } = await pool.query(`select email, name, role, disabled, password_hash is not null as can_sign_in from users order by created_at`);
      console.table(rows);
      return;
    }
    if ((cmd !== 'add' && cmd !== 'passwd') || !email) {
      console.error('usage: user.sh add <email> <name> [admin|editor|viewer]  |  user.sh passwd <email>  |  user.sh list');
      process.exitCode = 2; return;
    }
    if (cmd === 'add' && !['admin', 'editor', 'viewer'].includes(role)) { console.error(`role must be admin, editor or viewer — not '${role}'`); process.exitCode = 2; return; }
    const password = await readHidden('password: ');
    const problem = passwordProblem(password);
    if (problem) { console.error(problem); process.exitCode = 1; return; }
    if (process.stdin.isTTY && (await readHidden('again:    ')) !== password) { console.error('they do not match'); process.exitCode = 1; return; }
    const hash = await hashPassword(password);
    if (cmd === 'add') {
      // An existing account (the bootstrap admin, say) is given the password and role rather than refused.
      const { rows } = await pool.query(
        `insert into users (email, name, role, password_hash) values (lower($1), $2, $3, $4)
         on conflict (email) do update set name = excluded.name, role = excluded.role, password_hash = excluded.password_hash, disabled = false
         returning (xmax = 0) as created`, [email, name ?? '', role, hash]);
      console.log(rows[0].created ? `created ${email} (${role})` : `updated ${email}: now ${role}, new password set`);
    } else {
      const r = await pool.query(`update users set password_hash = $2 where lower(email) = lower($1)`, [email, hash]);
      if (!r.rowCount) { console.error(`no user ${email}`); process.exitCode = 1; return; }
      await pool.query(`delete from sessions where user_id = (select id from users where lower(email) = lower($1))`, [email]);
      console.log(`password changed for ${email}; their sessions were ended`);
    }
  } finally { await pool.end(); }
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
