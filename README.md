# SelfFeed

A self-hosted, Feedly-like RSS reader built with **Bun**, **Hono**, **React**, **TanStack**, and **Tailwind CSS**.

## Tech Stack

| Layer        | Technology                        |
| ------------ | --------------------------------- |
| Runtime      | Bun 1.3.14                        |
| API          | Hono (TypeScript)                 |
| Frontend     | React 19 + TanStack Router/Query  |
| Styling      | Tailwind CSS v4                   |
| Database     | SQLite3 (bun:sqlite)              |
| Cache        | Redis 8.8                         |
| ORM          | Drizzle ORM                       |
| Auth         | JWT (jose)                        |
| Containers   | Podman / Docker Compose           |
| CI           | GitHub Actions                    |

## Features

- **Feed management** — organize feeds into categories with drag-and-drop tree navigation
- **Article reader** — renders HTML content safely with embedded media (YouTube, Vimeo, Streamable)
- **Keyboard navigation** — `j`/`k` to move, `m` to toggle read, `v` to open original
- **Full-text search** — search across all articles or within a category
- **Read tracking** — auto-mark-read on open, mark-all-read per category or globally
- **User preferences** — font family, text size, display density, theme (light/dark/system)
- **Stats dashboard** — unread counts, daily read metrics, per-feed breakdowns
- **Multi-user** — JWT auth with admin-controlled registration lock
- **Bootstrap admin** — on a fresh deployment, the first registered account becomes the admin
- **Security hardened** — CSP, CORS, rate limiting, input validation with Zod
- **Mobile-ready API** — JSON REST endpoints plus generated `packages/api/openapi.json`

## Local Development Setup

Follow these steps to set up and run the application locally in development mode.

### 1. Prerequisites
- **Runtime:** [Bun](https://bun.sh) (version 1.3.10 or higher)
- **Container Engine:** [Podman](https://podman.io) or **Docker** (with Docker Compose plugin) to run Redis locally.

### 2. Installation
Clone the repository and install dependencies using Bun:
```bash
git clone <repo-url> && cd SelfFeed
bun install
```

### 3. Environment Configuration
Copy the development environment template to the API directory:
```bash
cp .env.example packages/api/.env
```
Open `packages/api/.env` and review the default configuration. By default, SQLite data is stored under `packages/api/data` and Redis is expected on localhost.

### 4. Database Setup & Seeding

Start the Redis cache service, apply migrations, and seed the initial admin account:
```bash
# 1. Start Redis container
bun run dev:infra

# 2. Apply migrations & seed initial admin user (run from repository root)
bun run db:migrate
bun run db:seed
```

### 5. Running the Application
To run the full stack locally (with automatic reload/watch mode):
```bash
# Stops any conflicting containers, frees up port 3000, and boots Redis, the API, Worker, and Web UI
bun run dev
```

Once running:
- **Web Frontend:** http://localhost:5173
- **API Server:** http://localhost:3000
- **API Health Check:** http://localhost:3000/health

To stop the background Redis database:
```bash
bun run dev:down
```

---

## Development Guide

### Running Specific Services
If you only want to work on one part of the stack, you can spin them up individually (make sure your infrastructure is running with `bun run dev:infra`):
- **Run API only:** `bun run dev:api` (reloads on file changes)
- **Run Worker only:** `bun run dev:worker` (reloads on file changes)
- **Run Frontend only:** `bun run dev:web` (reloads on file changes)

### Database Schemas & Migrations
The database schema is managed via Drizzle ORM inside `packages/api/src/db/schema.ts`.
- **Generate Migrations:** If you modify `schema.ts`, generate the SQL migrations by running `bun run db:generate` in the root workspace.
- **Apply Migrations:** Apply pending SQL migrations to your database by running `bun run db:migrate`.

### Code Quality (Linting & Types)
We use **Biome** for fast formatting and linting:
- **Lint check:** `bun run lint`
- **Auto-fix errors:** `bun run lint:fix`
- **Type check:** Run TypeScript type verification across all workspace packages with `bun run typecheck`.

### Testing Strategy
Tests are split into unit, integration, and E2E tiers. Make sure dependencies are built before testing.
- **Run Unit Tests:** `bun run test:unit` (Runs Vitest unit tests for both React frontend and API logic).
- **Run Integration Tests:** `bun run test:integration` (Spins up an isolated Redis container, creates a temporary SQLite file, and runs API integration tests).
- **Run End-to-End Tests:** `bun run test:e2e` (Installs Playwright dependencies, seeds the database, and runs full visual flow tests against headless Chromium).
- **Run All Suites:** Run unit, integration, and E2E tests together with `bun run test:all`.


## Project Structure

```
SelfFeed/
├── packages/
│   ├── shared/       # Domain types, Zod schemas, API contracts
│   ├── api/          # Hono REST API, Drizzle ORM, services
│   │   ├── src/
│   │   │   ├── db/           # Schema, client, repositories
│   │   │   ├── middleware/   # Auth, security, rate limiting
│   │   │   ├── routes/       # HTTP route handlersd
│   │   │   └── services/     # Business logic layer
│   │   └── tests/
│   └── web/          # React SPA with TanStack
│       ├── src/
│       │   ├── components/   # UI components
│       │   ├── hooks/        # React Query hooks, keyboard nav
│       │   ├── providers/    # Auth, theme providers
│       │   └── routes/       # TanStack Router pages
│       └── tests/
│   └── android/      # Jetpack Compose Android client (API 36)
├── compose.yaml      # Podman/Docker Compose stack
├── Dockerfile.api    # API container image
├── Dockerfile.web    # Web container image (nginx)
└── nginx.conf        # Reverse proxy config
```

## Android Client

An Android app using Jetpack Compose is available in `packages/android`.

- Target: **Android 16 / API 36**
- Auth: JWT access token + refresh-cookie flow
- Core coverage: auth, feeds/categories, articles, search, preferences, stats, admin registration lock

See `packages/android/README.md` for setup and run instructions.

## Scripts

```bash
bun run lint          # Biome lint check
bun run lint:fix      # Biome auto-fix
bun run typecheck     # TypeScript type check (all packages)
bun run test          # Run all tests (API + Web)
bun run db:generate   # Generate Drizzle SQL migrations
bun run db:seed       # Seed the configured admin user
bun run dev           # One-line local dev (infra + API/Web watch mode)
bun run dev:prepare:docker  # Stop docker api/web containers before local watch mode
bun run openapi:generate  # Refresh packages/api/openapi.json
```

## API Endpoints

All API endpoints are prefixed with `/api/v1`.

| Method | Path                          | Auth     | Description                  |
| ------ | ----------------------------- | -------- | ---------------------------- |
| POST   | /auth/register                | —        | Register new user            |
| POST   | /auth/login                   | —        | Login, receive JWT tokens    |
| POST   | /auth/refresh                 | —        | Refresh access token         |
| GET    | /categories                   | ✓        | List user categories         |
| POST   | /categories                   | ✓        | Create category              |
| PATCH  | /categories/:id               | ✓        | Update category              |
| DELETE | /categories/:id               | ✓        | Delete category              |
| GET    | /feeds                        | ✓        | List user feeds              |
| POST   | /feeds                        | ✓        | Subscribe to feed            |
| PATCH  | /feeds/:id                    | ✓        | Update feed                  |
| DELETE | /feeds/:id                    | ✓        | Unsubscribe from feed        |
| POST   | /feeds/:id/sync               | ✓        | Trigger feed sync            |
| GET    | /articles                     | ✓        | List articles (with filters) |
| PATCH  | /articles/:id/read            | ✓        | Mark article read/unread     |
| POST   | /articles/mark-all-read       | ✓        | Mark all read (by category)  |
| GET    | /search                       | ✓        | Full-text article search     |
| GET    | /preferences                  | ✓        | Get user preferences         |
| PATCH  | /preferences                  | ✓        | Update preferences           |
| GET    | /stats                        | ✓        | Dashboard statistics         |
| POST   | /admin/registration-lock      | Admin    | Toggle registration          |
| POST   | /admin/users                  | Admin    | Create user (when locked)    |

## Android / Mobile Integration

The API is designed for multi-client consumption:

- **Stateless JWT auth** — no server-side sessions; tokens work from any client
- **JSON REST** — standard HTTP methods with consistent response envelopes
- **Generated OpenAPI document** — `packages/api/openapi.json`
- **Pagination** — cursor-based via `offset`/`limit` query parameters
- **Consistent error format** — `{ success: false, error: { code, message } }`

Refresh the OpenAPI artifact with:

```bash
bun run openapi:generate
```

## Production Deployment & Publishing

This repository is configured for automated container builds, publishing to GitHub Container Registry (GHCR), and Continuous Deployment (CD) to a VPS behind a Traefik edge proxy.

### 1. CI/CD Architecture (GitHub Actions)
- **CI Workflow (`ci.yml`):** Runs on push/PR to `main` and `master`. Installs dependencies, runs Biome linter, compiles TypeScript, and runs the full unit/integration/E2E test suites (with dynamic Docker-based test databases).
- **Containers Workflow (`containers.yml`):** Runs on push to `main`/`master` or version tags (e.g., `v1.0.0`). Compiles the API and Web applications, builds Docker images for both `amd64` and `arm64` architectures, and pushes them to `ghcr.io`.
- **Deploy Workflow (`deploy.yml`):** Automatically triggers on completion of the container builds. Connects to your VPS via SSH (`appleboy/ssh-action`) using secrets, logs into `ghcr.io`, pulls the updated images, and restarts the containers.

### 2. VPS Deployment Setup
Use [DEPLOY.md](DEPLOY.md) as the source of truth for production setup.
It covers the protected `production` environment, the dedicated
`selffeed-deploy` SSH account, required secrets, the deploy path, and
the production `.env` file.

At minimum, the `production` environment needs:

- `VPS_HOST`: the IP address or domain name of your VPS.
- `VPS_USERNAME`: `selffeed-deploy`, unless you intentionally created a different deploy user.
- `VPS_SSH_KEY`: the private key generated by `scripts/setup-vps-deploy-user.sh`.
- `VPS_PORT`: optional, defaults to `22`.
- `DEPLOY_PATH`: `/mnt/storage/containers/selfrss` if you use the default VPS setup script path.

### 3. Database Migrations & Administration
- **Migrations:** The API service applies database migrations automatically on boot, so schema changes are handled seamlessly.
- **Backups:** Back up `/opt/self-feed/data` before every deploy. The GitHub deploy workflow also creates a timestamped archive under `/opt/self-feed/backups` before restarting containers.
- **Rollback:** Deploy immutable `sha-*` image tags where possible. If a deploy fails, restore the latest data archive and redeploy the previous known-good image tag.
- **Admin Setup:** On a fresh database, register a new account on your site. The first registered user is automatically granted the `admin` role. Once your account is set up, change `ALLOW_REGISTRATION` to `false` in `/opt/self-feed/.env` and restart (`docker compose up -d`) to disable public signups.

## License

MIT License - see the [LICENSE](LICENSE) file for details.
