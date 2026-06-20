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

describe('ArticleCacheService - getCachedArticleList', () => {
	it('returns null on cache miss', async () => {
		const redis = { get: vi.fn().mockResolvedValue(null) };
		const service = new ArticleCacheService({} as never, {} as never, redis as never);

		const result = await service.getCachedArticleList('user-1', { limit: 20 });
		expect(result).toBeNull();
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
		const service = new ArticleCacheService({} as never, {} as never, redis as never);

		const result = await service.getCachedArticleList('user-1', { limit: 20 });
		expect(result).toBeNull();
	});

	it('returns null for unread-only requests because the bounded cache can be incomplete', async () => {
		const redis = {
			get: vi.fn(),
		};
		const service = new ArticleCacheService({} as never, {} as never, redis as never);

		const result = await service.getCachedArticleList('user-1', { limit: 20, unreadOnly: true });
		expect(result).toBeNull();
		expect(redis.get).not.toHaveBeenCalled();
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
		const service = new ArticleCacheService({} as never, {} as never, redis as never);

		const result = await service.getCachedArticleList('user-1', { limit: 2 });

		expect(result?.articles.map((article) => article.id)).toEqual(['a3', 'a2']);
		expect(result?.cursor).toBe(`a2:${Date.parse('2026-01-02T00:00:00.000Z') / 1000}:d`);
		expect(result?.hasMore).toBe(true);
	});

	it('returns null for oldest requests because the bounded cache is latest-first only', async () => {
		const redis = {
			get: vi.fn(),
		};
		const service = new ArticleCacheService({} as never, {} as never, redis as never);

		const result = await service.getCachedArticleList('user-1', { limit: 2, sort: 'oldest' });

		expect(result).toBeNull();
		expect(redis.get).not.toHaveBeenCalled();
	});

	it('returns null and deletes the key when the cached payload is corrupt', async () => {
		const redis = {
			get: vi.fn().mockResolvedValueOnce('not json'),
			del: vi.fn().mockResolvedValue(1),
		};
		const service = new ArticleCacheService({} as never, {} as never, redis as never);

		const result = await service.getCachedArticleList('user-1', { limit: 20 });
		expect(result).toBeNull();
		expect(redis.del).toHaveBeenCalled();
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
		const redis = {
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
		};
		const service = new ArticleCacheService({} as never, {} as never, redis as never);

		await service.updateCachedReadState('user-1', 'a1', true);

		expect(redis.incr).not.toHaveBeenCalled();
		expect(setex).toHaveBeenCalledTimes(2);
		const payloads = setex.mock.calls.map((call) => JSON.parse(call[2]));
		expect(payloads.every((payload) => payload.articles[0].isRead === true)).toBe(true);
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
