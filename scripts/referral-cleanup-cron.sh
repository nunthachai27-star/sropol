#!/usr/bin/env bash
# Weekly referral cleanup — applies scripts/cleanup-stuck-referrals-2026-07-20.sql
# (evidence-based ARRIVED backfill + >30d no-evidence EXPIRED close-out).
# The SQL is idempotent and audit-logged, so re-running weekly only settles
# rows that have newly aged out of the live sync's matching window.
#
# Installed in the operator crontab (2026-07-20):
#   30 3 * * 0 /home/manoi/docker/kk-lrms/scripts/referral-cleanup-cron.sh
# Log: logs/referral-cleanup.log (gitignored, trimmed to the last 2000 lines).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_DIR/logs"
LOG_FILE="$LOG_DIR/referral-cleanup.log"
SQL_FILE="$REPO_DIR/scripts/cleanup-stuck-referrals-2026-07-20.sql"

mkdir -p "$LOG_DIR"

{
  echo "════ referral-cleanup run: $(date -Iseconds) ════"
  if docker exec -i kk-lrms-postgres-1 psql -U kklrms -d kklrms \
      -v apply=1 -f - < "$SQL_FILE"; then
    echo "── run OK: $(date -Iseconds)"
  else
    echo "── run FAILED (exit $?): $(date -Iseconds)"
  fi
} >> "$LOG_FILE" 2>&1

# Keep the log bounded.
tail -n 2000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
