# Plan 002: Make article ETags change when article detail content changes

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions occurs, stop and report. When done, update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b14d79b..HEAD -- packages/api/src/routes/articles.ts packages/api/src/services/feed-sync.service.ts packages/api/src/repositories/article.repository.ts packages/api/src/db/schema.ts packages/api/tests/integration/flows.integration.test.ts packages/api/tests/unit/feed-sync.service.test.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 001
- **Category**: bug
- **Planned at**: commit `b14d79b`, 2026-06-19

## Why this matters

Article detail responses use `article.hash` in their ETag. Today new articles hash only the feed GUID, and content update paths do not update the hash. A client that sends `If-None-Match` can receive `304 Not Modified` even after the reader-visible article body, excerpt, or hero image changed.

## Current state

```ts
// packages/api/src/routes/articles.ts:27-35
// ETag = hash of content + read state. Both change on re-fetch
const etag = `"${article.hash ?? article.id}-${article.isRead ? 'r' : 'u'}"`;
if (c.req.header('If-None-Match') === etag) {
  return c.body(null, 304, { ETag: etag });
}
```

```ts
// packages/api/src/services/feed-sync.service.ts:199-223
const hash = createHash('sha256').update(guid).digest('hex');
articlesToInsert.push({
  ...
  contentHtml: sanitizedHtml || null,
  contentText: textContent || null,
  heroImageUrl: heroImage,
  hash,
});
```

```ts
// packages/api/src/repositories/article.repository.ts:435-444
.set({
  contentHtml: update.contentHtml,
  contentText: update.contentText,
  excerpt: update.excerpt,
  heroImageUrl: update.heroImageUrl,
})
```

```ts
// packages/api/src/services/feed-sync.service.ts:547-552
await this.articleRepo.updateContent(enrichment.articleId, {
  contentHtml: sanitizedHtml || null,
  contentText: textContent || null,
  excerpt,
  heroImageUrl: heroImage,
});
```

Existing coverage at `packages/api/tests/integration/flows.integration.test.ts:121` only proves unchanged content returns `304`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| API unit focus | `bun run --filter '@self-feed/api' test -- tests/unit/feed-sync.service.test.ts tests/unit/article.service.test.ts` | exit 0 |
| API integration focus | `bun run --filter '@self-feed/api' test:integration -- tests/integration/flows.integration.test.ts` | exit 0 |
| Typecheck | `bun run typecheck` | exit 0 |

## Scope

**In scope**:

- `packages/api/src/services/feed-sync.service.ts`
- `packages/api/src/repositories/article.repository.ts`
- New API utility such as `packages/api/src/utils/article-hash.ts`
- `packages/api/tests/unit/feed-sync.service.test.ts`
- `packages/api/tests/integration/flows.integration.test.ts`

**Out of scope**:

- Changing the ETag header format except for using a corrected content hash.
- Changing read-state suffix behavior (`-r` / `-u`).
- Updating titles/authors for existing GUIDs unless required by the current sync behavior.
- Adding new public response fields.

## Git workflow

- Branch: `advisor/api-web-findings-e2e`
- Suggested commit subject: `Refresh article hashes when content changes`

## Steps

### Step 1: Add a canonical article detail hash helper

Create a small pure helper in `packages/api/src/utils/article-hash.ts`. It should hash a stable JSON payload of fields that affect article detail rendering and conditional caching.

Include at least:

- `canonicalUrl`
- `title`
- `author`
- `excerpt`
- `contentHtml`
- `contentText`
- `heroImageUrl`

Use `crypto.createHash('sha256')`. Normalize `undefined` to `null` so equivalent absent fields hash the same way. Do not include read state; the route already adds read state to the ETag suffix.

**Verify**: Add unit coverage either in a new test file or existing API unit tests:

- Same field values produce the same hash.
- Changing `contentHtml` changes the hash.
- Changing `heroImageUrl` changes the hash.

Run the focused unit test -> exit 0.

### Step 2: Use the helper for new articles

Replace `createHash('sha256').update(guid)` in `FeedSyncService` with the new content hash helper. Use the article fields already computed at `feed-sync.service.ts:145-165`.

Important: keep GUID as the identity/deduplication key. This plan changes only `articles.hash`, not article identity.

**Verify**: `bun run --filter '@self-feed/api' test -- tests/unit/feed-sync.service.test.ts` -> exit 0.

### Step 3: Persist new hashes on RSS content refresh

Extend the `articlesToUpdate` item type in `ArticleRepository.persistSyncResults` to include `hash: string`. When `FeedSyncService` pushes an existing article update at `feed-sync.service.ts:176-182`, compute a hash from the updated reader-visible fields and include it.

Repository update must write `hash: update.hash` in the same transaction as `contentHtml`, `contentText`, `excerpt`, and `heroImageUrl`.

**Verify**: Add or extend a unit test proving `persistSyncResults` update payload includes `hash` when an existing article is refreshed. If repository integration testing is easier than unit mocking, add the assertion to an integration test.

### Step 4: Persist new hashes on enrichment refresh

When `enrichSingleArticle` calls `articleRepo.updateContent`, include a newly computed `hash` for the enriched content. Because this method currently receives only `contentHtml`, `heroImageUrl`, and derived text/excerpt, compute the hash from the fields available without changing behavior for title/author.

If a complete hash requires current article title/author and the repository method does not return them, prefer adding a repository method that fetches the existing fields by article id. Do not set title/author to blank just to compute a hash.

**Verify**: Add a unit test or integration test showing enrichment/update changes `hash` when content changes.

### Step 5: Add ETag regression coverage

Extend `flows.integration.test.ts` near the existing ETag test.

Required scenario:

1. Create a mutable test RSS server or equivalent harness that can serve version 1 and version 2 of the same GUID.
2. Sync version 1.
3. Fetch article detail and store `ETag`.
4. Change the feed content for the same GUID.
5. Sync again so the existing article content updates.
6. Request the same article with the old `If-None-Match`.
7. Assert response status is `200`, the returned ETag differs, and the response body contains the new content.
8. Request again with the new ETag and assert `304`.

Do not include secret data or external network calls in this test.

**Verify**: `bun run --filter '@self-feed/api' test:integration -- tests/integration/flows.integration.test.ts` -> exit 0.

## Test plan

- Hash helper unit tests for stable/different hash behavior.
- Sync/update regression test for changed content producing changed ETag.
- Existing unchanged ETag test still passes.
- Unit tests for feed sync and article service continue to pass.

## Done criteria

- [ ] No article insertion path hashes only `guid`.
- [ ] Article content update paths write a new `hash`.
- [ ] The route ETag still changes when read state changes.
- [ ] Integration coverage proves old `If-None-Match` returns `200` after content change.
- [ ] `bun run --filter '@self-feed/api' test:integration -- tests/integration/flows.integration.test.ts` exits 0.
- [ ] `bun run typecheck` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- Updating the hash requires a database migration for existing rows. Existing rows may keep old hashes until the next content update; do not create a broad backfill unless a reviewer approves the production cost.
- The test harness cannot make a same-GUID content update without changing feed identity.
- The fix changes public article identity, GUID matching, or read-state semantics.

## Maintenance notes

Reviewer focus: the hash must track article-detail content, not feed identity. Any future field added to `ArticleDetailResponse` that should invalidate cached detail responses should be considered for the hash helper.
