import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import RSSParser from 'rss-parser';
import { CacheKeys } from '../db/redis.js';
import { AppError } from '../middleware/errors.js';
import type { ArticleRepository } from '../repositories/article.repository.js';
import type { FeedRepository } from '../repositories/feed.repository.js';
import type { MetricsRepository, SyncRunRepository } from '../repositories/settings.repository.js';
import { createArticleContentHash } from '../utils/article-hash.js';
import { readResponseTextWithinLimit } from '../utils/bounded-response.js';
import { createLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { fetchWithValidatedRedirects } from '../utils/safe-fetch.js';
import {
	extractExcerpt,
	extractHeroImage,
	extractMediaFromHtml,
	hasRichMedia,
	sanitizeHtml,
	stripHtml,
} from '../utils/sanitizer.js';
import type { ArticleCacheService } from './article-cache.service.js';
import { fetchArticlePageContent } from './article-source-fetcher.js';
import { isKnownProxyFeedUrl, resolveStaleProxyFeed } from './feed-proxy-recovery.js';
import { syncFeedsForBulk } from './feed-sync-bulk.js';
import {
	FeedSyncFetchError,
	getSyncErrorDetails,
	normalizeSyncThrowable,
} from './feed-sync-errors.js';
import {
	acquireManualSyncAllFeedsLock,
	getManualSyncAllFeedsRequest,
	getManualSyncAllFeedsStatus,
	type ManualSyncScope,
	queueManualSyncAllFeeds,
	releaseManualSyncAllFeedsState,
	startManualSyncAllFeedsHeartbeat,
	updateManualSyncAllFeedsProgress,
} from './feed-sync-status.js';
import type { MetricsService } from './metrics.service.js';
import type { RealtimeService } from './realtime.service.js';

const logger = createLogger();

const FAILED_SYNC_RETRY_MINUTES = {
	min: 5,
	max: 60,
};

interface SyncConfig {
	timeoutMs: number;
	maxContentLength: number;
	concurrency: number;
	allowPrivateHosts: boolean;
}

interface SyncFeedOptions {
	enrichArticles?: boolean;
	warmArticleCache?: boolean;
	forceFetch?: boolean;
	fetchTimeoutMs?: number;
	fetchMaxRetries?: number;
	deferScopedCacheCleanup?: boolean;
}

interface PendingArticleEnrichment {
	articleId: string;
	userId: string;
	canonicalUrl: string;
	contentHtml: string | null;
	heroImageUrl: string | null;
	fetchedAt: Date; // Used for priority sorting - more recent = higher priority
}

type FeedItemRecord = Record<string, unknown>;

const FEED_SYNC_ITEM_CONCURRENCY = 5;
const ARTICLE_ENRICHMENT_CONCURRENCY = 4;
const ARTICLE_ENRICHMENT_MAX_ATTEMPTS = 5;
const ARTICLE_ENRICHMENT_RETRY_BASE_MS = 30_000;
const MANUAL_FEED_SYNC_TIMEOUT_MS = 5_000;
const MANUAL_FEED_SYNC_MAX_CONCURRENCY = 4;
const FEED_SYNC_LOCK_TTL_SECONDS = 60 * 20;
const STALE_SYNCING_FEED_MS = (FEED_SYNC_LOCK_TTL_SECONDS + 5 * 60) * 1000;

export class FeedSyncService {
	private parser: RSSParser;
	constructor(
		private feedRepo: FeedRepository,
		private articleRepo: ArticleRepository,
		private syncRunRepo: SyncRunRepository,
		private metricsRepo: MetricsRepository,
		private redis: Redis,
		private config: SyncConfig,
		private articleCache?: ArticleCacheService,
		private realtimeService?: RealtimeService,
		private performanceMetrics?: Pick<
			MetricsService,
			'recordArticleEnrichment' | 'setArticleEnrichmentQueueDepth'
		>,
	) {
		this.parser = new RSSParser({
			timeout: this.config.timeoutMs,
			maxRedirects: 3,
			headers: {
				'User-Agent': 'SelfFeed/1.0',
				Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
			},
		});
	}

	async syncFeed(feedId: string, userId: string, options: SyncFeedOptions = {}) {
		const feed = await this.feedRepo.findById(feedId, userId);
		if (!feed) {
			logger.warn('Feed not found for sync', { feedId, userId });
			return null;
		}

		const releaseFeedLock = await this.tryAcquireFeedSyncLock(feedId);
		if (!releaseFeedLock) {
			logger.info('Skipping feed sync because another sync is already running', { feedId, userId });
			return { newArticles: 0, total: 0, skipped: true as const };
		}

		const shouldEnrichArticles = options.enrichArticles ?? true;
		const shouldWarmArticleCache = options.warmArticleCache ?? true;

		const run = await this.syncRunRepo.create(feedId);
		await this.feedRepo.update(feedId, userId, { syncStatus: 'syncing' });

		try {
			const articleCount = (await this.articleRepo.countByFeeds?.([feedId])) ?? 0;
			const isProxyFeed = isKnownProxyFeedUrl(feed.feedUrl);
			const ignoreCache = options.forceFetch === true || articleCount === 0 || isProxyFeed;
			const fetchOptions =
				options.fetchTimeoutMs != null || options.fetchMaxRetries != null
					? { timeoutMs: options.fetchTimeoutMs, maxRetries: options.fetchMaxRetries }
					: null;
			const fetchForSync = (url: string, bypassCache: boolean) =>
				fetchOptions
					? this.fetchAndParse(url, bypassCache, fetchOptions)
					: this.fetchAndParse(url, bypassCache);
			const initialParsed = await fetchForSync(feed.feedUrl, ignoreCache).catch((error) => {
				throw new FeedSyncFetchError(getSyncErrorDetails(error));
			});
			const proxyResolution = await resolveStaleProxyFeed({
				feedUrl: feed.feedUrl,
				parsed: initialParsed,
				config: this.config,
				fetchAndParse: fetchForSync,
			});
			const parsed = proxyResolution?.parsed ?? initialParsed;
			const effectiveFeedUrl = proxyResolution?.feedUrl ?? feed.feedUrl;
			const syncWarning = proxyResolution?.warning ?? null;
			const parsedTitle = this.normalizeText(parsed.title)?.trim() ?? null;
			const parsedLink = this.normalizeText(parsed.link);
			const parsedDescription = this.normalizeText(parsed.description);
			const parsedImageUrl = this.normalizeText(parsed.image?.url);

			const feedUpdates: Record<string, unknown> = {};
			if (effectiveFeedUrl !== feed.feedUrl) feedUpdates.feedUrl = effectiveFeedUrl;
			if (parsedTitle && parsedTitle !== feed.title) feedUpdates.title = parsedTitle;
			if (parsedLink) feedUpdates.siteUrl = parsedLink;
			if (parsedImageUrl) feedUpdates.faviconUrl = parsedImageUrl;
			if (parsedDescription) feedUpdates.description = parsedDescription;

			const items = parsed.items ?? [];
			const pendingEnrichments: PendingArticleEnrichment[] = [];
			const pendingInsertedEnrichmentsByGuid = new Map<
				string,
				Omit<PendingArticleEnrichment, 'articleId'>
			>();
			const now = new Date();
			const guids = items
				.map((item, index) => this.resolveItemGuid(item, index))
				.filter((guid): guid is string => !!guid);
			const existingGuids = shouldEnrichArticles
				? null
				: new Set(await this.articleRepo.findExistingGuids(feedId, guids));
			const existingArticles = shouldEnrichArticles
				? await this.articleRepo.findByFeedAndGuids(feedId, guids)
				: [];
			const existingByGuid = new Map(existingArticles.map((article) => [article.guid, article]));

			const articlesToInsert: typeof import('../db/schema.js').articles.$inferInsert[] = [];
			const articlesToUpdate: Array<{
				id: string;
				contentHtml: string | null;
				contentText: string | null;
				excerpt: string | null;
				heroImageUrl: string | null;
				hash: string;
			}> = [];
			const itemProcessingFailures: Array<{ index: number; error: string }> = [];

			const processItem = async (item: (typeof items)[0], index: number) => {
				const guid = this.resolveItemGuid(item, index);
				if (!guid) return;
				if (existingGuids?.has(guid)) return;

				const existingArticle = existingByGuid.get(guid) ?? null;
				if (!this.shouldProcessArticle(existingArticle, shouldEnrichArticles)) {
					return;
				}

				const itemRecord = item as FeedItemRecord;
				const rawFeedContent =
					itemRecord['content:encoded'] ??
					itemRecord.content ??
					itemRecord.summary ??
					itemRecord.description ??
					'';
				const canonicalUrl = this.normalizeText(itemRecord.link);
				const articleTitle = this.normalizeText(itemRecord.title) ?? 'Untitled';
				const author =
					this.normalizeText(itemRecord.creator) ??
					this.normalizeText(itemRecord['dc:creator']) ??
					null;
				const publishedAt = this.parsePublishedAt(itemRecord.pubDate);
				const rawHtml =
					typeof rawFeedContent === 'string'
						? rawFeedContent
						: (this.normalizeText(rawFeedContent) ?? '');
				const sanitizedHtml = sanitizeHtml(rawHtml);
				// Extract text from sanitized HTML (DOMPurify already stripped chrome).
				// This matches reader output and skips an extra regex pass.
				const textContent = stripHtml(sanitizedHtml);
				const excerpt = textContent ? extractExcerpt(textContent) : null;
				const heroImage = extractHeroImage(rawHtml) ?? extractHeroImage(sanitizedHtml);

				if (existingArticle) {
					if (
						this.shouldRefreshArticle(
							existingArticle.contentHtml,
							existingArticle.heroImageUrl,
							sanitizedHtml,
							heroImage,
						)
					) {
						articlesToUpdate.push({
							id: existingArticle.id,
							contentHtml: sanitizedHtml || null,
							contentText: textContent || null,
							excerpt,
							heroImageUrl: heroImage,
							hash: createArticleContentHash({
								canonicalUrl: existingArticle.canonicalUrl,
								title: existingArticle.title,
								author: existingArticle.author,
								excerpt,
								contentHtml: sanitizedHtml || null,
								contentText: textContent || null,
								heroImageUrl: heroImage,
							}),
						});
					}
					if (shouldEnrichArticles && this.shouldAttemptArticleEnrichment(canonicalUrl)) {
						pendingEnrichments.push({
							articleId: existingArticle.id,
							userId,
							canonicalUrl: canonicalUrl!,
							contentHtml: sanitizedHtml || null,
							heroImageUrl: heroImage,
							fetchedAt: publishedAt ?? now,
						});
					}
					return;
				}

				const hash = createArticleContentHash({
					canonicalUrl,
					title: articleTitle,
					author,
					excerpt,
					contentHtml: sanitizedHtml || null,
					contentText: textContent || null,
					heroImageUrl: heroImage,
				});
				if (shouldEnrichArticles && this.shouldAttemptArticleEnrichment(canonicalUrl)) {
					pendingInsertedEnrichmentsByGuid.set(guid, {
						canonicalUrl: canonicalUrl!,
						userId,
						contentHtml: sanitizedHtml || null,
						heroImageUrl: heroImage,
						fetchedAt: publishedAt ?? now,
					});
				}
				articlesToInsert.push({
					feedId,
					guid,
					canonicalUrl,
					title: articleTitle,
					author,
					excerpt,
					contentHtml: sanitizedHtml || null,
					contentText: textContent || null,
					heroImageUrl: heroImage,
					publishedAt,
					hash,
					contentStatus: canonicalUrl && shouldEnrichArticles ? 'enrichment_pending' : 'feed_ready',
					enrichmentQueuedAt: canonicalUrl && shouldEnrichArticles ? now : null,
					nextEnrichmentAt: canonicalUrl && shouldEnrichArticles ? now : null,
				});
			};

			for (let i = 0; i < items.length; i += FEED_SYNC_ITEM_CONCURRENCY) {
				const batch = items.slice(i, i + FEED_SYNC_ITEM_CONCURRENCY);
				const batchResults = await Promise.allSettled(
					batch.map((item, index) => processItem(item, i + index)),
				);
				batchResults.forEach((result, index) => {
					if (result.status === 'rejected') {
						itemProcessingFailures.push({
							index: i + index,
							error: result.reason instanceof Error ? result.reason.message : String(result.reason),
						});
					}
				});
			}
			if (itemProcessingFailures.length > 0) {
				logger.warn('Feed sync skipped malformed article items', {
					feedId,
					failedItems: itemProcessingFailures.length,
					sample: itemProcessingFailures.slice(0, 3),
				});
			}

			// Build media maps up front so the repository can persist all changes
			// in a single transaction (prevents partial inserts on crash).
			// Media for new articles is keyed by guid; the repository rewrites to
			// use the freshly-generated article id after insert.
			const mediaByGuid = new Map<
				string,
				typeof import('../db/schema.js').articleMedia.$inferInsert[]
			>();
			for (const article of articlesToInsert) {
				const html = article.contentHtml;
				const media = extractMediaFromHtml(html).map((item, index) => ({
					articleId: '',
					type: item.type,
					provider: item.provider,
					url: item.url,
					embedUrl: item.embedUrl,
					width: item.width,
					height: item.height,
					position: index,
				}));
				if (media.length > 0) {
					mediaByGuid.set(article.guid, media);
				}
			}

			const updatedMediaByArticleId = new Map<
				string,
				typeof import('../db/schema.js').articleMedia.$inferInsert[]
			>();
			for (const article of articlesToUpdate) {
				updatedMediaByArticleId.set(
					article.id,
					extractMediaFromHtml(article.contentHtml).map((item, index) => ({
						articleId: article.id,
						type: item.type,
						provider: item.provider,
						url: item.url,
						embedUrl: item.embedUrl,
						width: item.width,
						height: item.height,
						position: index,
					})),
				);
			}

			const insertedArticles = await this.articleRepo.persistSyncResults({
				articlesToInsert,
				articlesToUpdate,
				mediaByGuid,
				updatedMediaByArticleId,
			});
			await this.invalidateArticleDetailCaches(
				userId,
				articlesToUpdate.map((article) => article.id),
			);

			for (const article of insertedArticles) {
				const pendingInsertedEnrichment = pendingInsertedEnrichmentsByGuid.get(article.guid);
				if (pendingInsertedEnrichment) {
					pendingEnrichments.push({
						articleId: article.id,
						...pendingInsertedEnrichment,
					});
				}
			}
			if (pendingEnrichments.length > 0) {
				await this.enrichArticlesInBackground(pendingEnrichments);
			}

			// Update nextSyncAt so the scheduler's index-backed query skips this
			// feed until it's due (prevents re-fetching every minute).
			const nextSyncAt = new Date(Date.now() + feed.pollingIntervalMinutes * 60_000);

			await this.feedRepo.update(feedId, userId, {
				...feedUpdates,
				lastSyncedAt: new Date(),
				lastSyncError: syncWarning,
				lastSyncErrorAt: syncWarning ? new Date() : null,
				nextSyncAt,
				syncStatus: 'idle',
			});

			await this.syncRunRepo.complete(run.id, {
				status: 'success',
				httpStatus: 200,
				itemCount: insertedArticles.length,
				errorMessage:
					itemProcessingFailures.length > 0
						? `Skipped ${itemProcessingFailures.length} malformed article item(s)`
						: undefined,
			});

			await this.invalidateUnreadCache(userId, feedId);
			if (this.articleCache && (insertedArticles.length > 0 || articlesToUpdate.length > 0)) {
				await this.articleCache.invalidateCache(userId, {
					cleanupScoped: options.deferScopedCacheCleanup !== true,
				});
			}
			await this.metricsRepo.incrementSyncCount(userId);

			// Publish realtime event so clients update immediately
			if (insertedArticles.length > 0 && this.realtimeService)
				void this.realtimeService.publishEvent(userId, {
					type: 'articles.new',
					eventId: crypto.randomUUID(),
					feedId,
					articleIds: insertedArticles.map((a) => a.id),
					count: insertedArticles.length,
					updatedAt: new Date().toISOString(),
				});

			if (shouldWarmArticleCache && this.articleCache && insertedArticles.length > 0) {
				this.warmArticleCacheInBackground(userId, { feedId });
			}

			logger.info('Feed synced', {
				feedId,
				newArticles: insertedArticles.length,
				total: items.length,
			});

			return { newArticles: insertedArticles.length, total: items.length };
		} catch (err) {
			const errorDetails = getSyncErrorDetails(err);
			await this.feedRepo.update(feedId, userId, {
				nextSyncAt: this.nextFailedSyncRetryAt(feed.pollingIntervalMinutes),
				lastSyncError: errorDetails.error,
				lastSyncErrorAt: new Date(),
				syncStatus: 'error',
			});
			await this.syncRunRepo.complete(run.id, {
				status: 'failed',
				itemCount: 0,
				errorMessage: errorDetails.error,
			});
			logger.error('Feed sync failed', { feedId, ...errorDetails });
			if (err instanceof FeedSyncFetchError) {
				throw AppError.badGateway('Could not fetch or parse the feed URL', errorDetails.error);
			}
			throw normalizeSyncThrowable(err, errorDetails);
		} finally {
			await releaseFeedLock();
		}
	}

	async syncAllFeeds(
		userId: string,
		scope: ManualSyncScope = {},
		onProgress?: (progress: {
			totalFeeds: number;
			completedFeeds: number;
			newArticles: number;
		}) => Promise<void> | void,
	) {
		const feeds = await this.feedRepo.findAllByUser(userId);
		const staleSyncingFeeds = feeds.filter((feed) => feed.syncStatus === 'syncing');
		if (staleSyncingFeeds.length > 0) {
			logger.warn('Resetting stale syncing feeds before bulk refresh', {
				count: staleSyncingFeeds.length,
				feedIds: staleSyncingFeeds.map((feed) => feed.id),
			});
			await Promise.allSettled(
				staleSyncingFeeds.map((feed) =>
					this.feedRepo.update(feed.id, userId, { syncStatus: 'idle' }),
				),
			);
		}
		const categoryFeedIds = scope.categoryId
			? new Set(
					(await this.feedRepo.findByCategory(userId, scope.categoryId)).map((feed) => feed.id),
				)
			: new Set<string>();
		// Feed scope wins over category scope when both legacy parameters are present.
		const scopedFeeds = scope.feedId
			? feeds.filter((feed) => feed.id === scope.feedId)
			: scope.categoryId
				? feeds.filter((feed) => categoryFeedIds.has(feed.id))
				: feeds;
		const syncableFeeds = [...scopedFeeds].sort((left, right) => {
			const priority = (feed: (typeof feeds)[number]) => {
				if (scope.feedId === feed.id) return 0;
				if (categoryFeedIds.has(feed.id)) return 1;
				return 2;
			};
			return priority(left) - priority(right);
		});

		if (syncableFeeds.length === 0) {
			return {
				totalFeeds: 0,
				syncedFeeds: 0,
				failedFeeds: 0,
				skippedFeeds: 0,
				newArticles: 0,
			};
		}

		const bulkResult = await syncFeedsForBulk({
			feeds: syncableFeeds,
			concurrency: Math.min(this.config.concurrency, MANUAL_FEED_SYNC_MAX_CONCURRENCY),
			syncFeed: (feed) =>
				this.syncFeed(feed.id, userId, {
					enrichArticles: true,
					// Warm the full user cache once after the batch.
					warmArticleCache: false,
					// A manual refresh must contact the publisher, but HTTP
					// validators still need to be sent so unchanged feeds can
					// complete with a cheap 304 response.
					forceFetch: false,
					// Leave slow publishers for the robust background scheduler.
					fetchTimeoutMs: Math.min(this.config.timeoutMs, MANUAL_FEED_SYNC_TIMEOUT_MS),
					fetchMaxRetries: 0,
					deferScopedCacheCleanup: true,
				}),
			onProgress: async (progress) => {
				await onProgress?.({
					totalFeeds: progress.totalFeeds,
					completedFeeds: progress.completedFeeds,
					newArticles: progress.newArticles,
				});
			},
			onFeedError: (feed, err) => {
				const errorDetails = getSyncErrorDetails(err);
				logger.error('Feed sync failed during bulk sync', {
					operation: 'bulkFeedSync',
					feedId: feed.id,
					userId,
					...errorDetails,
				});
			},
		});

		// Populate cache after bulk sync completes
		if (this.articleCache && bulkResult.newArticles > 0) {
			// One SCAN/cleanup per user batch instead of one per feed. Individual
			// feeds still bump the generation so clients see early revisions.
			await this.articleCache.invalidateCache(userId);
			this.warmArticleCacheInBackground(userId, { operation: 'bulkFeedSync' });
		}

		return {
			totalFeeds: syncableFeeds.length,
			...bulkResult,
		};
	}

	async queueSyncAllFeeds(userId: string, scope: ManualSyncScope = {}) {
		const didQueue = await queueManualSyncAllFeeds(this.redis, userId, scope);
		if (!didQueue) {
			return { accepted: true, alreadyQueued: true };
		}

		logger.info('Queued bulk feed sync', { userId });
		return { accepted: true, alreadyQueued: false };
	}

	async getSyncAllFeedsStatus(userId: string) {
		return getManualSyncAllFeedsStatus(this.redis, userId);
	}

	async processNextQueuedSyncAllFeeds() {
		const userId = await this.redis.lpop(CacheKeys.feedSyncAllQueue());
		if (!userId) {
			return null;
		}

		await this.redis.lrem(CacheKeys.feedSyncAllQueue(), 0, userId);

		const didLock = await acquireManualSyncAllFeedsLock(this.redis, userId);
		if (!didLock) {
			logger.warn('Skipping queued bulk feed sync because one is already running', { userId });
			return { userId, skipped: true as const };
		}

		const stopHeartbeat = startManualSyncAllFeedsHeartbeat(this.redis, userId);

		try {
			const scope = await getManualSyncAllFeedsRequest(this.redis, userId);
			await updateManualSyncAllFeedsProgress(this.redis, userId, {
				totalFeeds: 0,
				completedFeeds: 0,
				newArticles: 0,
			});
			logger.info('Starting queued bulk feed sync', { userId });
			const result = await this.syncAllFeeds(userId, scope, (progress) =>
				updateManualSyncAllFeedsProgress(this.redis, userId, progress),
			);
			logger.info('Queued bulk feed sync complete', { userId, ...result });
			return { userId, skipped: false as const, result };
		} finally {
			stopHeartbeat();
			await releaseManualSyncAllFeedsState(this.redis, userId);
		}
	}

	async syncDueFeeds() {
		const staleBefore = new Date(Date.now() - STALE_SYNCING_FEED_MS);
		const recoveredStaleFeeds = await this.feedRepo.resetStaleSyncing(staleBefore);
		if (recoveredStaleFeeds.length > 0) {
			logger.warn('Recovered stale syncing feeds before scheduled sync', {
				count: recoveredStaleFeeds.length,
				feedIds: recoveredStaleFeeds.map((feed) => feed.id),
			});
		}

		// Fetch ALL due feeds - no artificial limit. The concurrency control
		// handles parallel processing, so there's no need to cap the batch size.
		const dueFeeds = await this.feedRepo.findDueForSync(1000);
		let succeeded = 0;
		let failed = 0;

		for (let i = 0; i < dueFeeds.length; i += this.config.concurrency) {
			const batch = dueFeeds.slice(i, i + this.config.concurrency);
			const batchResults = await Promise.allSettled(
				batch.map((feed) => this.syncFeed(feed.id, feed.userId)),
			);
			for (const result of batchResults) {
				if (result.status === 'fulfilled') {
					succeeded += 1;
				} else {
					failed += 1;
				}
			}
		}

		return { total: dueFeeds.length, succeeded, failed };
	}

	private warmArticleCacheInBackground(userId: string, context: Record<string, unknown>) {
		if (!this.articleCache) {
			return;
		}
		void this.articleCache.populateCache(userId).catch((error) => {
			logger.warn('Background article cache population failed after feed sync', {
				userId,
				...context,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}

	async enrichArticleNow(enrichment: PendingArticleEnrichment) {
		await this.articleRepo.queueEnrichments([enrichment.articleId]);
		return this.processPendingArticleEnrichments(1);
	}

	async queueArticleEnrichment(articleId: string) {
		// User-visible prefetch/open requests outrank the background queue.
		// Pending enrichments are ordered by nextEnrichmentAt, so epoch zero
		// moves this article to the front without requiring a schema change.
		await this.articleRepo.queueEnrichments([articleId], new Date(0));
	}

	private async enrichArticlesInBackground(pendingEnrichments: PendingArticleEnrichment[]) {
		await this.articleRepo.queueEnrichments?.(pendingEnrichments.map((item) => item.articleId));
	}

	async processPendingArticleEnrichments(limit = ARTICLE_ENRICHMENT_CONCURRENCY * 2) {
		const pending = await this.articleRepo.findPendingEnrichments(limit);
		this.performanceMetrics?.setArticleEnrichmentQueueDepth(pending.length);
		if (pending.length === 0) return { processed: 0, succeeded: 0, failed: 0 };

		let succeeded = 0;
		let failed = 0;
		for (let i = 0; i < pending.length; i += ARTICLE_ENRICHMENT_CONCURRENCY) {
			const batch = pending.slice(i, i + ARTICLE_ENRICHMENT_CONCURRENCY);
			const results = await Promise.allSettled(
				batch.map(async (item) => {
					const startedAt = Date.now();
					await this.articleRepo.markEnrichmentAttempt(item.articleId);
					try {
						const processed = await this.enrichSingleArticle({
							articleId: item.articleId,
							userId: item.userId,
							canonicalUrl: item.canonicalUrl!,
							contentHtml: item.contentHtml,
							heroImageUrl: item.heroImageUrl,
							fetchedAt: item.fetchedAt,
						});
						if (!processed) throw new Error('Article enrichment is already in progress');
						this.performanceMetrics?.recordArticleEnrichment(
							'success',
							(Date.now() - startedAt) / 1000,
						);
						return true;
					} catch (error) {
						const attempts = item.enrichmentAttempts + 1;
						const exhausted = attempts >= ARTICLE_ENRICHMENT_MAX_ATTEMPTS;
						const retryDelay = ARTICLE_ENRICHMENT_RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 5);
						const updated = await this.articleRepo.markEnrichmentRetry(item.articleId, {
							failed: exhausted,
							error: error instanceof Error ? error.message : String(error),
							nextEnrichmentAt: exhausted ? null : new Date(Date.now() + retryDelay),
						});
						if (exhausted) {
							await this.invalidateArticleDetailCaches(item.userId, [item.articleId]);
							if (updated && this.realtimeService) {
								await this.realtimeService.publishEvent(item.userId, {
									type: 'article.updated',
									eventId: crypto.randomUUID(),
									articleId: item.articleId,
									feedId: updated.feedId,
									contentStatus: 'failed',
									contentVersion: updated.contentVersion,
									updatedAt: new Date().toISOString(),
								});
							}
						}
						this.performanceMetrics?.recordArticleEnrichment(
							exhausted ? 'failed' : 'retry',
							(Date.now() - startedAt) / 1000,
						);
						throw error;
					}
				}),
			);
			for (const result of results) {
				if (result.status === 'fulfilled') succeeded++;
				else failed++;
			}
		}
		return { processed: pending.length, succeeded, failed };
	}

	private async enrichSingleArticle(enrichment: PendingArticleEnrichment) {
		const lockKey = CacheKeys.articleEnrichmentLock(enrichment.articleId);
		const lockAcquired = await this.redis.set(lockKey, '1', 'EX', 60, 'NX');
		if (lockAcquired !== 'OK') return false;

		try {
			const enrichedHtml = await this.resolveEnrichedArticleHtml(enrichment.canonicalUrl);
			if (!enrichedHtml) {
				throw new Error('Canonical article content was unavailable');
			}

			const sanitizedHtml = sanitizeHtml(enrichedHtml);
			const textContent = stripHtml(sanitizedHtml);
			const excerpt = textContent ? extractExcerpt(textContent) : null;
			const heroImage =
				extractHeroImage(enrichedHtml) ??
				extractHeroImage(sanitizedHtml) ??
				enrichment.heroImageUrl;

			const shouldReplace = this.shouldRefreshArticle(
				enrichment.contentHtml,
				enrichment.heroImageUrl,
				sanitizedHtml,
				heroImage,
			);

			const article = await this.articleRepo.findById(enrichment.articleId);
			if (!article) {
				return;
			}

			const replacement = {
				contentHtml: sanitizedHtml || null,
				contentText: textContent || null,
				excerpt,
				heroImageUrl: heroImage,
				hash: createArticleContentHash({
					canonicalUrl: article.canonicalUrl,
					title: article.title,
					author: article.author,
					excerpt,
					contentHtml: sanitizedHtml || null,
					contentText: textContent || null,
					heroImageUrl: heroImage,
				}),
				media: extractMediaFromHtml(sanitizedHtml || null).map((item, index) => ({
					articleId: enrichment.articleId,
					type: item.type,
					provider: item.provider,
					url: item.url,
					embedUrl: item.embedUrl,
					width: item.width,
					height: item.height,
					position: index,
				})),
				enrichedAt: new Date(),
			};
			let updated: { feedId: string; contentVersion: number } | null = null;
			if (shouldReplace && this.articleRepo.replaceEnrichedContent) {
				updated = await this.articleRepo.replaceEnrichedContent(enrichment.articleId, replacement);
			} else if (shouldReplace) {
				await this.articleRepo.updateContent(enrichment.articleId, replacement);
				await this.articleRepo.replaceMedia(enrichment.articleId, replacement.media);
			} else if (this.articleRepo.markEnrichmentComplete) {
				updated = await this.articleRepo.markEnrichmentComplete(enrichment.articleId);
			}
			await this.invalidateArticleDetailCaches(enrichment.userId, [enrichment.articleId]);
			if (updated && this.realtimeService) {
				await this.realtimeService.publishEvent(enrichment.userId, {
					type: 'article.updated',
					eventId: crypto.randomUUID(),
					articleId: enrichment.articleId,
					feedId: updated.feedId,
					contentStatus: 'full_ready',
					contentVersion: updated.contentVersion,
					updatedAt: new Date().toISOString(),
				});
			}
			return true;
		} finally {
			await this.redis.del(lockKey);
		}
	}

	private shouldAttemptArticleEnrichment(canonicalUrl: string | null) {
		return !!canonicalUrl?.trim();
	}

	private resolveEnrichedArticleHtml(canonicalUrl: string) {
		return fetchArticlePageContent(canonicalUrl, this.config);
	}

	private async fetchAndParse(
		feedUrl: string,
		ignoreCache = false,
		options: { timeoutMs?: number; maxRetries?: number } = {},
	): Promise<RSSParser.Output<FeedItemRecord>> {
		const etagKey = CacheKeys.feedEtag(feedUrl);
		const lastModKey = CacheKeys.feedLastModified(feedUrl);

		const [etag, lastMod] = ignoreCache
			? [null, null]
			: await Promise.all([this.redis.get(etagKey), this.redis.get(lastModKey)]);

		const headers: Record<string, string> = {
			'User-Agent': 'SelfFeed/1.0',
			Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
		};
		if (!ignoreCache) {
			if (etag) headers['If-None-Match'] = etag;
			if (lastMod) headers['If-Modified-Since'] = lastMod;
		}

		const result = await withRetry(
			async () => {
				const controller = new AbortController();
				const timeout = setTimeout(
					() => controller.abort(),
					options.timeoutMs ?? this.config.timeoutMs,
				);

				try {
					const response = await fetchWithValidatedRedirects(
						feedUrl,
						{
							signal: controller.signal,
							headers,
						},
						{ allowPrivateHosts: this.config.allowPrivateHosts, maxRedirects: 3 },
					);

					if (response.status === 304) {
						logger.debug('Feed not modified (304)', { feedUrl });
						return { notModified: true as const };
					}

					if (!response.ok) {
						await response.body?.cancel().catch(() => undefined);
						throw response;
					}

					const contentLength = response.headers?.get?.('content-length');
					if (contentLength && Number.parseInt(contentLength, 10) > this.config.maxContentLength) {
						await response.body?.cancel().catch(() => undefined);
						throw new Error('Feed content exceeds maximum size');
					}

					const text = await readResponseTextWithinLimit(
						response,
						this.config.maxContentLength,
						controller,
					);

					return {
						notModified: false as const,
						text,
						etag: response.headers.get('etag'),
						lastModified: response.headers.get('last-modified'),
					};
				} finally {
					clearTimeout(timeout);
				}
			},
			{ maxRetries: options.maxRetries ?? 3 },
			{ operation: 'fetchAndParse', feedUrl },
		);

		if (result.notModified) {
			return { items: [] };
		}

		const parsed = (await this.parser.parseString(result.text)) as RSSParser.Output<FeedItemRecord>;
		const ttl = 60 * 60 * 24 * 7;
		await Promise.all([
			result.etag ? this.redis.set(etagKey, result.etag, 'EX', ttl) : Promise.resolve(null),
			result.lastModified
				? this.redis.set(lastModKey, result.lastModified, 'EX', ttl)
				: Promise.resolve(null),
		]);
		return parsed;
	}

	private shouldRefreshArticle(
		existingContentHtml: string | null,
		existingHeroImageUrl: string | null,
		nextContentHtml: string,
		nextHeroImageUrl: string | null,
	) {
		if (!nextContentHtml) return false;

		const existingHasMedia = hasRichMedia(existingContentHtml ?? '');
		const nextHasMedia = hasRichMedia(nextContentHtml);
		if (!existingHasMedia && nextHasMedia) return true;
		if (!existingContentHtml && nextContentHtml) return true;
		if (!existingHeroImageUrl && nextHeroImageUrl) return true;

		return stripHtml(nextContentHtml).length > stripHtml(existingContentHtml ?? '').length + 80;
	}

	private nextFailedSyncRetryAt(pollingIntervalMinutes: number) {
		const retryMinutes = Math.min(
			FAILED_SYNC_RETRY_MINUTES.max,
			Math.max(FAILED_SYNC_RETRY_MINUTES.min, pollingIntervalMinutes),
		);
		return new Date(Date.now() + retryMinutes * 60_000);
	}

	private shouldProcessArticle(
		existingArticle: {
			contentHtml: string | null;
			heroImageUrl: string | null;
			contentStatus: string;
		} | null,
		shouldEnrichArticles: boolean,
	) {
		if (!existingArticle) {
			return true;
		}

		if (!shouldEnrichArticles) {
			return false;
		}

		return !(
			existingArticle.contentStatus === 'full_ready' ||
			(!existingArticle.contentStatus &&
				existingArticle.contentHtml &&
				existingArticle.heroImageUrl)
		);
	}

	private async invalidateUnreadCache(userId: string, feedId?: string) {
		const keys = [CacheKeys.unreadCount(userId)];
		if (feedId) keys.push(CacheKeys.unreadCountByFeed(userId, feedId));
		if (keys.length > 0) {
			await this.redis.del(...keys);
		}
	}

	private async invalidateArticleDetailCaches(userId: string, articleIds: string[]) {
		if (articleIds.length === 0) return;
		await this.redis.del(
			...articleIds.map((articleId) => CacheKeys.articleDetail(userId, articleId)),
		);
	}

	private async tryAcquireFeedSyncLock(feedId: string): Promise<(() => Promise<void>) | null> {
		const redisWithSet = this.redis as unknown as {
			set?: (...args: unknown[]) => Promise<unknown>;
			del?: (...args: unknown[]) => Promise<unknown>;
		};

		if (typeof redisWithSet.set !== 'function') {
			logger.warn('Feed sync lock unavailable because Redis set is not configured', { feedId });
			return async () => undefined;
		}

		const lockKey = CacheKeys.feedSyncLock(feedId);
		const lockAcquired = await redisWithSet.set(
			lockKey,
			'1',
			'EX',
			FEED_SYNC_LOCK_TTL_SECONDS,
			'NX',
		);
		if (lockAcquired !== 'OK') {
			return null;
		}

		return async () => {
			try {
				if (typeof redisWithSet.del === 'function') {
					await redisWithSet.del(lockKey);
				}
			} catch (err) {
				logger.warn('Failed to release feed sync lock', {
					feedId,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		};
	}

	private parsePublishedAt(value: unknown): Date | null {
		const normalized = this.normalizeText(value);
		if (!normalized) return null;
		const parsed = new Date(normalized);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
	}

	private resolveItemGuid(item: unknown, fallbackIndex: number): string | null {
		const record = item as FeedItemRecord;
		const explicitGuid =
			this.normalizeText(record.guid) ??
			this.normalizeText(record.id) ??
			this.normalizeText(record.link) ??
			this.normalizeText(record.title);
		if (explicitGuid) {
			return explicitGuid;
		}

		const fingerprint = createHash('sha256')
			.update(JSON.stringify(record) ?? `item-${fallbackIndex}`)
			.digest('hex');
		return `fallback:${fingerprint}`;
	}

	private normalizeText(value: unknown, seen = new Set<unknown>()): string | null {
		if (typeof value === 'string') {
			return value;
		}

		if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
			return String(value);
		}

		if (value == null) {
			return null;
		}

		if (Array.isArray(value)) {
			const combined = value
				.map((item) => this.normalizeText(item, seen))
				.filter((item): item is string => !!item)
				.join(' ')
				.trim();
			return combined || null;
		}

		if (typeof value === 'object') {
			if (seen.has(value)) {
				return null;
			}

			seen.add(value);
			const normalized = Object.values(value as Record<string, unknown>)
				.map((item) => this.normalizeText(item, seen))
				.filter((item): item is string => !!item)
				.join(' ')
				.trim();
			seen.delete(value);
			return normalized || null;
		}

		return null;
	}
}
