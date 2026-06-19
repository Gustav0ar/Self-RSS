# Plan 005: Replace unsafe silent article refresh merging with safe refetch behavior

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions occurs, stop and report. When done, update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b14d79b..HEAD -- packages/web/src/hooks/use-silent-article-refresh.ts packages/web/src/components/articles/feed-view.tsx packages/web/tests/unit/feed-view-refresh.test.tsx packages/web/tests/unit`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 001
- **Category**: bug
- **Planned at**: commit `b14d79b`, 2026-06-19

## Why this matters

The silent refresh hook manually prepends newly fetched first-page articles, truncates page 1, and leaves pages 2+ and page cursors untouched. When new articles arrive, articles displaced from the first page are not shifted into later pages, so users can temporarily miss articles at page boundaries.

## Current state

```ts
// packages/web/src/hooks/use-silent-article-refresh.ts:34-38
// Pages 2+ are never touched, the cursor stays valid, and the active article / scroll
// position are preserved.
```

```ts
// packages/web/src/hooks/use-silent-article-refresh.ts:64-81
const existing = cached.pages[0].data;
const existingIds = new Set(existing.map((a) => a.id));
const newOnes = fresh.data.filter((a) => !existingIds.has(a.id));
if (newOnes.length === 0) return;
const merged = [...newOnes, ...existing].slice(0, limit);
const firstPage: Page = {
  ...cached.pages[0],
  data: merged,
  hasMore: cached.pages[0].hasMore || fresh.hasMore,
};
const next: ArticleList = {
  pages: [firstPage, ...cached.pages.slice(1)],
  pageParams: cached.pageParams,
};
qc.setQueryData(queryKey, next);
```

`FeedView` later flattens and de-dupes pages at `feed-view.tsx:83-96`, which hides duplicates but cannot restore displaced articles.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Web unit focus | `bun run --filter '@self-feed/web' test -- tests/unit/use-silent-article-refresh.test.tsx tests/unit/feed-view-refresh.test.tsx` | exit 0 |
| Web unit all | `bun run --filter '@self-feed/web' test -- tests/unit` | exit 0 |
| Typecheck | `bun run typecheck` | exit 0 |

## Scope

**In scope**:

- `packages/web/src/hooks/use-silent-article-refresh.ts`
- New focused test file, recommended `packages/web/tests/unit/use-silent-article-refresh.test.tsx`
- Existing FeedView tests only if behavior needs updates

**Out of scope**:

- Encoding article cursors in the web client.
- Rewriting FeedView pagination.
- Changing the API article list contract.

## Git workflow

- Branch: `advisor/api-web-findings-e2e`
- Suggested commit subject: `Make silent article refresh pagination safe`

## Steps

### Step 1: Replace partial page mutation with safe invalidation/refetch

Keep the hook's trigger behavior, freshness guard, and in-flight guard. Continue fetching the first page to detect whether new articles exist. If there are no new article ids, do nothing.

If new article ids exist, do not call `setQueryData` to manually merge pages. Instead, invalidate or refetch the exact infinite query so TanStack Query and the API rebuild pages and cursors consistently.

Recommended implementation:

- Use `qc.invalidateQueries({ queryKey, exact: true })` or `qc.refetchQueries({ queryKey, exact: true, type: 'active' })`.
- Prefer the option that preserves current mounted query behavior and does not refetch unrelated article lists.
- Update the hook comment so it no longer claims pages 2+ and cursor remain valid after a manual merge.

**Verify**: `bun run --filter '@self-feed/web' test -- tests/unit/feed-view-refresh.test.tsx` -> exit 0.

### Step 2: Add direct hook tests

Create `packages/web/tests/unit/use-silent-article-refresh.test.tsx`.

Use `QueryClientProvider` and `renderHook` or a small probe component. Mock `apiFetch` from `src/lib/api`.

Required tests:

- No QueryClient mounted: hook is a no-op and does not throw.
- Cached first page exists, API returns no new ids: query data is unchanged and no invalidation/refetch occurs.
- Cached two pages exist, API returns new ids: hook invalidates/refetches the exact query and does not manually truncate/rewrite cached `pages`.
- Hidden document or in-flight guard skips duplicate work. Use fake timers or direct event dispatch only if reliable.

Trigger the hook with `window.dispatchEvent(new Event('focus'))` or document visibility changes. Use fake timers carefully and restore timers after each test.

**Verify**: `bun run --filter '@self-feed/web' test -- tests/unit/use-silent-article-refresh.test.tsx` -> exit 0.

### Step 3: Stabilize hook dependencies if needed

`FeedView` currently passes an inline object to `useSilentArticleRefresh` at `feed-view.tsx:73`. If tests show listener churn or repeated refreshes, memoize the params object in `FeedView` or memoize the built query key inside the hook.

Do not add this change unless tests expose the churn as a bug; keep the plan focused.

**Verify**: `bun run --filter '@self-feed/web' test -- tests/unit/feed-view-refresh.test.tsx tests/unit/use-silent-article-refresh.test.tsx` -> exit 0.

## Test plan

- Direct hook tests around cache mutation/refetch behavior.
- Existing FeedView refresh tests continue to pass.
- Full web unit suite before release.

## Done criteria

- [ ] Silent refresh no longer manually truncates page 1 while preserving stale later pages.
- [ ] New ids cause exact article query invalidation/refetch.
- [ ] No-new-id refresh remains a no-op.
- [ ] Direct hook tests exist and pass.
- [ ] `bun run --filter '@self-feed/web' test -- tests/unit` exits 0.
- [ ] `bun run typecheck` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- Product requirements demand preserving scroll without any query refetch, because that requires a more complex server-assisted pagination strategy.
- The chosen invalidation/refetch path causes visible selection loss or scroll regression in existing tests.
- Fixing this requires client-side cursor encoding.

## Maintenance notes

Reviewer focus: correctness beats local page surgery here. If future UX requires seamless insertion without refetching pages, design it with server-supported cursor/page shifting.
