# Plan 025: Distinguish failed searches from empty results

> **Drift check**: `git diff --stat b34c5b9..HEAD -- packages/web/src/components/search/search-bar.tsx packages/web/src/hooks/search-queries.ts packages/web/src/components/query-failure.tsx packages/web/tests/unit packages/web/tests/e2e`

## Status

- **State**: DONE
- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plan 024
- **Category**: bug
- **Planned at**: commit `b34c5b9`, 2026-07-24

## Why this matters

After retries are exhausted, search renders “No results found” because it
ignores the query error state. That misrepresents a service failure as valid
content and offers no recovery action.

## Current state

- `packages/web/src/components/search/search-bar.tsx:39-45` reads results and
  loading flags but not `isError`, `error`, or `refetch`.
- `search-bar.tsx:230-238` maps every empty non-loading state to the success
  empty message.
- `packages/web/src/components/query-failure.tsx` is the established
  accessible error/retry component. Reuse it rather than inventing new copy or
  toast behavior.

## Scope

In scope: search loading/error/empty/stale ordering, retry action, accessible
announcement, unit and browser tests. Out of scope: FTS ranking, search syntax,
API contracts, or visual redesign.

## Steps

1. Destructure `isError`, `error`, `refetch`, and the fetching state from
   `useSearch`.
2. Render a compact `QueryFailure` when there is no usable result data. If
   cached results exist, keep them visible and render a compact stale-data
   warning above them. Render “No results found” only after a successful empty
   response.
3. Keep listbox semantics valid: error content must not masquerade as an
   option, keyboard active index must reset safely, and Retry must be reachable
   without closing the search surface.
4. Test initial failure, stale-data refresh failure, successful empty result,
   retry success, category scope, and cancellation when the query changes.

## Verification

- `mise exec -- bun run --filter '@self-feed/web' test -- tests/unit/search-bar.test.tsx`
  exits 0 with the new cases.
- `mise exec -- bun run test:e2e` includes one intercepted failed-search/retry
  assertion and exits 0.
- `mise exec -- bun run typecheck` and `mise exec -- bun run lint` exit 0.

## STOP conditions

Stop if showing the error requires clearing cached results or changing
TanStack's query key. Preserve the current two-character enable threshold.

## Maintenance notes

The render order is: initial loading, blocking error without data, stale
warning with data, successful empty, successful results.
