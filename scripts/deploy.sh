#!/usr/bin/env bash
# =============================================================================
#  deploy.sh — update a running spatialdb to the latest commit, in the right order
# =============================================================================
#
#    ./scripts/deploy.sh              update if there is anything new
#    ./scripts/deploy.sh --force      rebuild / migrate / restart even if nothing is new
#    ./scripts/deploy.sh --dry-run    say what would happen; change nothing
#
#  Run it AS ROOT, by its full path — typically from your own account:
#
#      sudo /var/lib/spatialdb/app/scripts/deploy.sh
#
#  Root, because the two halves need different people: everything in the checkout is
#  done as the checkout's OWNER (the service's user — root drops to it, no password),
#  and stopping/starting the unit needs root. The service's user usually cannot sudo
#  and has no password, and your own account usually cannot even enter the directory;
#  root is the one identity that can do both. (A user who may `sudo` also works.)
#  If node/git/pg_dump are not installed system-wide on NixOS:
#      sudo nix shell nixpkgs#nodejs_22 nixpkgs#git nixpkgs#postgresql -c /path/to/scripts/deploy.sh
#
#  What it does, and why in this order — see DEPLOY.md §8:
#
#    1. look        fetch; show what is incoming; stop here if nothing is
#    2. back up     BEFORE anything changes. A migration can restructure data; the
#                   dump is how you get back.
#    3. pull        fast-forward only. Local edits on the server are an error, not
#                   something to merge silently.
#    4. install     `npm ci` — exactly the locked dependencies
#    5. build       the frontend, while the OLD server is still serving. If the build
#                   fails, nothing has been touched and nobody noticed.
#    6. stop        the service. Downtime starts here…
#    7. migrate     …because old code must not answer requests against a new schema
#    8. start       …and ends here: a few seconds
#    9. check       /api/health answers, and says which version is now running
#
#  SETTINGS come from the systemd unit itself (`systemctl show`), so there is one
#  place where DB_URL and the assets directory are written down. Override any of them
#  in the environment:
#
#    SERVICE        the unit's name                          (spatialdb)
#    APP_USER       who owns the checkout and runs the app   (the checkout's owner)
#    DB_URL, PORT, SPATIALDB_ASSETS_DIR, SPATIALDB_BACKUP_DIR
#    DEPLOY_NO_SYSTEMD=1   no unit (you run `npm start` by hand): do everything
#                          except stop/start, and tell you to restart it yourself.
#
#  It stops at the first failure and says what state things are in.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FORCE=0; DRY=0
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;; --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $a (try --help)" >&2; exit 2 ;;
  esac
done

SERVICE="${SERVICE:-spatialdb}"
NO_SYSTEMD="${DEPLOY_NO_SYSTEMD:-0}"
APP_USER="${APP_USER:-$(stat -c %U "$ROOT")}"
ME="$(id -un)"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die()  { printf '\n\033[31mFAILED:\033[0m %s\n' "$*" >&2; exit 1; }

# ── settings: from the unit, unless given ───────────────────────────────────
unit_env() {   # unit_env KEY → the value in the unit's Environment=, if any
  [ "$NO_SYSTEMD" = 1 ] && return 0
  systemctl show "$SERVICE" --property=Environment --value 2>/dev/null \
    | tr ' ' '\n' | sed -n "s/^$1=//p" | head -1
}
DB_URL="${DB_URL:-$(unit_env DB_URL)}";               DB_URL="${DB_URL:-postgres:///spatialdb?host=/run/postgresql}"
PORT="${PORT:-$(unit_env PORT)}";                     PORT="${PORT:-8787}"
ASSETS="${SPATIALDB_ASSETS_DIR:-$(unit_env SPATIALDB_ASSETS_DIR)}"
BACKUPS="${SPATIALDB_BACKUP_DIR:-$(unit_env SPATIALDB_BACKUP_DIR)}"

# Everything that touches the checkout runs as the app's user, with OUR PATH (on NixOS
# the tools may come from a `nix shell`, which sudo would otherwise drop).
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
as_app() {
  # HOME matters: npm writes its cache there, and root's HOME is not writable by the app's user.
  local -a envs=("PATH=$PATH" "DB_URL=$DB_URL" "HOME=${APP_HOME:-$ROOT}")
  [ -n "$ASSETS" ]  && envs+=("SPATIALDB_ASSETS_DIR=$ASSETS")
  [ -n "$BACKUPS" ] && envs+=("SPATIALDB_BACKUP_DIR=$BACKUPS")
  if [ "$ME" = "$APP_USER" ]; then env "${envs[@]}" "$@"
  elif [ "$(id -u)" = 0 ]; then runuser -u "$APP_USER" -- env "${envs[@]}" "$@"     # root: no password, no sudo needed
  else sudo -u "$APP_USER" -H env "${envs[@]}" "$@"; fi
}
svc() {
  if [ "$(id -u)" = 0 ]; then systemctl "$@"; return; fi
  sudo -n true 2>/dev/null || [ -t 0 ] || die "restarting $SERVICE needs root, and '$ME' cannot sudo without a password here."
  sudo systemctl "$@"
}

# ── 0. preflight ─────────────────────────────────────────────────────────────
say "Checking"
for tool in git node npm pg_dump; do
  command -v "$tool" >/dev/null 2>&1 || die "'$tool' is not on PATH. On NixOS:  nix shell nixpkgs#nodejs_22 nixpkgs#git nixpkgs#postgresql"
done
if [ "$NO_SYSTEMD" != 1 ]; then
  systemctl cat "$SERVICE" >/dev/null 2>&1 || die "no systemd unit called '$SERVICE'. Set SERVICE=…, or DEPLOY_NO_SYSTEMD=1 if you run the app by hand."
fi
if [ "$NO_SYSTEMD" != 1 ] && [ "$(id -u)" != 0 ] && ! sudo -n true 2>/dev/null && [ "$ME" = "$APP_USER" ]; then
  die "you are '$ME', the service's own user, which cannot restart the service. Run this as root instead, from your own account:
          sudo $ROOT/scripts/deploy.sh"
fi
note "checkout  $ROOT  (runs as $APP_USER)"
note "database  ${DB_URL%%\?*}…   port $PORT"
[ -n "$(as_app git status --porcelain --untracked-files=no)" ] && die "the checkout has local changes (git status). A server's checkout should match the repo exactly — commit them elsewhere, or 'git stash'."

# ── 1. look ──────────────────────────────────────────────────────────────────
say "Looking for updates"
as_app git fetch --quiet
BEFORE="$(as_app git rev-parse --short HEAD)"
UPSTREAM="$(as_app git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)" || die "this branch has no upstream to pull from"
INCOMING="$(as_app git rev-list --count "HEAD..$UPSTREAM")"
note "running $BEFORE; $INCOMING new commit(s) on $UPSTREAM"
[ "$INCOMING" -gt 0 ] && as_app git --no-pager log --oneline "HEAD..$UPSTREAM" | sed 's/^/      /' | head -20
NEW_SQL="$(as_app git diff --name-only "HEAD..$UPSTREAM" -- sql/ | grep -E '^sql/[0-8].*\.sql$' || true)"
[ -n "$NEW_SQL" ] && { note "includes MIGRATIONS:"; printf '%s\n' "$NEW_SQL" | sed 's/^/      /'; }
if [ "$INCOMING" -eq 0 ] && [ "$FORCE" != 1 ]; then note "nothing to do (use --force to rebuild and restart anyway)"; exit 0; fi
if [ "$DRY" = 1 ]; then say "Dry run — would: back up, pull, npm ci, build, stop, migrate, start, check. Nothing was changed."; exit 0; fi

# ── 2. back up ───────────────────────────────────────────────────────────────
say "Backing up (before anything changes)"
as_app ./scripts/backup.sh dump | sed 's/^/    /' \
  || die "the backup failed, so nothing else was attempted: the service is untouched and still running $BEFORE.
        Is Postgres up? Is pg_dump the same major version as the server?  ./scripts/backup.sh check"

# ── 3-5. pull, install, build — the old server is still running ───────────────
say "Pulling"
as_app git pull --ff-only --quiet || die "could not fast-forward. Nothing has been changed; the service is still running the old version."
AFTER="$(as_app git rev-parse --short HEAD)"
note "$BEFORE → $AFTER"

say "Installing dependencies (npm ci)"
as_app npm ci --no-audit --no-fund --loglevel=error || die "npm ci failed. The service is STILL RUNNING the old version, but the checkout is at $AFTER. To go back:  git checkout $BEFORE && npm ci"

say "Building the frontend"
as_app npm run --silent build || die "the build failed. The service is STILL RUNNING the old version ($BEFORE) and its old frontend may be partly replaced — fix the build, or:  git checkout $BEFORE && npm ci && npm run build"

# ── 6-8. the short outage ────────────────────────────────────────────────────
if [ "$NO_SYSTEMD" = 1 ]; then
  say "Migrating  (no systemd unit: STOP the app yourself first if a migration is listed above)"
else
  say "Stopping $SERVICE"
  svc stop "$SERVICE"
  say "Migrating"
fi
if ! as_app npm run --silent migrate | sed 's/^/    /'; then
  die "a migration failed and was rolled back (each file is one transaction; earlier files in this run stay applied).
        The service is STOPPED. The code is at $AFTER. Fix the migration and run this again, or go back:
          git checkout $BEFORE && npm ci && npm run build, restore the dump printed above if a migration already changed data,
          then: sudo systemctl start $SERVICE"
fi

if [ "$NO_SYSTEMD" = 1 ]; then
  say "Done — now restart the app yourself (Ctrl+C in its terminal, then: npm start)"
  exit 0
fi
say "Starting $SERVICE"
svc start "$SERVICE"

# ── 9. check ─────────────────────────────────────────────────────────────────
say "Checking it answers"
for i in $(seq 1 30); do
  if OUT="$(node -e "fetch('http://127.0.0.1:$PORT/api/health').then(r=>r.json()).then(j=>console.log(j.version)).catch(()=>process.exit(1))" 2>/dev/null)"; then
    note "up: version $OUT"
    say "Deployed $BEFORE → $AFTER"
    note "Browsers pick the new build up on their next reload."
    exit 0
  fi
  sleep 1
done
die "the service did not answer on port $PORT within 30s. Look at:  journalctl -u $SERVICE -n 50
        (a 'Refusing to start' line says exactly why; a 503 naming .sql files means the migrate step did not finish.)"
