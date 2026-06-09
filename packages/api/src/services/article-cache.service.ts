import type Redis from 'ioredis';
import { CacheKeys, CacheTTL } from '../db/redis.js';
import type { ArticleRepository } from '../repositories/article.repository.js';
import type { FeedRepository } from '../repositories/feed.repository.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger();

// Limit cached articles - users see recent articles first, no need to cache old ones
const CACHED_ARTICLE_LIMIT = 100;

// Warming lock TTL - prevents duplicate warming within this window
const WARMING_LOCK_TTL = 30; // seconds

export interface CachedArticleList {
	articles: CachedArticle[];
	cursor: string | null;
	hasMore: boolean;
	meta: {
		syncedAt: string;
		newArticlesCount: number;
		scope?: string; // 'all' | 'feed:{id}' | 'category:{id}'
		generation: number; // Cache generation for race condition handling
	};
}

export interface CachedArticle {
	id: string;
	feedId: string;
	feedTitle: string;
	feedFaviconUrl: string | null;
	title: string;
	author: string | null;
	excerpt: string | null;
	heroImageUrl: string | null;
	publishedAt: string | null;
	displayedAt: string;
	isRead: boolean;
}

interface ArticleListCacheMeta {
	syncedAt: string;
	newArticlesCount: number;
	scope?: string;
	generation: number;
}

export class ArticleCacheService {
	constructor(
		private articleRepo: ArticleRepository,
		private feedRepo: FeedRepository,
		private redis: Redis,
	) {}

	/**
	 * Get cached article list. Returns null if cache miss or stale generation.
	 * Checks generation to handle race conditions - if cache was invalidated while
	 * user was reading, return null to force fresh fetch.
	 */
	async getCachedArticleList(
		userId: string,
		options: { feedId?: string; categoryId?: string; unreadOnly?: boolean; sort?: string; limit: number },
	): Promise<CachedArticleList | null> {
		// Try scoped cache first
		let cacheKey: string | null = null;

		if (options.feedId) {
			cacheKey = CacheKeys.articleListByFeed(userId, options.feedId);
		} else if (options.categoryId) {
			cacheKey = CacheKeys.articleListByCategory(userId, options.categoryId);
		} else {
			cacheKey = CacheKeys.articleListCache(userId);
		}

		const cached = await this.redis.get(cacheKey);
		if (!cached) return null;

		try {
			const data: CachedArticleList = JSON.parse(cached);

			// Check generation - if it doesn't match, cache was invalidated during read
			const currentGeneration = await this.getGeneration(userId);
			if (data.meta.generation !== currentGeneration) {
				logger.debug('Cache generation mismatch, treating as miss', {
					userId,
					cachedGen: data.meta.generation,
					currentGen: currentGeneration,
				});
				return null;
			}

			// Apply unread filter
			let filtered = data.articles;
			if (options.unreadOnly) {
				filtered = filtered.filter((a) => !a.isRead);
			}

			// Apply sort
			if (options.sort === 'oldest') {
				filtered.sort(
					(a, b) =>
						new Date(a.displayedAt).getTime() - new Date(b.displayedAt).getTime(),
				);
			} else {
				filtered.sort(
					(a, b) =>
						new Date(b.displayedAt).getTime() - new Date(a.displayedAt).getTime(),
				);
			}

			// Apply limit + cursor
			const cursorIndex = options.limit > 0 ? options.limit : 20;
			const result = filtered.slice(0, cursorIndex + 1);
			const hasMore = result.length > cursorIndex;
			const items = result.slice(0, cursorIndex);

			return {
				articles: items,
				cursor: hasMore ? items[items.length - 1]?.id ?? null : null,
				hasMore,
				meta: data.meta,
			};
		} catch (err) {
			logger.warn('Failed to parse cached article list, treating as miss', {
				userId,
				error: err instanceof Error ? err.message : String(err),
			});
			await this.redis.del(cacheKey);
			return null;
		}
	}

	/**
	 * Try to acquire warming lock. Returns false if warming is already in progress.
	 * This prevents duplicate warming from syncFeed and scheduled warming.
	 */
	async tryAcquireWarmingLock(userId: string): Promise<boolean> {
		const lockKey = CacheKeys.articleCacheWarming(userId);
		// NX = only set if not exists, EX = expire time
		const result = await this.redis.set(lockKey, '1', 'EX', WARMING_LOCK_TTL, 'NX');
		return result === 'OK';
	}

	/**
	 * Release warming lock (optional - it auto-expires)
	 */
	async releaseWarmingLock(userId: string): Promise<void> {
		const lockKey = CacheKeys.articleCacheWarming(userId);
		await this.redis.del(lockKey);
	}

	/**
	 * Pre-compute and cache article list for a user.
	 * Only populates if warming lock can be acquired (dedup).
	 */
	async populateCache(userId: string): Promise<void> {
		// Try to acquire lock - skip if another warming is in progress
		if (!await this.tryAcquireWarmingLock(userId)) {
			logger.debug('Skipping cache population - warming already in progress', { userId });
			return;
		}

		try {
			await this.doPopulateCache(userId);
		} finally {
			// Lock will auto-expire, but release early to be responsive
			await this.releaseWarmingLock(userId);
		}
	}

	/**
	 * Internal method that actually populates the cache.
	 */
	private async doPopulateCache(userId: string): Promise<void> {
		const cacheKey = CacheKeys.articleListCache(userId);
		const metaKey = CacheKeys.articleListCacheMeta(userId);
		const generation = await this.getGeneration(userId);

		try {
			const feeds = await this.feedRepo.findAllByUser(userId);
			const feedIds = feeds.map((f) => f.id);

			if (feedIds.length === 0) {
				const empty: CachedArticleList = {
					articles: [],
					cursor: null,
					hasMore: false,
					meta: { syncedAt: new Date().toISOString(), newArticlesCount: 0, scope: 'all', generation },
				};
				await this.redis.setex(cacheKey, CacheTTL.articleList, JSON.stringify(empty));
				return;
			}

			// Only cache the most recent articles - users see recent first
			const result = await this.articleRepo.findByFeeds(userId, feedIds, {
				limit: CACHED_ARTICLE_LIMIT,
				sort: 'latest',
				unreadOnly: false,
			});

			const hasMore = result.length >= CACHED_ARTICLE_LIMIT;

			// Check for new articles since last sync
			const metaStr = await this.redis.get(metaKey);
			let newArticlesCount = 0;
			if (metaStr) {
				try {
					const prevMeta: ArticleListCacheMeta = JSON.parse(metaStr);
					const prevTime = new Date(prevMeta.syncedAt).getTime();
					newArticlesCount = result.filter(
						(a) => new Date(a.fetchedAt).getTime() > prevTime,
					).length;
				} catch {
					// Ignore
				}
			}

			const cached: CachedArticleList = {
				articles: result.map((a) => ({
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
				})),
				cursor: hasMore ? result[result.length - 1]?.id ?? null : null,
				hasMore,
				meta: {
					syncedAt: new Date().toISOString(),
					newArticlesCount,
					scope: 'all',
					generation,
				},
			};

			await Promise.all([
				this.redis.setex(cacheKey, CacheTTL.articleList, JSON.stringify(cached)),
				this.redis.setex(metaKey, CacheTTL.articleList * 3, JSON.stringify(cached.meta)),
			]);

			logger.debug('Article cache populated', {
				userId,
				articleCount: cached.articles.length,
				newArticlesCount,
				generation,
			});
		} catch (err) {
			logger.error('Failed to populate article cache', {
				userId,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	/**
	 * Populate cache for a specific feed (used for targeted warming)
	 */
	async populateFeedCache(userId: string, feedId: string): Promise<void> {
		if (!await this.tryAcquireWarmingLock(userId)) {
			return;
		}

		try {
			const cacheKey = CacheKeys.articleListByFeed(userId, feedId);
			const generation = await this.getGeneration(userId);

			const result = await this.articleRepo.findByFeeds(userId, [feedId], {
				limit: CACHED_ARTICLE_LIMIT,
				sort: 'latest',
				unreadOnly: false,
			});

			const hasMore = result.length >= CACHED_ARTICLE_LIMIT;

			const cached: CachedArticleList = {
				articles: result.map((a) => ({
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
				})),
				cursor: hasMore ? result[result.length - 1]?.id ?? null : null,
				hasMore,
				meta: {
					syncedAt: new Date().toISOString(),
					newArticlesCount: 0,
					scope: `feed:${feedId}`,
					generation,
				},
			};

			await this.redis.setex(cacheKey, CacheTTL.articleList, JSON.stringify(cached));
		} catch (err) {
			logger.error('Failed to populate feed cache', {
				userId,
				feedId,
				error: err instanceof Error ? err.message : String(err),
			});
		} finally {
			await this.releaseWarmingLock(userId);
		}
	}

	/**
	 * Populate cache for a specific category (used for targeted warming)
	 */
	async populateCategoryCache(userId: string, categoryId: string): Promise<void> {
		if (!await this.tryAcquireWarmingLock(userId)) {
			return;
		}

		try {
			const cacheKey = CacheKeys.articleListByCategory(userId, categoryId);
			const generation = await this.getGeneration(userId);

			const feeds = await this.feedRepo.findByCategory(userId, categoryId);
			const feedIds = feeds.map((f) => f.id);

			if (feedIds.length === 0) {
				const empty: CachedArticleList = {
					articles: [],
					cursor: null,
					hasMore: false,
					meta: { syncedAt: new Date().toISOString(), newArticlesCount: 0, scope: `category:${categoryId}`, generation },
				};
				await this.redis.setex(cacheKey, CacheTTL.articleList, JSON.stringify(empty));
				return;
			}

			const result = await this.articleRepo.findByFeeds(userId, feedIds, {
				limit: CACHED_ARTICLE_LIMIT,
				sort: 'latest',
				unreadOnly: false,
			});

			const hasMore = result.length >= CACHED_ARTICLE_LIMIT;

			const cached: CachedArticleList = {
				articles: result.map((a) => ({
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
				})),
				cursor: hasMore ? result[result.length - 1]?.id ?? null : null,
				hasMore,
				meta: {
					syncedAt: new Date().toISOString(),
					newArticlesCount: 0,
					scope: `category:${categoryId}`,
					generation,
				},
			};

			await this.redis.setex(cacheKey, CacheTTL.articleList, JSON.stringify(cached));
		} catch (err) {
			logger.error('Failed to populate category cache', {
				userId,
				categoryId,
				error: err instanceof Error ? err.message : String(err),
			});
		} finally {
			await this.releaseWarmingLock(userId);
		}
	}

	/**
	 * Invalidate all caches for a user and increment generation.
	 * This handles race conditions - if a user was reading during invalidation,
	 * they'll detect the generation mismatch and fetch fresh data.
	 */
	async invalidateCache(userId: string): Promise<void> {
		// Increment generation first - this marks cache as stale
		// Any in-flight reads will detect the mismatch
		await this.incrementGeneration(userId);

		// Delete global cache
		const cacheKey = CacheKeys.articleListCache(userId);
		const metaKey = CacheKeys.articleListCacheMeta(userId);
		await this.redis.del(cacheKey, metaKey);

		// Delete all feed/category scoped caches for this user
		const pattern = `articles:list:${userId}:*`;
		const keys = await this.redis.keys(pattern);
		if (keys.length > 0) {
			await this.redis.del(...keys);
		}
	}

	/**
	 * Check if cache is warm for a user
	 */
	async isCacheWarm(userId: string): Promise<boolean> {
		const cacheKey = CacheKeys.articleListCache(userId);
		const exists = await this.redis.exists(cacheKey);
		return exists > 0;
	}

	/**
	 * Track user activity for priority warming
	 */
	async trackUserActivity(userId: string): Promise<void> {
		const key = CacheKeys.userLastSeen(userId);
		await this.redis.setex(key, 60 * 60 * 24, new Date().toISOString()); // 24h TTL
	}

	/**
	 * Get users who were recently active (for priority warming)
	 */
	async getRecentlyActiveUserIds(withinMinutes: number = 10): Promise<string[]> {
		const threshold = Date.now() - withinMinutes * 60 * 1000;
		const pattern = `user:lastseen:*`;
		const keys = await this.redis.keys(pattern);

		if (keys.length === 0) return [];

		// Use MGET for efficiency instead of N individual GET calls
		const values = await this.redis.mget(...keys);
		const results: string[] = [];

		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			const lastSeen = values[i];
			if (key && lastSeen) {
				const timestamp = new Date(lastSeen).getTime();
				if (timestamp > threshold) {
					// Extract userId from key pattern: user:lastseen:{userId}
					const userId = key.split(':')[2];
					if (userId) {
						results.push(userId);
					}
				}
			}
		}

		return results;
	}

	/**
	 * Get current cache generation for a user
	 */
	private async getGeneration(userId: string): Promise<number> {
		const genKey = CacheKeys.articleCacheGeneration(userId);
		const gen = await this.redis.get(genKey);
		return gen ? parseInt(gen, 10) : 0;
	}

	/**
	 * Increment cache generation for a user (called on invalidation)
	 */
	private async incrementGeneration(userId: string): Promise<void> {
		const genKey = CacheKeys.articleCacheGeneration(userId);
		// INCR is atomic and creates key if doesn't exist
		await this.redis.incr(genKey);
	}
}