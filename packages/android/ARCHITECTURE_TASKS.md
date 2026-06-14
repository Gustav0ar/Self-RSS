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

## Remaining Deepening Work

1. Split `RssRepository` into dedicated remote data sources if backend API surface area keeps growing.
2. Add Hilt-specific instrumented test replacement modules before introducing device UI tests.

## Target Shape

```text
MainActivity
  -> SelfFeedAppRoute
    -> feature ViewModels
      -> optional use cases for shared workflows
        -> feature repositories
          -> Room DAOs as local source of truth
          -> Retrofit remote data sources
```
