/**
 * ============================================================================
 *  Server lifecycle for the suites — spawn it, wait for it, KILL it.
 * ============================================================================
 *
 *  This file exists because of a bug that made the suites lie.
 *
 *  The suites used to `spawn('npx', ['tsx', ...])` and later
 *  `server.kill('SIGTERM')`. The SIGTERM hit the npx WRAPPER; the tsx shim and
 *  the actual node process were orphaned to pid 1 and kept running — four
 *  leftover servers after every `npm test`, still holding their ports and,
 *  briefly, their database pool connections. Two consequences, both observed:
 *
 *  - `npm test` twice within ~10s failed at `dropdb spatialdb_test` (the
 *    orphans' pools hadn't hit pg.Pool's idle timeout yet). Wait longer and it
 *    passed, which is why a human at a keyboard never saw it.
 *  - Worse: on the next run the fresh server crashed with EADDRINUSE, the
 *    health-check loop then got a 200 from the PREVIOUS run's orphan, and the
 *    suite proceeded — 224 green tests against a server built from code that
 *    no longer existed. Edit the server, rerun, pass. That failure mode is
 *    disqualifying for a test suite.
 *
 *  Two changes close both holes:
 *
 *  1. No wrapper. `node --import tsx src/server/index.ts` is one process
 *     (tsx ≥4.9 supports the --import form), so the SIGTERM has exactly one
 *     place to go, and we WAIT for its exit before the suite finishes.
 *  2. A dead child is a hard failure, never a fallback. If the child exits
 *     while we are polling /api/health, we throw with its captured stderr
 *     instead of continuing to poll — so an EADDRINUSE can never be papered
 *     over by whoever else happens to answer on that port.
 */

import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ServerHandle {
  child: ChildProcess;
  /** SIGTERM, then wait for the process to actually be gone. */
  stop(): Promise<void>;
}

export async function bootServer(port: number, env: Record<string, string> = {}): Promise<ServerHandle> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
    // Sign-in is OFF for the suites that predate it (everyone is the first admin,
    // exactly as before 011). test/auth.ts passes AUTH_DISABLED: '0' to turn it on.
    env: { ...process.env, AUTH_DISABLED: '1', PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr?.on('data', (d) => {
    stderr += d;
    process.stderr.write(`[server] ${d}`);
  });

  let exited = false;
  const gone = new Promise<void>((resolve) => child.once('exit', () => { exited = true; resolve(); }));

  for (let i = 0; i < 60; i++) {
    if (exited) {
      throw new Error(`server exited before becoming healthy:\n${stderr}`);
    }
    try {
      if ((await fetch(`http://localhost:${port}/api/health`)).ok) {
        return {
          child,
          async stop() {
            if (!exited) {
              child.kill('SIGTERM');
              // SIGKILL escalation: nothing in the server traps SIGTERM today,
              // but a suite that can hang forever on teardown is worse than one
              // that occasionally kills harder than it needed to.
              await Promise.race([gone, sleep(5000).then(() => child.kill('SIGKILL'))]);
              await gone;
            }
          },
        };
      }
    } catch { /* not up yet */ }
    await sleep(500);
  }
  child.kill('SIGKILL');
  throw new Error(`server did not come up:\n${stderr}`);
}

/**
 * A table of BOARDS, as mutations — for suites that need a canvas to exist.
 *
 * A canvas is a record in a table of kind 'canvas' (sql/010_boards.sql), so the
 * old one-line `canvas.create` fixture became "a boards table, then a record in
 * it". Every suite that wants a canvas sends these two first.
 */
export function boardsTableMutations(tableId: string) {
  return [
    { type: 'table.create' as const, id: tableId, name: `Boards ${tableId.slice(0, 4)}`, singularName: 'Board', color: '', icon: '', kind: 'canvas' as const },
    { type: 'field.create' as const, id: randomUUID(), tableId, name: 'Name', key: 'name', fieldType: 'text' as const, options: {}, required: false },
  ];
}
