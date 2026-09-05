import { Database } from 'bun:sqlite';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../../src/db/migrations.js';
import * as schema from '../../src/db/schema.js';
import { ArticleRepository } from '../../src/repositories/article.repository.js';
import { CategoryRepository } from '../../src/repositories/category.repository.js';
import { FeedRepository } from '../../src/repositories/feed.repository.js';
import { FeedIngestionRepository } from '../../src/repositories/feed-ingestion.repository.js';
import { DurableFeedFacadeService } from '../../src/services/durable-feed-facade.service.js';
import { FeedService } from '../../src/services/feed.service.js';

const databases: Database[] = [];
const future = new Date('2100-01-01T00:00:00Z');
const past = new Date('2020-01-01T00:00:00Z');

afterEach(() => {
	for (const sqlite of databases.splice(0)) sqlite.close();
});

function setup() {
	const sqlite = new Database(':memory:');
	databases.push(sqlite);
	sqlite.exec('PRAGMA foreign_keys = ON');
	const queries: string[] = [];
	const db = drizzle(sqlite, { schema, logger: { logQuery: (query) => queries.push(query) } });
	applyMigrations(db, { migrationsFolder: resolve(import.meta.dir, '../../drizzle') });
	for (const id of ['user', 'other-user']) {
		db.insert(schema.users)
			.values({ id, email: `${id}@example.com`, passwordHash: 'fixture' })
			.run();
	}
	for (const id of ['news', 'other']) {
		db.insert(schema.categories).values({ id, userId: 'user', name: id, slug: id }).run();
	}
	db.insert(schema.feedOrigins)
		.values({ id: 'origin', scheme: 'https', host: 'example.com', port: 443 })
		.run();
	const feedRepository = new FeedRepository(db);
	const categoryRepository = new CategoryRepository(db);
	const facade = new DurableFeedFacadeService(
		db,
		feedRepository,
		categoryRepository,
		new FeedIngestionRepository(db),
	);
	const service = new FeedService(
		feedRepository,
		categoryRepository,
		new ArticleRepository(db),
		{ maxContentLength: 1_024, allowPrivateHosts: false },
		undefined,
		facade,
		'v2',
	);
	function source(id: string, data: Partial<typeof schema.feedSources.$inferInsert> = {}) {
		db.insert(schema.feedSources)
			.values({
				id,
				originId: 'origin',
				normalizedUrl: `https://example.com/${id}`,
				requestedUrl: `https://example.com/${id}`,
				nextFetchAt: past,
				...data,
			})
			.run();
	}
	function feed(id: string, data: Partial<typeof schema.feeds.$inferInsert> = {}) {
		db.insert(schema.feeds)
			.values({
				id,
				userId: 'user',
				categoryId: 'news',
				title: id,
				feedUrl: `https://example.com/${id}`,
				...data,
			})
			.run();
	}
	function candidate(
		id: string,
		feedId: string,
		data: Partial<typeof schema.feedDiscoveryCandidates.$inferInsert> = {},
	) {
		db.insert(schema.feedDiscoveryCandidates)
			.values({
				id,
				requestId: 'request',
				userId: 'user',
				inputUrl: 'https://example.com',
				candidateUrl: `https://example.com/${id}`,
				normalizedCandidateUrl: `https://example.com/${id}`,
				selectionMetadata: { feedId },
				expiresAt: future,
				...data,
			})
			.run();
	}
	return { db, queries, service, facade, source, feed, candidate };
}

describe('batched durable feed lifecycles', () => {
	it('keeps feed-list reads constant as subscriptions grow', async () => {
		const context = setup();
		for (const size of [1, 40]) {
			for (let i = size === 1 ? 0 : 1; i < size; i++) {
				context.source(`source-${i}`);
				context.feed(`feed-${i}`, { sourceId: `source-${i}` });
			}
			context.queries.length = 0;
			const result = await context.service.getAll('user');
			expect(result).toHaveLength(size);
			expect(context.queries).toHaveLength(4);
			expect(context.queries.filter((query) => query.includes('from "feed_sources"'))).toHaveLength(
				1,
			);
			expect(
				context.queries.filter((query) => query.includes('from "feed_discovery_candidates"')),
			).toHaveLength(1);
		}
	});

	it('preserves single-feed lifecycle values and isolates discovery candidates', async () => {
		const context = setup();
		context.source('active', { lastFetchAt: past, lastSuccessAt: past });
		context.source('paused', { state: 'paused' });
		context.source('backoff', { backoffUntil: future });
		context.source('error', { lastErrorCode: 'fetch_failed', lastErrorDetails: 'Unavailable' });
		context.source('pending', { lastErrorCode: 'parse_failed', lastErrorDetails: 'Invalid XML' });
		for (const id of ['active', 'paused', 'backoff', 'error']) {
			context.feed(id, { sourceId: id });
		}
		context.feed('replacement', {
			sourceId: 'active',
			pendingSourceId: 'pending',
			syncStatus: 'replacement_pending',
			replacementRequestedAt: past,
			refreshBlockedUntil: future,
		});
		context.feed('discovery', { syncStatus: 'discovery_required' });
		context.feed('outside-category', { categoryId: 'other', syncStatus: 'discovery_required' });
		context.candidate('match', 'discovery');
		context.candidate('outside', 'outside-category');
		context.candidate('expired', 'discovery', { expiresAt: past });
		context.candidate('selected', 'discovery', { status: 'selected' });
		context.candidate('other-user', 'discovery', { userId: 'other-user' });
		context.candidate('unassigned', 'discovery', { selectionMetadata: null });
		context.db
			.insert(schema.articles)
			.values({
				id: 'article',
				feedId: 'active',
				guid: 'article',
				hash: 'article',
				title: 'Unread',
				canonicalUrl: 'https://example.com/article',
			})
			.run();

		const result = await context.service.getAll('user');
		for (const feed of context.db.select().from(schema.feeds).all()) {
			expect(result.find((row) => row.id === feed.id)).toMatchObject(
				await context.facade.lifecycleForFeed(feed),
			);
		}
		expect(result.find((row) => row.id === 'active')).toMatchObject({
			lifecycleStatus: 'active',
			unreadCount: 1,
			lastFetchAt: past.toISOString(),
			lastSuccessAt: past.toISOString(),
		});
		for (const id of ['paused', 'backoff', 'error']) {
			expect(result.find((row) => row.id === id)).toMatchObject({ lifecycleStatus: id });
		}
		expect(result.find((row) => row.id === 'replacement')).toMatchObject({
			lifecycleStatus: 'replacement_pending',
			pendingFeedUrl: 'https://example.com/pending',
			sourceErrorCode: 'parse_failed',
			sourceErrorDetails: 'Invalid XML',
			replacementRequestedAt: past.toISOString(),
			nextEligibleFetchAt: future.toISOString(),
		});
		expect(result.find((row) => row.id === 'discovery')).toMatchObject({
			discovery: { required: true, candidates: [{ id: 'match', expiresAt: future.toISOString() }] },
		});
		const categoryResult = await context.service.getByCategory('user', 'news');
		expect(categoryResult).toEqual(result.filter((row) => row.categoryId === 'news'));
	});

	it('skips lifecycle reads for an empty list', async () => {
		const context = setup();
		context.queries.length = 0;
		expect(await context.service.getAll('user')).toEqual([]);
		expect(context.queries).toHaveLength(1);
	});
});
