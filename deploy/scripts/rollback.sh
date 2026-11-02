#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Manual / pipeline rollback. Runs on the VPS as the `deploy` user.
#
#   rollback.sh                            # back to the release before `current`
#   rollback.sh --to 20261102143000-ab12cd3
#   rollback.sh --list                     # show releases and backups
#   rollback.sh --restore-db <file.dump>   # also restore the database (add --to if needed)
#
# Code rollback is instant (symlink switch). Database restore is opt-in because it
# discards data written since the backup was taken.
# -----------------------------------------------------------------------------
set -Eeuo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[[ "$(id -un)" == "deploy" ]] || die "Run as the deploy user."

TARGET=""
DB_DUMP=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --to)          TARGET="${2:?--to needs a release id}"; shift 2 ;;
    --restore-db)  DB_DUMP="${2:?--restore-db needs a .dump file}"; shift 2 ;;
    --list)
      current="$(basename "$(readlink -f "$CURRENT_LINK" 2>/dev/null || echo none)")"
      echo "Releases (oldest -> newest):"
      while read -r r; do
        if [[ "$r" == "$current" ]]; then echo "  * $r   <- current"; else echo "    $r"; fi
      done < <(list_releases)
      echo; echo "Database backups (newest first):"
      find "$BACKUP_ROOT/db" -maxdepth 1 -name '*.dump' -printf '%T@ %f\n' 2>/dev/null \
        | sort -rn | head -n 10 | cut -d' ' -f2- | sed 's/^/    /'
      exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

exec 9>"$APP_ROOT/.deploy.lock"
flock -n 9 || die "A deployment is in progress."

CURRENT="$(readlink -f "$CURRENT_LINK")"
mapfile -t releases < <(list_releases)

if [[ -z "$TARGET" ]]; then
  for ((i = ${#releases[@]} - 1; i >= 0; i--)); do
    if [[ "$RELEASES_DIR/${releases[$i]}" == "$CURRENT" && $i -gt 0 ]]; then
      TARGET="${releases[$((i - 1))]}"
      break
    fi
  done
  [[ -n "$TARGET" ]] || die "No earlier release to roll back to."
fi
TARGET_DIR="$RELEASES_DIR/$TARGET"
[[ -d "$TARGET_DIR" ]] || die "Release not found: $TARGET"

step "Rolling back $(basename "$CURRENT") -> $TARGET"

if [[ -n "$DB_DUMP" ]]; then
  log "Safety backup of the current database first"
  safety="$(backup_database "pre-rollback")"
  ok "Saved: $safety"
  restore_database "$DB_DUMP"
  ok "Database restored from $DB_DUMP"
fi

switch_current "$TARGET_DIR"
restart_services
wait_services_healthy || die "Release $TARGET is not healthy after restart"
verify_live           || die "Live verification failed after rollback"

echo "$TARGET rollback $(date -Is)" >> "$APP_ROOT/logs/releases.log"
ok "Rolled back to $TARGET — https://${DOMAIN} is healthy"
