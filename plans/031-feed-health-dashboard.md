# Plan 031: Expose actionable feed sync history on web and Android

> **Executor instructions**: Reuse existing feed-health copy/status mappings,
> QueryFailure, realtime invalidation, and localized Compose surfaces. Error
> details may contain remote publisher text; render as plain text only.
>
> **Drift check**: `git diff --stat b34c5b9..HEAD -- packages/shared/src packages/api/src/repositories/settings.repository.ts packages/api/src/routes packages/api/src/services/stats.service.ts packages/api/src/openapi packages/api/tests packages/web/src/components/stats packages/web/src/components/feeds packages/web/src/hooks packages/web/tests packages/android/app/src/main packages/android/app/src/test packages/api/openapi.json`

## Status

- **State**: DONE
- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans 023 and 024
- **Category**: direction
- **Planned at**: commit `b34c5b9`, 2026-07-24

## Why this matters

The backend records sync runs and rich feed lifecycle state, but clients mostly
show only the latest error. Self-hosting operators need a timeline that
explains what failed, when it will retry, and what safe action they can take.

## Current state

- `packages/api/src/repositories/settings.repository.ts:48-67` returns recent
  user sync runs, and `StatsResponse` already includes them.
- `packages/shared/src/domain/types.ts:142-151` defines `SyncRun`, but it lacks
  feed title and retry/lifecycle context.
- `packages/web/src/hooks/queries/stats-hooks.ts:7-18` weakens
  `recentSyncRuns` to `unknown[]`; `stats-panel.tsx:56-62` only counts failures.
- Android models recent runs as `List<Map<String, Any?>>`, so it cannot render
  a type-safe history.
- Existing web `feed-health.ts` and Android `FeedLifecyclePresentation.kt`
  centralize current-state copy. Extend those mappings rather than duplicating
  status language.

## Scope

In scope: typed sync-run contract, feed title, paginated owned per-feed
history endpoint, stats timeline, feed-detail history/action UI on web and
Android, manual retry, realtime/cache refresh, tests and OpenAPI.

Out of scope: exposing global worker/admin telemetry to ordinary users,
publisher credentials, automatic policy changes, editing retry/backoff
configuration, or retaining history beyond configured server retention.

## Steps

1. Extend the shared sync-run response with nullable feed title and explicit
   normalized status fields. Add a paginated response for
   `GET /feeds/:id/sync-runs`; validate bounded limit/cursor.
2. Add repository/service ownership checks and stable newest-first pagination.
   A deleted or foreign feed must not expose history. Return sanitized,
   length-bounded error text.
3. Add route/OpenAPI and integration tests for ownership, pagination ties,
   running/success/failed runs, missing HTTP status, deleted feed, and error
   sanitization.
4. Replace web `unknown[]` with the shared type. Add an accessible recent-sync
   timeline to Stats and an expandable per-feed history panel containing time,
   duration, item count, HTTP outcome, plain-text error, current retry/backoff
   explanation, and a guarded “Retry now” action.
5. Add equivalent typed Android models and adaptive Compose history within
   feed details/stats. Reuse the existing sync action and confirmation/pending
   state; localize every label.
6. Invalidate/refetch affected history after manual sync and relevant SSE feed
   events. Preserve stale history with a warning on refresh failure.
7. Test empty/loading/error/stale/pagination/retry states, keyboard/screen-reader
   web behavior, and narrow/wide Android layouts.

## Verification

- API unit/integration, web unit/E2E, and Android unit/Compose tests pass.
- `mise exec -- bun run openapi:generate` produces only reviewed sync-history
  changes.
- `mise exec -- bun run typecheck`, lint, build, and `android:check` exit 0.
- No client production model contains `unknown[]` or
  `List<Map<String, Any?>>` for sync runs.

## STOP conditions

Stop if history cannot be ownership-filtered in one query, if error text would
be rendered as HTML, or if Retry bypasses the durable refresh queue and its
rate/backoff controls.

## Maintenance notes

Keep lifecycle copy centralized. New server statuses must be added to shared
types and exhaustively mapped on both clients.
