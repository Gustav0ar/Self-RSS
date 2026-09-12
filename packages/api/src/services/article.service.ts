import type { ArticleStateLookupResponse } from '@self-feed/shared';
import type Redis from 'ioredis';
import { CacheKeys, CacheTTL } from '../db/redis.js';
import { AppError } from '../middleware/errors.js';
import type { ArticleRepository } from '../repositories/article.repository.js';
import type { CategoryRepository } from '../repositories/category.repository.js';
import type { FeedRepository } from '../repositories/feed.repository.js';
import type { MetricsRepository } from '../repositories/settings.repository.js';
import { decodeArticleCursor, encodeArticleCursor } from '../utils/article-cursor.js';
import { createLogger } from '../utils/logger.js';
import type { ArticleCacheService } from './article-cache.service.js';
import type { FeedSyncService } from './feed-sync.service.js';
import type { MetricsService } from './metrics.service.js';
import type { RealtimeService } from './realtime.service.js';

const logger = createLogger();

// Shape of a single article as serialized for the API response and
// stored in the per-article detail cache. Derived from the repository
// query so adding a column there propagates here automatically. We
// Omit the raw Date fields and re-add them as ISO strings, since the
// repository returns Dates but the API contract (and the JSON we
// stash in Redis) is string-only.
type ArticleDetailResponse = Omit<
	NonNullable<Awaited<ReturnType<ArticleRepository['findDetailForUser']>>>,
	'publishedAt' | 'fetchedAt' | 'enrichmentQueuedAt' | 'enrichmentAttemptedAt' | 'enrichedAt'
> & {
	publishedAt: string | null;
	fetchedAt: string;
	enrichmentQueuedAt: string | null;
	enrichmentAttemptedAt: string | null;
	enrichedAt: string | null;
	isEnriched: boolean;
};

// Older API processes share these caches and can patch flags without revisions.
// Keep revision metadata only in responses assembled with current SQLite state.
type CachedArticleDetail = Omit<ArticleDetailResponse, 'readRevision' | 'savedRevision'>;

type CacheMetrics = Pick<MetricsService, 'recordCacheHit' | 'recordCacheMiss'>;

export class ArticleService {
	constructor(
		private articleRepo: ArticleRepository,
		private feedRepo: FeedRepository,
		private metricsRepo: MetricsRepository,
		private redis: Redis,
		private feedSyncService?: FeedSyncService,
		private realtimeService?: RealtimeService,
		private articleCache?: ArticleCacheService,
		private categoryRepo?: CategoryRepository,
		private cacheMetrics?: CacheMetrics,
	) {}

	/** Read only current owned flags. No content fetch, cache write or enrichment is needed. */
	async getArticleStates(
		userId: string,
		articleIds: string[],
	): Promise<ArticleStateLookupResponse> {
		const ids = [...new Set(articleIds)];
		const states = await this.articleRepo.findStatesForUser(userId, ids);
		const found = new Set(states.map((state) => state.id));
		return { states, missingIds: ids.filter((id) => !found.has(id)) };
	}

	async getArticles(
		userId: string,
		options: {
			feedId?: string;
			categoryId?: string;
			unreadOnly?: boolean;
			savedOnly?: boolean;
			sort?: string;
			cursor?: string;
			limit?: number;
		},
	) {
		const limit = options.limit ?? 20;
		if (options.cursor && !decodeArticleCursor(options.cursor, options.sort)) {
			throw new AppError(
				'CURSOR_RESET_REQUIRED',
				'This article cursor is no longer valid. Restart pagination from the first page.',
				409,
				{ reset: true },
			);
		}

		// Track user activity for priority warming (fire-and-forget)
		void this.articleCache?.trackUserActivity(userId).catch((error) => {
			logger.warn('Failed to track article-list activity', {
				userId,
				error: error instanceof Error ? error.message : String(error),
			});
		});

		if (options.feedId) {
			const feed = await this.feedRepo.findById(options.feedId, userId);
			if (!feed) throw AppError.notFound('Feed not found');
		}
		if (options.categoryId) {
			await this.assertCategoryExists(userId, options.categoryId);
		}

		// Try cache first (only for initial load without cursor) after scope
		// validation, so stale/deleted category ids cannot look like empty lists.
		if (!options.cursor && this.articleCache) {
			const cached = await this.articleCache.getCachedArticleList(userId, {
				feedId: options.feedId,
				categoryId: options.categoryId,
				unreadOnly: options.unreadOnly,
				savedOnly: options.savedOnly,
				sort: options.sort,
				limit,
			});
			if (cached) {
				const states = new Map(
					(
						await this.articleRepo.findStatesForUser(
							userId,
							cached.articles.map((article) => article.id),
						)
					).map((state) => [state.id, state]),
				);
				const data = cached.articles.flatMap((article) => {
					const state = states.get(article.id);
					return state ? [{ ...article, ...state }] : [];
				});
				// A removed or no-longer-owned row invalidates this page boundary.
				// Fall through to scoped SQL so pagination can fill it correctly.
				if (data.length === cached.articles.length) {
					return { data, cursor: cached.cursor, hasMore: cached.hasMore };
				}
			}
		}

		const result = await this.articleRepo.findByScope(
			{
				userId,
				feedId: options.feedId,
				categoryId: options.categoryId,
			},
			{
				limit,
				cursor: options.cursor,
				sort: options.sort,
				unreadOnly: options.unreadOnly,
				savedOnly: options.savedOnly,
			},
		);
		const hasMore = result.length > limit;
		const items = result.slice(0, limit);

		const data = items.map((a) => ({
			id: a.id,
			feedId: a.feedId,
			feedTitle: a.feedTitle,
			feedFaviconUrl: a.feedFaviconUrl,
			canonicalUrl: a.canonicalUrl,
			title: a.title,
			author: a.author,
			excerpt: a.excerpt,
			heroImageUrl: a.heroImageUrl,
			publishedAt: a.publishedAt?.toISOString() ?? null,
			displayedAt: (a.publishedAt ?? a.fetchedAt).toISOString(),
			isRead: Boolean(a.isRead),
			isSaved: Boolean(a.isSaved),
			readRevision: a.readRevision,
			savedRevision: a.savedRevision,
			contentStatus: a.contentStatus,
			contentVersion: a.contentVersion,
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
		// Redis caches content. SQLite supplies current state and ownership even
		// when a warmer, another API process, or a bulk mutation changed the flags.
		const cacheKey = CacheKeys.articleDetail(userId, articleId);
		const cached = await this.redis.get(cacheKey);
		if (cached) {
			let parsed: CachedArticleDetail | undefined;
			try {
				parsed = JSON.parse(cached) as CachedArticleDetail;
			} catch {
				await this.redis.del(cacheKey);
			}
			if (parsed) {
				const [state] = await this.articleRepo.findStatesForUser(userId, [articleId]);
				if (!state) throw AppError.notFound('Article not found');
				this.cacheMetrics?.recordCacheHit('article_detail');
				return { ...parsed, ...state };
			}
		}
		this.cacheMetrics?.recordCacheMiss('article_detail');

		const article = await this.articleRepo.findDetailForUser(userId, articleId);
		if (!article) throw AppError.notFound('Article not found');

		const response: ArticleDetailResponse = {
			...article,
			isRead: Boolean(article.isRead),
			isSaved: Boolean(article.isSaved),
			publishedAt: article.publishedAt?.toISOString() ?? null,
			fetchedAt: article.fetchedAt.toISOString(),
			enrichmentQueuedAt: article.enrichmentQueuedAt?.toISOString() ?? null,
			enrichmentAttemptedAt: article.enrichmentAttemptedAt?.toISOString() ?? null,
			enrichedAt: article.enrichedAt?.toISOString() ?? null,
			isEnriched: article.contentStatus === 'full_ready',
		};

		// Populate the cache for next time. Fire-and-forget — a cache
		// write failure must not fail the request.
		const { readRevision: _read, savedRevision: _saved, ...cachePayload } = response;
		this.redis
			.setex(cacheKey, CacheTTL.articleDetail, JSON.stringify(cachePayload))
			.catch((err) => {
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
		options: { mutationId?: string; baseRevision?: number } = {},
	) {
		const article = await this.articleRepo.findRefForUser(userId, articleId);
		if (!article) throw AppError.notFound('Article not found');

		const mutation = await this.articleRepo.setReadState(userId, articleId, read, source, options);

		if (mutation.changed) {
			await this.settlePostCommit('article read state', [
				this.invalidateUnreadCache(userId, [article.feedId]),
				this.invalidateArticleDetailCache(userId, articleId),
				mutation.state ? this.metricsRepo.incrementReadCount(userId, 1) : Promise.resolve(),
				this.realtimeService?.publishReadStateEvent(userId, {
					type: 'article.read_state_changed',
					eventId: crypto.randomUUID(),
					articleId,
					feedId: article.feedId,
					isRead: mutation.state,
					revision: mutation.revision,
					source,
					clientId,
					updatedAt: new Date().toISOString(),
				}) ?? Promise.resolve(),
			]);
		}

		return {
			success: true,
			applied: mutation.applied,
			conflict: mutation.conflict,
			duplicate: mutation.duplicate,
			read: mutation.state,
			revision: mutation.revision,
		};
	}

	async setSaved(
		userId: string,
		articleId: string,
		saved: boolean,
		clientId: string | null = null,
		options: { mutationId?: string; baseRevision?: number } = {},
	) {
		const article = await this.articleRepo.findRefForUser(userId, articleId);
		if (!article) throw AppError.notFound('Article not found');

		const mutation = await this.articleRepo.setSavedState(userId, articleId, saved, options);
		if (mutation.changed) {
			await this.settlePostCommit('article saved state', [
				this.invalidateArticleDetailCache(userId, articleId),
				mutation.state
					? (this.metricsRepo.incrementProductCounts?.(userId, { articlesSaved: 1 }) ??
						Promise.resolve())
					: Promise.resolve(),
				this.realtimeService?.publishReadStateEvent(userId, {
					type: 'article.saved_state_changed',
					eventId: crypto.randomUUID(),
					articleId,
					feedId: article.feedId,
					isSaved: mutation.state,
					revision: mutation.revision,
					clientId,
					updatedAt: new Date().toISOString(),
				}) ?? Promise.resolve(),
			]);
		}

		return {
			success: true,
			applied: mutation.applied,
			conflict: mutation.conflict,
			duplicate: mutation.duplicate,
			saved: mutation.state,
			revision: mutation.revision,
		};
	}

	private async settlePostCommit(label: string, operations: Promise<unknown>[]): Promise<void> {
		const outcomes = await Promise.allSettled(operations);
		for (const outcome of outcomes) {
			if (outcome.status === 'rejected') {
				logger.warn(`Failed post-commit ${label} fan-out`, {
					error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
				});
			}
		}
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
			await this.assertCategoryExists(userId, options.categoryId);
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
		await this.settlePostCommit('bulk read state', fanOut);
		return { markedCount: count, feedIds };
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

		if (article.contentStatus === 'full_ready') {
			return { success: false, reason: 'already_enriched' };
		}

		if (!this.feedSyncService) {
			return { success: false, reason: 'enrichment_unavailable' };
		}

		await this.feedSyncService.queueArticleEnrichment(article.id);

		// Enrichment adds hero image / media which are part of the detail
		// response, so the cached copy is now stale.
		await this.invalidateArticleDetailCache(userId, articleId);

		return { success: true, queued: true };
	}

	async search(userId: string, query: string, categoryId?: string, limit = 20, cursor?: string) {
		if (cursor && !decodeArticleCursor(cursor, 'latest')) {
			throw new AppError(
				'CURSOR_RESET_REQUIRED',
				'This search cursor is no longer valid. Restart pagination from the first page.',
				409,
				{ reset: true },
			);
		}
		if (categoryId) {
			await this.assertCategoryExists(userId, categoryId);
		}

		const results = await this.articleRepo.searchByScope(
			{ userId, categoryId },
			query,
			limit,
			cursor,
		);
		await this.metricsRepo.incrementSearchCount(userId);
		const hasMore = results.length > limit;
		const items = results.slice(0, limit);

		const data = items.map((a) => ({
			id: a.id,
			feedId: a.feedId,
			title: a.title,
			author: a.author,
			excerpt: a.excerpt,
			heroImageUrl: a.heroImageUrl,
			feedTitle: a.feedTitle,
			feedFaviconUrl: a.feedFaviconUrl,
			canonicalUrl: a.canonicalUrl,
			publishedAt: a.publishedAt?.toISOString() ?? null,
			displayedAt: (a.publishedAt ?? a.fetchedAt).toISOString(),
			isRead: a.isRead,
			isSaved: a.isSaved,
			readRevision: a.readRevision,
			savedRevision: a.savedRevision,
			contentStatus: a.contentStatus,
			contentVersion: a.contentVersion,
		}));

		return {
			data,
			cursor: hasMore ? encodeArticleCursor(items[items.length - 1] ?? null, 'latest') : null,
			hasMore,
		};
	}

	private async assertCategoryExists(userId: string, categoryId: string) {
		if (!this.categoryRepo) {
			return;
		}
		const category = await this.categoryRepo.findById(categoryId, userId);
		if (!category) {
			throw AppError.notFound('Category not found');
		}
	}

	private async invalidateUnreadCache(userId: string, feedIds: string[] = []) {
		const keys = [CacheKeys.unreadCount(userId)];
		for (const feedId of feedIds) {
			keys.push(CacheKeys.unreadCountByFeed(userId, feedId));
		}
		await this.redis.del(...keys);
	}
}
