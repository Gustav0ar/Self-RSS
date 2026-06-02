# Copilot instructions for this repo

## Build, test, lint
- Lint: `bun run lint` (auto-fix: `bun run lint:fix`)
- Typecheck: `bun run typecheck`
- Build all packages: `bun run build`
- Unit tests: `bun run test` or `bun run test:unit`
- API integration tests (ephemeral Postgres/Redis): `bun run test:integration`
- Web E2E (Playwright + ephemeral infra): `bun run test:e2e`
- Full suite: `bun run test:all`
- Single test:
	- API unit: `bun run --filter '@self-feed/api' test -- tests/unit/health.test.ts`
	- API integration: `bun run --filter '@self-feed/api' test:integration -- tests/integration/app.integration.test.ts`
	- Web unit: `bun run --filter '@self-feed/web' test -- tests/unit/keyboard-nav.test.ts`
	- Playwright spec: `bun run --filter '@self-feed/web' test:e2e:runner -- tests/e2e/app.e2e.spec.ts`
- Android (not in Bun workspace): `./packages/android/gradlew -p packages/android :app:testDebugUnitTest` (unit),
  `./packages/android/gradlew -p packages/android :app:connectedDebugAndroidTest` (instrumentation),
  `./packages/android/gradlew -p packages/android :app:lintDebug :app:assembleDebug`

## High-level architecture
- Monorepo: `packages/shared` (contracts + Zod), `packages/api` (Bun + Hono + Drizzle + Postgres/Redis), `packages/web` (React 19 + TanStack Router/Query), `packages/android` (Jetpack Compose client).
- Shared contracts are the source of truth. When request/response shapes change, update `packages/shared` first, then align API routes/services and web/android consumers. Regenerate `packages/api/openapi.json` via `bun run openapi:generate`.
- API startup (`packages/api/src/index.ts`) loads env, runs migrations, connects Redis, builds deps, starts Hono app, and runs in-process jobs (feed sync scheduling + retention cleanup).
- API layering: `src/routes/*` (HTTP), `src/services/*` (business logic), `src/repositories/*` (DB), `src/config/deps.ts` (composition root), `src/db/schema.ts` (data model).
- Web app boot (`packages/web/src/main.tsx`) provider order: `ThemeProvider` → `QueryProvider` → `AuthProvider` → `AppStateProvider` → `RouterProvider`. Router is intentionally thin; most screen state lives in providers.
- Auth: JWT access tokens in memory; refresh uses `POST /api/v1/auth/refresh` with cookies and retries once. Android mirrors the same API semantics with its own storage.

## Key conventions
- Health routes are mounted without the `/api/v1` prefix.
- Article search uses Postgres full-text search (`search_vector`).
- Migrations run automatically on API boot; schema changes affect startup.
- Vite proxies `/api` to the API server; override with `VITE_PROXY_TARGET` when needed.
- Android is built and tested via Gradle under `packages/android` and is not part of the Bun workspace.
- Formatting is enforced by Biome: tabs, 100-char line width, single quotes, semicolons, trailing commas.
