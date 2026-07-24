# Plan 011: Preserve preference changes until the server acknowledges them

> **Drift check**: `git diff --stat 49e78b4..HEAD -- packages/web/src/components/preferences/preferences-panel.tsx packages/web/src/hooks/queries/preferences-hooks.ts packages/web/tests/unit/preferences-panel.test.tsx`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 010
- **Category**: bug
- **Planned at**: commit `49e78b4`, 2026-07-24

## Why this matters

The debounce clears `pendingPatch` as soon as a request starts. On failure the
query cache rolls back, but the open draft still shows the unsaved value and
there is nothing left to retry.

## Current state

- `preferences-panel.tsx:60-71` calls `mutate` and immediately clears the patch.
- `preferences-panel.tsx:73-79` repeats that behavior on close.
- `preferences-hooks.ts:35-50` optimistically updates and rolls back the query
  cache on error.
- `preferences-panel.test.tsx:74-123` covers debounce/close/draft refresh but
  not rejection, retry, or changes made while a request is in flight.

## Scope

In scope: the two implementation files and preference-panel tests.
Out of scope: API changes, new persistence storage, or changing preference
semantics.

## Steps

1. Replace fire-and-forget saving with an acknowledgement-driven queue using
   `mutateAsync`. Keep one in-flight patch and merge later edits into a next
   patch; never run concurrent preference PATCH requests.
2. Clear only the exact acknowledged patch. On failure retain the patch, mark
   status as “Changes not saved,” and expose Retry and Revert actions.
3. Closing the panel must attempt a final flush without hiding a failure. If a
   request is pending, either keep the dialog open or show an explicit
   confirmation; do not silently abandon edits.
4. Reconcile draft, theme preview, and query cache after retry or revert.

## Verification

- Add tests for rejection retention, retry success, revert, close during
  pending, and edits arriving during an in-flight save.
- `bun run --filter '@self-feed/web' test -- tests/unit/preferences-panel.test.tsx`
  exits 0.
- `bun run --filter '@self-feed/web' typecheck` and `bun run lint` exit 0.

## STOP conditions

Stop if the proposed state machine can issue overlapping PATCH requests or if
closing the dialog can lose an unacknowledged patch.

## Maintenance notes

Keep the autosave state machine local and explicit. A reviewer should trace
every transition: clean, debounced, saving, failed, retrying, acknowledged.
