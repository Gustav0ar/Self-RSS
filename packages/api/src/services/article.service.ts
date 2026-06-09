import type Redis from 'ioredis';
import { CacheKeys } from '../db/redis.js';
import { AppError } from '../middleware/errors.js';
import type { ArticleRepository } from '../repositories/article.repository.js';
import type { FeedRepository } from '../repositories/feed.repository.js';
import type { MetricsRepository } from '../repositories/settings.repository.js';
import type { ArticleCacheService } from './article-cache.service.js';
import type { FeedSyncService } from './feed-sync.service.js';
import type { RealtimeService } from './realtime.service.js';

export class ArticleService {
	constructor(
		private articleRepo: ArticleRepository,
		private feedRepo: FeedRepository,
		private metricsRepo: MetricsRepository,
		private redis: Redis,
		private feedSyncService?: FeedSyncService,
		private realtimeService?: RealtimeService,
		private articleCache?: ArticleCacheService,
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

		// Track user activity for priority warming (fire-and-forget)
		void this.articleCache?.trackUserActivity(userId);

		// Try cache first (only for initial load without cursor)
		if (!options.cursor && this.articleCache) {
			const cached = await this.articleCache.getCachedArticleList(userId, {
				feedId: options.feedId,
				categoryId: options.categoryId,
				unreadOnly: options.unreadOnly,
				sort: options.sort,
				limit,
			});
			if (cached) {
				return {
					data: cached.articles,
					cursor: cached.cursor,
					hasMore: cached.hasMore,
				};
			}
		}

		// Fallback to DB query
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
		const article = await this.articleRepo.findDetailForUser(userId, articleId);
		if (!article) throw AppError.notFound('Article not found');

		return {
			...article,
			publishedAt: article.publishedAt?.toISOString() ?? null,
			fetchedAt: article.fetchedAt.toISOString(),
			isEnriched: !!article.heroImageUrl || (article.media?.length ?? 0) > 0,
		};
	}

	async markRead(
		userId: string,
		articleId: string,
		read: boolean,
		source: string,
		clientId: string | null = null,
	) {
		const article = await this.articleRepo.findRefForUser(userId, articleId);
		if (!article) throw AppError.notFound('Article not found');

		let changed = false;
		if (read) {
			changed = await this.articleRepo.markRead(userId, articleId, source);
			if (changed) {
				await this.metricsRepo.incrementReadCount(userId, 1);
			}
		} else {
			changed = await this.articleRepo.markUnread(userId, articleId);
		}

		if (changed) {
			await this.invalidateUnreadCache(userId, [article.feedId]);
			await this.articleCache?.invalidateCache(userId);
			await this.realtimeService?.publishReadStateEvent(userId, {
				type: 'article.read_state_changed',
				eventId: crypto.randomUUID(),
				articleId,
				feedId: article.feedId,
				isRead: read,
				source,
				clientId,
				updatedAt: new Date().toISOString(),
			});
		}

		return { success: true };
	}

	async markAllRead(
		userId: string,
		options: { categoryId?: string; feedId?: string },
		clientId: string | null = null,
	) {
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
			await this.realtimeService?.publishReadStateEvent(userId, {
				type: 'articles.marked_read',
				eventId: crypto.randomUUID(),
				feedIds,
				scope: options,
				markedCount: count,
				clientId,
				updatedAt: new Date().toISOString(),
			});
		}
		await this.invalidateUnreadCache(userId, feedIds);
		await this.articleCache?.invalidateCache(userId);
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
			fetchedAt: article.fetchedAt,
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
