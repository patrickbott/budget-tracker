#!/usr/bin/env bash
#
# deploy.sh — deploy budget-tracker to the production VPS.
#
# Usage:
#   ./scripts/deploy.sh                    # Standard deploy (pull + rebuild + restart)
#   ./scripts/deploy.sh --first-run        # First deploy: also runs migrations
#
# Environment variables (set in shell or .env):
#   VPS_HOST          — VPS hostname or IP (required)
#   VPS_USER          — SSH user (default: deploy)
#   SSH_KEY           — path to SSH private key (default: ~/.ssh/id_ed25519)
#   DEPLOY_PATH       — path on VPS (default: /opt/budget-tracker)
#   COMPOSE_FILE      — compose file relative to DEPLOY_PATH (default: infra/docker-compose.prod.yml)

set -euo pipefail

VPS_HOST="${VPS_HOST:?VPS_HOST must be set}"
VPS_USER="${VPS_USER:-deploy}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/budget-tracker}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker-compose.prod.yml}"
FIRST_RUN=false

for arg in "$@"; do
  case "$arg" in
    --first-run) FIRST_RUN=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new ${VPS_USER}@${VPS_HOST}"

echo "==> Deploying to ${VPS_USER}@${VPS_HOST}:${DEPLOY_PATH}"

# Pull latest code
echo "==> Pulling latest code..."
$SSH_CMD "cd ${DEPLOY_PATH} && git pull origin main"

# First-run: run database migrations before starting the app
if [ "$FIRST_RUN" = true ]; then
  echo "==> First run: running database migrations..."
  $SSH_CMD "cd ${DEPLOY_PATH} && docker compose -f ${COMPOSE_FILE} run --rm app npx drizzle-kit migrate"
fi

# Build and restart containers
echo "==> Building and restarting containers..."
$SSH_CMD "cd ${DEPLOY_PATH} && docker compose -f ${COMPOSE_FILE} up -d --build"

# Wait for the app to be ready
echo "==> Waiting for app to start..."
sleep 5

# Health check
echo "==> Running health check..."
$SSH_CMD "curl -sf http://localhost:3000/api/health || (echo 'Health check failed!' && exit 1)"

echo "==> Deploy complete!"
echo "    Check logs: ssh ${VPS_USER}@${VPS_HOST} 'cd ${DEPLOY_PATH} && docker compose -f ${COMPOSE_FILE} logs --tail=50 -f'"
