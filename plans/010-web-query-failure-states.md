# Plan 010: Give every primary web query an actionable failure state

> **Executor instructions**: Run the drift check and all tests. Match the
> existing SelfFeed visual language: compact surface cards, plain sentence-case
> copy, visible focus, and Retry as the primary recovery action.
>
> **Drift check**: `git diff --stat 49e78b4..HEAD -- packages/web/src/providers/query.tsx packages/web/src/components/stats packages/web/src/components/preferences packages/web/src/components/layout/sidebar.tsx packages/web/src/components/articles/feed-view.tsx packages/web/tests/unit`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plan 009
- **Category**: bug
- **Planned at**: commit `49e78b4`, 2026-07-24

## Why this matters

Permanent request failures currently look like endless loading or legitimate
empty data. Users cannot distinguish an empty account from a disconnected API,
and most affected surfaces offer no recovery action.

## Current state

- `stats-panel.tsx:6-10` treats missing data as loading without reading
  `isError`.
- `preferences-panel.tsx:28,94-105` can leave the modal on `Loading...`.
- `sidebar.tsx:46-49` converts failed category data to an empty tree.
- `feed-view.tsx:80-107` ignores article/category query errors.
- `reader-pane.tsx:174-190` is the existing exemplar: explicit error copy plus
  a Retry button that calls `refetch`.

## Scope

In scope: the files above; a focused reusable async-error component under
`packages/web/src/components/`; corresponding unit tests.
Out of scope: API response shapes, global toast infrastructure, visual redesign,
or changing React Query retry counts.

## Steps

1. Add a small reusable query failure component with a concise title,
   explanatory text, `role="alert"`, and a keyboard-accessible Retry button.
2. Destructure `isError`, `error`, and `refetch` on stats, preferences,
   categories/sidebar, and article-list queries. Preserve stale data when it
   exists; show the blocking failure state only when no usable data exists.
3. Ensure empty states render only after a successful query with an empty
   result. Do not throw query errors into the existing render ErrorBoundary.
4. Add component tests for failed-without-data, failed-with-stale-data, retry,
   and genuine empty success.

## Verification

- `bun run --filter '@self-feed/web' test -- tests/unit/stats-panel.test.tsx tests/unit/preferences-panel.test.tsx tests/unit/sidebar-selection.test.tsx tests/unit/feed-view-selected-article.test.tsx`
  exits 0 with new failure-state assertions.
- `bun run --filter '@self-feed/web' typecheck` and `bun run lint` exit 0.
- No success response with an empty list is labeled as an error.

## STOP conditions

Stop if fixing a surface requires changing an API contract or if stale React
Query data would be discarded during a background refetch failure.

## Maintenance notes

All future primary queries should implement the same loading/error/empty/stale
state order. Review copy from the user's perspective; never expose raw stack
traces.
