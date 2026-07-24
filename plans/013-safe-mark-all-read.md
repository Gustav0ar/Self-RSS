# Plan 013: Confirm and report the result of bulk read-state changes

> **Drift check**: `git diff --stat 49e78b4..HEAD -- packages/web/src/components/articles/feed-view.tsx packages/web/src/hooks/queries/article-hooks.ts packages/web/src/components/management/confirm-dialog.tsx packages/web/tests`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plan 010
- **Category**: bug
- **Planned at**: commit `49e78b4`, 2026-07-24

## Why this matters

One web click can mark an entire account, category, or feed as read with no
confirmation and no visible failure. Android already confirms this action, so
the clients currently offer different safety guarantees.

## Current state

- `feed-view.tsx:270-273,344-346` invokes the mutation directly.
- `article-hooks.ts:304-315` invalidates only on success and exposes no UI.
- `confirm-dialog.tsx` is the existing confirmation/error component.
- `SelfFeedApp.kt:562-577` is the Android behavioral reference.

## Scope

In scope: FeedView, mark-all hook if required, focused web unit/E2E tests.
Out of scope: implementing bulk undo or changing the API response.

## Steps

1. Open `ConfirmDialog` instead of mutating immediately. Describe the exact
   scope (“all feeds”, category name, or feed title) and show the known unread
   count.
2. Disable repeat submission while pending. Close only after success.
3. Keep the dialog open on error and display actionable retryable copy.
4. Reset retained-read state only when confirmation begins successfully, not
   when the toolbar button is merely clicked.

## Verification

- Add tests for cancel, exact scope copy, pending state, success, and rejection.
- Add one E2E assertion that cancellation leaves unread state unchanged.
- Targeted web tests, `bun run typecheck`, and `bun run lint` pass.

## STOP conditions

Stop if confirming the action requires loading unbounded article IDs or if
optimistic cache behavior would make a failed request appear successful.

## Maintenance notes

Keep terminology identical across button, dialog, and success/error feedback:
“Mark all read.”
