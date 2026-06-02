import type Redis from 'ioredis';
import { CacheKeys } from '../db/redis.js';
import { AppError } from '../middleware/errors.js';
import type { ArticleRepository } from '../repositories/article.repository.js';
import type { FeedRepository } from '../repositories/feed.repository.js';
import type { MetricsRepository } from '../repositories/settings.repository.js';
import type { FeedSyncService } from './feed-sync.service.js';

export class ArticleService {
	constructor(
		private articleRepo: ArticleRepository,
		private feedRepo: FeedRepository,
		private metricsRepo: MetricsRepository,
		private redis: Redis,
		private feedSyncService?: FeedSyncService,
	) {}

	async getArticles(
		userId: string,
		options: {
			feedId?: string;
			categoryId?: string;
			unreadOnly?: boolean;
			sort?: string;
			cursor?: string;
			limit?: number;
		},
	) {
		const limit = options.limit ?? 20;
		let feedIds: string[] = [];

		if (options.feedId) {
			const feed = await this.feedRepo.findById(options.feedId, userId);
			if (!feed) throw AppError.notFound('Feed not found');
			feedIds = [feed.id];
		} else if (options.categoryId) {
			const feeds = await this.feedRepo.findByCategory(userId, options.categoryId);
			feedIds = feeds.map((f) => f.id);
		} else {
			const feeds = await this.feedRepo.findAllByUser(userId);
			feedIds = feeds.map((f) => f.id);
		}

		if (feedIds.length === 0) {
			return { data: [], cursor: null, hasMore: false };
		}

		const result = await this.articleRepo.findByFeeds(userId, feedIds, {
			limit,
			cursor: options.cursor,
			sort: options.sort,
			unreadOnly: options.unreadOnly,
		});
		const hasMore = result.length > limit;
		const items = result.slice(0, limit);

		const data = items.map((a) => ({
			id: a.id,
			feedId: a.feedId,
			feedTitle: a.feedTitle,
			feedFaviconUrl: a.feedFaviconUrl,
			title: a.title,
			author: a.author,
			excerpt: a.excerpt,
			heroImageUrl: a.heroImageUrl,
			publishedAt: a.publishedAt?.toISOString() ?? null,
			displayedAt: (a.publishedAt ?? a.fetchedAt).toISOString(),
			isRead: a.isRead,
		}));

		return {
			data,
			cursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
			hasMore,
		};
	}

	async getArticle(userId: string, articleId: string) {
		const article = await this.articleRepo.findById(articleId);
		if (!article) throw AppError.notFound('Article not found');

		// Check ownership through feed
		const feed = await this.feedRepo.findById(article.feedId, userId);
		if (!feed) throw AppError.notFound('Article not found');

		const isRead = await this.articleRepo.isRead(userId, articleId);

		return {
			...article,
			feedTitle: feed.title,
			feedFaviconUrl: feed.faviconUrl,
			feedSiteUrl: feed.siteUrl,
			publishedAt: article.publishedAt?.toISOString() ?? null,
			fetchedAt: article.fetchedAt.toISOString(),
			isRead,
			media: article.media ?? [],
			isEnriched: !!article.heroImageUrl || (article.media?.length ?? 0) > 0,
		};
	}

	async markRead(userId: string, articleId: string, read: boolean, source: string) {
		const article = await this.articleRepo.findById(articleId);
		if (!article) throw AppError.notFound('Article not found');

		const feed = await this.feedRepo.findById(article.feedId, userId);
		if (!feed) throw AppError.notFound('Article not found');

		if (read) {
			await this.articleRepo.markRead(userId, articleId, source);
			await this.metricsRepo.incrementReadCount(userId, 1);
		} else {
			await this.articleRepo.markUnread(userId, articleId);
		}

		await this.invalidateUnreadCache(userId, [article.feedId]);
		return { success: true };
	}

	async markAllRead(userId: string, options: { categoryId?: string; feedId?: string }) {
		let feedIds: string[] = [];

		if (options.feedId) {
			const feed = await this.feedRepo.findById(options.feedId, userId);
			if (!feed) throw AppError.notFound('Feed not found');
			feedIds = [feed.id];
		} else if (options.categoryId) {
			const feeds = await this.feedRepo.findByCategory(userId, options.categoryId);
			feedIds = feeds.map((f) => f.id);
		} else {
			const feeds = await this.feedRepo.findAllByUser(userId);
			feedIds = feeds.map((f) => f.id);
		}

		const count = await this.articleRepo.markAllRead(userId, feedIds);
		if (count > 0) {
			await this.metricsRepo.incrementReadCount(userId, count);
		}
		await this.invalidateUnreadCache(userId, feedIds);
		return { markedCount: count };
	}

	async enrichArticle(userId: string, articleId: string) {
		const article = await this.articleRepo.findById(articleId);
		if (!article) throw AppError.notFound('Article not found');

		const feed = await this.feedRepo.findById(article.feedId, userId);
		if (!feed) throw AppError.notFound('Article not found');

		const canonicalUrl = article.canonicalUrl?.trim();
		if (!canonicalUrl) {
			return { success: false, reason: 'missing_canonical_url' };
		}

		if (article.heroImageUrl || (article.media?.length ?? 0) > 0) {
			return { success: false, reason: 'already_enriched' };
		}

		if (!this.feedSyncService) {
			return { success: false, reason: 'enrichment_unavailable' };
		}

		await this.feedSyncService.enrichArticleNow({
			articleId: article.id,
			canonicalUrl,
			contentHtml: article.contentHtml,
			heroImageUrl: article.heroImageUrl,
		});

		return { success: true };
	}

	async search(userId: string, query: string, categoryId?: string, limit = 20, cursor?: string) {
		let feedIds: string[] = [];

		if (categoryId) {
			const feeds = await this.feedRepo.findByCategory(userId, categoryId);
			feedIds = feeds.map((f) => f.id);
		} else {
			const feeds = await this.feedRepo.findAllByUser(userId);
			feedIds = feeds.map((f) => f.id);
		}

		if (feedIds.length === 0) {
			return { data: [], cursor: null, hasMore: false };
		}

		const results = await this.articleRepo.search(userId, query, feedIds, limit, cursor);
		await this.metricsRepo.incrementSearchCount(userId);
		const hasMore = results.length > limit;
		const items = results.slice(0, limit);

		const readIds = await this.articleRepo.getReadArticleIds(
			userId,
			items.map((a) => a.id),
		);

		const data = items.map((a) => ({
			...a,
			publishedAt: a.publishedAt?.toISOString() ?? null,
			displayedAt: (a.publishedAt ?? a.fetchedAt).toISOString(),
			isRead: readIds.has(a.id),
		}));

		return {
			data,
			cursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
			hasMore,
		};
	}

	private async invalidateUnreadCache(userId: string, feedIds: string[] = []) {
		const keys = [CacheKeys.unreadCount(userId)];
		for (const feedId of feedIds) {
			keys.push(CacheKeys.unreadCountByFeed(userId, feedId));
		}
		await this.redis.del(...keys);
	}
}
