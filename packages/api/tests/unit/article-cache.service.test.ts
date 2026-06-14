import { describe, expect, it, vi } from 'vitest';
import { ArticleCacheService } from '../../src/services/article-cache.service.js';

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

	it('applies unread filter and sort from the cached snapshot', async () => {
		const cached = {
			articles: [
				{
					id: 'a2',
					feedId: 'f1',
					feedTitle: 'Feed',
					feedFaviconUrl: null,
					title: 'B',
					author: null,
					excerpt: null,
					heroImageUrl: null,
					publishedAt: null,
					displayedAt: '2026-01-02T00:00:00.000Z',
					isRead: true,
				},
				{
					id: 'a1',
					feedId: 'f1',
					feedTitle: 'Feed',
					feedFaviconUrl: null,
					title: 'A',
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
			get: vi.fn().mockResolvedValueOnce(JSON.stringify(cached)).mockResolvedValueOnce('1'),
		};
		const service = new ArticleCacheService({} as never, {} as never, redis as never);

		const result = await service.getCachedArticleList('user-1', { limit: 20, unreadOnly: true });
		expect(result?.articles).toHaveLength(1);
		expect(result?.articles[0]?.id).toBe('a1');
		expect(result?.meta.generation).toBe(1);
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
});
