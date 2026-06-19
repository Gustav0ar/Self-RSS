import type Redis from 'ioredis';
import { CacheKeys, CacheTTL } from '../db/redis.js';
import { AppError } from '../middleware/errors.js';
import type { ArticleRepository } from '../repositories/article.repository.js';
import type { FeedRepository } from '../repositories/feed.repository.js';
import type { MetricsRepository } from '../repositories/settings.repository.js';
import { encodeArticleCursor } from '../utils/article-cursor.js';
import type { ArticleCacheService } from './article-cache.service.js';
import type { FeedSyncService } from './feed-sync.service.js';
import type { RealtimeService } from './realtime.service.js';

// Shape of a single article as serialized for the API response and
// stored in the per-article detail cache. Derived from the repository
// query so adding a column there propagates here automatically. We
// Omit the raw Date fields and re-add them as ISO strings, since the
// repository returns Dates but the API contract (and the JSON we
// stash in Redis) is string-only.
type ArticleDetailResponse = Omit<
	NonNullable<Awaited<ReturnType<ArticleRepository['findDetailForUser']>>>,
	'publishedAt' | 'fetchedAt'
> & {
	publishedAt: string | null;
	fetchedAt: string;
	isEnriched: boolean;
};

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
			// The cursor is opaque to clients but embeds the sort timestamp
			// for the last returned row so the next page query doesn't
			// need a second round-trip to look the row up. The shape is
			// `<articleId>:<unixSeconds>:<direction>`; clients must pass it back
			// verbatim.
			cursor: hasMore ? encodeArticleCursor(items[items.length - 1] ?? null, options.sort) : null,
			hasMore,
		};
	}

	async getArticle(userId: string, articleId: string): Promise<ArticleDetailResponse> {
		// Cache hit path: Redis lookup keyed by userId+articleId. The key
		// namespace already enforces ownership (you can only read articles
		// that are in your own namespace), so a hit is safe to return
		// without a DB ownership check.
		const cacheKey = CacheKeys.articleDetail(userId, articleId);
		const cached = await this.redis.get(cacheKey);
		if (cached) {
			try {
				return JSON.parse(cached) as ArticleDetailResponse;
			} catch {
				// Corrupt cache entry — fall through to the DB.
				await this.redis.del(cacheKey);
			}
		}

		const article = await this.articleRepo.findDetailForUser(userId, articleId);
		if (!article) throw AppError.notFound('Article not found');

		const response: ArticleDetailResponse = {
			...article,
			publishedAt: article.publishedAt?.toISOString() ?? null,
			fetchedAt: article.fetchedAt.toISOString(),
			isEnriched: !!article.heroImageUrl || (article.media?.length ?? 0) > 0,
		};

		// Populate the cache for next time. Fire-and-forget — a cache
		// write failure must not fail the request.
		this.redis.setex(cacheKey, CacheTTL.articleDetail, JSON.stringify(response)).catch((err) => {
			// Best-effort cache write. Log and continue.
			void err;
		});

		return response;
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
			// The cache invalidations and the realtime publish are all
			// independent of the DB write that just succeeded. Run them in
			// parallel so the route returns as soon as the slowest of the
			// three completes, not their sum.
			await Promise.all([
				this.invalidateUnreadCache(userId, [article.feedId]),
				this.invalidateArticleDetailCache(userId, articleId),
				this.articleCache?.invalidateCache(userId),
				this.realtimeService?.publishReadStateEvent(userId, {
					type: 'article.read_state_changed',
					eventId: crypto.randomUUID(),
					articleId,
					feedId: article.feedId,
					isRead: read,
					source,
					clientId,
					updatedAt: new Date().toISOString(),
				}),
			]);
		}

		return { success: true };
	}

	/**
	 * Drop the per-article detail cache. Called whenever a field that
	 * the response includes (isRead, media, heroImageUrl, etc.) changes
	 * for a specific article.
	 */
	private async invalidateArticleDetailCache(userId: string, articleId: string): Promise<void> {
		try {
			await this.redis.del(CacheKeys.articleDetail(userId, articleId));
		} catch {
			// Best-effort. Stale entries expire on their own via the
			// 5-minute TTL.
		}
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

		// Metrics, cache invalidation, and realtime publish are all
		// independent. Run them in parallel so the route doesn't pay the
		// sum of their latencies.
		const fanOut: Promise<unknown>[] = [
			this.invalidateUnreadCache(userId, feedIds),
			this.articleCache?.invalidateCache(userId) ?? Promise.resolve(),
		];
		if (count > 0) {
			fanOut.push(this.metricsRepo.incrementReadCount(userId, count));
			fanOut.push(
				this.realtimeService?.publishReadStateEvent(userId, {
					type: 'articles.marked_read',
					eventId: crypto.randomUUID(),
					feedIds,
					scope: options,
					markedCount: count,
					clientId,
					updatedAt: new Date().toISOString(),
				}) ?? Promise.resolve(),
			);
		}
		await Promise.all(fanOut);
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
			userId,
			canonicalUrl,
			contentHtml: article.contentHtml,
			heroImageUrl: article.heroImageUrl,
			fetchedAt: article.fetchedAt,
		});

		// Enrichment adds hero image / media which are part of the detail
		// response, so the cached copy is now stale.
		await this.invalidateArticleDetailCache(userId, articleId);

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

		const data = items.map((a) => ({
			...a,
			publishedAt: a.publishedAt?.toISOString() ?? null,
			displayedAt: (a.publishedAt ?? a.fetchedAt).toISOString(),
			isRead: a.isRead,
		}));

		return {
			data,
			cursor: hasMore ? encodeArticleCursor(items[items.length - 1] ?? null, 'latest') : null,
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
