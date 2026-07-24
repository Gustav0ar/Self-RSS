# Plan 012: Let a new user add a first feed without prerequisite work

> **Drift check**: `git diff --stat 49e78b4..HEAD -- packages/web/src/components/layout/sidebar-body.tsx packages/web/src/components/management/feed-dialog.tsx packages/web/src/hooks/queries/category-hooks.ts packages/web/tests`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 010
- **Category**: direction
- **Planned at**: commit `49e78b4`, 2026-07-24

## Why this matters

The empty state invites a user to add a feed while the Add Feed action is
disabled until a category exists. The first successful action should be adding
the source they came for.

## Current state

- `sidebar-body.tsx:95-103` disables Add Feed when there are no categories.
- `feed-dialog.tsx:29,157-205` requires a category and disables submission.
- `feed-view-model.ts:109-112` tells an empty user to add a feed.
- `useCreateCategory` already exposes `mutateAsync`; category dialogs establish
  the repository's mutation/error style.

## Scope

In scope: sidebar Add Feed availability, create-mode FeedDialog, category/feed
query hooks only if needed, focused unit/E2E tests.
Out of scope: nullable database category IDs, registration contract changes,
or a broad onboarding redesign.

## Steps

1. Enable Add Feed for an empty account.
2. In create mode with zero categories, explain that SelfFeed will create a
   `General` category and then add the feed. Keep edit mode unchanged.
3. On submit, create `General`, use its returned ID to create the feed, and
   surface either failure without losing entered URL/title. If category
   creation succeeds but feed creation fails, reuse the newly cached category
   on retry rather than creating duplicates.
4. Keep the UI compact and consistent with existing modal surfaces; no
   celebratory wizard or new visual system.

## Verification

- Extend `feed-dialog.test.tsx` for zero-category success, category failure,
  feed failure after category success, retry without duplicate category, and
  existing-category behavior.
- Add an E2E first-user flow: register, click Add Feed immediately, and confirm
  the resulting feed/category appears.
- `bun run --filter '@self-feed/web' test -- tests/unit/feed-dialog.test.tsx`
  and `bun run test:e2e` pass.

## STOP conditions

Stop if `useCreateCategory` does not return the created category ID or if
duplicate-category protection cannot be made deterministic.

## Maintenance notes

If the backend later supports uncategorized feeds, replace this compatibility
flow deliberately rather than maintaining both behaviors.
