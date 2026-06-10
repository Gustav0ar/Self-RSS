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
- Run only the web app: `bun run dev:web`
- Stop local infra: `bun run dev:down`

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
