#!/usr/bin/env bash
# Shared helpers for deploy.sh, rollback.sh, backup.sh and load-data.sh. Sourced, never executed.
# shellcheck disable=SC2034  # variables are consumed by the scripts that source this file

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# app.conf sits next to the scripts on the server, one level up in the repo.
if [[ -f "$SCRIPT_DIR/app.conf" ]]; then
  # shellcheck source=../app.conf
  source "$SCRIPT_DIR/app.conf"
else
  # shellcheck source=../app.conf
  source "$SCRIPT_DIR/../app.conf"
fi

RELEASES_DIR="$APP_ROOT/releases"
SHARED_DIR="$APP_ROOT/shared"
VENVS_DIR="$APP_ROOT/venvs"
CURRENT_LINK="$APP_ROOT/current"
ENV_FILE="$SHARED_DIR/.env"

# ---------------------------------------------------------------- logging ----

log()  { printf '\033[1;34m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
ok()   { printf '\033[1;32m[%s] ✔ %s\033[0m\n' "$(date +%H:%M:%S)" "$*" >&2; }
warn() { printf '\033[1;33m[%s] ⚠ %s\033[0m\n' "$(date +%H:%M:%S)" "$*" >&2; }
err()  { printf '\033[1;31m[%s] ✖ %s\033[0m\n' "$(date +%H:%M:%S)" "$*" >&2; }
step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

# ------------------------------------------------------------ environment ----

# Read one KEY from shared/.env without sourcing it (values may hold shell metacharacters).
env_get() {
  local value
  value="$(sed -n "s/^${1}=//p" "$ENV_FILE" | tail -n1)"
  value="${value%\"}"; value="${value#\"}"
  printf '%s' "$value"
}

load_db_env() {
  [[ -r "$ENV_FILE" ]] || die "Missing $ENV_FILE — run bootstrap-pharminsight.sh first."
  DB_NAME="$(env_get POSTGRES_DB)"
  DB_USER="$(env_get POSTGRES_USER)"
  DB_HOST="$(env_get POSTGRES_HOST)"; DB_HOST="${DB_HOST:-127.0.0.1}"
  DB_PORT="$(env_get POSTGRES_PORT)"; DB_PORT="${DB_PORT:-5432}"
  PGPASSWORD="$(env_get POSTGRES_PASSWORD)"
  export PGPASSWORD
}

# manage RELEASE_DIR args... — run manage.py inside a given release.
manage() {
  local release="$1"; shift
  (cd "$release/backend" && .venv/bin/python manage.py "$@")
}

# ---------------------------------------------------------------- backups ----

# Dump the database in custom format and prove the dump is readable.
# Prints the dump path on stdout.
backup_database() {
  local label="$1" dir file
  load_db_env
  dir="$BACKUP_ROOT/db"
  mkdir -p "$dir" && chmod 700 "$dir"
  file="$dir/${APP_NAME}-$(date +%Y%m%d-%H%M%S)-${label}.dump"

  pg_dump --host "$DB_HOST" --port "$DB_PORT" --username "$DB_USER" --dbname "$DB_NAME" \
          --format custom --no-owner --file "$file.partial" \
    || { rm -f "$file.partial"; return 1; }
  pg_restore --list "$file.partial" >/dev/null || { rm -f "$file.partial"; return 1; }
  mv "$file.partial" "$file"
  chmod 600 "$file"
  printf '%s' "$file"
}

restore_database() {
  local file="$1"
  [[ -f "$file" ]] || die "Backup not found: $file"
  load_db_env
  pg_restore --host "$DB_HOST" --port "$DB_PORT" --username "$DB_USER" --dbname "$DB_NAME" \
             --clean --if-exists --no-owner --single-transaction "$file"
}

prune_backups() {
  find "$BACKUP_ROOT" -type f -name '*.dump' -mtime +"$BACKUP_RETENTION_DAYS" -print -delete >&2 || true
}

# ----------------------------------------------------------- health checks ---

# http_code URL [curl args...] — prints the HTTP status (000 when unreachable).
http_code() {
  local url="$1"; shift
  curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$@" "$url" 2>/dev/null || printf '000'
}

# health_ok BASE_URL [curl args...] — API up, database reachable, model files present.
health_ok() {
  local base="$1"; shift
  curl -fsS --max-time 10 "$@" "${base}${HEALTH_PATH}" 2>/dev/null | grep -Eq '"status": ?"ok"'
}

# wait_until TRIES FUNCTION ARGS... — retry every 2 s.
wait_until() {
  local tries="$1"; shift
  local i
  for ((i = 1; i <= tries; i++)); do
    "$@" && return 0
    sleep 2
  done
  return 1
}

# api_checks BASE_URL [curl args...] — health + anonymous request is refused (auth is wired).
api_checks() {
  local base="$1"; shift
  local code
  health_ok "$base" "$@" || { err "API health check failed: ${base}${HEALTH_PATH}"; return 1; }
  code="$(http_code "${base}${AUTH_GUARD_PATH}" "$@")"
  [[ "$code" == "401" ]] || { err "Expected 401 from ${AUTH_GUARD_PATH} without a token, got $code"; return 1; }
}

# page_ok URL [curl args...] — 200 and an HTML document.
page_ok() {
  local url="$1"; shift
  local html
  # Streamed SSR output can contain NUL bytes; strip them before matching.
  html="$(curl -fsS --max-time 15 "$@" "$url" 2>/dev/null | tr -d '\000')" || return 1
  grep -qi '<html' <<<"$html"
}

# web_checks BASE_URL [curl args...] — every key page server-renders and its JS bundle exists.
web_checks() {
  local base="$1"; shift
  local path html asset
  for path in $PAGE_PATHS; do
    page_ok "${base}${path}" "$@" || { err "Page failed: ${path}"; return 1; }
  done
  html="$(curl -fsS --max-time 15 "$@" "${base}/login" | tr -d '\000')" || return 1
  asset="$(grep -o '/assets/[^"]*\.js' <<<"$html" | head -n1)"
  [[ -n "$asset" ]] || { err "No JS bundle referenced by /login"; return 1; }
  [[ "$(http_code "${base}${asset}" "$@")" == "200" ]] || { err "Bundle missing: $asset"; return 1; }
}

# verify_live — the full path users take: Nginx + TLS on this host (no DNS dependency).
verify_live() {
  local resolve=(--resolve "${DOMAIN}:443:127.0.0.1")
  local base="https://${DOMAIN}"
  wait_until 15 health_ok "$base" "${resolve[@]}" || { err "Health check failed via Nginx"; return 1; }
  api_checks "$base" "${resolve[@]}"              || return 1
  web_checks "$base" "${resolve[@]}"              || return 1
}

# ---------------------------------------------------------------- releases ---

# Atomically point `current` at a release.
switch_current() {
  ln -sfn "$1" "$CURRENT_LINK.tmp"
  mv -Tf "$CURRENT_LINK.tmp" "$CURRENT_LINK"
}

restart_services() {
  sudo -n /usr/bin/systemctl restart "$API_SERVICE"
  sudo -n /usr/bin/systemctl restart "$WEB_SERVICE"
}

# wait_services_healthy — both live services answer on their local ports.
wait_services_healthy() {
  wait_until 30 health_ok "http://127.0.0.1:${API_PORT}" || { err "$API_SERVICE is not healthy"; return 1; }
  wait_until 15 page_ok "http://127.0.0.1:${WEB_PORT}/login" || { err "$WEB_SERVICE is not serving pages"; return 1; }
}

# Releases sorted oldest -> newest (names start with a timestamp).
list_releases() {
  find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d ! -name '*.failed' -printf '%f\n' | sort
}
