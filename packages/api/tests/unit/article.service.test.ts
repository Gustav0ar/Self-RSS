import { describe, expect, it, vi } from 'vitest';
import { ArticleService } from '../../src/services/article.service.js';

describe('ArticleService', () => {
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
		const service = new ArticleService(
			articleRepo as never,
			{} as never,
			{} as never,
			{ del: vi.fn(async () => 0) } as never,
		);

		const result = await service.getArticle('user-1', 'article-1');

		expect(articleRepo.findDetailForUser).toHaveBeenCalledWith('user-1', 'article-1');
		expect(result.publishedAt).toBe('2026-06-01T00:00:00.000Z');
		expect(result.fetchedAt).toBe('2026-06-01T00:01:00.000Z');
		expect(result.isEnriched).toBe(false);
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
			canonicalUrl: 'https://example.com/post-1',
			contentHtml: 'Only text in the RSS feed',
			heroImageUrl: null,
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

		const service = new ArticleService(
			articleRepo as never,
			feedRepo as never,
			metricsRepo as never,
			redis as never,
			undefined,
			realtime as never,
		);

		const result = await service.markRead('user-1', 'article-1', true, 'manual', 'client-1');

		expect(articleRepo.findRefForUser).toHaveBeenCalledWith('user-1', 'article-1');
		expect(articleRepo.markRead).toHaveBeenCalledWith('user-1', 'article-1', 'manual');
		expect(metricsRepo.incrementReadCount).toHaveBeenCalledWith('user-1', 1);
		expect(redis.del).toHaveBeenCalledWith('unread:user-1', 'unread:user-1:feed:feed-1');
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
		expect(result).toEqual({ markedCount: 3 });
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
		expect(result).toEqual({ markedCount: 0 });
	});
});
