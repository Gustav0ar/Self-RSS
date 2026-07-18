import { createHash } from 'node:crypto';
import { MessageChannel } from 'node:worker_threads';
import type Redis from 'ioredis';
import RSSParser from 'rss-parser';
import { CacheKeys } from '../db/redis.js';
import { AppError } from '../middleware/errors.js';
import type { ArticleRepository } from '../repositories/article.repository.js';
import type { FeedRepository } from '../repositories/feed.repository.js';
import type { MetricsRepository, SyncRunRepository } from '../repositories/settings.repository.js';
import { createArticleContentHash } from '../utils/article-hash.js';
import { cancelResponseBody, readResponseTextWithinLimit } from '../utils/bounded-response.js';
import { createFeedFetchHeaders } from '../utils/feed-fetch-headers.js';
import type { FeedFetchRelayConfig } from '../utils/feed-fetch-relay.js';
import { fetchFeedWithRelayFallback } from '../utils/feed-fetch-relay.js';
import { createLogger } from '../utils/logger.js';
import { resolvePublisherHtmlUrls, resolvePublisherUrl } from '../utils/publisher-url.js';
import { withRetry } from '../utils/retry.js';
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
import { acquireFeedSyncGuards, consumePrefetchedFeed } from './feed-fetch-guard.js';
import { isKnownProxyFeedUrl, resolveStaleProxyFeed } from './feed-proxy-recovery.js';
import { deferFeedSyncUntilCooldown, processDueDelayedFeedSync } from './feed-sync-delayed.js';
import {
	buildPartialSyncWarning,
	FeedSyncFetchError,
	getSyncErrorDetails,
	nextFailedSyncRetryAt,
	normalizeSyncThrowable,
} from './feed-sync-errors.js';
import { type ManualSyncProgress, syncManualFeedBatch } from './feed-sync-manual-bulk.js';
import {
	processNextQueuedFeedSync,
	publishQueuedFeedSync,
	publishRealtimeEvent,
} from './feed-sync-manual-worker.js';
import { syncScheduledFeeds } from './feed-sync-scheduled.js';
import {
	getManualSyncAllFeedsStatus,
	type ManualSyncScope,
	queueManualSyncAllFeeds,
} from './feed-sync-status.js';
import type { MetricsService } from './metrics.service.js';
import type { RealtimeService } from './realtime.service.js';

const logger = createLogger();

interface SyncConfig extends FeedFetchRelayConfig {
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
	deferIfThrottled?: boolean;
	signal?: AbortSignal;
	skipIfSyncedWithinMs?: number;
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
// Keep memory-heavy Readability/CSS extraction serial so it cannot interrupt feed refreshes.
const ARTICLE_ENRICHMENT_CONCURRENCY = 1;
const ARTICLE_ENRICHMENT_MAX_ATTEMPTS = 5;
const ARTICLE_ENRICHMENT_RETRY_BASE_MS = 30_000;
const MANUAL_FEED_SYNC_TIMEOUT_MS = 10_000;
const SCHEDULED_FEED_SYNC_TIMEOUT_MS = 15_000;
const SCHEDULED_FEED_SYNC_MAX_CONCURRENCY = 1;
const SCHEDULED_FEED_SYNC_BATCH_SIZE = 50;
const FEED_VALIDATOR_TTL_SECONDS = 15 * 60;
// The heartbeat keeps live fetches locked indefinitely. A short TTL only
// affects dead workers, allowing their unfinished feeds to resume promptly.
const FEED_SYNC_LOCK_TTL_SECONDS = 60;
const STALE_SYNCING_FEED_MS = (FEED_SYNC_LOCK_TTL_SECONDS + 5 * 60) * 1000;
function yieldToEventLoop() {
	return new Promise<void>((resolve) => {
		const channel = new MessageChannel();
		channel.port1.on('message', () => {
			channel.port1.close();
			channel.port2.close();
			resolve();
		});
		channel.port2.postMessage(undefined);
	});
}
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
			headers: createFeedFetchHeaders(),
		});
	}
	async syncFeed(feedId: string, userId: string, options: SyncFeedOptions = {}) {
		options.signal?.throwIfAborted();
		const feed = await this.feedRepo.findById(feedId, userId);
		if (!feed) {
			logger.warn('Feed not found for sync', { feedId, userId });
			return null;
		}
		options.signal?.throwIfAborted();
		if (
			options.skipIfSyncedWithinMs != null &&
			feed.lastSyncedAt != null &&
			Date.now() - feed.lastSyncedAt.getTime() < options.skipIfSyncedWithinMs
		) {
			logger.info('Skipping recently updated feed', { feedId, userId });
			return { newArticles: 0, total: 0, skipped: true as const };
		}

		const releaseFeedLocks = await acquireFeedSyncGuards(this.redis, feedId, feed.feedUrl);
		if (!releaseFeedLocks) {
			logger.info('Skipping feed sync because it is active or in its fifteen-minute cooldown', {
				feedId,
				userId,
			});
			if (options.deferIfThrottled) {
				await deferFeedSyncUntilCooldown(this.redis, feed.feedUrl, { feedId, userId });
			}
			return { newArticles: 0, total: 0, skipped: true as const };
		}

		const shouldEnrichArticles = options.enrichArticles ?? true;
		const shouldWarmArticleCache = options.warmArticleCache ?? true;

		const run = await this.syncRunRepo.create(feedId);
		await this.feedRepo.update(feedId, userId, { syncStatus: 'syncing' });

		try {
			const articleCount = (await this.articleRepo.countByFeeds?.([feedId])) ?? 0;
			const isProxyFeed = isKnownProxyFeedUrl(feed.feedUrl);
			const isNeverSynced = feed.lastSyncedAt == null && articleCount === 0;
			const ignoreCache = options.forceFetch === true || isNeverSynced || isProxyFeed;
			const fetchOptions =
				options.fetchTimeoutMs != null || options.fetchMaxRetries != null || options.signal != null
					? {
							timeoutMs: options.fetchTimeoutMs,
							maxRetries: options.fetchMaxRetries,
							signal: options.signal,
						}
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
			options.signal?.throwIfAborted();
			const effectiveFeedUrl = proxyResolution?.feedUrl ?? feed.feedUrl;
			const syncWarning = proxyResolution?.warning ?? null;
			const parsedLink = resolvePublisherUrl(this.normalizeText(parsed.link), effectiveFeedUrl);
			const parsedDescription = this.normalizeText(parsed.description);
			const parsedImageUrl = resolvePublisherUrl(
				this.normalizeText(parsed.image?.url),
				parsedLink,
				effectiveFeedUrl,
			);

			const feedUpdates: Record<string, unknown> = {};
			if (effectiveFeedUrl !== feed.feedUrl) feedUpdates.feedUrl = effectiveFeedUrl;
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
				const canonicalUrl = resolvePublisherUrl(
					this.normalizeText(itemRecord.link),
					parsedLink,
					effectiveFeedUrl,
				);
				const articleTitle = this.normalizeText(itemRecord.title) ?? 'Untitled';
				const author =
					this.normalizeText(itemRecord.creator) ??
					this.normalizeText(itemRecord['dc:creator']) ??
					null;
				const publishedAt = this.parsePublishedAt(
					itemRecord.isoDate ?? itemRecord.pubDate ?? itemRecord.date ?? itemRecord['dc:date'],
				);
				const rawHtml =
					typeof rawFeedContent === 'string'
						? rawFeedContent
						: (this.normalizeText(rawFeedContent) ?? '');
				const sanitizedHtml = resolvePublisherHtmlUrls(
					sanitizeHtml(rawHtml),
					canonicalUrl,
					parsedLink,
					effectiveFeedUrl,
				);
				// Extract text from sanitized HTML (DOMPurify already stripped chrome).
				// This matches reader output and skips an extra regex pass.
				const textContent = stripHtml(sanitizedHtml);
				const excerpt = textContent ? extractExcerpt(textContent) : null;
				const heroImage = extractHeroImage(sanitizedHtml);

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
				options.signal?.throwIfAborted();
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
				await yieldToEventLoop();
			}
			options.signal?.throwIfAborted();
			if (itemProcessingFailures.length > 0) {
				logger.warn('Feed sync skipped malformed article items', {
					feedId,
					failedItems: itemProcessingFailures.length,
					sample: itemProcessingFailures.slice(0, 3),
				});
			}

			// Build media maps up front so persistence stays atomic.
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
			const syncCompletedAt = new Date();
			const { itemWarning, persistedWarning } = buildPartialSyncWarning(
				syncWarning,
				itemProcessingFailures,
			);

			await this.feedRepo.update(feedId, userId, {
				...feedUpdates,
				lastSyncedAt: syncCompletedAt,
				lastSyncError: persistedWarning || null,
				lastSyncErrorAt: persistedWarning ? syncCompletedAt : null,
				nextSyncAt,
				syncStatus: 'idle',
			});

			await this.syncRunRepo.complete(run.id, {
				status: 'success',
				httpStatus: 200,
				itemCount: insertedArticles.length,
				errorMessage: itemWarning ?? undefined,
			});

			await this.invalidateUnreadCache(userId, feedId);
			if (this.articleCache && (insertedArticles.length > 0 || articlesToUpdate.length > 0)) {
				await this.articleCache.invalidateCache(userId, {
					cleanupScoped: options.deferScopedCacheCleanup !== true,
				});
			}
			await this.metricsRepo.incrementSyncCount(userId);
			await publishRealtimeEvent(this.realtimeService, userId, {
				type: 'feed.health.updated',
				eventId: crypto.randomUUID(),
				feedId,
				severity: persistedWarning ? 'warning' : 'healthy',
				syncStatus: 'idle',
				lastSyncedAt: syncCompletedAt.toISOString(),
				lastSyncError: persistedWarning || null,
				lastSyncErrorAt: persistedWarning ? syncCompletedAt.toISOString() : null,
				updatedAt: syncCompletedAt.toISOString(),
			});

			if (insertedArticles.length > 0)
				await publishRealtimeEvent(this.realtimeService, userId, {
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
			const failedAt = new Date();
			await this.feedRepo.update(feedId, userId, {
				nextSyncAt: nextFailedSyncRetryAt(feed.pollingIntervalMinutes, errorDetails.status),
				lastSyncError: errorDetails.error,
				lastSyncErrorAt: failedAt,
				syncStatus: 'error',
			});
			await this.syncRunRepo.complete(run.id, {
				status: 'failed',
				itemCount: 0,
				errorMessage: errorDetails.error,
			});
			await publishRealtimeEvent(this.realtimeService, userId, {
				type: 'feed.health.updated',
				eventId: crypto.randomUUID(),
				feedId,
				severity: 'error',
				syncStatus: 'error',
				lastSyncedAt: feed.lastSyncedAt?.toISOString() ?? null,
				lastSyncError: errorDetails.error,
				lastSyncErrorAt: failedAt.toISOString(),
				updatedAt: failedAt.toISOString(),
			});
			logger.error('Feed sync failed', { feedId, ...errorDetails });
			if (err instanceof FeedSyncFetchError) {
				throw AppError.badGateway('Could not fetch or parse the feed URL', errorDetails.error);
			}
			throw normalizeSyncThrowable(err, errorDetails);
		} finally {
			await releaseFeedLocks();
		}
	}

	async syncAllFeeds(
		userId: string,
		scope: ManualSyncScope = {},
		onProgress?: (progress: ManualSyncProgress) => Promise<void> | void,
	) {
		const feeds = await this.feedRepo.findAllByUser(userId);
		const categoryFeedIds = scope.categoryId
			? new Set(
					(await this.feedRepo.findByCategory(userId, scope.categoryId)).map((feed) => feed.id),
				)
			: new Set<string>();
		const bulkResult = await syncManualFeedBatch({
			feeds,
			concurrency: this.config.concurrency,
			categoryFeedIds,
			scope,
			syncFeed: (feed, controls) =>
				this.syncFeed(feed.id, userId, {
					enrichArticles: true,
					// Warm the full user cache once after the batch.
					warmArticleCache: false,
					// Leave slow publishers for the robust background scheduler.
					fetchTimeoutMs: Math.min(this.config.timeoutMs, MANUAL_FEED_SYNC_TIMEOUT_MS),
					// Publisher requests are never retried inline. Throttled work is
					// resumed by the durable delayed queue after its cooldown expires.
					fetchMaxRetries: 0,
					deferScopedCacheCleanup: true,
					deferIfThrottled: true,
					...controls,
				}),
			onProgress: async (progress) => {
				await onProgress?.(progress);
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

		return bulkResult;
	}

	async queueSyncAllFeeds(userId: string, scope: ManualSyncScope = {}) {
		const { didQueue, request } = await queueManualSyncAllFeeds(this.redis, userId, scope);
		if (didQueue) await publishQueuedFeedSync(this.realtimeService, userId, request);
		const status = await getManualSyncAllFeedsStatus(this.redis, userId);
		if (didQueue)
			logger.info('Queued bulk feed sync', {
				userId,
				jobId: request.jobId,
				scope,
			});
		return {
			accepted: true,
			alreadyQueued: !didQueue,
			jobId: request.jobId,
			status,
		};
	}

	async getSyncAllFeedsStatus(userId: string) {
		return getManualSyncAllFeedsStatus(this.redis, userId);
	}
	async processNextQueuedSyncAllFeeds() {
		return processNextQueuedFeedSync({
			redis: this.redis,
			realtimeService: this.realtimeService,
			syncAllFeeds: (userId, scope, onProgress) => this.syncAllFeeds(userId, scope, onProgress),
		});
	}

	async processNextDelayedFeedSync() {
		return processDueDelayedFeedSync(this.redis, (request) =>
			this.syncFeed(request.feedId, request.userId, {
				enrichArticles: true,
				warmArticleCache: true,
				fetchTimeoutMs: Math.min(this.config.timeoutMs, MANUAL_FEED_SYNC_TIMEOUT_MS),
				fetchMaxRetries: 0,
				deferIfThrottled: true,
			}),
		);
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

		// Bound each drain so a few slow or broken publishers cannot keep every
		// later feed trapped in one long-running scheduler cycle. The scheduler
		// immediately revisits the oldest remaining due feeds on its next pass.
		const dueFeeds = await this.feedRepo.findDueForSync(SCHEDULED_FEED_SYNC_BATCH_SIZE);
		return syncScheduledFeeds({
			feeds: dueFeeds,
			concurrency: Math.min(this.config.concurrency, SCHEDULED_FEED_SYNC_MAX_CONCURRENCY),
			syncFeed: (feed) =>
				this.syncFeed(feed.id, feed.userId, {
					warmArticleCache: false,
					fetchTimeoutMs: Math.min(this.config.timeoutMs, SCHEDULED_FEED_SYNC_TIMEOUT_MS),
					// A failed source is persisted and retried by the scheduler.
					// Retrying inline only blocks healthy feeds behind it.
					fetchMaxRetries: 0,
				}),
		});
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

	async processPendingArticleEnrichments(limit = ARTICLE_ENRICHMENT_CONCURRENCY) {
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

			const sanitizedHtml = resolvePublisherHtmlUrls(
				sanitizeHtml(enrichedHtml),
				enrichment.canonicalUrl,
			);
			const textContent = stripHtml(sanitizedHtml);
			const excerpt = textContent ? extractExcerpt(textContent) : null;
			const heroImage =
				extractHeroImage(sanitizedHtml) ??
				resolvePublisherUrl(enrichment.heroImageUrl, enrichment.canonicalUrl);

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
		options: { timeoutMs?: number; maxRetries?: number; signal?: AbortSignal } = {},
	): Promise<RSSParser.Output<FeedItemRecord>> {
		options.signal?.throwIfAborted();
		const etagKey = CacheKeys.feedEtag(feedUrl);
		const lastModKey = CacheKeys.feedLastModified(feedUrl);
		const prefetched = await consumePrefetchedFeed(this.redis, feedUrl, FEED_VALIDATOR_TTL_SECONDS);
		if (prefetched) return this.parser.parseString(prefetched);

		const [etag, lastMod] = ignoreCache
			? [null, null]
			: await Promise.all([this.redis.get(etagKey), this.redis.get(lastModKey)]);

		const headers = createFeedFetchHeaders();
		if (ignoreCache) {
			headers['Cache-Control'] = 'no-cache';
			headers.Pragma = 'no-cache';
		} else {
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

				const signal = options.signal
					? AbortSignal.any([controller.signal, options.signal])
					: controller.signal;
				try {
					const response = await fetchFeedWithRelayFallback(
						feedUrl,
						{
							signal,
							headers,
						},
						{
							allowPrivateHosts: this.config.allowPrivateHosts,
							maxRedirects: 3,
						},
						{
							relayUrl: this.config.relayUrl,
							relayToken: this.config.relayToken,
							allowedHosts: this.config.allowedHosts,
						},
					);

					if (response.status === 304) {
						logger.debug('Feed not modified (304)', { feedUrl });
						return { notModified: true as const };
					}

					if (!response.ok) {
						cancelResponseBody(response);
						throw response;
					}

					const contentLength = response.headers?.get?.('content-length');
					if (contentLength && Number.parseInt(contentLength, 10) > this.config.maxContentLength) {
						cancelResponseBody(response);
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
			{
				maxRetries: 0,
				baseDelayMs: 2_000,
				maxDelayMs: 10_000,
			},
			{ operation: 'fetchAndParse', feedUrl },
		);

		if (result.notModified) {
			return { items: [] };
		}

		options.signal?.throwIfAborted();
		const parsed = (await this.parser.parseString(result.text)) as RSSParser.Output<FeedItemRecord>;
		options.signal?.throwIfAborted();
		// Some publishers return stale validators for hours or days. Expiring
		// them frequently preserves cheap conditional polling while guaranteeing
		// a regular unconditional fetch that can discover those articles.
		const ttl = FEED_VALIDATOR_TTL_SECONDS;
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
