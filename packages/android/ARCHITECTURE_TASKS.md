# Android Architecture Tasks

## Implemented

- Moved app-wide Compose coordination out of `MainActivity` into `SelfFeedAppRoute`.
- Added feature-scoped repository implementations for auth, feeds, articles, search, settings, and app status.
- Extracted shared repository runtime concerns for safe API calls, retry/backoff, memory caching, cache metrics, and debug resilience snapshots.
- Extracted read-state SSE connection/reconnect handling into `ReadStateStreamClient`.
- Replaced the manual `AppContainer` object graph with Hilt application/activity/ViewModel injection.
- Bound feature repository interfaces through Hilt so ViewModels depend on focused contracts instead of the monolithic repository.
- Replaced the manual `androidx.sqlite` helper in `LocalStore` with a Room database, DAO, and typed local entities.
- Removed destructive Room fallback behavior and centralized explicit migration registration.
- Enabled committed Room schema export and added migration validation coverage for the current schema.
- Stored article summaries as typed Room rows, with page cache entries retaining only ordered article IDs and cursor metadata.
- Added Room query entries, remote keys, and a Paging 3 `RemoteMediator` so article paging reads from Room while network calls fill the database.
- Added a Room-backed pending read-state mutation queue so offline read/unread actions update the local source of truth and flush when reads resume online.
- Added repository-level coverage for flushing queued read-state mutations after connectivity returns.
- Preserved the existing `LocalStore` API so repository behavior and tests remain stable.
- Converted feed sync background work to Hilt Worker injection instead of casting the application context.
- Fixed article/feed/category cache invalidation to avoid stale article pages after category mutations.
- Made the shell article queue prefer the current Paging snapshot over the legacy manual cursor list.
- Removed manual article cursor/has-more/loading-more state from `ArticlesViewModel`; Paging 3 owns article pagination.
- Split Retrofit calls out of `RssRepository` into dedicated auth, feed, article, search, and settings remote data sources.
- Kept repository policy centralized while remote data sources own request-envelope translation.
- Optimized Paging read-state override mapping by snapshotting overrides once per `PagingData` emission.
- Added a database-version guard so future Room version bumps require registered migrations and migration tests.
- Added a Hilt androidTest runner, fake repository graph, and replacement module for device UI tests.
- Replaced placeholder Android UI coverage with real `ArticlesTab` behavior coverage and a Hilt-backed `MainActivity` smoke test.
- Removed the obsolete manual cursor `PagingSource`, cursor-page cache, and fallback UI path; Paging 3 `RemoteMediator` plus Room query entries are now the sole article-list implementation.
- Added `RemoteMediator` characterization coverage for refresh, append, cached initialization, and failed refresh retention.
- Narrowed the articles ViewModel, warming, enrichment, and read-state managers to `ArticleRepository` rather than the full application repository.
- Moved screen contracts into a feature-owned file and split Search/Stats into their own destinations; future feature additions no longer need to expand the shared shell contract.
- Moved app lifecycle, preference, sync, and article-event workflow policy into a testable `AppWorkflowCoordinator`.
- Added emulator-backed instrumentation CI and a manually generated release Baseline Profile on a Gradle-managed device.

## Remaining Deepening Work

1. Keep macrobenchmarks manual and investigate timing regressions with a physical device before introducing numeric CI thresholds.
2. Introduce use-case classes only if a workflow is shared outside the app-shell coordinator or requires independent reuse.

## Target Shape

```text
MainActivity
  -> SelfFeedAppRoute
    -> AppWorkflowCoordinator
    -> feature ViewModels
      -> optional use cases for shared workflows
        -> feature repositories
          -> Room DAOs as local source of truth
          -> Retrofit remote data sources
```
