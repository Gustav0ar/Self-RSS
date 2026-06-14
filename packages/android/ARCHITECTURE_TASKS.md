# Android Architecture Tasks

## Implemented

- Moved app-wide Compose coordination out of `MainActivity` into `SelfFeedAppRoute`.
- Added feature-scoped repository implementations for auth, feeds, articles, search, settings, and app status.
- Extracted shared repository runtime concerns for safe API calls, retry/backoff, memory caching, cache metrics, and debug resilience snapshots.
- Extracted read-state SSE connection/reconnect handling into `ReadStateStreamClient`.
- Changed ViewModel factories to receive feature repository interfaces from `AppContainer`.
- Replaced the manual `androidx.sqlite` helper in `LocalStore` with a Room database, DAO, and typed local entities.
- Stored article summaries as typed Room rows, with page cache entries retaining only ordered article IDs and cursor metadata.
- Preserved the existing `LocalStore` API so repository behavior and tests remain stable.
- Fixed article/feed/category cache invalidation to avoid stale article pages after category mutations.
- Made the shell article queue prefer the current Paging snapshot over the legacy manual cursor list.
- Removed manual article cursor/has-more/loading-more state from `ArticlesViewModel`; Paging 3 owns article pagination.

## Remaining Deepening Work

1. Replace cursor-backed article loading with Paging 3 `RemoteMediator` once API cursor metadata can be mapped to stable remote keys.
2. Consider Hilt after repository implementations are fully separated; manual DI remains acceptable while the object graph is small.

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
