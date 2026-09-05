import { Database } from 'bun:sqlite';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations } from '../../src/db/migrations.js';
import * as schema from '../../src/db/schema.js';
import { ArticleRepository } from '../../src/repositories/article.repository.js';
import { FeedIngestionRepository } from '../../src/repositories/feed-ingestion.repository.js';
import { FeedSnapshotDeliveryService } from '../../src/services/feed-snapshot-delivery.service.js';
import { FeedSnapshotParserService } from '../../src/services/feed-snapshot-parser.service.js';

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
	db.insert(schema.users)
		.values({ id: 'user', email: 'reader@example.com', passwordHash: 'fixture' })
		.run();
	db.insert(schema.categories)
		.values({ id: 'category', userId: 'user', name: 'News', slug: 'news' })
		.run();
	const repository = new FeedIngestionRepository(db);
	const origin = await repository.upsertOrigin({
		id: 'origin',
		scheme: 'https',
		host: 'example.com',
		port: 443,
	});
	for (const id of ['old', 'new']) {
		await repository.upsertSource({
			id,
			originId: origin.id,
			requestedUrl: `https://example.com/${id}`,
			normalizedUrl: `https://example.com/${id}`,
			nextFetchAt: now,
		});
	}
	db.insert(schema.feeds)
		.values({
			id: 'feed',
			userId: 'user',
			categoryId: 'category',
			title: 'Old feed',
			feedUrl: 'https://example.com/old',
			sourceId: 'old',
			nextSyncAt: now,
		})
		.run();
	const parser = new FeedSnapshotParserService(repository);
	async function parse(sourceId: string) {
		const snapshot = await parser.persistRawResponse({
			id: `${sourceId}-snapshot`,
			sourceId,
			finalUrl: `https://example.com/${sourceId}`,
			status: 200,
			fetchedAt: now,
			body: `<rss version="2.0"><channel><title>${sourceId} feed</title><item><guid>${sourceId}-guid</guid><title>${sourceId} article</title><description>${sourceId} content</description></item></channel></rss>`,
		});
		await parser.parsePersistedSnapshot(snapshot.id, now);
	}
	await parse('old');
	const oldDelivery = db.select().from(schema.feedSnapshotDeliveries).get();
	if (!oldDelivery) throw new Error('Old snapshot did not queue a delivery');
	async function activateReplacement() {
		db.update(schema.feeds)
			.set({ pendingSourceId: 'new' })
			.where(eq(schema.feeds.id, 'feed'))
			.run();
		await parse('new');
	}
	return {
		db,
		repository,
		now,
		oldDelivery,
		activateReplacement,
		articles: new ArticleRepository(db),
	};
}

describe('snapshot delivery transaction fencing', () => {
	it('settles a queued old-source snapshot without restoring replaced articles', async () => {
		const context = await setup();
		await context.activateReplacement();
		const afterCommit = vi.fn();
		const delivery = new FeedSnapshotDeliveryService(context.repository, context.articles, {
			afterCommit,
		});
		expect(await delivery.drainOnce('worker', { now: context.now })).toBe(2);
		expect(context.db.select({ title: schema.articles.title }).from(schema.articles).all()).toEqual(
			[{ title: 'new article' }],
		);
		expect(
			context.db
				.select()
				.from(schema.feedSnapshotDeliveries)
				.where(eq(schema.feedSnapshotDeliveries.id, context.oldDelivery.id))
				.get(),
		).toMatchObject({ status: 'completed', lastErrorCode: 'source_replaced' });
		expect(afterCommit).toHaveBeenCalledTimes(1);
		expect(context.db.select({ sourceId: schema.feeds.sourceId }).from(schema.feeds).get()).toEqual(
			{ sourceId: 'new' },
		);
	});

	it('rechecks the source after an in-flight delivery has prepared its articles', async () => {
		const context = await setup();
		const afterCommit = vi.fn();
		const delivery = new FeedSnapshotDeliveryService(context.repository, context.articles, {
			beforePersist: async (id) => {
				if (id === context.oldDelivery.id) await context.activateReplacement();
			},
			afterCommit,
		});
		await delivery.drainOnce('worker', { now: context.now });
		expect(context.db.select({ title: schema.articles.title }).from(schema.articles).all()).toEqual(
			[{ title: 'new article' }],
		);
		expect(afterCommit).toHaveBeenCalledTimes(1);
		expect(
			context.db
				.select()
				.from(schema.feedSnapshotDeliveries)
				.where(eq(schema.feedSnapshotDeliveries.id, context.oldDelivery.id))
				.get(),
		).toMatchObject({ status: 'completed', lastErrorCode: 'source_replaced' });
	});

	it.each(['expired', 'reclaimed'])('does not write articles under an %s lease', async (kind) => {
		const context = await setup();
		const afterCommit = vi.fn();
		const delivery = new FeedSnapshotDeliveryService(context.repository, context.articles, {
			beforePersist: () => {
				context.db
					.update(schema.feedSnapshotDeliveries)
					.set({
						leaseOwner: kind === 'reclaimed' ? 'replacement-worker' : 'worker',
						leaseExpiresAt: new Date(
							context.now.getTime() + (kind === 'reclaimed' ? 60_000 : -1_000),
						),
					})
					.where(eq(schema.feedSnapshotDeliveries.id, context.oldDelivery.id))
					.run();
			},
			afterCommit,
		});
		await delivery.drainOnce('worker', { now: context.now, limit: 1 });
		expect(context.db.select().from(schema.articles).all()).toHaveLength(0);
		expect(afterCommit).not.toHaveBeenCalled();
		expect(
			context.db
				.select()
				.from(schema.feedSnapshotDeliveries)
				.where(eq(schema.feedSnapshotDeliveries.id, context.oldDelivery.id))
				.get(),
		).toMatchObject({
			status: 'running',
			leaseOwner: kind === 'reclaimed' ? 'replacement-worker' : 'worker',
		});
	});
});
