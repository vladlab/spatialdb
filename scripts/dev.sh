#!/usr/bin/env bash
# Run the API and the Vite client together, and take BOTH down on exit.
#
# This used to be `npm run dev:api & npm run dev:client` in package.json. The `&`
# backgrounds the API, Ctrl-C reaches only the foreground job (Vite), and the API
# is left running with the terminal looking idle. The next `npm run dev` then
# fails with EADDRINUSE on 8787 — while the app carries on "working", because the
# new Vite happily proxies to the OLD api process. Nothing tells you that the
# server you are talking to is last session's.
#
# `kill 0` signals this script's whole process group: both npm wrappers and the
# tsx/vite children under them. `wait -n` returns when EITHER exits, so an API
# that dies at startup (port taken, database down) brings Vite down with it
# instead of leaving a client pointed at nothing.
set -uo pipefail
cd "$(dirname "$0")/.."

# Check the port FIRST. Relying on the API to fail does not work: it runs under
# `tsx watch`, which survives its child crashing (it waits for a file change to
# retry), so `wait -n` below never sees an exit and Vite stays up, proxying to
# whatever already owns the port. bash's /dev/tcp needs no extra tools.
PORT="${PORT:-8787}"
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  echo "Port $PORT is already in use — most likely an API server left over from an earlier run."
  echo "  find it:  ss -ltnp | grep $PORT"
  echo "  stop it:  pkill -f src/server/index.ts"
  exit 1
fi

# Apply any migrations the code needs before starting it. `db.sh start` always
# did this, but only when it was the thing starting Postgres; with the database
# already up, new sql/ files sat unapplied and the app half-worked (see
# src/server/migrations.ts for what that looked like). Migrations here only ever
# ADD, and this is the dev entry point — a deploy should run `db.sh migrate`
# deliberately. If Postgres is not running, say so rather than guessing.
if ./scripts/db.sh status 2>/dev/null | grep -q "^running"; then
  ./scripts/db.sh migrate | grep -E "applying" || true
else
  echo "Postgres does not seem to be running — start it with ./scripts/db.sh start"
fi

# ── start both, stop both — with exactly ONE signal each ────────────────────
#
# The first version of this was `trap 'kill 0'` around two `npm run … &`. It did
# stop everything, but noisily: tsx printed "Previous process hasn't exited yet.
# Force killing..." three times after the prompt came back, and the API was being
# SIGKILLed rather than shut down. tsx prints that whenever a SECOND signal
# arrives while it is still stopping its child, and it was getting four:
#
#   1. Ctrl-C — the terminal signals every process in the foreground group
#   2. npm forwarding that SIGINT to its child
#   3. `kill 0` from the trap — the whole group again
#   4. npm forwarding THAT
#
# So: no npm wrappers (run the binaries directly), and each child in its OWN
# session via setsid, so the terminal's Ctrl-C reaches only this script. This
# script then sends each child one SIGTERM and waits. The API handles SIGTERM
# itself (src/server/index.ts) and exits cleanly within a moment.
BIN="node_modules/.bin"
pids=()
if command -v setsid >/dev/null 2>&1; then run() { setsid "$@" & pids+=($!); }
else                                       run() { "$@" & pids+=($!); }   # noisier on Ctrl-C, still correct
fi

stop() {
  trap - EXIT INT TERM
  for p in "${pids[@]}"; do kill -TERM "$p" 2>/dev/null; done
  # Give them a moment to go quietly; then make sure. The group kill is the
  # safety net for anything a child spawned (esbuild under vite, the server under
  # tsx) — it is a no-op when they have already exited, which is the normal case.
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    alive=0; for p in "${pids[@]}"; do kill -0 "$p" 2>/dev/null && alive=1; done
    [ "$alive" = 0 ] && break; sleep 0.2
  done
  for p in "${pids[@]}"; do kill -KILL -- "-$p" 2>/dev/null; done
  wait 2>/dev/null
}
trap stop EXIT INT TERM

run "$BIN/tsx" watch src/server/index.ts
run "$BIN/vite"
wait -n
