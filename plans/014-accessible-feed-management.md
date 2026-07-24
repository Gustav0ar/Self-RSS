# Plan 014: Make feed health and category reordering keyboard- and touch-accessible

> **Drift check**: `git diff --stat 49e78b4..HEAD -- packages/web/src/components/layout/sidebar-tree.tsx packages/web/tests/unit/sidebar-reorder.test.ts packages/web/tests/unit/sidebar-sync-warning.test.tsx`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plan 010
- **Category**: bug
- **Planned at**: commit `49e78b4`, 2026-07-24

## Why this matters

Native HTML drag-and-drop has no keyboard move operation and is unreliable on
touch. Feed warnings also advertise hover details while their described node
does not exist until the tooltip opens.

## Current state

- `sidebar-tree.tsx:276-325` implements category reorder with drag events only.
- `sidebar-tree.tsx:153-173` tells users to hover.
- `sidebar-tree.tsx:451-559` points `aria-describedby` at a conditionally
  rendered tooltip; the warning span is not focusable.
- Current warning tests exercise mouse hover only.

## Scope

In scope: SidebarTree and its unit/E2E tests.
Out of scope: replacing the full sidebar, changing category persistence, or
adding a large drag-and-drop dependency unless native fallbacks prove
insufficient.

## Steps

1. Add visible-on-focus Move up/Move down controls (or an equivalent menu) for
   each category. Reuse the existing reorder mutation and enforce sibling-level
   boundaries.
2. Announce successful position changes through a polite live region. Preserve
   pointer dragging as an optional enhancement.
3. Always render a stable screen-reader-only feed-health description. Make the
   warning detail reachable by focus/click/touch and replace hover-only copy.
4. Verify focus order, Escape behavior, and 44px-equivalent touch targets where
   controls are exposed.

## Verification

- Unit tests cover keyboard reorder, boundaries, announcement, focus-visible
  health details, and stable `aria-describedby`.
- Mobile E2E covers touch/click health details and reorder fallback.
- `bun run --filter '@self-feed/web' test`, `bun run lint`, and
  `bun run typecheck` pass.

## STOP conditions

Stop if keyboard operations can move a category across parent boundaries or if
the mutation payload cannot express the visible order deterministically.

## Maintenance notes

Pointer drag is never the only way to perform a persisted action. Tooltip text
needed for comprehension must exist in the accessibility tree at rest.
