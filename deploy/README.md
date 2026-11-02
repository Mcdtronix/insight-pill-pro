# PharmInsight — Production Deployment Runbook

**Target:** `https://pharminsight.mcdtronix.co.zw` on the Contabo VPS `173.249.26.101` (Ubuntu 24.04), next to the portfolio
**Stack:** TanStack Start SSR on Node 22 · Django REST API + 4 ML models on Gunicorn · PostgreSQL · Nginx + Let's Encrypt
**Delivery:** GitHub Actions → SSH (restricted `deploy` user) → atomic release with backup, pre-flight test and automatic rollback

---

## 1. Architecture

```
              git push
                 │
   ┌─────────────▼──────────────────────────────┐
   │ GitHub Actions  (every branch and PR)      │
   │  backend  : migrations check, deploy check,│
   │             43 tests on PostgreSQL         │
   │  frontend : lint, type check, SSR build,   │
   │             boot server + render pages     │
   │  scripts  : shellcheck                     │
   │ ── main only ───────────────────────────── │
   │  package  : release.tar.gz                 │
   │  deploy   : scp + deploy.sh                │
   │  verify   : public HTTPS check ────────────┼──► fails → rollback.sh
   └─────────────┬──────────────────────────────┘
                 │ SSH (key, pinned host key)
   ┌─────────────▼───────────────────────────────────────────────┐
   │ VPS                                                          │
   │  Nginx :443 ─ /assets/        → current/web/public (static)  │
   │             ├ /api/, /admin/  → Gunicorn 127.0.0.1:8003      │
   │             ├ /static/        → current/backend/staticfiles  │
   │             └ everything else → Node SSR 127.0.0.1:3003      │
   │  PostgreSQL (localhost only) · nightly backup 02:45          │
   │  Portfolio keeps 8001 / 8091 — nothing shared but Nginx + PG │
   └──────────────────────────────────────────────────────────────┘
```

### Server layout

```
/srv/apps/pharminsight/
├── current -> releases/20261102143000-ab12cd3   # atomic symlink: what is live
├── releases/<timestamp>-<sha>/                  # last 5 kept for instant rollback
│   ├── REVISION
│   ├── backend/   (.env -> shared/.env, .venv -> venvs/<hash>)
│   ├── ml/        Demand/, Reorder/, supplier/, data/   (models + datasets)
│   └── web/       server/index.mjs, public/assets/      (Node SSR build)
├── shared/.env                                  # production secrets (600, never in git)
├── venvs/<requirements-hash>-py312/             # reused while requirements.txt is unchanged
├── bin/                                         # deploy.sh, rollback.sh, backup.sh, load-data.sh, lib.sh, app.conf
├── incoming/                                    # uploaded release archives
└── logs/                                        # deploy-*.log, releases.log

/var/backups/apps/pharminsight/db/               # pg_dump (custom format), 14 days
```

### Repository layout

| Path | Purpose |
|---|---|
| `.github/workflows/deploy.yml` | CI on every push and PR, CI + CD on every push to `main` |
| `deploy/app.conf` | The only per-app settings (domain, ports, paths, checks) |
| `deploy/scripts/deploy.sh` | Server-side release pipeline with automatic rollback |
| `deploy/scripts/rollback.sh` | Manual rollback (code, and optionally database) |
| `deploy/scripts/load-data.sh` | Load a data snapshot into production, with backup and auto-restore |
| `deploy/scripts/backup.sh` | Nightly database backup |
| `deploy/server/bootstrap-pharminsight.sh` | One-time, idempotent server provisioning |
| `deploy/nginx/`, `deploy/systemd/` | Nginx site, API + web services, backup timer |
| `backend/core/management/commands/` | `smoke_test`, `export_data`, `import_data` |

---

## 2. What happens on every deploy

| # | Step | On failure |
|---|---|---|
| 1 | Unpack release into `releases/<id>` | Abort — live site untouched |
| 2 | Build/reuse virtualenv, `check --deploy`, `collectstatic` | Abort — live site untouched |
| 3 | **Back up the database** (`pg_dump`, verified with `pg_restore --list`) | Abort — live site untouched |
| 4 | Apply migrations (only if pending) | **Restore DB**, keep old release |
| 5 | **Pre-flight** — new API on `:8093`, new web on `:3093`, while users stay on the old release:<br>• `/api/health/` → database reachable **and** all model files present<br>• anonymous `/api/dashboard/kpis/` → **401** (auth wired)<br>• `manage.py smoke_test` → 13 endpoints as a real user against live data, rolled back<br>• `/login`, `/dashboard`, `/model-lab` server-render; JS bundle exists | **Restore DB** if migrated, keep old release |
| 6 | Atomically switch `current`, restart both services, wait for health | **Restore DB**, switch back, restart |
| 7 | Same checks again through Nginx + TLS | **Restore DB**, switch back, restart |
| 8 | Prune old releases / virtualenvs / backups | — |
| 9 | GitHub runner checks the site from the public internet | `rollback.sh` |

A failed release is kept as `releases/<id>.failed` for 7 days. Every run is logged in `logs/deploy-*.log`.

> **Database rollback:** the automatic restore only happens when that deploy applied migrations, and it covers
> the seconds between backup and failure. Keep migrations backward-compatible (add a column first, remove it in a
> later release) and rollbacks stay code-only.

---

## 3. First-time setup (once)

### 3.1 DNS

At the `mcdtronix.co.zw` DNS host add:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `pharminsight` | `173.249.26.101` | 300 |

DNS names are case-insensitive, so `pharmInsight.mcdtronix.co.zw` and `pharminsight.mcdtronix.co.zw` are the same
host. The config uses lower case. Check from PowerShell:

```powershell
Resolve-DnsName pharminsight.mcdtronix.co.zw -Type A
```

### 3.2 GitHub Actions deploy key (Windows PowerShell)

A dedicated key for this repository, no passphrase (CI uses it unattended):

```powershell
ssh-keygen -t ed25519 -C "github-actions@pharminsight" -f "$env:USERPROFILE\.ssh\pharminsight_deploy" -N '""'
```

### 3.3 Upload the deploy kit and provision the server

From the project root:

```powershell
scp -r deploy "$env:USERPROFILE\.ssh\pharminsight_deploy.pub" root@173.249.26.101:/root/pharminsight/
```

On the VPS, as root:

```bash
cd /root/pharminsight/deploy
CERTBOT_EMAIL=you@example.com bash server/bootstrap-pharminsight.sh /root/pharminsight/pharminsight_deploy.pub
```

The script checks DNS and ports, installs Node 22 if needed, reuses the existing `deploy` user, creates the
`pharminsight_db` database and `pharminsight_app` role with a generated password, writes
`/srv/apps/pharminsight/shared/.env` with a generated `DJANGO_SECRET_KEY`, installs the two services and the backup
timer, a sudoers rule limited to restarting those two services, gets the certificate and enables the Nginx site.
It does not touch the portfolio. It is safe to re-run.

### 3.4 GitHub secrets

`Mcdtronix/insight-pill-pro` → **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `VPS_HOST` | `173.249.26.101` |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | full contents of `%USERPROFILE%\.ssh\pharminsight_deploy` (the **private** key) |
| `VPS_KNOWN_HOSTS` | the `173.249.26.101 ssh-ed25519 AAAA…` line printed by the bootstrap script |
| `VPS_PORT` | only if SSH is not on port 22 |

```powershell
gh secret set VPS_HOST --body "173.249.26.101" -R Mcdtronix/insight-pill-pro
gh secret set VPS_USER --body "deploy" -R Mcdtronix/insight-pill-pro
Get-Content "$env:USERPROFILE\.ssh\pharminsight_deploy" -Raw | gh secret set VPS_SSH_KEY -R Mcdtronix/insight-pill-pro
gh secret set VPS_KNOWN_HOSTS --body "<line printed by bootstrap>" -R Mcdtronix/insight-pill-pro
```

### 3.5 First deploy

Merge your work into `main` and push, or run **Actions → CI/CD · PharmInsight → Run workflow** on `main`. The first
run builds the scikit-learn virtualenv (a few minutes) and creates an empty schema. There is no previous release to
roll back to on this run only.

### 3.6 Copy your current data into PostgreSQL

`export_data` copies users (with their password hashes, so the same logins work), medicines, suppliers, offers,
batches, demand history, deliveries, policy, recommendations, orders and audit events. It skips sessions and
tokens, so everyone signs in again.

On Windows, in the project root:

```powershell
env\Scripts\python.exe backend\manage.py export_data -o pharminsight-data.json.gz
scp pharminsight-data.json.gz root@173.249.26.101:/tmp/
```

On the VPS:

```bash
chown deploy:deploy /tmp/pharminsight-data.json.gz
sudo -u deploy /srv/apps/pharminsight/bin/load-data.sh /tmp/pharminsight-data.json.gz --dry-run   # validate only
sudo -u deploy /srv/apps/pharminsight/bin/load-data.sh /tmp/pharminsight-data.json.gz             # back up, import, verify
rm /tmp/pharminsight-data.json.gz
```

`load-data.sh` validates the checksum and schema, backs up the database, imports everything in **one
transaction** (all or nothing), resets the ID sequences, restarts the API, runs the smoke test and the live checks,
and restores the backup by itself if any check fails. Delete the local `pharminsight-data.json.gz` afterwards; it is
git-ignored.

*Alternative (no local data needed):* rebuild the demo data straight from the CSVs on the server:

```bash
sudo -u deploy bash -c 'cd /srv/apps/pharminsight/current/backend && .venv/bin/python manage.py import_datasets --reset'
```

### 3.7 Admin account (optional)

```bash
sudo -u deploy bash -c 'cd /srv/apps/pharminsight/current/backend && .venv/bin/python manage.py createsuperuser'
```

Admin: `https://pharminsight.mcdtronix.co.zw/admin/`

---

## 4. Day-to-day operations

All commands run on the VPS.

```bash
# What is live, and what can I roll back to?
sudo -u deploy /srv/apps/pharminsight/bin/rollback.sh --list

# Roll back the code to the previous release (instant)
sudo -u deploy /srv/apps/pharminsight/bin/rollback.sh

# Roll back to a specific release and restore its database backup (discards newer data)
sudo -u deploy /srv/apps/pharminsight/bin/rollback.sh --to 20261102143000-ab12cd3 \
     --restore-db /var/backups/apps/pharminsight/db/pharminsight-20261102-143001-pre-20261102143000-ab12cd3.dump

# Backup now
sudo systemctl start pharminsight-backup.service

# Status and logs
systemctl status pharminsight-api pharminsight-web
journalctl -u pharminsight-api -n 100 --no-pager
journalctl -u pharminsight-web -n 100 --no-pager
ls -t /srv/apps/pharminsight/logs/deploy-*.log | head -1 | xargs less
tail -f /var/log/nginx/pharminsight.error.log

# Health from anywhere
curl -s https://pharminsight.mcdtronix.co.zw/api/health/
```

---

## 5. Demonstration mode

The datasets end on 31 December 2024. `shared/.env` sets:

```
DSS_DEMO_DATE=2024-12-31
DSS_ALLOW_DEMO_DATE=true
```

so the engine treats that date as "today" and the forecasts, stock positions and reorder decisions match the
dissertation. Production refuses to start with a demo date unless `DSS_ALLOW_DEMO_DATE=true` is also set, so a fake
date can never be switched on by accident. When the system runs on real, current data, delete both lines and
restart: `sudo systemctl restart pharminsight-api`.

---

## 6. Troubleshooting

| Symptom | Check |
|---|---|
| CI `backend` fails | Read the failing test. Run the same suite locally on PostgreSQL. |
| CI `frontend` fails on lint | Code rules only. Formatting is reported but never blocks. |
| Deploy stops at step 2 | `pip` could not install a wheel; read `logs/deploy-*.log`. |
| Deploy stops at step 5 | The new release failed a check; the live site was never touched. The log names the endpoint. |
| `/api/health/` shows `"models": "missing"` | The release is missing `ml/` files; check the `package` job's `git archive` paths. |
| 502 from Nginx | `systemctl status pharminsight-api pharminsight-web`, then `journalctl` as above. |
| Login returns 429 | Rate limit (10/min per client in Django, 20/min in Nginx). Wait a minute. |
| Certificate | `certbot certificates`, `certbot renew --dry-run` |
