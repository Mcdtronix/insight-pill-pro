#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Load a data snapshot (made locally with `manage.py export_data`) into the live
# PostgreSQL database. Runs on the VPS as the `deploy` user.
#
#   load-data.sh /tmp/pharminsight-data.json.gz            # validate, back up, import, test
#   load-data.sh /tmp/pharminsight-data.json.gz --dry-run  # validate only, change nothing
#
#   1. Dry-run the import (checksum, schema version, counts) — nothing changes yet
#   2. Back up the current database (verified pg_dump)
#   3. Import in ONE transaction, replacing the existing application data
#   4. Restart the API (clears in-memory caches) and run the smoke test + live checks
#   5. If step 4 fails, restore the step-2 backup automatically
# -----------------------------------------------------------------------------
set -Eeuo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SNAPSHOT="${1:-}"
MODE="${2:-}"
[[ -n "$SNAPSHOT" && -f "$SNAPSHOT" ]] || die "Usage: load-data.sh <snapshot.json.gz> [--dry-run]"
[[ "$(id -un)" == "deploy" ]] || die "Run as the deploy user."
CURRENT="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
[[ -d "$CURRENT" ]] || die "Nothing is deployed yet — run the first deployment before loading data."

exec 9>"$APP_ROOT/.deploy.lock"
flock -n 9 || die "A deployment is in progress."

step "1/4 Validate snapshot (dry run)"
manage "$CURRENT" import_data "$SNAPSHOT" --replace --dry-run
if [[ "$MODE" == "--dry-run" ]]; then ok "Snapshot is valid. Nothing was changed."; exit 0; fi

step "2/4 Back up the current database"
BACKUP_FILE="$(backup_database pre-data-load)" || die "Backup failed — nothing was changed"
ok "Backup: $BACKUP_FILE"

step "3/4 Import"
manage "$CURRENT" import_data "$SNAPSHOT" --replace

step "4/4 Restart and verify"
if sudo -n /usr/bin/systemctl restart "$API_SERVICE" \
   && wait_until 30 health_ok "http://127.0.0.1:${API_PORT}" \
   && manage "$CURRENT" smoke_test \
   && verify_live; then
  ok "Data loaded and https://${DOMAIN} is healthy"
else
  err "Checks failed after the import — restoring $BACKUP_FILE"
  restore_database "$BACKUP_FILE"
  sudo -n /usr/bin/systemctl restart "$API_SERVICE"
  wait_until 30 health_ok "http://127.0.0.1:${API_PORT}" && ok "Previous data restored" \
    || err "API unhealthy after restore — manual intervention required"
  exit 1
fi
