# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development commands

### Workspace setup
- `bun install`
- Copy env for the API: `cp .env.example packages/api/.env`
- Start local infra with Podman: `podman compose up -d redis`
- Or with Docker: `docker compose up -d redis`

### Run the app locally
- Full local dev flow (engine-agnostic: stops dev containers, frees port 3000, boots Redis, the API, worker, and Web UI in watch/watch-reload mode): `bun run dev`
- Run only the API in watch mode: `bun run dev:api`
- Run only the API worker in watch mode: `bun run dev:worker`
- Run only the web app: `bun run dev:web`
- Stop local infra containers: `bun run dev:down`

Foreground local development:
- Prefer `bun run dev` when working interactively in a terminal. It starts Redis, waits for API health on `http://localhost:3000/health`, then starts the worker and Vite web app at `http://localhost:5173/`.
- Stop a foreground `bun run dev` session with `Ctrl-C`. If ports are still occupied afterward, check with `ss -ltnp | rg ':3000|:5173|:6379'`.
- `bun run dev:api`, `bun run dev:worker`, and `bun run dev:web` are useful in separate terminals, but they assume Redis is already running; start Redis first with `bun run dev:infra`.

Detached local browser-testing setup:
- Do not rely on plain `nohup bun run dev ... &` for a persistent background setup; the dev orchestrator inherits child stdio and can exit when the launching shell exits.
- Start detached services individually with `setsid` when the browser preview needs to keep working after the command returns:
  ```bash
  setsid sh -c 'cd /home/gustavo/Code/RSS-app/packages/api && exec env API_HOST=0.0.0.0 bun --env-file=.env --env-file=../../.env.example --watch src/index.ts' > /tmp/self-feed-api.log 2>&1 & echo $! > /tmp/self-feed-api.pid
  setsid sh -c 'cd /home/gustavo/Code/RSS-app/packages/api && exec bun --env-file=.env --env-file=../../.env.example --watch src/worker.ts' > /tmp/self-feed-worker.log 2>&1 & echo $! > /tmp/self-feed-worker.pid
  setsid sh -c 'cd /home/gustavo/Code/RSS-app/packages/web && exec bun run dev' > /tmp/self-feed-web.log 2>&1 & echo $! > /tmp/self-feed-web.pid
  ```
- Verify detached services with `curl -fsS http://127.0.0.1:3000/health` and `ss -ltnp | rg ':3000|:5173|:6379'`.
- Stop detached services with `kill $(cat /tmp/self-feed-api.pid /tmp/self-feed-worker.pid /tmp/self-feed-web.pid)`. Run `bun run dev:down` afterward if Redis or compose-managed containers should also be stopped.
- Detached logs are written to `/tmp/self-feed-api.log`, `/tmp/self-feed-worker.log`, and `/tmp/self-feed-web.log`.

Local UI review data:
- After the local API and web app are running, run `bun run seed:review` before browser verification. This ensures a review user exists and adds public RSS feeds with real articles.
- Default review login: `reader@example.com` / `password123`.
- `bun run seed:review` creates a `Review Feeds` category if needed, adds BBC World, The Verge, xkcd, and NASA News Releases feeds if missing, and triggers sync for those feeds.
- If the app opens with no articles, run `bun run seed:review` again and check API health with `curl -fsS http://127.0.0.1:3000/health`.
- Use `LOCAL_REVIEW_EMAIL`, `LOCAL_REVIEW_PASSWORD`, `LOCAL_REVIEW_CATEGORY`, or `LOCAL_REVIEW_API_BASE` to override the defaults.

### Build, lint, typecheck
- Lint all JS/TS: `bun run lint`
- Auto-fix lint issues: `bun run lint:fix`
- Typecheck all Bun workspace packages: `bun run typecheck`
- Build all Bun workspace packages: `bun run build`
- Generate OpenAPI JSON from the API spec: `bun run openapi:generate`

### Database
- Generate Drizzle migration files: `bun run db:generate`
- Apply migrations: `bun run db:migrate`
- Seed the API database: `bun run db:seed`

### Tests
- Run all Bun workspace tests: `bun run test`
- Run all unit tests across workspace packages: `bun run test:unit`
- Run API integration tests with an ephemeral Redis container and temporary SQLite database: `bun run test:integration`
- Run Playwright E2E with ephemeral infra plus spawned API/web servers: `bun run test:e2e`
- Run the full test suite: `bun run test:all`

### Run a single test
- API unit test file: `bun run --filter '@self-feed/api' test -- tests/unit/health.test.ts`
- API integration test file: `bun run --filter '@self-feed/api' test:integration -- tests/integration/app.integration.test.ts`
- Web unit test file: `bun run --filter '@self-feed/web' test -- tests/unit/keyboard-nav.test.ts`
- Playwright spec: `bun run --filter '@self-feed/web' test:e2e:runner -- tests/e2e/app.e2e.spec.ts`
- Install the web package's pinned Playwright browsers: `bun run --filter '@self-feed/web' playwright:install`

Do not install Playwright browsers in CI with root-level `bun x playwright ...`; it can resolve a different Playwright version than `@self-feed/web` uses and leave E2E without the expected browser revision.

### Android
Android is not part of the root Bun workspace. Build and test it with the Gradle wrapper under `packages/android`.

- Run Android unit tests: `./packages/android/gradlew -p packages/android :app:testDebugUnitTest`
- Run Android instrumentation tests: `./packages/android/gradlew -p packages/android :app:connectedDebugAndroidTest`
- Run Android lint + debug build: `./packages/android/gradlew -p packages/android :app:lintDebug :app:assembleDebug`
- Run the repo’s Android check script: `bun run android:check`

## Architecture overview

### Monorepo shape
This repo has four main packages:
- `packages/shared`: shared domain types, API contracts, and Zod validation used by both clients and the API.
- `packages/api`: Bun + Hono REST API, Drizzle/SQLite persistence, Redis-backed auth/rate limiting/caching helpers, and background jobs.
- `packages/web`: React 19 SPA with TanStack Router and TanStack Query.
- `packages/android`: standalone Jetpack Compose client that talks to the same `/api/v1` API but is built separately with Gradle.

The root `package.json` workspace only includes `shared`, `api`, and `web`. Do not assume Android participates in root `bun run --filter '*' ...` commands.

### Shared contracts first
`packages/shared/src/index.ts` re-exports contracts, domain types, and validation. This package is the common schema layer between server and web, and the API also generates `packages/api/openapi.json` for external/mobile consumption.

When changing request/response shapes, update shared contracts first, then align API routes/services and any client code consuming them.

### API layering
The API boots from `packages/api/src/index.ts`.

Startup flow:
1. Read env.
2. Open the SQLite database and run Drizzle migrations on boot.
3. Connect to Redis.
4. Build `tokenUtils` and dependency graph via `createDeps`.
5. Create the Hono app and start Bun.

The worker (`src/worker.ts`) boots separately with the same env/deps setup and starts feed sync scheduling and article retention cleanup.

Key API layers:
- `src/app.ts`: wires middleware, CORS, auth, admin checks, and mounts `/api/v1` route groups.
- `src/config/deps.ts`: central dependency composition root. Repositories are constructed first, then services, then the Redis-backed rate limiter.
- `src/repositories/*`: database access layer over Drizzle.
- `src/services/*`: business logic layer; route handlers should stay thin and delegate here.
- `src/routes/*`: HTTP translation layer.
- `src/db/schema.ts`: primary domain model and relational structure.
- `src/jobs/scheduler.ts`: periodic feed sync plus retention cleanup.

Important API behavior:
- Health routes are mounted without the `/api/v1` prefix.
- Auth is JWT-based. Web uses an in-memory access token plus refresh cookie flow; Android mirrors the same API semantics with its own secure storage and cookie handling.
- Feed syncing and article retention cleanup run in a separate worker process (`src/worker.ts`), deployed as its own container that reuses the API image.
- Article search relies on SQLite FTS5.
- The API applies migrations automatically at startup, so schema changes affect boot behavior immediately.

### Data model
The core relational flow in `packages/api/src/db/schema.ts` is:
- `users`
- `user_preferences`
- hierarchical `categories`
- `feeds` belonging to categories
- `articles` belonging to feeds
- `article_media` extracted from article content
- `article_reads` joining users to articles
- `sync_runs` for feed sync history
- `user_metrics_daily` for usage stats
- `app_settings` and `audit_logs` for admin controls

That shape explains most feature behavior across both clients: category/feed navigation, unread counts, search, stats, admin registration lock, and OPML import/export.

### Web app structure
The web app boots from `packages/web/src/main.tsx` and nests providers in this order:
1. `ThemeProvider`
2. `QueryProvider`
3. `AuthProvider`
4. `AppStateProvider`
5. `RouterProvider`

The router is intentionally thin right now: `packages/web/src/routes/router.tsx` defines a root layout plus a single index route, and most screen state lives in provider state rather than route params.

Important web behavior:
- API calls go through `packages/web/src/lib/api.ts`.
- The client keeps the short-lived access token in memory only.
- Refresh uses `POST /api/v1/auth/refresh` with `credentials: include` and retries the failed request once after refresh.
- Vite proxies `/api` to the API server; override with `VITE_PROXY_TARGET` when needed.

When changing auth or selection flows, check both the auth provider and app-state provider before assuming state is router-driven.

### Android app structure
The Android app is a separate client, not a wrapper around the web app.

The main Android flow is:
- `network/*`: Retrofit/Moshi models and API definitions for the same backend envelope conventions.
- `data/RssRepository.kt`: main client-side data layer. It owns API calls, session handling, retry/backoff, and short-lived in-memory caching/invalidation.
- `ui/MainViewModel.kt`: central screen-state orchestrator for auth, categories, feeds, articles, search, preferences, stats, admin settings, and OPML flows.
- `ui/SelfFeedApp.kt`: top-level Compose shell using a single `AppUiState` stream.

Important Android behavior:
- The app is effectively ViewModel-driven from a single root state object, not split across many feature-specific viewmodels.
- Read-heavy endpoints use repository caching plus bounded retry logic.
- Debug API base URL is configured in Gradle `buildConfigField`; check `packages/android/app/build.gradle.kts` before assuming emulator host mapping.

## Testing and environment notes

### Project navigation fast paths
- Web article list and reader UI live under `packages/web/src/components/articles/`.
- Web app-wide selection, filter, feed, and article state flows through `packages/web/src/providers/app-state-provider.tsx`.
- Web API calls are centralized in `packages/web/src/lib/api.ts`; check this before changing auth retry, refresh, or envelope handling.
- Web unit tests live in `packages/web/tests/unit/`; Playwright specs live in `packages/web/tests/e2e/`.
- API route changes usually trace through `packages/api/src/routes/` -> `packages/api/src/services/` -> `packages/api/src/repositories/` -> `packages/api/src/db/schema.ts`.
- Shared request/response contracts live in `packages/shared/src/`; update these before downstream consumers when payload shapes change.

### API and E2E harnesses
The integration and E2E scripts under `scripts/` create a disposable Redis container and temporary SQLite database automatically using either Podman or Docker.

- `scripts/run-api-integration.ts` starts ephemeral services, migrates, runs API integration tests, and tears everything down.
- `scripts/run-playwright.ts` starts ephemeral services, migrates, seeds E2E data, launches API and web on free ports, waits for readiness, runs Playwright, then cleans up.
- `scripts/test-env.ts` is the shared harness that chooses Podman first, falls back to Docker, and allocates free local ports.

If integration or E2E tests fail, inspect these scripts before changing app code; failures may be test-harness or container-runtime related.

### Local infra assumptions
- Main local API URL: `http://localhost:3000`
- Main local web URL: `http://localhost:5173`
- Compose services provide Redis 8.8.
- API defaults to `packages/api/.env` first, then falls back to root `.env.example` values where available.

### Git, CI, and deployment workflow
- Before committing or pushing, check `git status -sb` and `git log --oneline --decorate -5`. This repo can have local branches with unrelated user commits, so do not push `main` blindly.
- When only the current work should go to production and local `main` has unrelated commits, create or use a clean branch based on `origin/main`, commit there, and push with `git push origin HEAD:main`.
- If GitHub reports the PR-only rule was bypassed on direct push, that is expected for admin-authenticated deploy work, but still confirm the pushed commit list is exactly what was intended.
- After pushing to `main`, watch GitHub Actions with `gh run list --branch main --limit 10 --json databaseId,workflowName,status,conclusion,headSha,createdAt,displayTitle,url` and `gh run watch <run-id> --exit-status`.
- After pushing any commit, treat the push as incomplete until every GitHub Actions workflow triggered for that pushed SHA has finished successfully. Do not report the push as done while a triggered workflow is queued, in progress, waiting for approval, failed, or cancelled.
- The important workflows for a production push are `CI`, `Security`, `Containers`, and then `Deploy`. `Deploy` is triggered by a successful `Containers` workflow run.
- Also verify `Android CI` for pushed SHAs when that workflow is triggered.
- The `Security` workflow runs Trivy against `bun.lock`. If it flags a transitive package, prefer a root `package.json` `overrides` entry plus a regenerated lockfile, then verify with `bun audit --audit-level high` and `bun pm why <package>`.
- The root `package.json` currently overrides `undici` to `7.28.0` to satisfy Trivy for `CVE-2026-9697`; keep that override until all transitive consumers naturally resolve to a fixed version.
- The `Deploy` workflow uses the protected `production` environment and usually pauses in `waiting`. Check pending approvals with `gh api /repos/Gustav0ar/Self-RSS/actions/runs/<run-id>/pending_deployments`.
- If `current_user_can_approve` is true and CI/Security/Containers are green for the same `headSha`, approve the latest deploy with:
  `gh api --method POST /repos/Gustav0ar/Self-RSS/actions/runs/<run-id>/pending_deployments --input -`
  using JSON like `{"environment_ids":[<environment-id>],"state":"approved","comment":"Approve deploy for <sha> after CI, Security, and Containers passed"}`.
- Do not approve older waiting deploy runs after a newer commit has superseded them unless the user explicitly asks for that exact SHA.
- Deployment details and one-time VPS setup are documented in `DEPLOY.md`; use that file as the source of truth for production secrets, environment variables, and VPS path assumptions.

### System-specific build notes
On this system, use the following paths for manual builds if not using the wrapper:
- **JAVA_HOME**: `/home/gustavo/.local/share/JetBrains/Toolbox/apps/android-studio/jbr`
- **Java Binary**: `/home/gustavo/.local/share/JetBrains/Toolbox/apps/android-studio/jbr/bin/java`
- **Gradle Binary**: `/home/gustavo/.gradle/wrapper/dists/gradle-9.5.1-bin/iq79hdu3mqx29lgffhp8bfmx/gradle-9.5.1/bin/gradle`

To build the Android app using the specific Java path:
`JAVA_HOME=/home/gustavo/.local/share/JetBrains/Toolbox/apps/android-studio/jbr ./packages/android/gradlew -p packages/android :app:assembleDebug`

## Change guidance for future Claude sessions
- Prefer updating shared contracts and validation before touching downstream consumers.
- For backend feature work, trace the full path: route -> service -> repository -> schema/shared contract.
- For web auth issues, inspect `packages/web/src/lib/api.ts` and provider state before changing route code.
- For Android behavior changes, expect most logic to flow through `RssRepository` and `MainViewModel`, with `SelfFeedApp` mostly rendering current state.
- If a change affects API payloads, check both web and Android clients, even if only one visibly breaks.
