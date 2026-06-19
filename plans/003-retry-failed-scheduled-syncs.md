# Plan 003: Retry failed feeds from the scheduled worker with bounded backoff

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions occurs, stop and report. When done, update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b14d79b..HEAD -- packages/api/src/services/feed-sync.service.ts packages/api/src/repositories/feed.repository.ts packages/api/src/db/schema.ts packages/api/tests/unit/feed-sync.service.test.ts packages/api/tests/integration/app.integration.test.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `b14d79b`, 2026-06-19

## Why this matters

Scheduled feed sync discovers only `idle` feeds. A transient fetch failure sets a feed to `error`, so the worker stops polling it forever unless a user manually refreshes it. The app already has `nextSyncAt`, so the fix should preserve indexed scheduled polling while allowing failed feeds to retry after a bounded delay.

## Current state

```ts
// packages/api/src/services/feed-sync.service.ts:339-347
} catch (err) {
  await this.feedRepo.update(feedId, userId, { syncStatus: 'error' });
  await this.syncRunRepo.complete(run.id, {
    status: 'failed',
    itemCount: 0,
    errorMessage: err instanceof Error ? err.message : String(err),
  });
  throw err;
}
```

```ts
// packages/api/src/repositories/feed.repository.ts:97-115
async findDueForSync(limit: number) {
  return this.db.query.feeds.findMany({
    where: and(
      eq(feeds.syncStatus, 'idle'),
      sql`${feeds.nextSyncAt} <= unixepoch()`,
    ),
    orderBy: [asc(feeds.nextSyncAt)],
    limit,
  });
}
```

`FeedSyncService.syncDueFeeds` calls `findDueForSync` at `feed-sync.service.ts:485-504`. Manual `syncAllFeeds` already includes non-active feeds, but scheduler coverage does not.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| API unit focus | `bun run --filter '@self-feed/api' test -- tests/unit/feed-sync.service.test.ts` | exit 0 |
| API integration focus | `bun run --filter '@self-feed/api' test:integration -- tests/integration/app.integration.test.ts` | exit 0 |
| Typecheck | `bun run typecheck` | exit 0 |

## Scope

**In scope**:

- `packages/api/src/services/feed-sync.service.ts`
- `packages/api/src/repositories/feed.repository.ts`
- `packages/api/tests/unit/feed-sync.service.test.ts`
- API integration test only if needed to prove repository scheduling behavior

**Out of scope**:

- Adding a full retry-attempt counter schema unless a simple bounded `nextSyncAt` delay cannot solve the issue.
- Changing feed sync worker cadence.
- Changing manual refresh behavior.

## Git workflow

- Branch: `advisor/api-web-findings-e2e`
- Suggested commit subject: `Retry failed scheduled feed syncs`

## Steps

### Step 1: Define retry timing policy

In `FeedSyncService`, add a small helper for failure retry delay. Use existing feed data; avoid a schema migration unless strictly necessary.

Recommended policy:

- On failure, keep `syncStatus: 'error'`.
- Set `nextSyncAt` to now plus a bounded retry delay.
- Use a minimum delay to avoid hammering broken feeds, for example 5 minutes.
- Use a maximum delay to avoid indefinite staleness, for example 60 minutes.
- Clamp around `feed.pollingIntervalMinutes` if available: `Math.min(max, Math.max(min, feed.pollingIntervalMinutes))`.

Name constants clearly, for example `FAILED_SYNC_RETRY_MINUTES` and `FAILED_SYNC_RETRY_MAX_MINUTES`.

**Verify**: Add a unit test around the helper if it is exported, or fake timers in the failure test below.

### Step 2: Set nextSyncAt on failed syncs

In the `catch` block of `syncFeed`, update the feed with both `syncStatus: 'error'` and `nextSyncAt: <retry date>`. Preserve existing sync run failure logging/completion.

**Verify**: Extend `feed-sync.service.test.ts` with a test that makes `fetchAndParse` or a downstream dependency fail, then asserts `feedRepo.update` is called with:

- initial `{ syncStatus: 'syncing' }`
- later object containing `{ syncStatus: 'error', nextSyncAt: expect.any(Date) }`
- `nextSyncAt` is after the fake current time by the expected bounded delay

Run `bun run --filter '@self-feed/api' test -- tests/unit/feed-sync.service.test.ts` -> exit 0.

### Step 3: Include errored feeds when due

Update `FeedRepository.findDueForSync` to select feeds whose `syncStatus` is either `idle` or `error`, provided `nextSyncAt <= unixepoch()`. Keep ordering by `nextSyncAt` and the limit.

Use Drizzle's structured helpers where possible. Import `or` from `drizzle-orm` if that is the cleanest expression.

**Verify**: Add repository-level coverage if an integration test can seed feeds with `idle`, `error`, and `syncing` statuses. The expected query result should include due `idle` and due `error`, exclude future `error`, and exclude `syncing`.

### Step 4: Keep success recovery unchanged

Ensure a feed that succeeds after an error returns to `syncStatus: 'idle'` and gets its normal polling-based `nextSyncAt`. This is already done at `feed-sync.service.ts:304-309`; do not remove it.

**Verify**: Add or extend a test where `syncDueFeeds` receives one `error` feed from `findDueForSync`, `syncFeed` resolves, and summary counts show success.

## Test plan

- Unit: failed sync stores `syncStatus: 'error'` plus future `nextSyncAt`.
- Unit/integration: scheduler query includes due `error` feeds and excludes `syncing` feeds.
- Unit: successful retry counts as success and does not break existing `syncDueFeeds` summary.

## Done criteria

- [ ] Failed feeds get a bounded future `nextSyncAt`.
- [ ] Scheduled discovery includes due `error` feeds.
- [ ] Scheduled discovery does not include `syncing` feeds.
- [ ] Successful retries return feeds to `idle`.
- [ ] `bun run --filter '@self-feed/api' test -- tests/unit/feed-sync.service.test.ts` exits 0.
- [ ] `bun run typecheck` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- A correct retry policy requires persistent attempt counts or a schema migration; stop and propose the migration before changing production polling behavior.
- The scheduler query cannot include `error` without losing the `nextSyncAt` index behavior.
- Tests reveal existing UI depends on `error` meaning "never retry automatically."

## Maintenance notes

Reviewer focus: failed feeds should retry, but not every worker tick. Watch for production logs after deploy to confirm a bad remote feed does not dominate sync capacity.
