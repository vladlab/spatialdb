#!/usr/bin/env bash
# ============================================================================
#  Project-local Postgres.
#
#  Everything lives under ./.pg — nothing is installed system-wide and nothing
#  touches a Postgres you may already run. Delete .pg and it's as if this never
#  happened.
#
#  Deliberately plain bash rather than Nix expressions: the logic is testable
#  on its own, works for anyone not using Nix, and keeps flake.nix thin enough
#  to be obviously correct.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PGDATA="${PGDATA:-$ROOT/.pg/data}"

# The socket must live OUTSIDE the project tree.
#
# `nix develop` copies the flake source into the Nix store, and the store only
# accepts regular files, directories and symlinks. A live Unix socket in the
# tree makes the whole project un-enterable:
#   error: file '.../.pg/socket/.s.PGSQL.5432' has an unsupported type
#
# Keyed by a hash of the project path so several checkouts don't collide, and
# kept short because Unix socket paths cap out around 107 characters.
default_socket_dir() {
  local key
  key="$(printf '%s' "$ROOT" | cksum | cut -d' ' -f1)"
  echo "${XDG_RUNTIME_DIR:-/tmp}/spatialdb-$key"
}
SOCKET_DIR="${PGHOST:-$(default_socket_dir)}"
LOG="$ROOT/.pg/postgres.log"
DB_NAME="${PGDATABASE:-spatialdb}"

# Socket-only by default. A Unix socket sidesteps port collisions entirely —
# no fighting a system Postgres on 5432 — and needs no password.
# PGPORT=5433 ./scripts/db.sh start  if you want TCP as well.
PORT="${PGPORT:-0}"

mkdir -p "$SOCKET_DIR"

usage() {
  cat <<EOF
usage: db.sh <command>

  init      create the cluster (idempotent)
  start     start Postgres, create the database, apply migrations
  stop      stop Postgres
  status    is it running? (also prints data + socket paths)
  psql      open a shell against the dev database
  migrate   apply sql/*.sql that haven't been applied yet
  bootstrap create the admin user — the minimum needed to accept writes
  seed      bootstrap + load the worked example (sql/900_example.sql)
  reset     drop everything and rebuild from migrations
  url       print the connection string
  testdb    (re)create an isolated <db>_test database for the test suites
  testurl   print the test connection string

Tests run against <db>_test, never the dev database — `npm test` recreates it.

Data lives in .pg/ — safe to delete.
EOF
}

is_running() { pg_ctl -D "$PGDATA" status >/dev/null 2>&1; }

cmd_init() {
  if [ -f "$PGDATA/PG_VERSION" ]; then echo "cluster exists"; return; fi
  echo "creating cluster in $PGDATA"
  mkdir -p "$PGDATA"
  # trust auth: this is a local dev socket, not a network service
  initdb -D "$PGDATA" -U postgres -A trust --encoding=UTF8 >/dev/null
  {
    echo "unix_socket_directories = '$SOCKET_DIR'"
    if [ "$PORT" = "0" ]; then echo "listen_addresses = ''"; else echo "port = $PORT"; fi
    echo "fsync = off"              # dev only — trades durability for speed
    echo "synchronous_commit = off"
  } >> "$PGDATA/postgresql.conf"
}

cmd_start() {
  cmd_init

  # Reconcile the socket directory.
  #
  # `unix_socket_directories` is written ONCE, at initdb. So on an existing
  # cluster, setting PGHOST changed only where the CLIENT looked while the server
  # kept listening exactly where it always had — you would be told the socket had
  # moved, and it hadn't. A silent no-op on an explicit instruction is the worst
  # kind of sharp edge, and it matters now that a scheduled backup depends on the
  # socket living somewhere that survives logout.
  if [ -f "$PGDATA/postgresql.conf" ]; then
    configured="$(sed -n "s/^unix_socket_directories = '\(.*\)'/\1/p" \
      "$PGDATA/postgresql.conf" | tail -1)"
    if [ -n "$configured" ] && [ "$configured" != "$SOCKET_DIR" ]; then
      if is_running; then
        echo "note: cluster is running with socket dir $configured"
        echo "      to move it to $SOCKET_DIR, stop it first: db.sh stop"
      else
        sed -i.bak \
          "s|^unix_socket_directories = .*|unix_socket_directories = '$SOCKET_DIR'|" \
          "$PGDATA/postgresql.conf"
        rm -f "$PGDATA/postgresql.conf.bak"
        echo "socket dir moved: $configured -> $SOCKET_DIR"
      fi
    fi
  fi

  if is_running; then echo "already running"; else
    mkdir -p "$(dirname "$LOG")"
    pg_ctl -D "$PGDATA" -l "$LOG" -w start >/dev/null
    echo "postgres started (socket: $SOCKET_DIR)"
  fi
  # Connect to the 'postgres' maintenance database explicitly. Without -d,
  # libpq falls back to $PGDATABASE — which the dev shell sets to the database
  # we are checking the existence of, so this fails on a fresh cluster.
  if ! psql -h "$SOCKET_DIR" -U postgres -d postgres -tAc \
       "select 1 from pg_database where datname='$DB_NAME'" | grep -q 1; then
    createdb -h "$SOCKET_DIR" -U postgres --maintenance-db=postgres "$DB_NAME"
    echo "created database $DB_NAME"
  fi
  cmd_migrate
}

cmd_stop() {
  if is_running; then pg_ctl -D "$PGDATA" -w -m fast stop >/dev/null; echo "stopped";
  else echo "not running"; fi
}

cmd_status() {
  if is_running; then echo "running"; else echo "stopped"; fi
  echo "  data:   $PGDATA"
  echo "  socket: $SOCKET_DIR"
}

# Tiny migration runner. A real one (dbmate, node-pg-migrate) is worth adopting
# once migrations need to roll back; until then this is enough and has no deps.
cmd_migrate() {
  psql -h "$SOCKET_DIR" -U postgres -d "$DB_NAME" -q -c \
    "set client_min_messages to warning;
     create table if not exists _migrations (
       name text primary key, applied_at timestamptz not null default now())"
  for f in "$ROOT"/sql/[0-8]*.sql; do
    [ -e "$f" ] || continue
    name="$(basename "$f")"
    applied=$(psql -h "$SOCKET_DIR" -U postgres -d "$DB_NAME" -tAc \
      "select 1 from _migrations where name='$name'")
    if [ "$applied" = "1" ]; then continue; fi
    echo "  applying $name"
    psql -h "$SOCKET_DIR" -U postgres -d "$DB_NAME" -q -v ON_ERROR_STOP=1 -f "$f"
    psql -h "$SOCKET_DIR" -U postgres -d "$DB_NAME" -q -c \
      "insert into _migrations (name) values ('$name')"
  done
}

# ─────────────────────────────────────────────────────────────────────────────
#  bootstrap — the minimum a database needs to accept writes.
#
#  Just a user. `currentActor()` resolves the writer by picking the first admin
#  in the users table, so with no users EVERY write fails — reads work fine,
#  which makes an unconfigured database look like a half-broken one.
#
#  This used to be bundled into `seed`, alongside the Deliverables/Specs example.
#  That conflated two unrelated things: one is a hard prerequisite, the other is a
#  demonstration. The result was no way to get a working-but-empty database — the
#  only route to a usable system also handed you fictional broadcast deliverables
#  to delete.
#
#  Idempotent, so running it twice (or after seed) is harmless.
# ─────────────────────────────────────────────────────────────────────────────
cmd_bootstrap() {
  psql -h "$SOCKET_DIR" -U postgres -d "$DB_NAME" -q -c \
    "insert into users (email, name, role) values ('dev@local','Dev','admin')
     on conflict (email) do nothing"
  local n
  n="$(psql -h "$SOCKET_DIR" -U postgres -d "$DB_NAME" -tAc 'select count(*) from users')"
  echo "bootstrapped: $n user(s) — the database can now accept writes"

  # Say so plainly. Without a table there is nothing to put records in, and the
  # schema editor is phase 3, so an empty database is legal but not yet usable.
  local t
  t="$(psql -h "$SOCKET_DIR" -U postgres -d "$DB_NAME" -tAc 'select count(*) from tables')"
  if [ "$t" = "0" ]; then
    echo "note: no tables yet. You can create canvases in the app, but records need"
    echo "      a table — add one with SQL, or run './scripts/db.sh seed' for the"
    echo "      worked example."
  fi
}

cmd_seed() {
  # Bootstrap first: the example data is optional, a user is not, and seeding
  # without one would leave a database full of rows that cannot be edited.
  cmd_bootstrap >/dev/null
  echo "seeding example data"
  psql -h "$SOCKET_DIR" -U postgres -d "$DB_NAME" -q -v ON_ERROR_STOP=1 \
    -f "$ROOT/sql/900_example.sql"
}

cmd_reset() {
  if is_running; then
    dropdb   -h "$SOCKET_DIR" -U postgres --maintenance-db=postgres --if-exists "$DB_NAME"
    createdb -h "$SOCKET_DIR" -U postgres --maintenance-db=postgres "$DB_NAME"
  fi
  cmd_migrate
  echo "reset complete"
}

cmd_psql() { exec psql -h "$SOCKET_DIR" -U postgres -d "$DB_NAME"; }

cmd_url() {
  if [ "$PORT" = "0" ]; then echo "postgresql://postgres@/$DB_NAME?host=$SOCKET_DIR"
  else echo "postgresql://postgres@localhost:$PORT/$DB_NAME"; fi
}

# ─────────────────────────────────────────────────────────────────────────────
#  testdb — a separate database for the test suites.
#
#  The suites used to run against the dev database, and they are not polite
#  guests: one `npm test` turned a freshly seeded database of 1 canvas into 902.
#  Most of that was `test/stream.ts` padding the mutation log to force the
#  catch-up truncation branch — a fix for a weak test that quietly created a new
#  problem — but every suite left fixtures behind, and the canvas picker filled
#  up with `evt 1`, `pad <uuid>` and `Doomed canvas`.
#
#  Cleanup-after-yourself was the tempting fix and it is the wrong one: a suite
#  that fails partway through skips its own cleanup, which is exactly when you
#  least want your dev data disturbed. Tests that need to delete a table, prune
#  the log, or roll the head backwards should be free to do that without anyone
#  thinking about it. So: a different database, dropped and recreated on demand.
#
#  Same cluster, same migrations, no seed — suites build their own fixtures.
# ─────────────────────────────────────────────────────────────────────────────
cmd_testdb() {
  local test_db="${DB_NAME}_test"
  # Fresh every time. Test isolation is not worth debugging, and creating a
  # database from template0 takes well under a second.
  dropdb -h "$SOCKET_DIR" -U postgres --maintenance-db=postgres --if-exists "$test_db"
  createdb -h "$SOCKET_DIR" -U postgres --maintenance-db=postgres "$test_db"
  DB_NAME="$test_db" cmd_migrate >/dev/null
  # Same bootstrap the dev database gets — one definition of "minimum viable
  # database", so the suites cannot drift from what a real one looks like.
  DB_NAME="$test_db" cmd_bootstrap >/dev/null
  echo "ready: $test_db"
}

cmd_testurl() {
  DB_NAME="${DB_NAME}_test" cmd_url
}

case "${1:-}" in
  init) cmd_init ;;    start) cmd_start ;;  stop) cmd_stop ;;
  status) cmd_status ;; migrate) cmd_migrate ;; seed) cmd_seed ;;
  bootstrap) cmd_bootstrap ;;
  reset) cmd_reset ;;  psql) cmd_psql ;;    url) cmd_url ;;
  testdb) cmd_testdb ;; testurl) cmd_testurl ;;
  *) usage; exit 1 ;;
esac
