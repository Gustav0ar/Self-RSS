import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import Redis from 'ioredis';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheKeys, normalizeRedisUrl } from '../../src/db/redis.js';
import * as schema from '../../src/db/schema.js';
import { ArticleRepository } from '../../src/repositories/article.repository.js';
import { FeedRepository } from '../../src/repositories/feed.repository.js';
import {
	MetricsRepository,
	SyncRunRepository,
} from '../../src/repositories/settings.repository.js';
import { ArticleService } from '../../src/services/article.service.js';
import { ArticleCacheService } from '../../src/services/article-cache.service.js';
import { FeedSyncService } from '../../src/services/feed-sync.service.js';
import { scanKeys } from '../../src/services/redis-scan.js';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error('Integration tests require REDIS_URL');
const redis = new Redis(normalizeRedisUrl(redisUrl), { maxRetriesPerRequest: 3 });
const userId = `state-snapshot-${crypto.randomUUID()}`;
const foreignUserId = `${userId}-foreign`;
const articleId = crypto.randomUUID();
const feedId = crypto.randomUUID();
let fixture: Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
	const sqlite = new Database(':memory:');
	try {
		sqlite.exec('PRAGMA foreign_keys = ON');
		const folder = new URL('../../drizzle/', import.meta.url);
		for (const file of readdirSync(folder)
			.filter((name) => name.endsWith('.sql'))
			.sort()) {
			for (const statement of readFileSync(new URL(file, folder), 'utf8').split(
				'--> statement-breakpoint',
			)) {
				if (statement.trim()) sqlite.exec(statement);
			}
		}
		const db = drizzle(sqlite, { schema });
		await db.insert(schema.users).values([
			{ id: userId, email: 'reader@example.com', passwordHash: 'hash' },
			{ id: foreignUserId, email: 'other@example.com', passwordHash: 'hash' },
		]);
		await db
			.insert(schema.categories)
			.values({ id: 'category', userId, name: 'Category', slug: 'category' });
		await db.insert(schema.feeds).values({
			id: feedId,
			userId,
			categoryId: 'category',
			title: 'Feed',
			feedUrl: 'https://example.com/feed',
		});
		await db.insert(schema.articles).values({
			id: articleId,
			feedId,
			guid: 'guid',
			title: 'Snapshot',
			hash: 'hash',
			contentHtml: '<p>Body</p>',
		});
		const repo = new ArticleRepository(db, sqlite);
		const feeds = new FeedRepository(db);
		const cache = new ArticleCacheService(repo, feeds, redis);
		const service = new ArticleService(
			repo,
			feeds,
			new MetricsRepository(db),
			redis,
			undefined,
			undefined,
			cache,
		);
		await cache.populateCache(userId);
		const detail = await service.getArticle(userId, articleId);
		// Redis commands on this connection follow the service's queued cache write.
		expect(await redis.get(CacheKeys.articleDetail(userId, articleId))).not.toBeNull();
		return { sqlite, db, repo, cache, service, detail };
	} catch (error) {
		sqlite.close();
		throw error;
	}
}

beforeEach(async () => {
	fixture = await createFixture();
});
afterEach(async () => {
	try {
		const keys = await scanKeys(redis, `*${userId}*`);
		if (keys.length) await redis.del(...keys);
	} finally {
		fixture.sqlite.close();
	}
});
afterAll(async () => {
	await redis.quit();
});

describe('cached article state authority', () => {
	it('does not advertise revisions that an older cache writer cannot maintain', async () => {
		const detail: unknown = JSON.parse(
			(await redis.get(CacheKeys.articleDetail(userId, articleId))) ?? 'null',
		);
		const list: unknown = JSON.parse(
			(await redis.get(CacheKeys.articleListCache(userId))) ?? 'null',
		);
		expect(detail).not.toHaveProperty('readRevision');
		expect(detail).not.toHaveProperty('savedRevision');
		expect(list).not.toHaveProperty('articles.0.readRevision');
		expect(list).not.toHaveProperty('articles.0.savedRevision');
		const { readRevision: _read, savedRevision: _saved, ...legacy } = fixture.detail;
		// An old process changes a boolean without knowing about revision metadata.
		fixture.repo.setReadState(userId, articleId, true, 'manual');
		await redis.setex(
			CacheKeys.articleDetail(userId, articleId),
			60,
			JSON.stringify({ ...legacy, isRead: true }),
		);
		expect(await fixture.service.getArticle(userId, articleId)).toMatchObject({
			isRead: true,
			readRevision: 1,
		});
	});

	it('serves current SQLite state after another writer or an older warmer updates the cache', async () => {
		const oldList = await redis.get(CacheKeys.articleListCache(userId));
		expect(oldList).not.toBeNull();
		fixture.repo.setReadState(userId, articleId, true, 'manual');
		fixture.repo.setSavedState(userId, articleId, true);
		const expected = {
			id: articleId,
			isRead: true,
			isSaved: true,
			readRevision: 1,
			savedRevision: 1,
		};
		expect(await fixture.service.getArticle(userId, articleId)).toMatchObject(expected);
		expect((await fixture.service.getArticles(userId, { limit: 20 })).data).toMatchObject([
			expected,
		]);

		fixture.repo.setReadState(userId, articleId, false, 'manual');
		await redis.setex(CacheKeys.articleListCache(userId), 60, oldList ?? '');
		await redis.setex(
			CacheKeys.articleDetail(userId, articleId),
			60,
			JSON.stringify(fixture.detail),
		);
		const newer = { ...expected, isRead: false, readRevision: 2 };
		expect(await fixture.service.getArticle(userId, articleId)).toMatchObject(newer);
		expect((await fixture.service.getArticles(userId, { limit: 20 })).data).toMatchObject([newer]);
	});

	it('refreshes state after bulk mutation and accepts an unversioned cached body', async () => {
		const { readRevision: _read, savedRevision: _saved, ...legacy } = fixture.detail;
		await redis.setex(CacheKeys.articleDetail(userId, articleId), 60, JSON.stringify(legacy));
		expect(await fixture.service.getArticle(userId, articleId)).toMatchObject({
			readRevision: 0,
			savedRevision: 0,
		});
		await fixture.service.markAllRead(userId, {});
		expect(await fixture.service.getArticle(userId, articleId)).toMatchObject({
			isRead: true,
			readRevision: 1,
			savedRevision: 0,
		});
	});

	it('does not expose cached content after ownership loss or return a short deleted page', async () => {
		await redis.setex(
			CacheKeys.articleDetail(foreignUserId, articleId),
			60,
			JSON.stringify(fixture.detail),
		);
		await expect(fixture.service.getArticle(foreignUserId, articleId)).rejects.toMatchObject({
			statusCode: 404,
		});
		const oldList = await redis.get(CacheKeys.articleListCache(userId));
		await redis.setex(CacheKeys.articleListCache(foreignUserId), 60, oldList ?? '');
		expect((await fixture.service.getArticles(foreignUserId, { limit: 20 })).data).toEqual([]);

		await fixture.db.delete(schema.articles).where(eq(schema.articles.id, articleId));
		await fixture.db
			.insert(schema.articles)
			.values({ id: 'replacement', feedId, guid: 'next', title: 'Replacement', hash: 'next' });
		await expect(fixture.service.getArticle(userId, articleId)).rejects.toMatchObject({
			statusCode: 404,
		});
		expect(
			(await fixture.service.getArticles(userId, { limit: 20 })).data.map((row) => row.id),
		).toEqual(['replacement']);
	});
});

describe('article enrichment queue', () => {
	function createWorker() {
		return new FeedSyncService(
			new FeedRepository(fixture.db),
			fixture.repo,
			new SyncRunRepository(fixture.db),
			new MetricsRepository(fixture.db),
			redis,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 1, allowPrivateHosts: true },
		);
	}

	it('keeps the retry deadline across repeated opens and background polling', async () => {
		let requests = 0;
		const publisher = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch() {
				requests++;
				return new Response(null, { status: 503 });
			},
		});
		try {
			const worker = createWorker();
			await fixture.repo.updateContent(articleId, { canonicalUrl: String(publisher.url) });
			await fixture.repo.queueEnrichments([articleId]);
			await worker.queueArticleEnrichment(articleId);
			await fixture.repo.queueEnrichments([articleId]);
			expect((await fixture.repo.findById(articleId))?.nextEnrichmentAt).toEqual(new Date(0));
			const started = Date.now();
			expect(await worker.processPendingArticleEnrichments()).toEqual({
				processed: 1,
				succeeded: 0,
				failed: 1,
			});
			const article = await fixture.repo.findById(articleId);
			expect(article).toMatchObject({ enrichmentAttempts: 1, contentStatus: 'enrichment_pending' });
			// Timestamps in SQLite have one-second precision.
			expect(article!.nextEnrichmentAt!.getTime()).toBeGreaterThanOrEqual(started + 29_000);
			await Promise.all([
				worker.queueArticleEnrichment(articleId),
				fixture.repo.queueEnrichments([articleId]),
			]);
			expect(await fixture.repo.findById(articleId)).toEqual(article);
			expect(await worker.processPendingArticleEnrichments()).toEqual({
				processed: 0,
				succeeded: 0,
				failed: 0,
			});
			expect(await fixture.repo.markEnrichmentAttempt(articleId)).toBeNull();
			expect(requests).toBe(1);
		} finally {
			publisher.stop(true);
		}
	});

	it.each([
		'durable',
		'legacy',
	] as const)('preserves a %s publisher correction during an enrichment fetch', async (pipeline) => {
		const requested = Promise.withResolvers<string>();
		const respond = Promise.withResolvers<Response>();
		const publisher = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch(request) {
				requested.resolve(new URL(request.url).pathname);
				return respond.promise;
			},
		});
		try {
			await fixture.repo.updateContent(articleId, {
				canonicalUrl: new URL('/old', publisher.url).href,
				contentStatus: 'enrichment_pending',
			});
			const selectPending = fixture.repo.findPendingEnrichments.bind(fixture.repo);
			vi.spyOn(fixture.repo, 'findPendingEnrichments').mockImplementationOnce(async (limit) => {
				const selected = await selectPending(limit);
				await fixture.repo.updateContent(articleId, {
					canonicalUrl: new URL('/at-claim', publisher.url).href,
					hash: 'at-claim',
				});
				return selected;
			});

			const replaceContent = vi.spyOn(fixture.repo, 'replaceEnrichedContent');
			const work = createWorker().processPendingArticleEnrichments();
			expect(await requested.promise).toBe('/at-claim');
			const correctedMedia = {
				articleId,
				type: 'image' as const,
				provider: 'example.com',
				url: 'https://example.com/correction.png',
				position: 0,
			};
			await fixture.repo.persistSyncResults({
				articlesToInsert: [],
				articlesToUpdate: [
					{
						id: articleId,
						contentHtml: '<p>Publisher correction</p>',
						contentText: 'Publisher correction',
						excerpt: 'Publisher correction',
						heroImageUrl: correctedMedia.url,
						hash: 'publisher-correction',
						incrementContentVersion: pipeline === 'durable',
					},
				],
				mediaByGuid: new Map(),
				updatedMediaByArticleId: new Map([[articleId, [correctedMedia]]]),
			});
			const stale = { articleId, attempts: 1, contentVersion: 1, hash: 'at-claim' };
			expect(
				await fixture.repo.markEnrichmentRetry(stale, {
					failed: true,
					error: 'old error',
					nextEnrichmentAt: null,
				}),
			).toBeNull();
			expect(await fixture.repo.markEnrichmentComplete(stale)).toBeNull();

			respond.resolve(
				new Response(
					`<article><div class="entry-content"><p>${'Superseded content from the earlier request. '.repeat(20)}</p><img src="/stale.png"></div></article>`,
					{ headers: { 'content-type': 'text/html' } },
				),
			);
			expect(await work).toEqual({ processed: 0, succeeded: 0, failed: 0 });
			expect(replaceContent).toHaveBeenCalledWith(
				expect.objectContaining(stale),
				expect.objectContaining({ contentText: expect.stringContaining('Superseded content') }),
			);
			expect(await fixture.repo.findById(articleId)).toMatchObject({
				contentText: 'Publisher correction',
				contentStatus: 'enrichment_pending',
				contentVersion: pipeline === 'durable' ? 2 : 1,
				hash: 'publisher-correction',
			});
			expect(
				fixture.db.select({ url: schema.articleMedia.url }).from(schema.articleMedia).all(),
			).toEqual([{ url: correctedMedia.url }]);
			expect(await fixture.repo.findPendingEnrichments(1)).toEqual([{ articleId, userId }]);
		} finally {
			respond.resolve(new Response(null, { status: 503 }));
			publisher.stop(true);
		}
	});

	it('leaves the last attempt to the worker fetching it and requeues failures only on request', async () => {
		const requested = Promise.withResolvers<void>();
		const respond = Promise.withResolvers<Response>();
		const publisher = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch() {
				requested.resolve();
				return respond.promise;
			},
		});
		try {
			await fixture.repo.updateContent(articleId, {
				canonicalUrl: String(publisher.url),
				contentStatus: 'enrichment_pending',
				enrichmentAttempts: 4,
			});
			const owner = createWorker().processPendingArticleEnrichments();
			await requested.promise;
			expect(await createWorker().processPendingArticleEnrichments()).toEqual({
				processed: 0,
				succeeded: 0,
				failed: 0,
			});
			expect(await fixture.repo.findById(articleId)).toMatchObject({
				contentStatus: 'enrichment_pending',
				enrichmentAttempts: 5,
				contentVersion: 1,
			});
			respond.resolve(new Response(null, { status: 503 }));
			expect(await owner).toEqual({ processed: 1, succeeded: 0, failed: 1 });
			await fixture.repo.queueEnrichments([articleId]);
			expect(await fixture.repo.findById(articleId)).toMatchObject({
				contentStatus: 'failed',
				enrichmentAttempts: 5,
			});
			await createWorker().queueArticleEnrichment(articleId);
			expect(await fixture.repo.findById(articleId)).toMatchObject({
				contentStatus: 'enrichment_pending',
				enrichmentAttempts: 0,
				enrichmentError: null,
			});
			const attempt = await fixture.repo.markEnrichmentAttempt(articleId);
			if (!attempt) throw new Error('Expected a new enrichment attempt');
			expect(attempt.attempts).toBe(1);
			expect(
				await fixture.repo.markEnrichmentRetry(
					{ ...attempt, attempts: 5 },
					{
						failed: true,
						error: 'old worker',
						nextEnrichmentAt: null,
					},
				),
			).toBeNull();
			expect(await fixture.repo.markEnrichmentComplete(attempt)).not.toBeNull();
			const completed = await fixture.repo.findById(articleId);
			await createWorker().queueArticleEnrichment(articleId);
			await fixture.repo.queueEnrichments([articleId]);
			expect(await fixture.repo.findById(articleId)).toEqual(completed);
			expect(await fixture.repo.markEnrichmentAttempt(articleId)).toBeNull();
		} finally {
			respond.resolve(new Response(null, { status: 503 }));
			publisher.stop(true);
		}
	});
});
