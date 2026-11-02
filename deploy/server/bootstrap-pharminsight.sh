#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# One-time (idempotent) server provisioning for PharmInsight on
# pharminsight.mcdtronix.co.zw. Shares the VPS with the portfolio and never
# touches its files, database, service or certificate.
#
# Run as root on the VPS from the uploaded deploy/ folder:
#
#   sudo CERTBOT_EMAIL=you@example.com bash server/bootstrap-pharminsight.sh /root/pharminsight_deploy.pub
#
# Safe to re-run: existing secrets, database, certificate and keys are kept.
#
#   1. Preconditions (root, DNS points here, ports free)
#   2. Packages: Nginx, PostgreSQL, Python venv, certbot, Node.js 22
#   3. deploy user + SSH key for GitHub Actions
#   4. Directory layout under /srv/apps/pharminsight
#   5. PostgreSQL role + database, production .env with generated secrets
#   6. systemd services + nightly backup timer, scoped sudoers rule
#   7. Nginx + Let's Encrypt certificate (webroot), final HTTPS site
# -----------------------------------------------------------------------------
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"     # the deploy/ folder
# shellcheck source=../app.conf
source "$HERE/app.conf"

DEPLOY_USER="deploy"
DB_NAME="pharminsight_db"
DB_USER="pharminsight_app"
NODE_MAJOR=22
DEPLOY_PUBKEY_FILE="${1:-}"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
ACME_ROOT="/var/www/letsencrypt"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ✔\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  ⚠\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m  ✖ %s\033[0m\n' "$*"; exit 1; }

# ------------------------------------------------------------ 1. checks -------
log "Preconditions"
[[ $EUID -eq 0 ]] || die "Run as root."
[[ -n "${CERTBOT_EMAIL:-}" ]] || die "Set CERTBOT_EMAIL (Let's Encrypt expiry notices)."

cd /   # keeps `sudo -u postgres` from warning about /root
SERVER_IP="$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i <= NF; i++) if ($i == "src") print $(i + 1)}')"
resolved="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}')"
if [[ "$resolved" == "$SERVER_IP" ]]; then ok "$DOMAIN -> $SERVER_IP"
else die "$DOMAIN resolves to '${resolved:-nothing}', expected $SERVER_IP. Add the DNS A record first."; fi

for port in "$API_PORT" "$API_PREFLIGHT_PORT" "$WEB_PORT" "$WEB_PREFLIGHT_PORT"; do
  owner="$(ss -Hltnp "sport = :$port" 2>/dev/null | grep -o 'users:(("[^"]*' | cut -d'"' -f2 | head -n1 || true)"
  if [[ -n "$owner" ]] && ! systemctl is-active --quiet "$API_SERVICE" "$WEB_SERVICE" 2>/dev/null; then
    die "Port $port is already used by '$owner'. Change the ports in app.conf."
  fi
done
ok "Ports $API_PORT/$WEB_PORT (+ pre-flight $API_PREFLIGHT_PORT/$WEB_PREFLIGHT_PORT) available"

# --------------------------------------------------------- 2. packages --------
log "Packages"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  nginx postgresql postgresql-contrib python3-venv certbot curl rsync ca-certificates gnupg >/dev/null
ok "Nginx, PostgreSQL, Python venv, certbot present"

node_major="$(node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || true)"
if [[ -z "$node_major" || "$node_major" -lt 20 ]]; then
  # NodeSource apt repository, pinned by its signing key (no curl | bash).
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
fi
[[ -x /usr/bin/node ]] || die "Node.js is not at /usr/bin/node (expected by pharminsight-web.service)."
ok "Node.js $(node --version)"

# ---------------------------------------------------- 3. deploy user ----------
log "Deploy user"
if ! id "$DEPLOY_USER" &>/dev/null; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
NGINX_NEEDS_RESTART=0
if ! id -nG www-data | grep -qw "$DEPLOY_USER"; then
  usermod -aG "$DEPLOY_USER" www-data          # Nginx can read releases
  NGINX_NEEDS_RESTART=1                        # workers pick up a new group only on restart
fi
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
AUTH_KEYS="/home/$DEPLOY_USER/.ssh/authorized_keys"
touch "$AUTH_KEYS"
if [[ -n "$DEPLOY_PUBKEY_FILE" ]]; then
  [[ -f "$DEPLOY_PUBKEY_FILE" ]] || die "Public key not found: $DEPLOY_PUBKEY_FILE"
  key="$(head -n1 "$DEPLOY_PUBKEY_FILE")"
  [[ "$key" == ssh-ed25519\ * ]] || die "Expected an ssh-ed25519 PUBLIC key."
  if ! grep -qF "$key" "$AUTH_KEYS"; then
    # `restrict` = no PTY, no port/agent/X11 forwarding. Commands and scp still work.
    echo "restrict $key" >> "$AUTH_KEYS"
    ok "GitHub Actions key installed (restricted)"
  else
    ok "GitHub Actions key already installed"
  fi
fi
chown "$DEPLOY_USER:$DEPLOY_USER" "$AUTH_KEYS"; chmod 600 "$AUTH_KEYS"

# ------------------------------------------------------- 4. directories -------
log "Directory layout"
install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /srv/apps
for d in "" releases shared venvs incoming bin logs; do
  install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_ROOT/$d"
done
install -d -m 711 -o root -g root /var/backups/apps                # traverse only
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BACKUP_ROOT"
install -d -m 755 "$ACME_ROOT"

# Deploy scripts (CI refreshes them on every deploy).
install -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$HERE"/scripts/*.sh "$APP_ROOT/bin/"
install -m 640 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$HERE/app.conf" "$APP_ROOT/bin/app.conf"
ok "$APP_ROOT ready"

# ------------------------------------------------ 5. database + secrets -------
log "PostgreSQL and production secrets"
ENV_FILE="$APP_ROOT/shared/.env"
role_exists="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'")"

if [[ -f "$ENV_FILE" && "$role_exists" == "1" ]]; then
  ok "Existing $ENV_FILE and database role kept"
else
  db_password="$(openssl rand -hex 24)"
  secret_key="$(openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c 64)"

  # Password goes through stdin, never argv / shell history.
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
\\set pw '${db_password}'
SELECT format('CREATE ROLE %I LOGIN', '${DB_USER}')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}') \\gexec
ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD :'pw';
SELECT format('CREATE DATABASE %I OWNER %I ENCODING ''UTF8'' TEMPLATE template0', '${DB_NAME}', '${DB_USER}')
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}') \\gexec
REVOKE ALL ON DATABASE ${DB_NAME} FROM PUBLIC;
SQL

  umask 077
  cat > "$ENV_FILE" <<ENV
# Production settings for ${DOMAIN}. Generated $(date -Is). Never commit.
DJANGO_SECRET_KEY=${secret_key}
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=${DOMAIN},127.0.0.1,localhost
CSRF_TRUSTED_ORIGINS=https://${DOMAIN}
CORS_ALLOWED_ORIGINS=https://${DOMAIN}

# TLS ends at Nginx, which redirects HTTP and sends HSTS.
SECURE_SSL_REDIRECT=false
BEHIND_PROXY=true

POSTGRES_DB=${DB_NAME}
POSTGRES_USER=${DB_USER}
POSTGRES_PASSWORD=${db_password}
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432

# Demonstration mode: the 2024 datasets behave as a live pharmacy on 31 Dec 2024.
# Remove both lines when the system runs on real, current data.
DSS_DEMO_DATE=2024-12-31
DSS_ALLOW_DEMO_DATE=true

DSS_PRELOAD_MODELS=true
GUNICORN_WORKERS=2
LOG_LEVEL=INFO
ENV
  umask 022
  ok "Database ${DB_NAME} / role ${DB_USER} ready, secrets written to $ENV_FILE"
fi
chown "$DEPLOY_USER:$DEPLOY_USER" "$ENV_FILE"; chmod 600 "$ENV_FILE"

# ------------------------------------------------ 6. systemd + sudoers --------
log "systemd units and sudoers"
for unit in pharminsight-api.service pharminsight-web.service pharminsight-backup.service pharminsight-backup.timer; do
  install -m 644 "$HERE/systemd/$unit" /etc/systemd/system/
done
systemctl daemon-reload
systemctl enable "$API_SERVICE" "$WEB_SERVICE" >/dev/null       # started by the first deploy
systemctl enable --now pharminsight-backup.timer >/dev/null

visudo -cf "$HERE/server/sudoers-deploy-pharminsight" >/dev/null || die "sudoers file invalid"
install -m 440 -o root -g root "$HERE/server/sudoers-deploy-pharminsight" /etc/sudoers.d/deploy-pharminsight
ok "Services enabled, nightly backup timer active, sudo scoped to restarting the two services"

# --------------------------------------------------- 7. nginx + TLS -----------
log "Nginx and TLS"
# Shared snippets: install only if missing, so the portfolio's copies are never overwritten.
for snippet in ssl-params.conf security-headers.conf; do
  [[ -f "/etc/nginx/snippets/$snippet" ]] || install -m 644 "$HERE/nginx/snippets/$snippet" /etc/nginx/snippets/
done
install -m 644 "$HERE/nginx/snippets/pharminsight-api-proxy.conf" /etc/nginx/snippets/

if [[ ! -f "$CERT_DIR/fullchain.pem" ]]; then
  # Temporary HTTP-only site so Let's Encrypt can validate the subdomain.
  cat > /etc/nginx/sites-available/acme-pharminsight.conf <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    location ^~ /.well-known/acme-challenge/ { root ${ACME_ROOT}; default_type text/plain; }
    location / { return 404; }
}
NGINX
  ln -sfn /etc/nginx/sites-available/acme-pharminsight.conf /etc/nginx/sites-enabled/acme-pharminsight.conf
  nginx -t && systemctl reload nginx

  certbot certonly --webroot -w "$ACME_ROOT" -d "$DOMAIN" \
    --email "$CERTBOT_EMAIL" --agree-tos --no-eff-email --non-interactive \
    --deploy-hook "systemctl reload nginx"

  rm -f /etc/nginx/sites-enabled/acme-pharminsight.conf /etc/nginx/sites-available/acme-pharminsight.conf
  ok "Certificate issued for $DOMAIN"
else
  ok "Certificate already present"
fi

install -m 644 "$HERE/nginx/${DOMAIN}.conf" "/etc/nginx/sites-available/${DOMAIN}.conf"
ln -sfn "/etc/nginx/sites-available/${DOMAIN}.conf" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
nginx -t
if [[ $NGINX_NEEDS_RESTART == 1 ]]; then systemctl restart nginx; else systemctl reload nginx; fi
ok "Nginx site enabled (the portfolio keeps running)"

# ---------------------------------------------------------------- done --------
cat <<DONE

$(printf '\033[1;32m')Server is ready for the first PharmInsight deployment.$(printf '\033[0m')

Add these secrets to the insight-pill-pro GitHub repository
(Settings -> Secrets and variables -> Actions):

  VPS_HOST         ${SERVER_IP}
  VPS_USER         ${DEPLOY_USER}
  VPS_SSH_KEY      contents of the PRIVATE key matching ${DEPLOY_PUBKEY_FILE:-<your deploy key>.pub}
  VPS_KNOWN_HOSTS  the line below:

$(ssh-keyscan -t ed25519 localhost 2>/dev/null | sed "s/^localhost/${SERVER_IP}/")

Then push to main — or run the workflow manually — to deploy.
DONE
