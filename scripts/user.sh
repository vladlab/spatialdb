#!/usr/bin/env bash
# Create users and reset passwords from a terminal — see src/server/userCli.ts.
#   ./scripts/user.sh add you@example.com "Your Name" admin
#   ./scripts/user.sh passwd you@example.com
#   ./scripts/user.sh list
set -euo pipefail
cd "$(dirname "$0")/.."
export DB_URL="${DB_URL:-$(./scripts/db.sh url)}"
exec npx tsx src/server/userCli.ts "$@"
