import { Database } from 'bun:sqlite';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../../src/db/migrations.js';
import * as schema from '../../src/db/schema.js';
import { recordDurableSyncRun } from '../../src/repositories/durable-sync-history.js';
import { FeedRepository } from '../../src/repositories/feed.repository.js';
import { FeedIngestionRepository } from '../../src/repositories/feed-ingestion.repository.js';
import {
	MetricsRepository,
	SyncRunRepository,
} from '../../src/repositories/settings.repository.js';

const databases: Database[] = [];
afterEach(() => {
	for (const sqlite of databases.splice(0)) sqlite.close();
});

async function setup() {
	const sqlite = new Database(':memory:');
	databases.push(sqlite);
	const db = drizzle(sqlite, { schema });
	applyMigrations(db, { migrationsFolder: resolve(import.meta.dir, '../../drizzle') });
	const now = new Date();
	for (const id of ['one', 'two']) {
		db.insert(schema.users)
			.values({ id, email: `${id}@example.com`, passwordHash: 'fixture' })
			.run();
		db.insert(schema.categories)
			.values({ id: `category-${id}`, userId: id, name: 'News', slug: 'news' })
			.run();
	}
	const repository = new FeedIngestionRepository(db);
	const origin = await repository.upsertOrigin({
		id: 'origin',
		scheme: 'https',
		host: 'example.com',
		port: 443,
	});
	const source = await repository.upsertSource({
		id: 'source',
		originId: origin.id,
		requestedUrl: 'https://example.com/feed',
		normalizedUrl: 'https://example.com/feed',
		nextFetchAt: now,
	});
	function subscribe(userId: string) {
		return db
			.insert(schema.feeds)
			.values({
				id: `feed-${userId}`,
				userId,
				categoryId: `category-${userId}`,
				title: 'News',
				feedUrl: source.normalizedUrl,
				sourceId: source.id,
				nextSyncAt: now,
			})
			.returning()
			.get();
	}
	const feed = subscribe('one');
	return { db, now, source, origin, feed, repository, subscribe, feeds: new FeedRepository(db) };
}

describe('durable source subscription eligibility', () => {
	it('counts each background outcome once and retains user activity across later polls', async () => {
		const { db, now, feed } = await setup();
		const metrics = new MetricsRepository(db);
		for (const status of ['success', 'failed', 'success', 'failed'] as const) {
			db.transaction((tx) =>
				recordDurableSyncRun(tx, {
					id: `same-${status}`,
					feedId: feed.id,
					status,
					finishedAt: now,
				}),
			);
		}
		const row = () => db.select().from(schema.userMetricsDaily).get();
		expect(row()).toMatchObject({ isActive: false, feedsSyncedCount: 1, feedFailuresCount: 1 });
		await metrics.incrementSyncCount('one', 'failed');
		expect(row()).toMatchObject({ isActive: false, feedsSyncedCount: 1, feedFailuresCount: 2 });
		// app_opened has no product counter, but does establish activity.
		await metrics.incrementProductCounts('one', {});
		await metrics.incrementSyncCount('one', 'success');
		expect(row()).toMatchObject({ isActive: true, feedsSyncedCount: 2, feedFailuresCount: 2 });
		expect((await metrics.getDailyMetrics('one', 30))[0]).not.toHaveProperty('isActive');
	});

	it('records unchanged publisher polls in each subscriber’s own history alongside legacy runs', async () => {
		const { db, now, repository, subscribe } = await setup();
		subscribe('two');
		const history = new SyncRunRepository(db);
		const legacy = await history.create('feed-one');
		await repository.enqueueDueSources(1, now);
		const claim = await repository.claimEligibleFetchJob('worker', 60, now);
		if (!claim) throw new Error('Expected due job');
		await repository.finishFetchJob(
			claim.job.id,
			'worker',
			{
				status: 'completed',
				completesWithoutDelivery: true,
				source: { lastHttpStatus: 304 },
			},
			now,
		);
		const first = await history.findByFeedForUser('one', 'feed-one', 10, 0);
		expect(first).toHaveLength(2);
		expect(first).toContainEqual(expect.objectContaining({ id: legacy.id }));
		expect(first).toContainEqual(expect.objectContaining({ status: 'success', httpStatus: 304 }));
		expect(await history.findRecentByUser('two', 10)).toMatchObject([
			{ feedId: 'feed-two', httpStatus: 304 },
		]);
		expect(await history.findByFeedForUser('two', 'feed-one', 10, 0)).toEqual([]);
	});

	it('stops scheduling a source when its final subscription is removed', async () => {
		const context = await setup();
		await context.feeds.delete(context.feed.id, context.feed.userId);
		expect(await context.repository.enqueueDueSources(10, context.now)).toEqual([]);
		expect(context.db.select().from(schema.feedSources).all()).toHaveLength(1);
	});

	it('settles queued orphan work and its refresh request while retaining its snapshot', async () => {
		const context = await setup();
		const [job] = await context.repository.enqueueDueSources(10, context.now);
		if (!job) throw new Error('Subscribed source was not scheduled');
		await context.repository.createRefreshRequest({ id: 'refresh', userId: 'one' }, [
			{ feedId: context.feed.id, sourceId: context.source.id, jobId: job.id },
		]);
		await context.repository.createSnapshot({
			id: 'snapshot',
			sourceId: context.source.id,
			jobId: job.id,
			finalUrl: context.source.normalizedUrl,
			rawBody: '<rss/>',
			rawBodyBytes: 6,
		});
		context.db
			.update(schema.feedFetchJobs)
			.set({ snapshotId: 'snapshot' })
			.where(eq(schema.feedFetchJobs.id, job.id))
			.run();
		await context.feeds.delete(context.feed.id, context.feed.userId);
		expect(await context.repository.claimEligibleFetchJob('worker', 30, context.now)).toBeNull();
		expect(context.db.select().from(schema.feedFetchJobs).get()).toMatchObject({
			status: 'completed',
			lastErrorCode: 'no_subscribers',
			attempts: 0,
		});
		expect(context.db.select().from(schema.feedRefreshRequests).get()).toMatchObject({
			status: 'completed_with_errors',
			pendingItems: 0,
			failedItems: 1,
		});
		expect(context.db.select().from(schema.feedRefreshRequestItems).get()).toMatchObject({
			status: 'failed',
			lastErrorCode: 'no_subscribers',
		});
		expect(context.db.select().from(schema.feedFetchSnapshots).get()).toMatchObject({
			id: 'snapshot',
			rawBody: '<rss/>',
		});
		expect(await context.repository.enqueueDueSources(10, context.now)).toEqual([]);
	});

	it('keeps fetching a shared source for its remaining subscriber', async () => {
		const context = await setup();
		context.subscribe('two');
		await context.feeds.delete(context.feed.id, context.feed.userId);
		expect(await context.repository.enqueueDueSources(10, context.now)).toHaveLength(1);
		expect(await context.repository.claimEligibleFetchJob('worker', 30, context.now)).toMatchObject(
			{ source: { id: context.source.id } },
		);
	});

	it('fetches a source referenced only by a pending replacement', async () => {
		const context = await setup();
		await context.repository.upsertSource({
			id: 'previous',
			originId: context.origin.id,
			requestedUrl: 'https://example.com/previous',
			normalizedUrl: 'https://example.com/previous',
			nextFetchAt: new Date(context.now.getTime() + 86_400_000),
		});
		context.db
			.update(schema.feeds)
			.set({ sourceId: 'previous', pendingSourceId: context.source.id })
			.where(eq(schema.feeds.id, context.feed.id))
			.run();
		expect(await context.repository.enqueueDueSources(10, context.now)).toHaveLength(1);
		expect(await context.repository.claimEligibleFetchJob('worker', 30, context.now)).toMatchObject(
			{ source: { id: context.source.id } },
		);
	});

	it('preserves a live lease and retires orphan work once the lease expires', async () => {
		const context = await setup();
		await context.repository.enqueueDueSources(10, context.now);
		await context.repository.claimEligibleFetchJob('active-worker', 30, context.now);
		await context.feeds.delete(context.feed.id, context.feed.userId);
		expect(
			await context.repository.claimEligibleFetchJob('other-worker', 30, context.now),
		).toBeNull();
		expect(context.db.select().from(schema.feedFetchJobs).get()).toMatchObject({
			status: 'running',
			leaseOwner: 'active-worker',
		});
		expect(
			await context.repository.claimEligibleFetchJob(
				'other-worker',
				30,
				new Date(context.now.getTime() + 31_000),
			),
		).toBeNull();
		expect(context.db.select().from(schema.feedFetchJobs).get()).toMatchObject({
			status: 'completed',
			lastErrorCode: 'no_subscribers',
			leaseOwner: null,
		});
	});
});
