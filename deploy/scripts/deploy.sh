#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# PharmInsight release deploy. Runs on the VPS as the `deploy` user.
#
#   deploy.sh /srv/apps/pharminsight/incoming/release-<sha>.tar.gz
#
# Pipeline
#   1. Unpack the release into releases/<timestamp>-<sha>/
#   2. Build (or reuse) the Python virtualenv, Django deploy checks, static files
#   3. Back up the database (verified pg_dump)
#   4. Apply migrations (only if any are pending)
#   5. Pre-flight: boot the NEW API and web server on private ports while the
#      current release keeps serving users, then test them:
#        API  — health (DB + model files), auth guard, read-only smoke test of
#               every main endpoint as a real user against the live data
#        Web  — key pages server-render, JS bundle is present
#   6. Atomically switch `current`, restart both services
#   7. Verify through Nginx + TLS exactly as a user would reach the site
#   8. Prune old releases, virtualenvs, backups
#
# Any failure from step 4 onwards rolls back automatically:
#   database restored from the step-3 backup (if migrations ran),
#   `current` pointed back at the previous release, services restarted and re-verified.
# -----------------------------------------------------------------------------
set -Eeuo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

TARBALL="${1:-}"
[[ -n "$TARBALL" && -f "$TARBALL" ]] || die "Usage: deploy.sh <release.tar.gz>"
[[ "$(id -un)" == "deploy" ]] || die "Run as the deploy user."

# One deploy (or rollback, or data load) at a time.
exec 9>"$APP_ROOT/.deploy.lock"
flock -n 9 || die "Another deployment is in progress."

mkdir -p "$APP_ROOT/logs"
DEPLOY_LOG="$APP_ROOT/logs/deploy-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$DEPLOY_LOG") 2>&1

REVISION="$(tar -xzOf "$TARBALL" ./REVISION | tr -d '[:space:]')"
[[ "$REVISION" =~ ^[0-9a-f]{7,40}$ ]] || die "Release has no valid REVISION file."
RELEASE_ID="$(date +%Y%m%d%H%M%S)-${REVISION:0:7}"
NEW_RELEASE="$RELEASES_DIR/$RELEASE_ID"
PREV_RELEASE="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
[[ -d "$PREV_RELEASE" ]] || PREV_RELEASE=""

STAGE="prepare"       # prepare -> migrated -> switched -> done
BACKUP_FILE=""
MIGRATIONS_APPLIED=0
API_PREFLIGHT_PID=""
WEB_PREFLIGHT_PID=""

# ---------------------------------------------------------------- rollback ---

stop_preflight() {
  local pid
  for pid in "$API_PREFLIGHT_PID" "$WEB_PREFLIGHT_PID"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  API_PREFLIGHT_PID=""; WEB_PREFLIGHT_PID=""
}

fail() {
  trap - ERR
  set +e
  err "DEPLOY FAILED (stage: $STAGE): $*"
  stop_preflight

  if [[ "$STAGE" != "prepare" && -z "$PREV_RELEASE" ]]; then
    # First deployment: nothing to roll back to. Keep the schema and release in place
    # so the next run (after fixing the cause) starts from here.
    warn "First deployment: no previous release — leaving $RELEASE_ID in place for diagnosis."
    err "Log: $DEPLOY_LOG"
    exit 1
  fi

  if [[ "$STAGE" != "prepare" ]]; then
    step "Automatic rollback"

    if [[ "$MIGRATIONS_APPLIED" == 1 && -n "$BACKUP_FILE" ]]; then
      log "Restoring database from $BACKUP_FILE"
      if restore_database "$BACKUP_FILE"; then ok "Database restored"
      else err "Database restore FAILED — restore manually: rollback.sh --restore-db $BACKUP_FILE"; fi
    fi

    if [[ "$STAGE" == "switched" ]]; then
      switch_current "$PREV_RELEASE"
      log "Re-pointed current -> $(basename "$PREV_RELEASE")"
    fi
    restart_services
    if wait_services_healthy && verify_live; then
      ok "Previous release $(basename "$PREV_RELEASE") is serving and healthy"
    else
      err "Previous release is NOT healthy — manual intervention required"
    fi
  fi

  if [[ -d "$NEW_RELEASE" ]]; then
    mv "$NEW_RELEASE" "$NEW_RELEASE.failed" 2>/dev/null
    log "Failed release kept for inspection: $NEW_RELEASE.failed"
  fi
  err "Log: $DEPLOY_LOG"
  exit 1
}
trap 'fail "unexpected error on line $LINENO"' ERR
trap stop_preflight EXIT

# ------------------------------------------------------------------ steps ----

step "Deploying ${APP_NAME} ${REVISION:0:7} as ${RELEASE_ID}"
log "Previous release: ${PREV_RELEASE:-<none>}"

step "1/8 Unpack release"
mkdir -p "$NEW_RELEASE"
tar -xzf "$TARBALL" -C "$NEW_RELEASE"
[[ -f "$NEW_RELEASE/backend/manage.py" && -f "$NEW_RELEASE/web/server/index.mjs" \
   && -d "$NEW_RELEASE/ml/Demand" && -d "$NEW_RELEASE/web/public/assets" ]] \
  || fail "Release archive is incomplete"
ln -sfn "$ENV_FILE" "$NEW_RELEASE/backend/.env"
ok "Unpacked"

step "2/8 Python environment, checks, static files"
PY_TAG="$(python3 -c 'import sys; print(f"{sys.version_info[0]}{sys.version_info[1]}")')"
REQ_HASH="$(sha256sum "$NEW_RELEASE/backend/requirements.txt" | cut -c1-16)-py${PY_TAG}"
VENV="$VENVS_DIR/$REQ_HASH"
if [[ -f "$VENV/.ready" ]]; then
  log "Reusing virtualenv $REQ_HASH (requirements unchanged)"
else
  log "Building virtualenv $REQ_HASH (scikit-learn, pandas… takes a few minutes the first time)"
  rm -rf "$VENV"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --disable-pip-version-check --no-input --upgrade pip
  "$VENV/bin/pip" install --quiet --disable-pip-version-check --no-input \
      -r "$NEW_RELEASE/backend/requirements.txt"
  touch "$VENV/.ready"
fi
ln -sfn "$VENV" "$NEW_RELEASE/backend/.venv"

manage "$NEW_RELEASE" check --deploy --fail-level ERROR
manage "$NEW_RELEASE" collectstatic --noinput --clear --verbosity 0
ok "Build ready"

step "3/8 Database backup"
BACKUP_FILE="$(backup_database "pre-${RELEASE_ID}")" || fail "Database backup failed — aborting before any change"
ok "Backup: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

step "4/8 Migrations"
STAGE="migrated"
if manage "$NEW_RELEASE" migrate --check >/dev/null 2>&1; then
  log "No pending migrations"
else
  manage "$NEW_RELEASE" migrate --noinput
  MIGRATIONS_APPLIED=1
  ok "Migrations applied"
fi

step "5/8 Pre-flight test of the new release (API :${API_PREFLIGHT_PORT}, web :${WEB_PREFLIGHT_PORT})"
(cd "$NEW_RELEASE/backend" && exec .venv/bin/gunicorn config.wsgi:application \
    -c config/gunicorn.conf.py --bind "127.0.0.1:${API_PREFLIGHT_PORT}" --workers 1 \
    --log-level warning --access-logfile /dev/null) &
API_PREFLIGHT_PID=$!
(cd "$NEW_RELEASE/web" && PORT="$WEB_PREFLIGHT_PORT" HOST=127.0.0.1 NODE_ENV=production \
    exec node server/index.mjs >/dev/null) &
WEB_PREFLIGHT_PID=$!

wait_until 45 health_ok "http://127.0.0.1:${API_PREFLIGHT_PORT}" || fail "New API failed its health check"
api_checks "http://127.0.0.1:${API_PREFLIGHT_PORT}"              || fail "New API failed its checks"
manage "$NEW_RELEASE" smoke_test --allow-empty                   || fail "New API failed the smoke test"
wait_until 15 page_ok "http://127.0.0.1:${WEB_PREFLIGHT_PORT}/login" || fail "New web server did not start"
web_checks "http://127.0.0.1:${WEB_PREFLIGHT_PORT}"              || fail "New web server failed its checks"
stop_preflight
ok "New release passed pre-flight"

step "6/8 Go live"
STAGE="switched"
switch_current "$NEW_RELEASE"
restart_services
wait_services_healthy || fail "Services did not become healthy after restart"
ok "current -> $RELEASE_ID"

step "7/8 Verify through Nginx + TLS"
verify_live || fail "Live verification failed"
ok "https://${DOMAIN} is healthy"
STAGE="done"

step "8/8 Housekeeping"
mapfile -t releases < <(list_releases)
excess=$(( ${#releases[@]} - KEEP_RELEASES ))
for ((i = 0; i < excess; i++)); do
  candidate="$RELEASES_DIR/${releases[$i]}"
  if [[ "$candidate" != "$NEW_RELEASE" && "$candidate" != "$PREV_RELEASE" ]]; then
    rm -rf "$candidate"
    log "Removed old release ${releases[$i]}"
  fi
done
find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -name '*.failed' -mtime +7 -exec rm -rf {} +

# Drop virtualenvs no remaining release uses.
for venv in "$VENVS_DIR"/*/; do
  [[ -d "$venv" ]] || continue
  venv="${venv%/}"
  in_use=0
  for rel in "$RELEASES_DIR"/*/backend/.venv; do
    if [[ "$(readlink -f "$rel")" == "$venv" ]]; then in_use=1; break; fi
  done
  if [[ $in_use == 0 ]]; then
    rm -rf "$venv"
    log "Removed unused virtualenv $(basename "$venv")"
  fi
done

prune_backups
rm -f "$TARBALL"
find "$APP_ROOT/logs" -name 'deploy-*.log' -mtime +30 -delete

echo "$RELEASE_ID ${REVISION} $(date -Is)" >> "$APP_ROOT/logs/releases.log"
ok "Deployed ${REVISION:0:7} successfully"
