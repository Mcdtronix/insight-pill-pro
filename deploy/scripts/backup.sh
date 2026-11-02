#!/usr/bin/env bash
# Nightly database backup. Triggered by pharminsight-backup.timer (runs as `deploy`).
# Model files and code live in each release, so the database is the only state to protect.
set -Eeuo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

db="$(backup_database nightly)"
ok "Database: $db ($(du -h "$db" | cut -f1))"

prune_backups
ok "Backups older than ${BACKUP_RETENTION_DAYS} days pruned"
