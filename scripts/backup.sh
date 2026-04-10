#!/usr/bin/env bash
#
# backup.sh — nightly Postgres backup with age encryption and optional B2 upload.
#
# Designed to run as a daily cron on the VPS:
#   0 3 * * * /opt/budget-tracker/scripts/backup.sh >> /var/log/budget-backup.log 2>&1
#
# Environment variables (set in /opt/budget-tracker/.env or export before running):
#   POSTGRES_DB              — database name (required)
#   POSTGRES_USER            — database user (required)
#   BACKUP_DIR               — local backup dir (default: /opt/budget-tracker/backups)
#   BACKUP_RETENTION_DAYS    — days to keep local backups (default: 30)
#   AGE_RECIPIENT            — age public key for encryption (required)
#   B2_BUCKET                — Backblaze B2 bucket name (optional; skips upload if unset)
#   B2_KEY_ID                — B2 application key ID (optional)
#   B2_APP_KEY               — B2 application key (optional)
#   HEALTHCHECKS_PING_URL    — Healthchecks.io ping URL (optional; skips ping if unset)
#   COMPOSE_FILE             — compose file path (default: infra/docker-compose.prod.yml)

set -euo pipefail

POSTGRES_DB="${POSTGRES_DB:?POSTGRES_DB must be set}"
POSTGRES_USER="${POSTGRES_USER:?POSTGRES_USER must be set}"
BACKUP_DIR="${BACKUP_DIR:-/opt/budget-tracker/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
AGE_RECIPIENT="${AGE_RECIPIENT:?AGE_RECIPIENT must be set}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker-compose.prod.yml}"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DUMP_FILE="${BACKUP_DIR}/${POSTGRES_DB}-${TIMESTAMP}.sql.age"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup of ${POSTGRES_DB}..."

# Dump and encrypt in a single pipeline — no unencrypted dump touches disk.
docker compose -f "${COMPOSE_FILE}" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges \
  | age -r "$AGE_RECIPIENT" \
  > "$DUMP_FILE"

DUMP_SIZE=$(stat -f%z "$DUMP_FILE" 2>/dev/null || stat -c%s "$DUMP_FILE" 2>/dev/null)
echo "[$(date)] Dump created: ${DUMP_FILE} (${DUMP_SIZE} bytes)"

# Upload to Backblaze B2 if configured.
if [ -n "${B2_BUCKET:-}" ]; then
  echo "[$(date)] Uploading to B2 bucket: ${B2_BUCKET}..."
  b2 upload-file "$B2_BUCKET" "$DUMP_FILE" "backups/$(basename "$DUMP_FILE")"
  echo "[$(date)] Upload complete."
else
  echo "[$(date)] B2_BUCKET not set — skipping remote upload (local-only backup)."
fi

# Prune old local backups.
echo "[$(date)] Pruning local backups older than ${BACKUP_RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name "*.sql.age" -mtime +"$BACKUP_RETENTION_DAYS" -delete

# Ping Healthchecks.io on success.
if [ -n "${HEALTHCHECKS_PING_URL:-}" ]; then
  curl -fsS -m 10 --retry 3 "$HEALTHCHECKS_PING_URL" > /dev/null
  echo "[$(date)] Healthchecks.io pinged."
fi

echo "[$(date)] Backup complete."
