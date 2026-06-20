import { describe, expect, it, vi } from 'vitest';
import { ArticleService } from '../../src/services/article.service.js';

function cacheMetrics() {
	return {
		recordCacheHit: vi.fn(),
		recordCacheMiss: vi.fn(),
	};
}

describe('ArticleService', () => {
	it('lists articles through a user-scoped repository query without materializing feed ids', async () => {
		const articleRepo = {
			findByScope: vi.fn(async () => [
				{
					id: 'article-1',
					feedId: 'feed-1',
					feedTitle: 'Feed',
					feedFaviconUrl: null,
					title: 'Post 1',
					author: null,
					excerpt: 'Excerpt',
					heroImageUrl: null,
					publishedAt: new Date('2026-06-01T00:00:00.000Z'),
					fetchedAt: new Date('2026-06-01T00:01:00.000Z'),
					isRead: false,
				},
			]),
		};
		const feedRepo = {
			findById: vi.fn(async () => ({ id: 'feed-1' })),
			findAllByUser: vi.fn(),
		};
		const service = new ArticleService(
			articleRepo as never,
			feedRepo as never,
			{} as never,
			{} as never,
		);

		const result = await service.getArticles('user-1', { feedId: 'feed-1', limit: 20 });

		expect(feedRepo.findById).toHaveBeenCalledWith('feed-1', 'user-1');
		expect(feedRepo.findAllByUser).not.toHaveBeenCalled();
		expect(articleRepo.findByScope).toHaveBeenCalledWith(
			{ userId: 'user-1', feedId: 'feed-1', categoryId: undefined },
			{ limit: 20, cursor: undefined, sort: undefined, unreadOnly: undefined },
		);
		expect(result).toEqual({
			data: [
				expect.objectContaining({
					id: 'article-1',
					displayedAt: '2026-06-01T00:00:00.000Z',
					publishedAt: '2026-06-01T00:00:00.000Z',
				}),
			],
			cursor: null,
			hasMore: false,
		});
	});

	it('does not fail article listing when best-effort activity tracking rejects', async () => {
		const articleRepo = {
			findByScope: vi.fn(async () => [
				{
					id: 'article-1',
					feedId: 'feed-1',
					feedTitle: 'Feed',
					feedFaviconUrl: null,
					title: 'Post 1',
					author: null,
					excerpt: 'Excerpt',
					heroImageUrl: null,
					publishedAt: null,
					fetchedAt: new Date('2026-06-01T00:01:00.000Z'),
					isRead: false,
				},
			]),
		};
		const feedRepo = {
			findById: vi.fn(async () => ({ id: 'feed-1' })),
		};
		const articleCache = {
			trackUserActivity: vi.fn(async () => {
				throw new Error('redis unavailable');
			}),
			getCachedArticleList: vi.fn(async () => null),
		};
		const service = new ArticleService(
			articleRepo as never,
			feedRepo as never,
			{} as never,
			{} as never,
			undefined,
			undefined,
			articleCache as never,
		);

		const result = await service.getArticles('user-1', { feedId: 'feed-1', limit: 20 });

		expect(articleCache.trackUserActivity).toHaveBeenCalledWith('user-1');
		expect(result.data).toHaveLength(1);
	});

	it('returns 404 for category-scoped article lists when the category is missing', async () => {
		const articleRepo = {
			findByScope: vi.fn(),
		};
		const categoryRepo = {
			findById: vi.fn(async () => null),
		};
		const service = new ArticleService(
			articleRepo as never,
			{} as never,
			{} as never,
			{} as never,
			undefined,
			undefined,
			undefined,
			categoryRepo as never,
		);

		await expect(
			service.getArticles('user-1', { categoryId: 'category-1', limit: 20 }),
		).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
		expect(categoryRepo.findById).toHaveBeenCalledWith('category-1', 'user-1');
		expect(articleRepo.findByScope).not.toHaveBeenCalled();
	});

	it('searches through a scoped repository query and records search metrics', async () => {
		const articleRepo = {
			searchByScope: vi.fn(async () => [
				{
					id: 'article-1',
					feedId: 'feed-1',
					feedTitle: 'Feed',
					feedFaviconUrl: null,
					title: 'Post 1',
					author: null,
					excerpt: 'Excerpt',
					heroImageUrl: null,
					publishedAt: null,
					fetchedAt: new Date('2026-06-01T00:01:00.000Z'),
					isRead: false,
				},
			]),
		};
		const feedRepo = {
			findAllByUser: vi.fn(),
			findByCategory: vi.fn(),
		};
		const metricsRepo = {
			incrementSearchCount: vi.fn(async () => undefined),
		};
		const service = new ArticleService(
			articleRepo as never,
			feedRepo as never,
			metricsRepo as never,
			{} as never,
		);

		const result = await service.search('user-1', 'reader', 'cat-1', 20);

		expect(feedRepo.findAllByUser).not.toHaveBeenCalled();
		expect(feedRepo.findByCategory).not.toHaveBeenCalled();
		expect(articleRepo.searchByScope).toHaveBeenCalledWith(
			{ userId: 'user-1', categoryId: 'cat-1' },
			'reader',
			20,
			undefined,
		);
		expect(metricsRepo.incrementSearchCount).toHaveBeenCalledWith('user-1');
		expect(result.data[0]).toEqual(
			expect.objectContaining({
				id: 'article-1',
				displayedAt: '2026-06-01T00:01:00.000Z',
				publishedAt: null,
			}),
		);
	});

	it('returns 404 for category-scoped search when the category is missing', async () => {
		const articleRepo = {
			searchByScope: vi.fn(),
		};
		const metricsRepo = {
			incrementSearchCount: vi.fn(),
		};
		const categoryRepo = {
			findById: vi.fn(async () => null),
		};
		const service = new ArticleService(
			articleRepo as never,
			{} as never,
			metricsRepo as never,
			{} as never,
			undefined,
			undefined,
			undefined,
			categoryRepo as never,
		);

		await expect(service.search('user-1', 'reader', 'missing-category')).rejects.toMatchObject({
			code: 'NOT_FOUND',
			statusCode: 404,
		});
		expect(articleRepo.searchByScope).not.toHaveBeenCalled();
		expect(metricsRepo.incrementSearchCount).not.toHaveBeenCalled();
	});

	it('loads article detail with the user-scoped detail query', async () => {
		const articleRepo = {
			findDetailForUser: vi.fn(async () => ({
				id: 'article-1',
				feedId: 'feed-1',
				guid: 'guid-1',
				canonicalUrl: 'https://example.com/post-1',
				title: 'Post 1',
				author: null,
				excerpt: 'Excerpt',
				contentHtml: '<p>Body</p>',
				contentText: 'Body',
				heroImageUrl: null,
				publishedAt: new Date('2026-06-01T00:00:00.000Z'),
				fetchedAt: new Date('2026-06-01T00:01:00.000Z'),
				hash: 'hash-1',
				feedTitle: 'Feed',
				feedFaviconUrl: null,
				feedSiteUrl: 'https://example.com',
				isRead: false,
				media: [],
			})),
		};
		const metrics = cacheMetrics();
		const service = new ArticleService(
			articleRepo as never,
			{} as never,
			{} as never,
			{
				get: vi.fn(async () => null),
				setex: vi.fn(async () => 'OK'),
				del: vi.fn(async () => 0),
			} as never,
			undefined,
			undefined,
			undefined,
			undefined,
			metrics,
		);

		const result = await service.getArticle('user-1', 'article-1');

		expect(articleRepo.findDetailForUser).toHaveBeenCalledWith('user-1', 'article-1');
		expect(result.publishedAt).toBe('2026-06-01T00:00:00.000Z');
		expect(result.fetchedAt).toBe('2026-06-01T00:01:00.000Z');
		expect(result.isEnriched).toBe(false);
		expect(metrics.recordCacheMiss).toHaveBeenCalledWith('article_detail');
		expect(metrics.recordCacheHit).not.toHaveBeenCalled();
	});

	it('returns article detail from cache and records a cache hit', async () => {
		const cachedArticle = {
			id: 'article-1',
			feedId: 'feed-1',
			guid: 'guid-1',
			canonicalUrl: 'https://example.com/post-1',
			title: 'Post 1',
			author: null,
			excerpt: 'Excerpt',
			contentHtml: '<p>Body</p>',
			contentText: 'Body',
			heroImageUrl: null,
			publishedAt: null,
			fetchedAt: '2026-06-01T00:01:00.000Z',
			hash: 'hash-1',
			feedTitle: 'Feed',
			feedFaviconUrl: null,
			feedSiteUrl: 'https://example.com',
			isRead: false,
			isEnriched: false,
			media: [],
		};
		const articleRepo = {
			findDetailForUser: vi.fn(),
		};
		const redis = {
			get: vi.fn(async () => JSON.stringify(cachedArticle)),
			setex: vi.fn(async () => 'OK'),
			del: vi.fn(async () => 0),
		};
		const metrics = cacheMetrics();
		const service = new ArticleService(
			articleRepo as never,
			{} as never,
			{} as never,
			redis as never,
			undefined,
			undefined,
			undefined,
			undefined,
			metrics,
		);

		const result = await service.getArticle('user-1', 'article-1');

		expect(result).toEqual(cachedArticle);
		expect(articleRepo.findDetailForUser).not.toHaveBeenCalled();
		expect(redis.setex).not.toHaveBeenCalled();
		expect(metrics.recordCacheHit).toHaveBeenCalledWith('article_detail');
		expect(metrics.recordCacheMiss).not.toHaveBeenCalled();
	});

	it('treats corrupt article detail cache entries as misses and refreshes from the database', async () => {
		const articleRepo = {
			findDetailForUser: vi.fn(async () => ({
				id: 'article-1',
				feedId: 'feed-1',
				guid: 'guid-1',
				canonicalUrl: 'https://example.com/post-1',
				title: 'Post 1',
				author: null,
				excerpt: 'Excerpt',
				contentHtml: '<p>Body</p>',
				contentText: 'Body',
				heroImageUrl: null,
				publishedAt: null,
				fetchedAt: new Date('2026-06-01T00:01:00.000Z'),
				hash: 'hash-1',
				feedTitle: 'Feed',
				feedFaviconUrl: null,
				feedSiteUrl: 'https://example.com',
				isRead: false,
				media: [],
			})),
		};
		const redis = {
			get: vi.fn(async () => 'not json'),
			setex: vi.fn(async () => 'OK'),
			del: vi.fn(async () => 1),
		};
		const metrics = cacheMetrics();
		const service = new ArticleService(
			articleRepo as never,
			{} as never,
			{} as never,
			redis as never,
			undefined,
			undefined,
			undefined,
			undefined,
			metrics,
		);

		const result = await service.getArticle('user-1', 'article-1');

		expect(redis.del).toHaveBeenCalledWith('articles:detail:user-1:article-1');
		expect(articleRepo.findDetailForUser).toHaveBeenCalledWith('user-1', 'article-1');
		expect(result.fetchedAt).toBe('2026-06-01T00:01:00.000Z');
		expect(metrics.recordCacheMiss).toHaveBeenCalledWith('article_detail');
		expect(metrics.recordCacheHit).not.toHaveBeenCalled();
	});

	it('waits for enrichment to complete before returning success', async () => {
		const articleRepo = {
			findById: vi.fn(async () => ({
				id: 'article-1',
				feedId: 'feed-1',
				canonicalUrl: 'https://example.com/post-1',
				contentHtml: 'Only text in the RSS feed',
				heroImageUrl: null,
				media: [],
			})),
		};
		const feedRepo = {
			findById: vi.fn(async () => ({ id: 'feed-1' })),
		};
		const metricsRepo = {};
		const redis = { del: vi.fn(async () => 0) };
		const feedSyncService = {
			enrichArticleNow: vi.fn(async () => undefined),
		};

		const service = new ArticleService(
			articleRepo as never,
			feedRepo as never,
			metricsRepo as never,
			redis as never,
			feedSyncService as never,
		);

		const result = await service.enrichArticle('user-1', 'article-1');

		expect(feedSyncService.enrichArticleNow).toHaveBeenCalledWith({
			articleId: 'article-1',
			userId: 'user-1',
			canonicalUrl: 'https://example.com/post-1',
			contentHtml: 'Only text in the RSS feed',
			heroImageUrl: null,
			fetchedAt: undefined,
		});
		expect(result).toEqual({ success: true });
	});

	it('invalidates only affected unread cache keys on markRead', async () => {
		const articleRepo = {
			findRefForUser: vi.fn(async () => ({ id: 'article-1', feedId: 'feed-1' })),
			markRead: vi.fn(async () => true),
		};
		const feedRepo = {};
		const metricsRepo = {
			incrementReadCount: vi.fn(async () => undefined),
		};
		const redis = {
			del: vi.fn(async () => 2),
		};
		const realtime = {
			publishReadStateEvent: vi.fn(async () => undefined),
		};
		const articleCache = {
			updateCachedReadState: vi.fn(async () => undefined),
			invalidateCache: vi.fn(async () => undefined),
		};

		const service = new ArticleService(
			articleRepo as never,
			feedRepo as never,
			metricsRepo as never,
			redis as never,
			undefined,
			realtime as never,
			articleCache as never,
		);

		const result = await service.markRead('user-1', 'article-1', true, 'manual', 'client-1');

		expect(articleRepo.findRefForUser).toHaveBeenCalledWith('user-1', 'article-1');
		expect(articleRepo.markRead).toHaveBeenCalledWith('user-1', 'article-1', 'manual');
		expect(metricsRepo.incrementReadCount).toHaveBeenCalledWith('user-1', 1);
		expect(redis.del).toHaveBeenCalledWith('unread:user-1', 'unread:user-1:feed:feed-1');
		expect(redis.del).toHaveBeenCalledWith('articles:detail:user-1:article-1');
		expect(articleCache.updateCachedReadState).toHaveBeenCalledWith('user-1', 'article-1', true);
		expect(articleCache.invalidateCache).not.toHaveBeenCalled();
		expect(realtime.publishReadStateEvent).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				type: 'article.read_state_changed',
				articleId: 'article-1',
				feedId: 'feed-1',
				isRead: true,
				source: 'manual',
				clientId: 'client-1',
			}),
		);
		expect(result).toEqual({ success: true });
	});

	it('does not wait for scoped list cache patching on markRead', async () => {
		const articleRepo = {
			findRefForUser: vi.fn(async () => ({ id: 'article-1', feedId: 'feed-1' })),
			markRead: vi.fn(async () => true),
		};
		const metricsRepo = {
			incrementReadCount: vi.fn(async () => undefined),
		};
		const redis = {
			del: vi.fn(async () => 1),
		};
		const realtime = {
			publishReadStateEvent: vi.fn(async () => undefined),
		};
		const articleCache = {
			updateCachedReadState: vi.fn(() => new Promise(() => undefined)),
		};
		const service = new ArticleService(
			articleRepo as never,
			{} as never,
			metricsRepo as never,
			redis as never,
			undefined,
			realtime as never,
			articleCache as never,
		);

		await expect(
			service.markRead('user-1', 'article-1', true, 'manual', 'client-1'),
		).resolves.toEqual({ success: true });
		expect(articleCache.updateCachedReadState).toHaveBeenCalledWith('user-1', 'article-1', true);
	});

	it('does not publish or count duplicate markRead requests', async () => {
		const articleRepo = {
			findRefForUser: vi.fn(async () => ({ id: 'article-1', feedId: 'feed-1' })),
			markRead: vi.fn(async () => false),
		};
		const metricsRepo = {
			incrementReadCount: vi.fn(async () => undefined),
		};
		const redis = {
			del: vi.fn(async () => 0),
		};
		const realtime = {
			publishReadStateEvent: vi.fn(async () => undefined),
		};
		const service = new ArticleService(
			articleRepo as never,
			{} as never,
			metricsRepo as never,
			redis as never,
			undefined,
			realtime as never,
		);

		await service.markRead('user-1', 'article-1', true, 'manual', 'client-1');

		expect(metricsRepo.incrementReadCount).not.toHaveBeenCalled();
		expect(redis.del).not.toHaveBeenCalled();
		expect(realtime.publishReadStateEvent).not.toHaveBeenCalled();
	});

	it('publishes unread changes without incrementing read metrics', async () => {
		const articleRepo = {
			findRefForUser: vi.fn(async () => ({ id: 'article-1', feedId: 'feed-1' })),
			markUnread: vi.fn(async () => true),
		};
		const metricsRepo = {
			incrementReadCount: vi.fn(async () => undefined),
		};
		const redis = {
			del: vi.fn(async () => 1),
		};
		const realtime = {
			publishReadStateEvent: vi.fn(async () => undefined),
		};
		const service = new ArticleService(
			articleRepo as never,
			{} as never,
			metricsRepo as never,
			redis as never,
			undefined,
			realtime as never,
		);

		await service.markRead('user-1', 'article-1', false, 'manual', 'client-1');

		expect(articleRepo.markUnread).toHaveBeenCalledWith('user-1', 'article-1');
		expect(metricsRepo.incrementReadCount).not.toHaveBeenCalled();
		expect(redis.del).toHaveBeenCalledWith('unread:user-1', 'unread:user-1:feed:feed-1');
		expect(realtime.publishReadStateEvent).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				type: 'article.read_state_changed',
				articleId: 'article-1',
				feedId: 'feed-1',
				isRead: false,
				clientId: 'client-1',
			}),
		);
	});

	it('passes all touched feed ids to markAllRead invalidation', async () => {
		const articleRepo = {
			markAllRead: vi.fn(async () => 3),
		};
		const feedRepo = {
			findAllByUser: vi.fn(async () => [{ id: 'feed-1' }, { id: 'feed-2' }]),
		};
		const metricsRepo = {
			incrementReadCount: vi.fn(async () => undefined),
		};
		const redis = {
			del: vi.fn(async () => 3),
		};
		const realtime = {
			publishReadStateEvent: vi.fn(async () => undefined),
		};

		const service = new ArticleService(
			articleRepo as never,
			feedRepo as never,
			metricsRepo as never,
			redis as never,
			undefined,
			realtime as never,
		);

		const result = await service.markAllRead('user-1', {}, 'client-1');

		expect(articleRepo.markAllRead).toHaveBeenCalledWith('user-1', ['feed-1', 'feed-2']);
		expect(metricsRepo.incrementReadCount).toHaveBeenCalledWith('user-1', 3);
		expect(redis.del).toHaveBeenCalledWith(
			'unread:user-1',
			'unread:user-1:feed:feed-1',
			'unread:user-1:feed:feed-2',
		);
		expect(realtime.publishReadStateEvent).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				type: 'articles.marked_read',
				feedIds: ['feed-1', 'feed-2'],
				scope: {},
				markedCount: 3,
				clientId: 'client-1',
			}),
		);
		expect(result).toEqual({ markedCount: 3, feedIds: ['feed-1', 'feed-2'] });
	});

	it('does not publish markAllRead events when nothing changed', async () => {
		const articleRepo = {
			markAllRead: vi.fn(async () => 0),
		};
		const feedRepo = {
			findAllByUser: vi.fn(async () => [{ id: 'feed-1' }]),
		};
		const metricsRepo = {
			incrementReadCount: vi.fn(async () => undefined),
		};
		const redis = {
			del: vi.fn(async () => 1),
		};
		const realtime = {
			publishReadStateEvent: vi.fn(async () => undefined),
		};
		const service = new ArticleService(
			articleRepo as never,
			feedRepo as never,
			metricsRepo as never,
			redis as never,
			undefined,
			realtime as never,
		);

		const result = await service.markAllRead('user-1', {}, 'client-1');

		expect(metricsRepo.incrementReadCount).not.toHaveBeenCalled();
		expect(realtime.publishReadStateEvent).not.toHaveBeenCalled();
		expect(redis.del).toHaveBeenCalledWith('unread:user-1', 'unread:user-1:feed:feed-1');
		expect(result).toEqual({ markedCount: 0, feedIds: ['feed-1'] });
	});

	it('returns 404 for markAllRead when the category is missing', async () => {
		const articleRepo = {
			markAllRead: vi.fn(),
		};
		const feedRepo = {
			findByCategory: vi.fn(),
		};
		const categoryRepo = {
			findById: vi.fn(async () => null),
		};
		const service = new ArticleService(
			articleRepo as never,
			feedRepo as never,
			{} as never,
			{} as never,
			undefined,
			undefined,
			undefined,
			categoryRepo as never,
		);

		await expect(
			service.markAllRead('user-1', { categoryId: 'missing-category' }, 'client-1'),
		).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
		expect(feedRepo.findByCategory).not.toHaveBeenCalled();
		expect(articleRepo.markAllRead).not.toHaveBeenCalled();
	});
});
