import { describe, expect, it, vi } from 'vitest';
import { ArticleService } from '../../src/services/article.service.js';

describe('ArticleService', () => {
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
			findById: vi.fn(async () => ({ id: 'article-1', feedId: 'feed-1' })),
			markRead: vi.fn(async () => undefined),
		};
		const feedRepo = {
			findById: vi.fn(async () => ({ id: 'feed-1' })),
		};
		const metricsRepo = {
			incrementReadCount: vi.fn(async () => undefined),
		};
		const redis = {
			del: vi.fn(async () => 2),
		};

		const service = new ArticleService(
			articleRepo as never,
			feedRepo as never,
			metricsRepo as never,
			redis as never,
		);

		const result = await service.markRead('user-1', 'article-1', true, 'manual');

		expect(articleRepo.markRead).toHaveBeenCalledWith('user-1', 'article-1', 'manual');
		expect(metricsRepo.incrementReadCount).toHaveBeenCalledWith('user-1', 1);
		expect(redis.del).toHaveBeenCalledWith('unread:user-1', 'unread:user-1:feed:feed-1');
		expect(result).toEqual({ success: true });
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

		const service = new ArticleService(
			articleRepo as never,
			feedRepo as never,
			metricsRepo as never,
			redis as never,
		);

		const result = await service.markAllRead('user-1', {});

		expect(articleRepo.markAllRead).toHaveBeenCalledWith('user-1', ['feed-1', 'feed-2']);
		expect(metricsRepo.incrementReadCount).toHaveBeenCalledWith('user-1', 3);
		expect(redis.del).toHaveBeenCalledWith(
			'unread:user-1',
			'unread:user-1:feed:feed-1',
			'unread:user-1:feed:feed-2',
		);
		expect(result).toEqual({ markedCount: 3 });
	});
});
