import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import Redis from 'ioredis';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CacheKeys, normalizeRedisUrl } from '../../src/db/redis.js';
import * as schema from '../../src/db/schema.js';
import { ArticleRepository } from '../../src/repositories/article.repository.js';
import { FeedRepository } from '../../src/repositories/feed.repository.js';
import { MetricsRepository } from '../../src/repositories/settings.repository.js';
import { ArticleService } from '../../src/services/article.service.js';
import { ArticleCacheService } from '../../src/services/article-cache.service.js';
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
