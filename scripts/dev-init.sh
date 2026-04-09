#!/usr/bin/env bash
#
# Bootstraps the local development stack:
#   1. Starts Postgres via docker-compose.dev.yml
#   2. Waits until the DB is healthy
#   3. Runs pnpm migrations against the @budget-tracker/db workspace
#   4. Runs the dev seed script
#
# Usage (from anywhere in the repo):
#   bash scripts/dev-init.sh
#
# Windows users: run this via Git Bash or WSL.
# macOS / Linux: direct execution works once the file is chmod +x.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE_FILE="infra/docker-compose.dev.yml"
DB_URL="postgres://budget:budget@localhost:5432/budget_tracker"

echo "→ Starting Postgres via ${COMPOSE_FILE}..."
docker compose -f "$COMPOSE_FILE" up -d postgres

echo "→ Waiting for Postgres to be healthy..."
until docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U budget >/dev/null 2>&1; do
  printf '.'
  sleep 1
done
echo
echo "→ Postgres is ready."

echo "→ Running migrations (@budget-tracker/db)..."
DATABASE_URL="$DB_URL" pnpm --filter @budget-tracker/db run db:migrate

echo "→ Seeding dev data (@budget-tracker/db)..."
DATABASE_URL="$DB_URL" pnpm --filter @budget-tracker/db run db:seed

echo
echo "✓ Dev stack ready."
echo "  Next steps:"
echo "    pnpm --filter @budget-tracker/web dev"
