#!/usr/bin/env bash
# ============================================================================
#  Backups.
#
#  This is load-bearing, not housekeeping. sql/001_schema.sql deliberately has
#  no soft deletes, and the reasoning written into that file is explicit:
#
#      "For a team this size, nightly pg_dump is cheaper recoverability than
#       carrying tombstones in the schema."
#
#  That trade is only sound if the dumps actually exist. Until they do, the
#  system has no undo at any level: `record.delete` cascades to links and
#  placements by foreign key, there are no tombstones, and the mutation log
#  records that a delete happened without retaining what was deleted. One
#  mis-click on a canvas is unrecoverable.
#
#  So: this runs before phase 2 puts a drag-and-drop surface in front of real
#  project data, not after.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Outside the project tree by default, for the same reason the socket is: the
# tree gets copied into the Nix store on every `nix develop`, and a growing pile
# of dumps in there is both slow and eventually enormous. Override freely.
BACKUP_DIR="${SPATIALDB_BACKUP_DIR:-$HOME/spatialdb-backups}"
# Where the server keeps uploaded files — beside the Postgres data directory.
# Must match src/server/assets.ts (same variable, same default).
ASSETS_DIR="${SPATIALDB_ASSETS_DIR:-$ROOT/.pg/assets}"
KEEP_DAYS="${SPATIALDB_BACKUP_KEEP_DAYS:-30}"

# Same defaults as db.sh so the two agree without being coupled.
DB_NAME="${PGDATABASE:-spatialdb}"
default_socket_dir() {
  local key
  key="$(printf '%s' "$ROOT" | cksum | cut -d' ' -f1)"
  echo "${XDG_RUNTIME_DIR:-/tmp}/spatialdb-$key"
}
SOCKET_DIR="${PGHOST:-$(default_socket_dir)}"

usage() {
  cat <<EOF
usage: backup.sh <command>

  dump              write a timestamped compressed dump, then prune old ones
  check             will this work from CRON's environment, not just yours?
  list              show existing dumps, newest first
  verify <file>     check a dump is readable and report what it contains
  restore <file>    DESTRUCTIVE: drop the database and restore from <file>
  assets            mirror uploaded files into the backup dir (dump does this too)
  restore-assets    copy mirrored files back into the assets directory (additive)

Environment:
  SPATIALDB_BACKUP_DIR        where dumps live   (default: \$HOME/spatialdb-backups)
  SPATIALDB_BACKUP_KEEP_DAYS  prune older than   (default: 30)

Install the nightly job:
  ./scripts/backup.sh cron     # PRINTS a crontab line; it does NOT install it
  crontab -e                   # paste it
  ./scripts/backup.sh check    # then confirm it would actually run
EOF
}

psql_ () { psql -h "$SOCKET_DIR" -U postgres -d "$DB_NAME" "$@"; }

# Log to BOTH stdout and a file inside BACKUP_DIR.
#
# Deliberately NOT left to a `>> logfile` redirect in the crontab line. cron's
# shell sets up that redirect BEFORE the script runs, so if the directory does
# not exist yet the redirect fails, the script never executes, and there is no
# log to tell you — the record of the failure is destroyed by the same missing
# directory that caused it. Verified: exit 2, nothing written, nothing anywhere.
log() {
  mkdir -p "$BACKUP_DIR" 2>/dev/null || true
  local line="[$(date -Is)] $*"
  echo "$line"
  [ -d "$BACKUP_DIR" ] && echo "$line" >> "$BACKUP_DIR/backup.log"
}

cmd_dump() {
  mkdir -p "$BACKUP_DIR"
  local stamp file
  stamp="$(date +%Y%m%d-%H%M%S)"
  file="$BACKUP_DIR/$DB_NAME-$stamp.dump"

  if ! command -v pg_dump >/dev/null 2>&1; then
    log "FAILED: pg_dump is not on PATH (PATH=$PATH). If Postgres comes from Nix,"
    log "        cron will not have it — pin PATH in the crontab line (backup.sh cron)."
    exit 1
  fi

  # Custom format (-Fc), not plain SQL: it is compressed, and pg_restore can do
  # selective and parallel restores from it. Plain .sql can only be replayed
  # whole, which is exactly the wrong property when you want one table back.
  # DB_URL set = a real deployment (the system's Postgres, an ordinary role — see
  # DEPLOY.md). Unset = the private development cluster in .pg/, over its socket.
  local -a conn
  if [ -n "${DB_URL:-}" ]; then conn=(-d "$DB_URL"); else conn=(-h "$SOCKET_DIR" -U postgres -d "$DB_NAME"); fi
  if ! pg_dump "${conn[@]}" -Fc -f "$file" 2>>"$BACKUP_DIR/backup.log"; then
    # Never print DB_URL itself: it can carry a password.
    if [ -n "${DB_URL:-}" ]; then log "FAILED: pg_dump could not connect using DB_URL"; else log "FAILED: pg_dump could not connect via socket dir $SOCKET_DIR"; fi
    log "        Run './scripts/backup.sh check' — this is usually a cron"
    log "        environment problem, not a database problem."
    rm -f "$file"
    exit 1
  fi

  # A dump you have never read is a hope, not a backup. Verify immediately —
  # if the archive is truncated or corrupt, we want to know now, while the
  # database it came from is still healthy.
  if ! pg_restore --list "$file" >/dev/null 2>&1; then
    log "FAILED: $file is not a readable archive"
    rm -f "$file"
    exit 1
  fi

  log "ok $file ($(du -h "$file" | cut -f1))"

  # Files AFTER the database, never before. Every asset the dump mentions was
  # uploaded before the dump was taken (a value can only name an asset that
  # already exists), so mirroring second guarantees the mirror covers the dump.
  # The other order could capture a row whose file had not been copied yet.
  cmd_assets

  # Prune. Only ever touches files matching our own naming pattern, so pointing
  # BACKUP_DIR at a shared directory cannot delete someone else's data.
  find "$BACKUP_DIR" -maxdepth 1 -name "$DB_NAME-*.dump" -type f \
    -mtime "+$KEEP_DAYS" -print -delete | while read -r pruned; do
      log "pruned $pruned"
    done
}

# ── uploaded files ───────────────────────────────────────────────────────────
#
# A dump without the assets directory restores a database full of notes whose
# images 404. The files are content-addressed: named by their own hash, never
# modified, never deleted. That makes backing them up almost trivially safe:
#
#   - ONE mirror serves EVERY dump, old and new. There is no "assets as of
#     Tuesday" — a file that existed on Tuesday is byte-identical today.
#   - Copying is purely ADDITIVE (never overwrite, never delete), so a bad run
#     cannot damage a good mirror, and it is safe while the server is writing: a
#     file only appears at its final path complete (the server renames it in).
#   - It is never pruned. KEEP_DAYS applies to dumps; an old dump you decide to
#     restore still needs its files.
#
# tmp/ (in-flight uploads) is skipped.
cmd_assets() {
  if [ ! -d "$ASSETS_DIR" ]; then log "assets: none yet ($ASSETS_DIR)"; return; fi
  mkdir -p "$BACKUP_DIR/assets"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --ignore-existing --exclude '/tmp/' "$ASSETS_DIR"/ "$BACKUP_DIR/assets"/
  else
    ( cd "$ASSETS_DIR" && find . -path ./tmp -prune -o -type f -print ) | while read -r f; do
      [ -e "$BACKUP_DIR/assets/$f" ] && continue
      mkdir -p "$BACKUP_DIR/assets/$(dirname "$f")" && cp "$ASSETS_DIR/$f" "$BACKUP_DIR/assets/$f"
    done
  fi
  log "ok assets mirrored: $(find "$BACKUP_DIR/assets" -type f | wc -l) file(s), $(du -sh "$BACKUP_DIR/assets" | cut -f1)"
}

# The reverse, equally additive: puts back what is missing, touches nothing that
# is there. Run it after `restore` on a machine that lost its assets directory.
cmd_restore_assets() {
  [ -d "$BACKUP_DIR/assets" ] || { echo "no mirrored assets in $BACKUP_DIR/assets" >&2; exit 1; }
  mkdir -p "$ASSETS_DIR"
  local before after
  before=$(find "$ASSETS_DIR" -type f 2>/dev/null | wc -l)
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --ignore-existing "$BACKUP_DIR/assets"/ "$ASSETS_DIR"/
  else
    ( cd "$BACKUP_DIR/assets" && find . -type f ) | while read -r f; do
      [ -e "$ASSETS_DIR/$f" ] && continue
      mkdir -p "$ASSETS_DIR/$(dirname "$f")" && cp "$BACKUP_DIR/assets/$f" "$ASSETS_DIR/$f"
    done
  fi
  after=$(find "$ASSETS_DIR" -type f | wc -l)
  log "ok assets restored: $((after - before)) file(s) put back into $ASSETS_DIR"
}

cmd_list() {
  if [ ! -d "$BACKUP_DIR" ]; then echo "no backups yet ($BACKUP_DIR)"; return; fi
  ls -lht "$BACKUP_DIR"/"$DB_NAME"-*.dump 2>/dev/null || echo "no backups yet ($BACKUP_DIR)"
}

cmd_verify() {
  local file="${1:?usage: backup.sh verify <file>}"
  pg_restore --list "$file" >/dev/null
  echo "archive is readable: $file"
  echo "tables in the dump:"
  pg_restore --list "$file" | awk '/TABLE DATA/ { print "  " $(NF-1) }' | sort -u
}

cmd_restore() {
  local file="${1:?usage: backup.sh restore <file>}"
  [ -f "$file" ] || { echo "no such file: $file" >&2; exit 1; }
  pg_restore --list "$file" >/dev/null

  echo "This DROPS the database '$DB_NAME' and restores it from:"
  echo "  $file"
  echo
  echo "Stop the API server first if it is running — it holds a connection pool"
  echo "and will reconnect the instant one is available."
  printf "Type the database name to confirm: "
  read -r reply
  [ "$reply" = "$DB_NAME" ] || { echo "aborted"; exit 1; }

  # Evict everything else before dropping.
  #
  # `dropdb` refuses while any session is connected, so restore used to fail with
  # "database is being accessed by other users" — precisely when you need it, since
  # the situation that makes you restore is the app being up and having done
  # something regrettable. A recovery tool that only works when nothing is running
  # is not much of a recovery tool.
  #
  # Order matters: REVOKE first, then terminate. Terminating alone loses the race,
  # because a connection pool reconnects in milliseconds and the drop fails again.
  echo "evicting connections…"
  psql -h "$SOCKET_DIR" -U postgres -d postgres -q -c \
    "revoke connect on database \"$DB_NAME\" from public" 2>/dev/null || true
  psql -h "$SOCKET_DIR" -U postgres -d postgres -tAc \
    "select pg_terminate_backend(pid) from pg_stat_activity
      where datname = '$DB_NAME' and pid <> pg_backend_pid()" >/dev/null 2>&1 || true

  if ! dropdb -h "$SOCKET_DIR" -U postgres --maintenance-db=postgres --if-exists "$DB_NAME"; then
    echo "FAILED: could not drop '$DB_NAME'. Something is still connected." >&2
    echo "        Stop the API server and try again; the database is untouched." >&2
    exit 1
  fi

  createdb -h "$SOCKET_DIR" -U postgres --maintenance-db=postgres "$DB_NAME"
  if ! pg_restore -h "$SOCKET_DIR" -U postgres -d "$DB_NAME" --no-owner "$file"; then
    echo "FAILED: pg_restore reported errors — inspect '$DB_NAME' before trusting it." >&2
    exit 1
  fi

  local n
  n="$(psql -h "$SOCKET_DIR" -U postgres -d "$DB_NAME" -tAc \
    'select count(*) from records' 2>/dev/null || echo '?')"
  echo "restored. records: $n"

  # A restored database that refers to files which are not on disk shows notes
  # with broken images and no explanation. Count them and say what to do.
  local missing=0 sha
  while read -r sha; do
    [ -n "$sha" ] || continue
    [ -e "$ASSETS_DIR/${sha:0:2}/${sha:2:2}/$sha" ] || missing=$((missing + 1))
  done < <(psql -h "$SOCKET_DIR" -U postgres -d "$DB_NAME" -tAc 'select sha256 from assets' 2>/dev/null)
  if [ "$missing" -gt 0 ]; then
    echo
    echo "WARNING: $missing uploaded file(s) this database refers to are missing from"
    echo "  $ASSETS_DIR"
    echo "Put them back with:  ./scripts/backup.sh restore-assets"
  fi
  echo
  echo "The mutation log came back with it, so the log head has moved BACKWARDS."
  echo "Any client whose watermark is now ahead of it must discard state and"
  echo "refetch — restart the API server and reload every open tab."
}

cmd_cron() {
  # Everything fragile is RESOLVED NOW and pinned into the line, because cron's
  # environment is not your shell's. Three things bit us:
  #
  #   1. XDG_RUNTIME_DIR is UNSET under cron, so default_socket_dir() falls back
  #      to /tmp and looks for the socket somewhere Postgres is not listening.
  #      This is the one that silently failed every night.
  #   2. PATH is minimal under cron. If Postgres comes from Nix, pg_dump is not
  #      on it at all.
  #   3. A `>> logfile` redirect in the crontab line is evaluated BEFORE the
  #      script runs, so a missing directory kills the job and the log that
  #      would have told you. The script logs itself now; no redirect needed.
  local pgdump_dir
  pgdump_dir="$(dirname "$(command -v pg_dump 2>/dev/null || echo /usr/bin/pg_dump)")"

  cat <<EOF
# spatialdb nightly backup — add with: crontab -e
# Verify it first:  ./scripts/backup.sh check
15 3 * * * PATH="$pgdump_dir:/usr/bin:/bin" PGHOST="$SOCKET_DIR" SPATIALDB_BACKUP_DIR="$BACKUP_DIR" $ROOT/scripts/backup.sh dump
EOF

  case "$SOCKET_DIR" in
    "${XDG_RUNTIME_DIR:-__unset__}"/*)
      cat <<EOF

# ⚠ The socket lives under XDG_RUNTIME_DIR ($XDG_RUNTIME_DIR), which systemd
#   CREATES AT LOGIN AND DELETES AT LOGOUT. Pinning PGHOST above fixes the path
#   lookup, but the path itself disappears when you log out — and the hand-started
#   cluster goes with it. A 03:15 backup of a cluster that only exists while you
#   are logged in is not a backup.
#
#   Pick one:
#     loginctl enable-linger $USER
#         keeps your user session — and the hand-started cluster — alive at 03:15
#
#     ./scripts/db.sh stop && PGHOST=/var/lib/spatialdb-sock ./scripts/db.sh start
#         moves the socket somewhere that survives logout. Must be STOPPED first:
#         unix_socket_directories is read at startup, so db.sh rewrites it while
#         the cluster is down and tells you if it cannot.
#
#     run Postgres as a systemd service
#         the right answer for anything holding real project data
#
#   Then re-run: ./scripts/backup.sh check
EOF
      ;;
  esac
}

# ─────────────────────────────────────────────────────────────────────────────
#  check — does this work from cron's environment, not just yours?
#
#  The whole point of the script is that the no-soft-deletes trade in
#  001_schema.sql is only sound if dumps exist. A dump command that works when
#  you run it by hand and fails at 03:15 satisfies nothing, and fails invisibly.
#  So: re-run the real thing under a stripped environment and report.
# ─────────────────────────────────────────────────────────────────────────────
cmd_check() {
  local problems=0
  echo "socket dir (this shell):  $SOCKET_DIR"
  echo "backup dir:               $BACKUP_DIR"
  echo "XDG_RUNTIME_DIR:          ${XDG_RUNTIME_DIR:-<unset>}"
  echo

  if [ -S "$SOCKET_DIR/.s.PGSQL.5432" ]; then
    echo "  ok    postgres socket present"
  else
    echo "  FAIL  no socket at $SOCKET_DIR — is the cluster running? (db.sh status)"
    problems=$((problems + 1))
  fi

  if command -v pg_dump >/dev/null 2>&1; then
    echo "  ok    pg_dump on this shell's PATH ($(command -v pg_dump))"
  else
    echo "  FAIL  pg_dump not found in this shell"
    problems=$((problems + 1))
  fi

  # THE test that matters: a stripped environment, the way cron will run it.
  #
  # Dumps to a real temp file, not /dev/null — `pg_dump -Fc` fsyncs its output
  # and /dev/null cannot be fsynced ("Invalid argument"), so /dev/null produced a
  # confident false FAIL. A check that cries wolf gets ignored, which is worse
  # than not having one.
  local pgdump_dir tmp
  pgdump_dir="$(dirname "$(command -v pg_dump 2>/dev/null || echo /usr/bin/pg_dump)")"
  tmp="$(mktemp)"

  echo
  echo "simulating cron with the pinned line (backup.sh cron):"
  if env -i HOME="$HOME" PATH="$pgdump_dir:/usr/bin:/bin" PGHOST="$SOCKET_DIR" \
       pg_dump -h "$SOCKET_DIR" -U postgres -d "$DB_NAME" -Fc -f "$tmp" 2>/dev/null; then
    echo "  ok    connects and dumps ($(du -h "$tmp" | cut -f1))"
  else
    echo "  FAIL  the pinned line cannot dump — the cluster may not be reachable"
    problems=$((problems + 1))
  fi

  # And the same thing with NOTHING pinned: a bare cron environment, which is
  # what the original crontab line amounted to. Shown so the difference is
  # visible rather than asserted.
  echo "simulating cron with nothing pinned (the old line):"
  if env -i HOME="$HOME" PATH=/usr/bin:/bin \
       "$ROOT/scripts/backup.sh" dump >/dev/null 2>&1; then
    echo "  ok    also works unpinned (XDG_RUNTIME_DIR is not load-bearing here)"
  else
    local unpinned
    unpinned="/tmp/spatialdb-$(printf '%s' "$ROOT" | cksum | cut -d' ' -f1)"
    echo "  note  fails, as expected — unpinned it looks for the socket in"
    echo "        $unpinned, because XDG_RUNTIME_DIR is unset under cron."
    echo "        This is why the line from 'backup.sh cron' pins PGHOST."
  fi
  rm -f "$tmp"

  case "$SOCKET_DIR" in
    "${XDG_RUNTIME_DIR:-__unset__}"/*)
      echo "  WARN  socket is under XDG_RUNTIME_DIR, which is removed at logout."
      echo "        A scheduled backup cannot outlive your session. See 'backup.sh cron'."
      problems=$((problems + 1))
      ;;
  esac

  # Staleness. A backup job that stopped working three weeks ago looks exactly
  # like one that is working, unless something checks the clock.
  echo
  local newest
  newest="$(ls -t "$BACKUP_DIR"/"$DB_NAME"-*.dump 2>/dev/null | head -1 || true)"
  if [ -z "$newest" ]; then
    echo "  FAIL  no dumps exist yet in $BACKUP_DIR"
    problems=$((problems + 1))
  else
    local age_h
    age_h=$(( ( $(date +%s) - $(stat -c %Y "$newest") ) / 3600 ))
    if [ "$age_h" -le 48 ]; then
      echo "  ok    newest dump is ${age_h}h old ($(basename "$newest"))"
    else
      echo "  FAIL  newest dump is ${age_h}h old — the job is not running"
      problems=$((problems + 1))
    fi
  fi

  echo
  if [ "$problems" -eq 0 ]; then echo "all clear"; else echo "$problems problem(s)"; exit 1; fi
}

case "${1:-}" in
  dump)    cmd_dump ;;
  check)   cmd_check ;;
  list)    cmd_list ;;
  verify)  shift; cmd_verify "$@" ;;
  restore) shift; cmd_restore "$@" ;;
  assets)  cmd_assets ;;
  restore-assets) cmd_restore_assets ;;
  cron)    cmd_cron ;;
  *)       usage; exit 1 ;;
esac
