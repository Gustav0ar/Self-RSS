# Plan 001: Emit compatible article cursors from every cache path

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions occurs, stop and report. When done, update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b14d79b..HEAD -- packages/api/src/services/article-cache.service.ts packages/api/src/services/article.service.ts packages/api/src/repositories/article.repository.ts packages/api/tests/unit/article-cache.service.test.ts packages/api/tests/integration/app.integration.test.ts packages/web/src/hooks/queries.ts`
> If any in-scope file changed since this plan was written, compare the current-state excerpts below against live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `b14d79b`, 2026-06-19

## Why this matters

The uncached article list emits opaque cursors shaped as `articleId:unixSeconds:direction`, and the repository decoder depends on that shape. The article-list cache emits id-only cursors, so a warm first page can make the next page request fall back to page 1. The web de-dupes repeated articles, which hides the duplicate page but can make "load more" appear to do nothing or skip expected articles.

## Current state

- `packages/api/src/services/article.service.ts` owns the DB-backed article list response and has a private `encodeCursor` helper.
- `packages/api/src/services/article-cache.service.ts` builds cached global, feed, and category article lists but emits bare ids as cursors.
- `packages/api/src/repositories/article.repository.ts` decodes only the opaque 3-part cursor.
- `packages/web/src/hooks/queries.ts` passes `lastPage.cursor` into `fetchNextPage` without transformation.

Key excerpts:

```ts
// packages/api/src/services/article-cache.service.ts:138-147
const result = filtered.slice(0, cursorIndex + 1);
const hasMore = result.length > cursorIndex;
const items = result.slice(0, cursorIndex);
return {
  articles: items,
  cursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
  hasMore,
  meta: data.meta,
};
```

```ts
// packages/api/src/services/article-cache.service.ts:267
cursor: hasMore ? (result[result.length - 1]?.id ?? null) : null,
```

The same id-only pattern also exists in feed/category warming paths at `article-cache.service.ts:335` and `article-cache.service.ts:416`.

```ts
// packages/api/src/repositories/article.repository.ts:20-47
// format is `<articleId>:<unixSeconds>:<direction>`
const parts = cursor.split(':');
if (parts.length !== 3) return null;
```

```ts
// packages/api/src/services/article.service.ts:351-363
function encodeCursor(item, sort): string | null {
  if (!item) return null;
  const seconds = Math.floor((item.publishedAt ?? item.fetchedAt).getTime() / 1000);
  const direction = sort === 'oldest' ? 'a' : 'd';
  return `${item.id}:${seconds}:${direction}`;
}
```

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| API unit focus | `bun run --filter '@self-feed/api' test -- tests/unit/article-cache.service.test.ts` | exit 0 |
| API integration focus | `bun run --filter '@self-feed/api' test:integration -- tests/integration/app.integration.test.ts` | exit 0 |
| Web unit focus | `bun run --filter '@self-feed/web' test -- tests/unit/queries-hooks.test.tsx` | exit 0 |
| Typecheck | `bun run typecheck` | exit 0 |

## Scope

**In scope**:

- `packages/api/src/services/article-cache.service.ts`
- `packages/api/src/services/article.service.ts`
- A new small API utility such as `packages/api/src/utils/article-cursor.ts`, if needed
- `packages/api/tests/unit/article-cache.service.test.ts`
- `packages/api/tests/integration/app.integration.test.ts`
- `packages/web/tests/unit/queries-hooks.test.tsx`, only if client cursor encoding expectations need coverage

**Out of scope**:

- Changing public article response fields.
- Changing cursor format for already valid 3-part cursors.
- Adding cursor encoding to the web client. Cursors must stay opaque to clients.
- Refactoring article search pagination, except to import the same API cursor helper if necessary.

## Git workflow

- Branch: `advisor/api-web-findings-e2e`
- Commit after this plan passes targeted tests. Suggested subject: `Fix cached article pagination cursors`

## Steps

### Step 1: Extract or share the API cursor encoder

Create a single API-side cursor encoder that can be used by both DB-backed article responses and cached article snapshots. It must produce exactly `id:seconds:direction` where `direction` is `a` for `oldest` and `d` otherwise.

Recommended shape:

- Move `encodeCursor` out of `ArticleService` into `packages/api/src/utils/article-cursor.ts`.
- Export a helper that accepts either Date fields or an ISO/display timestamp, for example:
  - `encodeArticleCursorFromDates(item: { id: string; publishedAt: Date | null; fetchedAt: Date }, sort?: string)`
  - `encodeArticleCursorFromDisplayedAt(item: { id: string; displayedAt: string }, sort?: string)`
- Keep decoding in `ArticleRepository` unless you need a shared decoder for tests.
- Fix the stale comment at `article.service.ts:115-119` so it mentions the direction suffix.

**Verify**: `bun run --filter '@self-feed/api' test -- tests/unit/article.service.test.ts` -> exit 0.

### Step 2: Use the shared encoder in ArticleService

Replace private `encodeCursor` calls in `ArticleService.getArticles` and `ArticleService.search` with the shared helper. The returned cursor for DB-backed lists must be unchanged for existing valid tests.

**Verify**: `bun run --filter '@self-feed/api' test:integration -- tests/integration/app.integration.test.ts` -> exit 0, including `paginates article lists with a stable cursor`.

### Step 3: Use compatible cursors in cached list reads

In `ArticleCacheService.getCachedArticleList`, compute the cursor from the last item actually returned to the client, not from the raw cached list. For cached snapshots, use `displayedAt` as the encoded timestamp because it is already the API-visible sort key equivalent of `publishedAt ?? fetchedAt`.

Required behavior:

- Latest sorted cached pages use direction `d`.
- Oldest sorted cached pages use direction `a`.
- No cursor is returned when `hasMore` is false.
- Empty lists return `cursor: null`.
- Corrupt cache behavior remains unchanged.

**Verify**: Add a unit test in `article-cache.service.test.ts` where 3 cached articles are requested with `limit: 2`; assert `hasMore` is true and `cursor` matches `secondArticleId:<unixSeconds>:d`. Add a second assertion or test for `sort: 'oldest'` producing direction `a`. Then run `bun run --filter '@self-feed/api' test -- tests/unit/article-cache.service.test.ts` -> exit 0.

### Step 4: Fix all cache population cursor fields

Update global, feed-specific, and category-specific cache population so any stored cursor field is also compatible. Even if `getCachedArticleList` recomputes the cursor today, stored cache payloads should not contain an invalid shape.

Search must return no id-only cache cursor assignments:

`rg -n "cursor: hasMore \\? \\([^:]+\\.id|\\? \\(.*\\?\\.id" packages/api/src/services/article-cache.service.ts`

Expected result: no matches for id-only cursor assignment. Manual inspection is acceptable if the regex is too broad, but every `cursor:` in `article-cache.service.ts` must either be `null` or call the shared encoder.

**Verify**: `bun run --filter '@self-feed/api' test -- tests/unit/article-cache.service.test.ts` -> exit 0.

### Step 5: Add cached-pagination integration coverage

Extend `packages/api/tests/integration/app.integration.test.ts` near the existing stable cursor test. The new test must prove the first page comes from a warm cache and the second page is still the true next page.

Suggested test structure:

1. Create a user, category, and feed with 35 deterministic RSS items.
2. Sync the feed.
3. Trigger cache warming through the service/deps available in the integration harness if accessible, or call the public flow that warms the cache. If direct warming is not reachable from the test harness, add a focused service-level test instead and document why in the test name.
4. Request `/api/v1/articles?sort=latest&limit=30` with no cursor.
5. Assert `cursor` has 3 colon-separated parts.
6. Request page 2 with that cursor.
7. Assert page 2 starts at item 5 and does not duplicate any item from page 1.

**Verify**: `bun run --filter '@self-feed/api' test:integration -- tests/integration/app.integration.test.ts` -> exit 0.

## Test plan

- Unit: cached list emits valid latest and oldest cursor shapes.
- Integration: warm-cache first page followed by cursor page returns true page 2.
- Existing: DB-backed pagination test continues to pass.
- Optional web unit: `buildArticleSearchParams` continues to URL-encode colon cursors; existing test at `queries-hooks.test.tsx:221` already covers this.

## Done criteria

- [ ] No id-only cursor is emitted from `ArticleCacheService`.
- [ ] `ArticleService` and `ArticleCacheService` use one API-side cursor encoder.
- [ ] Cached first-page pagination has a regression test.
- [ ] `bun run --filter '@self-feed/api' test -- tests/unit/article-cache.service.test.ts` exits 0.
- [ ] `bun run --filter '@self-feed/api' test:integration -- tests/integration/app.integration.test.ts` exits 0.
- [ ] `bun run typecheck` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- The live repository now accepts id-only cursors intentionally and has tests proving that behavior.
- Fixing cache cursors requires changing the public response shape beyond the opaque cursor string.
- The warm-cache integration harness cannot access cache behavior and the focused unit/service tests cannot prove the next-page regression.
- Targeted tests fail twice after reasonable fixes.

## Maintenance notes

Reviewer focus: every article-list path must use the same cursor shape. Future pagination changes must update the shared encoder and the repository decoder together.
