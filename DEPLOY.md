# SelfFeed Deployment

This is the **single source of truth** for deploying the repo to your VPS. The
deploy runs in a protected GitHub Actions environment, so logs and secrets are
only visible to you — public users only see the deploy-summary artifact.

## One-time GitHub configuration

Do this once after the repo is created, before the first deploy.

### 1. Create the `production` environment

1. Go to **Repo → Settings → Environments → New environment**.
2. Name it `production` (must match the name in `deploy.yml`).
3. **Deployment protection rules**:
   - Enable **Required reviewers** and add yourself.
   - (Optional) Enable **Wait timer** if you want a cooldown window.
4. **Environment visibility**:
   - Default is fine — environment is only visible to people with at
     least Write access to the repo. Anonymous visitors to the Actions
     tab cannot view runs in this environment, cannot view its logs,
     and cannot see its secrets or variables.
5. **Deployment branches**: restrict to `main`.

### 2. Add environment secrets

Under the `production` environment, add these secrets. They are
**environment-scoped**, which means they are only available to jobs
that use `environment: production` and only visible to people with
write access to the repo.

| Secret           | Example value                         |
| ---------------- | ------------------------------------- |
| `VPS_HOST`       | `203.0.113.10`                        |
| `VPS_USERNAME`   | `selffeed-deploy`                     |
| `VPS_PORT`       | `22` (optional, defaults to 22)       |
| `VPS_SSH_KEY`    | contents of the private key (`-----BEGIN OPENSSH PRIVATE KEY-----...`) |

`VPS_USERNAME` must match the account created by
`scripts/setup-vps-deploy-user.sh`. The default is `selffeed-deploy`.
The SSH public key for `VPS_SSH_KEY` must be installed in that account's
`authorized_keys`.

### 3. Add environment variables

These are non-sensitive and can live in vars (visible to repo members
but not to the public):

| Var                       | Default                 | Notes                                  |
| ------------------------- | ----------------------- | -------------------------------------- |
| `DEPLOY_PATH`             | `/opt/self-feed`        | Directory on the VPS holding the deploy |
| `COMPOSE_COMMAND`         | `docker compose`        | Use `podman compose` if you prefer     |
| `REGISTRY`                | `ghcr.io`               | Container registry to pull from        |
| `IMAGE_OWNER_LOWERCASE`   | `gustav0ar`             | Your GitHub username, lowercased       |

> Set `DEPLOY_PATH` to `/mnt/storage/containers/selfrss` if that's where
> you want the stack to live.

## First-time VPS setup

On the VPS, run the setup helper as root. This creates the dedicated
`selffeed-deploy` user, prepares the deploy path, installs the public
key in `authorized_keys`, and writes the private key to a handoff file
for the GitHub environment secret.

```bash
# 1. Install Docker (skip if already installed).
curl -fsSL https://get.docker.com | sh

# 2. Download and run the deploy-user setup.
curl -fsSL \
  https://raw.githubusercontent.com/Gustav0ar/Self-RSS/main/scripts/setup-vps-deploy-user.sh \
  -o /tmp/setup-vps-deploy-user.sh
sudo bash /tmp/setup-vps-deploy-user.sh /mnt/storage/containers/selfrss selffeed-deploy

# 3. Copy this full private key into the production VPS_SSH_KEY secret.
sudo cat /root/.ssh-key-handoff/selffeed-deploy.key

# 4. Create the .env file with production secrets.
sudo -u selffeed-deploy bash -c 'cat > /mnt/storage/containers/selfrss/.env <<EOF
REDIS_PASSWORD=<long-random>
JWT_SECRET=<openssl rand -hex 32>
JWT_REFRESH_SECRET=<openssl rand -hex 32>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
AUTH_SESSION_ABSOLUTE_TTL_DAYS=400
AUTH_SESSION_IDLE_TTL_DAYS=30
AUTH_SESSION_CLEANUP_BATCH_SIZE=250
REGISTRY=ghcr.io
IMAGE_OWNER_LOWERCASE=gustav0ar
IMAGE_TAG=latest
APP_UID=$(id -u selffeed-deploy)
APP_GID=$(id -g selffeed-deploy)
CORS_ALLOWED_ORIGINS=https://rss.yourdomain.com
DOMAIN_NAME=rss.yourdomain.com
TRAEFIK_NETWORK=web
TRAEFIK_HTTP_ENTRYPOINT=web
TRAEFIK_ENTRYPOINT=websecure
TRAEFIK_CERT_RESOLVER=le
ALLOW_REGISTRATION=true
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=<strong-password>
TRUSTED_PROXY_HOPS=1
REQUIRE_WORKER_HEARTBEAT=true
CACHE_WARMER_INTERVAL_MS=60000
CACHE_WARMER_RECENT_WINDOW_MINUTES=10
CACHE_WARMER_RECENT_USERS_LIMIT=25
CACHE_WARMER_CONCURRENCY=5
CACHE_WARMER_IDLE_USERS_ENABLED=false
CACHE_WARMER_IDLE_USERS_LIMIT=25
RETENTION_DELETION_ENABLED=false
RETENTION_DELETION_DAYS=90
RETENTION_DRY_RUN=true
FEED_PIPELINE_MODE=v2
FEED_INGESTION_HISTORY_RETENTION_DAYS=14
FEED_INGESTION_CLEANUP_BATCH_SIZE=250
FEED_FETCH_RELAY_URL=
FEED_FETCH_RELAY_TOKEN=
FEED_FETCH_RELAY_HOSTS=
EOF'
sudo chmod 600 /mnt/storage/containers/selfrss/.env

# 5. Make sure the Traefik network exists.
docker network create web 2>/dev/null || true
```

`REGISTRY`, `IMAGE_OWNER_LOWERCASE`, and `IMAGE_TAG` are not secrets.
The Deploy workflow rewrites them on each deploy so manual commands such
as `docker compose logs` can parse `docker-compose.yml` on the VPS.

`DOMAIN_NAME` must be only the bare hostname. Do not include `https://`,
paths, or a port. Use `CORS_ALLOWED_ORIGINS` for the full browser origin
including `https://`.

The default Traefik labels assume HTTP entrypoint `web` and HTTPS
entrypoint `websecure`. If your Traefik instance uses different
entrypoint names, set `TRAEFIK_HTTP_ENTRYPOINT` and `TRAEFIK_ENTRYPOINT`
to match.

The default external Docker network is also `web`. Set
`TRAEFIK_NETWORK` only if your Traefik container uses another external
network name.

`TRUSTED_PROXY_HOPS=1` matches the default Traefik → web nginx → API
production path, where nginx appends the trusted Traefik hop to
`X-Forwarded-For`. If the API is deployed behind only the bundled nginx
proxy with no upstream proxy, set `TRUSTED_PROXY_HOPS=0`. Do not increase
this value unless every hop counted from the right side of
`X-Forwarded-For` is controlled by your infrastructure.

The optional feed relay is an authenticated fallback for publishers that reject
the VPS address. The API and worker try the publisher directly and use the relay
only after a `401`, `403`, or `429`. The target is sent in a private request
header, never in the relay URL, and the relay independently blocks credentials,
non-HTTP schemes, private/local addresses, DNS rebinding, and unsafe redirects.
`FEED_FETCH_RELAY_HOSTS` is retained only for compatibility and may be empty.

Set `FEED_FETCH_RELAY_URL` to the private relay endpoint ending in `/feed` (the
legacy `/videocardz/rss-feed` path also accepts generic targets), and use the
same random value of at least 32 characters for `FEED_FETCH_RELAY_TOKEN` on the
VPS and `FEED_RELAY_TOKEN` on the relay host. Keep the relay on a private network
and bind its published port only to that network interface. Each target is
coalesced and cached for at least one minute by the relay. The API also uses a
Redis URL-scoped one-minute lease, so several accounts, app instances, manual
refreshes, and scheduled syncs cannot flood the same publisher.

The API container image can run the relay as a separate container:

```bash
docker run -d --name self-feed-relay --restart unless-stopped \
	--publish <private-interface-ip>:18080:8080 \
	--env FEED_RELAY_PORT=8080 \
	--env FEED_RELAY_TOKEN='<same-random-token>' \
	--env FEED_RELAY_MAX_CONTENT_LENGTH=5242880 \
	ghcr.io/gustav0ar/self-feed-api:<image-tag> start:feed-relay
```

When upgrading the old fixed VideoCardz relay, recreate that container with the
new image before enabling other blocked publishers. New API versions verify the
`X-Self-Feed-Relay: generic` response marker and reject an old fixed relay for a
different target, preventing content from one feed from being stored under
another feed.

### CrowdSec and rapid article navigation

CrowdSec's generic `http-crawl-non_statics` scenario treats many distinct,
successful article-detail URLs as crawler traffic. A reader holding the next
article shortcut can therefore be banned even though every request is an
authenticated, successful application action. First-party clients use the
stable `/api/v1/articles/detail?id=...` path so UUIDs no longer count as
distinct crawl targets. The legacy UUID path remains available for older
clients.

The deploy script also discovers running CrowdSec containers, copies the
narrow parser whitelist from
`deploy/crowdsec/self-feed-navigation-whitelist.yaml` into the parser config,
validates the full CrowdSec configuration, and restarts CrowdSec. Set
`CROWDSEC_CONTAINER_NAME` in the production `.env` if auto-discovery cannot
identify the container. Set `CROWDSEC_REQUIRED=true` to make deployment fail
instead of skip when the configured CrowdSec container is missing. For a
host-installed CrowdSec service, install the same file under
`/etc/crowdsec/parsers/s02-enrich/` and restart the service.

The whitelist applies only to `GET` responses with status `200` or `304`, only
on `rss.gustavo.ca`, and only for exact API or SPA article-detail UUID routes.
It does not exempt authentication failures, missing routes, admin paths, other
hosts, or CVE/probing traffic. Change the hostname in the expression when
deploying under another domain.

The setup helper leaves `/mnt/storage/containers/selfrss/data` owned by
the deploy user and readable only by that account. The deploy workflow
also writes `APP_UID` and `APP_GID` into `.env`, and the API/worker
containers run with that same host uid/gid so SQLite files do not need
world-writable permissions. If you create the directory manually, run:

```bash
sudo chown -R selffeed-deploy:selffeed-deploy /mnt/storage/containers/selfrss/data
sudo chmod 750 /mnt/storage/containers/selfrss/data
```

Set the production environment secrets to the same account:

```text
VPS_USERNAME = selffeed-deploy
VPS_PORT     = 22
```

If SSH auth fails in GitHub Actions, compare the workflow's printed
deploy key fingerprint with the server key:

```bash
sudo ssh-keygen -l -f /var/lib/selffeed-deploy/.ssh/id_ed25519.pub
sudo bash /tmp/setup-vps-deploy-user.sh /mnt/storage/containers/selfrss selffeed-deploy
```

## Deploy flow

1. Push a commit to `main` (or trigger the `Deploy` workflow manually).
2. The `Containers` workflow builds the `self-feed-api` and
   `self-feed-web` images.
3. The `Deploy` workflow is gated on:
   - The `production` environment's required reviewers (you) approving
     the deployment.
   - The image tag matching the latest successful build.
4. On approval, the workflow:
   - Captures the previous Compose file, private `.env`, immutable container
     image IDs, and SQLite schema and migration-ledger fingerprint before
     changing configuration.
   - Pulls the `docker-compose.yml` from the repo at the deploy commit.
   - Creates a pre-deploy SQLite backup under `data/backups` on the VPS
     when `data/self-feed.db` already exists.
   - Pulls the new images.
   - Restarts the stack with `docker compose up -d --remove-orphans`.
   - Health-checks Redis, API, worker, web, and the public routes.
   - Prunes dangling images.
5. A `deploy-summary` artifact is uploaded for public visibility
   (image tag, commit SHA, host fingerprint) — **no secrets**.

SQLite migrations also run with application-level data guards. Before
pending migrations are applied, the API creates a `VACUUM INTO` backup
when protected tables already contain data. The migrator then applies
pending journal entries in one transaction and checks protected table
row counts, existing protected row keys, and `PRAGMA foreign_key_check`
before commit. If a migration would remove protected rows or leave
orphaned rows, it is rolled back and startup fails with the backup path
in the error.

Automatic rollback stops the API and worker before comparing the current
SQLite schema and `__drizzle_migrations` ledger with the captured fingerprint.
When both are unchanged, it restores the matching previous configuration and
starts the captured API, worker, and web image IDs, leaving Redis unchanged.
It leaves the database files in place, including user writes made after
deployment began. It never restores a database backup automatically.

If the schema or ledger changed, or their current state cannot be read,
rollback refuses to start previous images. The target configuration, images,
and database remain in place, with the API and worker stopped. Correct the
target release or deploy a compatible forward fix, then retry the deployment.

Recovery metadata lives under `.deploy-recovery/<target-sha>` with private
permissions because it includes `.env`. Failed-attempt retries reuse the
original recovery set. A successful deployment closes that attempt; a later
deployment of the same SHA captures the now-current release as its baseline.
Completed recovery metadata is retained separately from SQLite backups.

## Durable feed ingestion rollout

Production Docker Compose defaults `FEED_PIPELINE_MODE` to `v2` for both
the API and worker. The application schema and `.env.example` deliberately
default to `legacy`, so source-based and local deployments require an
explicit activation. API and worker must always receive the same value:
the worker starts exactly one publisher-fetch pipeline, never both.

An existing `FEED_PIPELINE_MODE=legacy` entry in the VPS `.env` overrides
the new Compose `v2` default. Change it to `v2` (or remove it only if both
services use this Compose file) before expecting activation. Confirm the
resolved values for both services with `docker compose config`.

Before activation, take the normal pre-deploy SQLite backup and confirm the
worker is healthy. Deploy API and worker together, then verify:

```bash
curl -fsS https://rss.example.com/ready
curl -fsS -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  https://rss.example.com/api/v1/metrics | rg 'feed_ingestion_'
docker compose logs --since=10m api worker
```

`/ready` must report `"feedPipelineMode":"v2"` and an informational
`checks.ingestion` object. Inspect queued/running/dead fetch jobs, parse and
delivery backlog, oldest due ages, refresh errors, backoff/paused sources,
and blocked/circuit-open origins. Backoff and publisher rate limiting are
protective state and do not make readiness fail. Readiness still fails when
the required worker heartbeat, database, or Redis check fails.

Prometheus publisher counters describe actual outbound requests and bounded
outcome classes only; they intentionally contain no user, feed URL, or host
labels. Alert on sustained growth in due-job or due-delivery age, dead work,
loop errors, and circuit-open origins rather than on a publisher entering
normal backoff.

Durable operational history is cleaned hourly in bounded transactions. The
defaults retain terminal history for 14 days and process at most 250 rows per
resource per pass:

```dotenv
FEED_INGESTION_HISTORY_RETENTION_DAYS=14
FEED_INGESTION_CLEANUP_BATCH_SIZE=250
```

Cleanup never removes active/recoverable requests, jobs, or deliveries, and
respects snapshot retention timestamps. Increase retention before increasing
batch size when more diagnostic history is needed; avoid large cleanup bursts
against the shared SQLite database.

To roll back, set `FEED_PIPELINE_MODE=legacy` in the deployment `.env` and
restart API and worker together with `docker compose up -d`. Do not delete or
truncate the durable ingestion tables: queued work and retained snapshots stay
in SQLite and are available for a later v2 reactivation. Verify `/ready`
reports `legacy`, that only legacy publisher workers are running, and that
normal feed refresh resumes before considering the rollback complete.

## Visibility recap

- **Public users** see: the workflow file, the `deploy-summary`
  artifact, the commit history.
- **Public users do NOT see**: deploy logs, environment secrets,
  environment variables, environment name (when restricted), or
  approval history.
- **You (and any collaborators you add)** see everything.

## Retention Cleanup Configuration

The production Compose file forwards the documented session, worker-heartbeat,
cache-warmer, and retention variables into the services that consume them. Check
the effective contract before a rollout with:

```bash
docker compose config | rg 'AUTH_SESSION_|REQUIRE_WORKER_HEARTBEAT|CACHE_WARMER_|RETENTION_'
```

Articles that have neither been read nor saved by any user are eligible for
automatic cleanup to manage database size. This feature is **disabled by
default** for safety.

| Variable                   | Default | Description                                      |
| -------------------------- | ------- | ------------------------------------------------ |
| `RETENTION_DELETION_ENABLED` | `false` | Set to `true` to enable actual deletion         |
| `RETENTION_DELETION_DAYS`    | `90`    | Delete unprotected articles older than this many days |
| `RETENTION_DRY_RUN`          | `true`  | Log what would be deleted without deleting       |

### Safety Features

1. **Opt-in required**: Deletion is disabled by default. Even if
   `RETENTION_DELETION_ENABLED` is not set, no articles are deleted.

2. **Dry-run mode**: `RETENTION_DRY_RUN=true` (the default) logs how
   many articles would be deleted without actually deleting them. Use
   this to verify the cleanup behavior before enabling live deletion.

3. **Reader-state protection**: Only articles that have **never been read or
   saved** by any user are eligible for cleanup. Either action protects the
   article regardless of age.

### Enabling Retention Cleanup

```bash
# 1. First, enable dry-run mode to preview what would be deleted
RETENTION_DELETION_ENABLED=false
RETENTION_DRY_RUN=true
# Check logs for "Retention cleanup: would delete N articles"

# 2. Once satisfied with the preview, enable live deletion
RETENTION_DELETION_ENABLED=true
RETENTION_DRY_RUN=false
```

### Recommended Production Settings

```bash
RETENTION_DELETION_ENABLED=true
RETENTION_DELETION_DAYS=90
RETENTION_DRY_RUN=false
```
