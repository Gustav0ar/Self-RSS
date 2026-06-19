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
REGISTRY=ghcr.io
IMAGE_OWNER_LOWERCASE=gustav0ar
IMAGE_TAG=latest
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

The setup helper leaves `/mnt/storage/containers/selfrss/data` writable
by the unprivileged `bun` user inside the API container. If you create
the directory manually, run:

```bash
sudo chmod 777 /mnt/storage/containers/selfrss/data
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
   - Creates a pre-deploy SQLite backup under `data/backups` on the VPS
     when `data/self-feed.db` already exists.
   - Pulls the `docker-compose.yml` from the repo at the deploy commit.
   - Pulls the new images.
   - Restarts the stack with `docker compose up -d --remove-orphans`.
   - Health-checks the API and web.
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

## Visibility recap

- **Public users** see: the workflow file, the `deploy-summary`
  artifact, the commit history.
- **Public users do NOT see**: deploy logs, environment secrets,
  environment variables, environment name (when restricted), or
  approval history.
- **You (and any collaborators you add)** see everything.
