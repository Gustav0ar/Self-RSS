import type Redis from 'ioredis';
import { CacheKeys, CacheTTL } from '../db/redis.js';
import type { ArticleRepository } from '../repositories/article.repository.js';
import type { FeedRepository } from '../repositories/feed.repository.js';
import { encodeArticleCursor, encodeCachedArticleCursor } from '../utils/article-cursor.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger();

// Limit cached articles - users see recent articles first, no need to cache old ones
const CACHED_ARTICLE_LIMIT = 100;

// Warming lock TTL - prevents duplicate warming within this window
const WARMING_LOCK_TTL = 30; // seconds

// SCAN COUNT hint. Larger batches are faster but increase per-call latency
// against the event loop. 500 is a reasonable middle ground for the key
// patterns we use here.
const SCAN_BATCH = 500;

/**
 * Iterate every key matching `pattern` using SCAN, which is non-blocking
 * even for very large keyspaces. We deliberately avoid the convenience
 * `KEYS` command, which Redis documents as unsafe in production.
 */
async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
	const matched: string[] = [];
	let cursor = '0';
	do {
		const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', SCAN_BATCH);
		if (batch.length > 0) {
			matched.push(...batch);
		}
		cursor = nextCursor;
	} while (cursor !== '0');
	return matched;
}

function isArticleListCacheKey(userId: string, key: string): boolean {
	return key === CacheKeys.articleListCache(userId) || key.startsWith(`articles:list:${userId}:`);
}

function cacheableArticleRows(result: Awaited<ReturnType<ArticleRepository['findByFeeds']>>): {
	articles: CachedArticle[];
	cursor: string | null;
	hasMore: boolean;
	rows: typeof result;
} {
	const hasMore = result.length > CACHED_ARTICLE_LIMIT;
	const rows = result.slice(0, CACHED_ARTICLE_LIMIT);
	return {
		rows,
		articles: rows.map((a) => ({
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
		cursor: hasMore ? encodeArticleCursor(rows[rows.length - 1] ?? null, 'latest') : null,
		hasMore,
	};
}

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
		options: {
			feedId?: string;
			categoryId?: string;
			unreadOnly?: boolean;
			sort?: string;
			limit: number;
		},
	): Promise<CachedArticleList | null> {
		// The warmed list intentionally contains only the latest unread+read
		// snapshot. It cannot faithfully answer oldest-first or unread-only
		// initial pages because older unread rows may sit outside that bounded
		// snapshot. Let those views hit SQLite, where the complete scoped set is
		// available.
		if (options.unreadOnly || options.sort === 'oldest') {
			return null;
		}

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

			const filtered = [...data.articles].sort(
				(a, b) => new Date(b.displayedAt).getTime() - new Date(a.displayedAt).getTime(),
			);

			// Apply limit + cursor
			const cursorIndex = options.limit > 0 ? options.limit : 20;
			const result = filtered.slice(0, cursorIndex + 1);
			const hasMore = result.length > cursorIndex;
			const items = result.slice(0, cursorIndex);

			return {
				articles: items,
				cursor: hasMore
					? encodeCachedArticleCursor(items[items.length - 1] ?? null, options.sort)
					: null,
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
		if (!(await this.tryAcquireWarmingLock(userId))) {
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
					meta: {
						syncedAt: new Date().toISOString(),
						newArticlesCount: 0,
						scope: 'all',
						generation,
					},
				};
				if (!(await this.isGenerationCurrent(userId, generation))) {
					return;
				}
				await this.redis.setex(cacheKey, CacheTTL.articleList, JSON.stringify(empty));
				return;
			}

			// Only cache the most recent articles - users see recent first
			const result = await this.articleRepo.findByFeeds(userId, feedIds, {
				limit: CACHED_ARTICLE_LIMIT,
				sort: 'latest',
				unreadOnly: false,
			});

			const cacheable = cacheableArticleRows(result);

			// Check for new articles since last sync
			const metaStr = await this.redis.get(metaKey);
			let newArticlesCount = 0;
			if (metaStr) {
				try {
					const prevMeta: ArticleListCacheMeta = JSON.parse(metaStr);
					const prevTime = new Date(prevMeta.syncedAt).getTime();
					newArticlesCount = cacheable.rows.filter(
						(a) => new Date(a.fetchedAt).getTime() > prevTime,
					).length;
				} catch {
					// Ignore
				}
			}

			const cached: CachedArticleList = {
				articles: cacheable.articles,
				cursor: cacheable.cursor,
				hasMore: cacheable.hasMore,
				meta: {
					syncedAt: new Date().toISOString(),
					newArticlesCount,
					scope: 'all',
					generation,
				},
			};

			if (!(await this.isGenerationCurrent(userId, generation))) {
				logger.debug('Skipping stale article cache population', { userId, generation });
				return;
			}

			await Promise.all([
				this.redis.setex(cacheKey, CacheTTL.articleList, JSON.stringify(cached)),
				this.redis.setex(metaKey, CacheTTL.articleList * 3, JSON.stringify(cached.meta)),
				this.registerArticleListMembership(userId, cacheKey, cached),
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
		if (!(await this.tryAcquireWarmingLock(userId))) {
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

			const cacheable = cacheableArticleRows(result);

			const cached: CachedArticleList = {
				articles: cacheable.articles,
				cursor: cacheable.cursor,
				hasMore: cacheable.hasMore,
				meta: {
					syncedAt: new Date().toISOString(),
					newArticlesCount: 0,
					scope: `feed:${feedId}`,
					generation,
				},
			};

			if (!(await this.isGenerationCurrent(userId, generation))) {
				return;
			}
			await Promise.all([
				this.redis.setex(cacheKey, CacheTTL.articleList, JSON.stringify(cached)),
				this.registerArticleListMembership(userId, cacheKey, cached),
			]);
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
		if (!(await this.tryAcquireWarmingLock(userId))) {
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
					meta: {
						syncedAt: new Date().toISOString(),
						newArticlesCount: 0,
						scope: `category:${categoryId}`,
						generation,
					},
				};
				if (!(await this.isGenerationCurrent(userId, generation))) {
					return;
				}
				await this.redis.setex(cacheKey, CacheTTL.articleList, JSON.stringify(empty));
				return;
			}

			const result = await this.articleRepo.findByFeeds(userId, feedIds, {
				limit: CACHED_ARTICLE_LIMIT,
				sort: 'latest',
				unreadOnly: false,
			});

			const cacheable = cacheableArticleRows(result);

			const cached: CachedArticleList = {
				articles: cacheable.articles,
				cursor: cacheable.cursor,
				hasMore: cacheable.hasMore,
				meta: {
					syncedAt: new Date().toISOString(),
					newArticlesCount: 0,
					scope: `category:${categoryId}`,
					generation,
				},
			};

			if (!(await this.isGenerationCurrent(userId, generation))) {
				return;
			}
			await Promise.all([
				this.redis.setex(cacheKey, CacheTTL.articleList, JSON.stringify(cached)),
				this.registerArticleListMembership(userId, cacheKey, cached),
			]);
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

		// Delete all feed/category scoped caches for this user. Use SCAN,
		// not KEYS, so a large keyspace does not block Redis. The pattern
		// excludes the generation and warming keys (which are managed
		// elsewhere) by requiring the segment after the user id.
		const pattern = `articles:list:${userId}:*`;
		const keys = await scanKeys(this.redis, pattern);
		if (keys.length > 0) {
			await this.redis.del(...keys);
		}
	}

	/**
	 * Patch cached article-list rows after a single read-state toggle.
	 * This keeps hot list caches coherent without bumping the generation and
	 * deleting every scoped list on every navigation-driven mark-read event.
	 */
	async updateCachedReadState(userId: string, articleId: string, read: boolean): Promise<void> {
		try {
			const indexKey = CacheKeys.articleListMembership(userId, articleId);
			const indexedKeys = await this.redis.smembers(indexKey);
			const keys = indexedKeys.filter((key) => isArticleListCacheKey(userId, key));
			if (keys.length === 0) {
				const scopedKeys = await scanKeys(this.redis, `articles:list:${userId}:*`);
				keys.push(CacheKeys.articleListCache(userId), ...scopedKeys);
			}
			const uniqueKeys = Array.from(new Set(keys));

			await Promise.allSettled(
				uniqueKeys.map(async (key) => {
					const cached = await this.redis.get(key);
					if (!cached) {
						return;
					}

					let data: CachedArticleList;
					try {
						data = JSON.parse(cached) as CachedArticleList;
					} catch {
						await this.redis.del(key);
						return;
					}

					let changed = false;
					const articles = data.articles.map((article) => {
						if (article.id !== articleId || article.isRead === read) {
							return article;
						}
						changed = true;
						return { ...article, isRead: read };
					});

					if (!changed) {
						return;
					}

					const nextData = { ...data, articles };
					await Promise.all([
						this.redis.setex(key, CacheTTL.articleList, JSON.stringify(nextData)),
						this.registerArticleListMembership(userId, key, nextData),
					]);
				}),
			);
		} catch (err) {
			logger.warn('Failed to update cached article read state', {
				userId,
				articleId,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	private async registerArticleListMembership(
		userId: string,
		cacheKey: string,
		data: CachedArticleList,
	): Promise<void> {
		if (data.articles.length === 0) return;
		const pipeline = this.redis.pipeline();
		for (const article of data.articles) {
			const indexKey = CacheKeys.articleListMembership(userId, article.id);
			pipeline.sadd(indexKey, cacheKey);
			pipeline.expire(indexKey, CacheTTL.articleList);
		}
		await pipeline.exec();
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
	async getRecentlyActiveUserIds(
		withinMinutes: number = 10,
		limit: number = 25,
	): Promise<string[]> {
		if (limit <= 0) return [];

		const threshold = Date.now() - withinMinutes * 60 * 1000;
		const pattern = `user:lastseen:*`;
		const results: string[] = [];
		const seenUserIds = new Set<string>();
		let cursor = '0';

		do {
			const [nextCursor, keys] = await this.redis.scan(
				cursor,
				'MATCH',
				pattern,
				'COUNT',
				SCAN_BATCH,
			);
			cursor = nextCursor;

			if (keys.length === 0) {
				continue;
			}

			// Use MGET for efficiency instead of N individual GET calls.
			const values = await this.redis.mget(...keys);
			for (let i = 0; i < keys.length; i++) {
				const key = keys[i];
				const lastSeen = values[i];
				if (!key || !lastSeen) {
					continue;
				}

				const timestamp = new Date(lastSeen).getTime();
				if (timestamp <= threshold) {
					continue;
				}

				// Extract userId from key pattern: user:lastseen:{userId}
				const userId = key.split(':')[2];
				if (userId && !seenUserIds.has(userId)) {
					seenUserIds.add(userId);
					results.push(userId);
					if (results.length >= limit) {
						return results;
					}
				}
			}
		} while (cursor !== '0');

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

	private async isGenerationCurrent(userId: string, generation: number): Promise<boolean> {
		return (await this.getGeneration(userId)) === generation;
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
