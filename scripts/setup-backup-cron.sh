#!/usr/bin/env bash
# Install a daily backup cron job for Borderfall production databases.
#
# Usage (on VPS, as root or deploy user with docker access):
#   sudo ./scripts/setup-backup-cron.sh
#   BACKUP_DIR=/var/backups/borderfall CRON_HOUR=3 ./scripts/setup-backup-cron.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKUP_SCRIPT="${REPO_ROOT}/scripts/backup-databases.sh"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/borderfall}"
CRON_HOUR="${CRON_HOUR:-3}"
CRON_USER="${CRON_USER:-$(whoami)}"
LOG_FILE="${LOG_FILE:-/var/log/borderfall-backup.log}"

if [ ! -x "${BACKUP_SCRIPT}" ]; then
  chmod +x "${BACKUP_SCRIPT}"
fi

CRON_LINE="${CRON_HOUR} 0 * * * BACKUP_DIR=${BACKUP_DIR} ${BACKUP_SCRIPT} >> ${LOG_FILE} 2>&1"

mkdir -p "${BACKUP_DIR}"

# Install or replace existing borderfall backup line
( crontab -u "${CRON_USER}" -l 2>/dev/null | grep -v 'backup-databases.sh' || true
  echo "${CRON_LINE}"
) | crontab -u "${CRON_USER}" -

echo "[cron] Installed daily backup at ${CRON_HOUR}:00 for user ${CRON_USER}"
echo "[cron] Backups: ${BACKUP_DIR}"
echo "[cron] Log: ${LOG_FILE}"
echo "[cron] Test now: BACKUP_DIR=${BACKUP_DIR} ${BACKUP_SCRIPT}"
