import { describe, expect, it, vi } from 'vitest';
import { ArticleCacheService } from '../../src/services/article-cache.service.js';

function cachedArticle(id: string, displayedAt: string, isRead = false) {
	return {
		id,
		feedId: 'f1',
		feedTitle: 'Feed',
		feedFaviconUrl: null,
		title: id,
		author: null,
		excerpt: null,
		heroImageUrl: null,
		publishedAt: null,
		displayedAt,
		isRead,
	};
}

function articleRow(index: number) {
	const date = new Date(Date.UTC(2026, 0, 1, 0, index));
	return {
		id: `article-${index}`,
		feedId: 'feed-1',
		feedTitle: 'Feed',
		feedFaviconUrl: null,
		title: `Article ${index}`,
		author: null,
		excerpt: null,
		heroImageUrl: null,
		publishedAt: date,
		fetchedAt: date,
		isRead: false,
	};
}

function redisForPopulate() {
	const pipeline = {
		sadd: vi.fn().mockReturnThis(),
		expire: vi.fn().mockReturnThis(),
		exec: vi.fn(async () => []),
	};
	const setex = vi.fn(async (_key: string, _ttl: number, _value: string) => 'OK');
	return {
		set: vi.fn(
			async (_key: string, _value: string, _mode: string, _ttl: number, _nx: string) => 'OK',
		),
		del: vi.fn(async (..._keys: string[]) => 1),
		get: vi.fn(async (_key: string) => null),
		setex,
		pipeline: vi.fn(() => pipeline),
	};
}

function cacheMetrics() {
	return {
		recordCacheHit: vi.fn(),
		recordCacheMiss: vi.fn(),
	};
}

describe('ArticleCacheService - getCachedArticleList', () => {
	it('returns null on cache miss', async () => {
		const redis = { get: vi.fn().mockResolvedValue(null) };
		const metrics = cacheMetrics();
		const service = new ArticleCacheService({} as never, {} as never, redis as never, metrics);

		const result = await service.getCachedArticleList('user-1', { limit: 20 });
		expect(result).toBeNull();
		expect(metrics.recordCacheMiss).toHaveBeenCalledWith('article_list');
		expect(metrics.recordCacheHit).not.toHaveBeenCalled();
	});

	it('returns null when the cached generation does not match the current one', async () => {
		const cached = {
			articles: [
				{
					id: 'a1',
					feedId: 'f1',
					feedTitle: 'Feed',
					feedFaviconUrl: null,
					title: 'Story',
					author: null,
					excerpt: null,
					heroImageUrl: null,
					publishedAt: null,
					displayedAt: '2026-01-01T00:00:00.000Z',
					isRead: false,
				},
			],
			cursor: null,
			hasMore: false,
			meta: { syncedAt: '2026-01-01T00:00:00.000Z', newArticlesCount: 0, generation: 1 },
		};
		const redis = {
			get: vi.fn().mockResolvedValueOnce(JSON.stringify(cached)).mockResolvedValueOnce('2'),
		};
		const metrics = cacheMetrics();
		const service = new ArticleCacheService({} as never, {} as never, redis as never, metrics);

		const result = await service.getCachedArticleList('user-1', { limit: 20 });
		expect(result).toBeNull();
		expect(metrics.recordCacheMiss).toHaveBeenCalledWith('article_list');
		expect(metrics.recordCacheHit).not.toHaveBeenCalled();
	});

	it('returns null for unread-only requests because the bounded cache can be incomplete', async () => {
		const redis = {
			get: vi.fn(),
		};
		const metrics = cacheMetrics();
		const service = new ArticleCacheService({} as never, {} as never, redis as never, metrics);

		const result = await service.getCachedArticleList('user-1', { limit: 20, unreadOnly: true });
		expect(result).toBeNull();
		expect(redis.get).not.toHaveBeenCalled();
		expect(metrics.recordCacheHit).not.toHaveBeenCalled();
		expect(metrics.recordCacheMiss).not.toHaveBeenCalled();
	});

	it('returns an opaque latest cursor from the last returned cached article', async () => {
		const cached = {
			articles: [
				cachedArticle('a3', '2026-01-03T00:00:00.000Z'),
				cachedArticle('a2', '2026-01-02T00:00:00.000Z'),
				cachedArticle('a1', '2026-01-01T00:00:00.000Z'),
			],
			cursor: null,
			hasMore: true,
			meta: { syncedAt: '2026-01-01T00:00:00.000Z', newArticlesCount: 0, generation: 1 },
		};
		const redis = {
			get: vi.fn().mockResolvedValueOnce(JSON.stringify(cached)).mockResolvedValueOnce('1'),
		};
		const metrics = cacheMetrics();
		const service = new ArticleCacheService({} as never, {} as never, redis as never, metrics);

		const result = await service.getCachedArticleList('user-1', { limit: 2 });

		expect(result?.articles.map((article) => article.id)).toEqual(['a3', 'a2']);
		expect(result?.cursor).toBe(`a2:${Date.parse('2026-01-02T00:00:00.000Z') / 1000}:d`);
		expect(result?.hasMore).toBe(true);
		expect(metrics.recordCacheHit).toHaveBeenCalledWith('article_list');
		expect(metrics.recordCacheMiss).not.toHaveBeenCalled();
	});

	it('records scoped article-list cache hit types', async () => {
		const cached = {
			articles: [cachedArticle('a1', '2026-01-01T00:00:00.000Z')],
			cursor: null,
			hasMore: false,
			meta: { syncedAt: '2026-01-01T00:00:00.000Z', newArticlesCount: 0, generation: 1 },
		};
		const redis = {
			get: vi.fn().mockResolvedValueOnce(JSON.stringify(cached)).mockResolvedValueOnce('1'),
		};
		const metrics = cacheMetrics();
		const service = new ArticleCacheService({} as never, {} as never, redis as never, metrics);

		const result = await service.getCachedArticleList('user-1', { feedId: 'feed-1', limit: 20 });

		expect(result?.articles.map((article) => article.id)).toEqual(['a1']);
		expect(metrics.recordCacheHit).toHaveBeenCalledWith('article_list_feed');
	});

	it('returns null for oldest requests because the bounded cache is latest-first only', async () => {
		const redis = {
			get: vi.fn(),
		};
		const metrics = cacheMetrics();
		const service = new ArticleCacheService({} as never, {} as never, redis as never, metrics);

		const result = await service.getCachedArticleList('user-1', { limit: 2, sort: 'oldest' });

		expect(result).toBeNull();
		expect(redis.get).not.toHaveBeenCalled();
		expect(metrics.recordCacheHit).not.toHaveBeenCalled();
		expect(metrics.recordCacheMiss).not.toHaveBeenCalled();
	});

	it('returns null and deletes the key when the cached payload is corrupt', async () => {
		const redis = {
			get: vi.fn().mockResolvedValueOnce('not json'),
			del: vi.fn().mockResolvedValue(1),
		};
		const metrics = cacheMetrics();
		const service = new ArticleCacheService({} as never, {} as never, redis as never, metrics);

		const result = await service.getCachedArticleList('user-1', { limit: 20 });
		expect(result).toBeNull();
		expect(redis.del).toHaveBeenCalled();
		expect(metrics.recordCacheMiss).toHaveBeenCalledWith('article_list');
		expect(metrics.recordCacheHit).not.toHaveBeenCalled();
	});
});

describe('ArticleCacheService - populateCache', () => {
	it('does not report more pages when the cache query returns exactly the cache limit', async () => {
		const redis = redisForPopulate();
		const articleRepo = {
			findByFeeds: vi.fn(async () => Array.from({ length: 100 }, (_, index) => articleRow(index))),
		};
		const feedRepo = {
			findAllByUser: vi.fn(async () => [{ id: 'feed-1' }]),
		};
		const service = new ArticleCacheService(
			articleRepo as never,
			feedRepo as never,
			redis as never,
		);

		await service.populateCache('user-1');

		const cachedPayload = JSON.parse(redis.setex.mock.calls[0]?.[2] ?? '{}');
		expect(cachedPayload.articles).toHaveLength(100);
		expect(cachedPayload.hasMore).toBe(false);
		expect(cachedPayload.cursor).toBeNull();
	});

	it('trims the over-fetched row and reports more pages when the cache query exceeds the limit', async () => {
		const redis = redisForPopulate();
		const articleRepo = {
			findByFeeds: vi.fn(async () => Array.from({ length: 101 }, (_, index) => articleRow(index))),
		};
		const feedRepo = {
			findAllByUser: vi.fn(async () => [{ id: 'feed-1' }]),
		};
		const service = new ArticleCacheService(
			articleRepo as never,
			feedRepo as never,
			redis as never,
		);

		await service.populateCache('user-1');

		const cachedPayload = JSON.parse(redis.setex.mock.calls[0]?.[2] ?? '{}');
		expect(cachedPayload.articles).toHaveLength(100);
		expect(cachedPayload.hasMore).toBe(true);
		expect(cachedPayload.cursor).toBe('article-99:1767231540:d');
	});
});

describe('ArticleCacheService - updateCachedReadState', () => {
	it('patches matching cached articles without invalidating the generation', async () => {
		const globalCached = {
			articles: [
				cachedArticle('a1', '2026-01-01T00:00:00.000Z'),
				cachedArticle('a2', '2026-01-02T00:00:00.000Z'),
			],
			cursor: null,
			hasMore: false,
			meta: { syncedAt: '2026-01-01T00:00:00.000Z', newArticlesCount: 0, generation: 1 },
		};
		const scopedCached = {
			...globalCached,
			articles: [cachedArticle('a1', '2026-01-01T00:00:00.000Z')],
		};
		const setex = vi.fn(async (_key: string, _ttl: number, _payload: string) => 'OK');
		const pipeline = {
			sadd: vi.fn().mockReturnThis(),
			expire: vi.fn().mockReturnThis(),
			exec: vi.fn(async () => []),
		};
		const redis = {
			smembers: vi.fn().mockResolvedValue([]),
			scan: vi.fn().mockResolvedValue(['0', ['articles:list:user-1:feed:f1']]),
			get: vi
				.fn()
				.mockImplementation((key: string) =>
					Promise.resolve(
						key === 'articles:list:user-1'
							? JSON.stringify(globalCached)
							: JSON.stringify(scopedCached),
					),
				),
			setex,
			del: vi.fn(async () => 0),
			incr: vi.fn(async () => 2),
			pipeline: vi.fn(() => pipeline),
		};
		const service = new ArticleCacheService({} as never, {} as never, redis as never);

		await service.updateCachedReadState('user-1', 'a1', true);

		expect(redis.scan).toHaveBeenCalled();
		expect(redis.incr).not.toHaveBeenCalled();
		expect(setex).toHaveBeenCalledTimes(2);
		const payloads = setex.mock.calls.map((call) => JSON.parse(call[2]));
		expect(payloads.every((payload) => payload.articles[0].isRead === true)).toBe(true);
	});

	it('uses article membership indexes to avoid scanning scoped cache keys', async () => {
		const scopedCached = {
			articles: [cachedArticle('a1', '2026-01-01T00:00:00.000Z')],
			cursor: null,
			hasMore: false,
			meta: { syncedAt: '2026-01-01T00:00:00.000Z', newArticlesCount: 0, generation: 1 },
		};
		const setex = vi.fn(async (_key: string, _ttl: number, _payload: string) => 'OK');
		const pipeline = {
			sadd: vi.fn().mockReturnThis(),
			expire: vi.fn().mockReturnThis(),
			exec: vi.fn(async () => []),
		};
		const redis = {
			smembers: vi.fn().mockResolvedValue(['articles:list:user-1:feed:f1']),
			scan: vi.fn(),
			get: vi.fn().mockResolvedValue(JSON.stringify(scopedCached)),
			setex,
			del: vi.fn(async () => 0),
			pipeline: vi.fn(() => pipeline),
		};
		const service = new ArticleCacheService({} as never, {} as never, redis as never);

		await service.updateCachedReadState('user-1', 'a1', true);

		expect(redis.smembers).toHaveBeenCalledWith('articles:list:index:user-1:a1');
		expect(redis.scan).not.toHaveBeenCalled();
		expect(setex).toHaveBeenCalledTimes(1);
		expect(pipeline.sadd).toHaveBeenCalledWith(
			'articles:list:index:user-1:a1',
			'articles:list:user-1:feed:f1',
		);
	});
});

describe('ArticleCacheService - warming lock', () => {
	it('returns true on first lock attempt and false on subsequent', async () => {
		const redis = { set: vi.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null) };
		const service = new ArticleCacheService({} as never, {} as never, redis as never);

		expect(await service.tryAcquireWarmingLock('user-1')).toBe(true);
		expect(await service.tryAcquireWarmingLock('user-1')).toBe(false);
	});
});

describe('ArticleCacheService - trackUserActivity / getRecentlyActiveUserIds', () => {
	it('stores the activity timestamp and returns matching user ids', async () => {
		const recent = new Date().toISOString();
		const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
		const redis = {
			setex: vi.fn().mockResolvedValue('OK'),
			scan: vi
				.fn()
				.mockResolvedValueOnce(['0', ['user:lastseen:user-1', 'user:lastseen:user-2']])
				.mockResolvedValueOnce(['0', []]),
			mget: vi.fn().mockResolvedValue([recent, old]),
		};
		const service = new ArticleCacheService({} as never, {} as never, redis as never);

		await service.trackUserActivity('user-1');
		expect(redis.setex).toHaveBeenCalledWith(
			'user:lastseen:user-1',
			60 * 60 * 24,
			expect.any(String),
		);

		const ids = await service.getRecentlyActiveUserIds(10);
		expect(ids).toEqual(['user-1']);
	});

	it('stops scanning once the recent user limit is reached', async () => {
		const recent = new Date().toISOString();
		const redis = {
			scan: vi
				.fn()
				.mockResolvedValueOnce(['1', ['user:lastseen:user-1', 'user:lastseen:user-2']])
				.mockResolvedValueOnce(['0', ['user:lastseen:user-3']]),
			mget: vi.fn().mockResolvedValue([recent, recent]),
		};
		const service = new ArticleCacheService({} as never, {} as never, redis as never);

		const ids = await service.getRecentlyActiveUserIds(10, 1);

		expect(ids).toEqual(['user-1']);
		expect(redis.scan).toHaveBeenCalledTimes(1);
	});
});
