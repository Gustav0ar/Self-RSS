import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import RSSParser from 'rss-parser';
import { CacheKeys } from '../db/redis.js';
import type { ArticleRepository } from '../repositories/article.repository.js';
import type { FeedRepository } from '../repositories/feed.repository.js';
import type { MetricsRepository, SyncRunRepository } from '../repositories/settings.repository.js';
import { createArticleContentHash } from '../utils/article-hash.js';
import { readResponseTextWithinLimit } from '../utils/bounded-response.js';
import { createLogger } from '../utils/logger.js';
import { fetchWithValidatedRedirects } from '../utils/safe-fetch.js';
import {
	extractArticleContentFromPage,
	extractExcerpt,
	extractHeroImage,
	extractMediaFromHtml,
	hasRichMedia,
	sanitizeHtml,
	stripHtml,
} from '../utils/sanitizer.js';
import type { ArticleCacheService } from './article-cache.service.js';

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
const MANUAL_SYNC_DEDUPE_TTL_SECONDS = 60 * 30;
const MANUAL_SYNC_LOCK_TTL_SECONDS = 60 * 30;
const FEED_SYNC_LOCK_TTL_SECONDS = 60 * 20;

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
			const ignoreCache = articleCount === 0;
			const parsed = await this.fetchAndParse(feed.feedUrl, ignoreCache);
			const parsedTitle = this.normalizeText(parsed.title)?.trim() ?? null;
			const parsedLink = this.normalizeText(parsed.link);
			const parsedDescription = this.normalizeText(parsed.description);
			const parsedImageUrl = this.normalizeText(parsed.image?.url);

			const feedUpdates: Record<string, unknown> = {};
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
			const now = new Date(); // Use consistent timestamp for all enrichments in this sync
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
				// Run the regex-based text extraction over the already-
				// sanitized HTML, not the raw payload. DOMPurify strips
				// script/style/iframe and the chrome elements, so the
				// resulting plain text is closer to the reader output
				// (matches the article reader's own extraction) and we
				// skip one regex pass over a potentially huge string.
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
					if (
						shouldEnrichArticles &&
						this.shouldAttemptArticleEnrichment(canonicalUrl, rawHtml, existingArticle.contentHtml)
					) {
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
				if (
					shouldEnrichArticles &&
					this.shouldAttemptArticleEnrichment(canonicalUrl, rawHtml, null)
				) {
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
				});
			};

			for (let i = 0; i < items.length; i += FEED_SYNC_ITEM_CONCURRENCY) {
				const batch = items.slice(i, i + FEED_SYNC_ITEM_CONCURRENCY);
				await Promise.allSettled(batch.map((item, index) => processItem(item, i + index)));
			}

			// Build the per-article media maps up front so the repository can
			// persist inserts, content updates, and media rows inside a single
			// transaction. A crash mid-sync otherwise leaves articles inserted
			// with empty `contentHtml` or stale media.
			//
			// Media for newly inserted articles is keyed by `guid` because the
			// article id is generated by the database on insert. The
			// repository rewrites the rows to use the freshly-inserted id
			// after the insert returns.
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

			// Update `nextSyncAt` to `now + pollingIntervalMinutes` so the
			// scheduler's index-backed due-feed query skips this feed until
			// it's actually due. Without this, the worker would re-fetch
			// the feed every minute regardless of the configured interval.
			const nextSyncAt = new Date(Date.now() + feed.pollingIntervalMinutes * 60_000);

			await this.feedRepo.update(feedId, userId, {
				...feedUpdates,
				lastSyncedAt: new Date(),
				nextSyncAt,
				syncStatus: 'idle',
			});

			await this.syncRunRepo.complete(run.id, {
				status: 'success',
				httpStatus: 200,
				itemCount: insertedArticles.length,
			});

			await this.invalidateUnreadCache(userId, feedId);
			if (this.articleCache && (insertedArticles.length > 0 || articlesToUpdate.length > 0)) {
				await this.articleCache.invalidateCache(userId);
			}
			await this.metricsRepo.incrementSyncCount(userId);

			if (pendingEnrichments.length > 0) {
				void this.enrichArticlesInBackground(pendingEnrichments);
			}

			// Populate article cache after sync completes
			if (shouldWarmArticleCache && this.articleCache && insertedArticles.length > 0) {
				void this.articleCache.populateCache(userId);
			}

			logger.info('Feed synced', {
				feedId,
				newArticles: insertedArticles.length,
				total: items.length,
			});

			return { newArticles: insertedArticles.length, total: items.length };
		} catch (err) {
			await this.feedRepo.update(feedId, userId, {
				nextSyncAt: this.nextFailedSyncRetryAt(feed.pollingIntervalMinutes),
				syncStatus: 'error',
			});
			await this.syncRunRepo.complete(run.id, {
				status: 'failed',
				itemCount: 0,
				errorMessage: err instanceof Error ? err.message : String(err),
			});
			logger.error('Feed sync failed', { feedId, error: String(err) });
			throw err;
		} finally {
			await releaseFeedLock();
		}
	}

	async syncAllFeeds(userId: string) {
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
		const syncableFeeds = feeds;
		let skippedFeeds = 0;

		if (syncableFeeds.length === 0) {
			return {
				totalFeeds: feeds.length,
				syncedFeeds: 0,
				failedFeeds: 0,
				skippedFeeds,
				newArticles: 0,
			};
		}

		let syncedFeeds = 0;
		let failedFeeds = 0;
		let newArticles = 0;
		const bulkConcurrency = Math.max(1, this.config.concurrency);
		let nextFeedIndex = 0;

		const worker = async () => {
			while (nextFeedIndex < syncableFeeds.length) {
				const currentIndex = nextFeedIndex;
				nextFeedIndex += 1;
				const feed = syncableFeeds[currentIndex];
				if (!feed) {
					continue;
				}
				try {
					const result = await this.syncFeed(feed.id, userId, {
						enrichArticles: false,
						warmArticleCache: false,
					});
					if (result) {
						if ('skipped' in result && result.skipped) {
							skippedFeeds += 1;
						} else {
							syncedFeeds += 1;
							newArticles += result.newArticles;
						}
					}
				} catch {
					failedFeeds += 1;
				}
			}
		};

		await Promise.all(
			Array.from({ length: Math.min(bulkConcurrency, syncableFeeds.length) }, () => worker()),
		);

		// Populate cache after bulk sync completes
		if (this.articleCache && newArticles > 0) {
			await this.articleCache.populateCache(userId);
		}

		return {
			totalFeeds: feeds.length,
			syncedFeeds,
			failedFeeds,
			skippedFeeds,
			newArticles,
		};
	}

	async queueSyncAllFeeds(userId: string) {
		const queuedKey = CacheKeys.feedSyncAllQueued(userId);
		const didQueue = await this.redis.set(
			queuedKey,
			'1',
			'EX',
			MANUAL_SYNC_DEDUPE_TTL_SECONDS,
			'NX',
		);

		if (didQueue !== 'OK') {
			return { accepted: true, alreadyQueued: true };
		}

		await this.redis.rpush(CacheKeys.feedSyncAllQueue(), userId);
		logger.info('Queued bulk feed sync', { userId });
		return { accepted: true, alreadyQueued: false };
	}

	async getSyncAllFeedsStatus(userId: string) {
		const queuedKey = CacheKeys.feedSyncAllQueued(userId);
		const lockKey = CacheKeys.feedSyncAllLock(userId);
		const [queuedCount, runningCount] = await Promise.all([
			this.redis.exists(queuedKey),
			this.redis.exists(lockKey),
		]);
		const running = runningCount > 0;
		const queued = queuedCount > 0 && !running;

		return {
			queued,
			running,
			active: queued || running,
		};
	}

	async processNextQueuedSyncAllFeeds() {
		const userId = await this.redis.lpop(CacheKeys.feedSyncAllQueue());
		if (!userId) {
			return null;
		}

		const lockKey = CacheKeys.feedSyncAllLock(userId);
		const queuedKey = CacheKeys.feedSyncAllQueued(userId);
		const didLock = await this.redis.set(lockKey, '1', 'EX', MANUAL_SYNC_LOCK_TTL_SECONDS, 'NX');
		if (didLock !== 'OK') {
			logger.warn('Skipping queued bulk feed sync because one is already running', { userId });
			return { userId, skipped: true as const };
		}

		try {
			logger.info('Starting queued bulk feed sync', { userId });
			const result = await this.syncAllFeeds(userId);
			logger.info('Queued bulk feed sync complete', { userId, ...result });
			return { userId, skipped: false as const, result };
		} finally {
			await this.redis.del(lockKey, queuedKey);
		}
	}

	async syncDueFeeds() {
		const dueFeeds = await this.feedRepo.findDueForSync(this.config.concurrency);
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

	async enrichArticleNow(enrichment: PendingArticleEnrichment) {
		await this.enrichSingleArticle(enrichment);
	}

	private async enrichArticlesInBackground(pendingEnrichments: PendingArticleEnrichment[]) {
		// Sort by most recent first - users see recent articles first
		pendingEnrichments.sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime());

		for (let i = 0; i < pendingEnrichments.length; i += ARTICLE_ENRICHMENT_CONCURRENCY) {
			const batch = pendingEnrichments.slice(i, i + ARTICLE_ENRICHMENT_CONCURRENCY);
			await Promise.allSettled(batch.map((item) => this.enrichSingleArticle(item)));
		}
	}

	private async enrichSingleArticle(enrichment: PendingArticleEnrichment) {
		const lockKey = CacheKeys.articleEnrichmentLock(enrichment.articleId);
		const lockAcquired = await this.redis.set(lockKey, '1', 'EX', 60, 'NX');
		if (lockAcquired !== 'OK') {
			return;
		}

		try {
			const enrichedHtml = await this.resolveEnrichedArticleHtml(
				enrichment.canonicalUrl,
				enrichment.contentHtml,
			);
			if (!enrichedHtml) {
				return;
			}

			const sanitizedHtml = sanitizeHtml(enrichedHtml);
			const textContent = stripHtml(sanitizedHtml);
			const excerpt = textContent ? extractExcerpt(textContent) : null;
			const heroImage =
				extractHeroImage(enrichedHtml) ??
				extractHeroImage(sanitizedHtml) ??
				enrichment.heroImageUrl;

			if (
				!this.shouldRefreshArticle(
					enrichment.contentHtml,
					enrichment.heroImageUrl,
					sanitizedHtml,
					heroImage,
				)
			) {
				return;
			}

			const article = await this.articleRepo.findById(enrichment.articleId);
			if (!article) {
				return;
			}

			await this.articleRepo.updateContent(enrichment.articleId, {
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
			});
			await this.replaceArticleMedia(enrichment.articleId, sanitizedHtml || null);
			await this.invalidateArticleDetailCaches(enrichment.userId, [enrichment.articleId]);
		} finally {
			await this.redis.del(lockKey);
		}
	}

	private shouldAttemptArticleEnrichment(
		canonicalUrl: string | null,
		rawHtml: string,
		existingContentHtml: string | null,
	) {
		if (!canonicalUrl) return false;
		const feedHasMedia = hasRichMedia(rawHtml) || extractMediaFromHtml(rawHtml).length > 0;
		const existingHasMedia =
			hasRichMedia(existingContentHtml ?? '') ||
			extractMediaFromHtml(existingContentHtml ?? '').length > 0;
		if (feedHasMedia || existingHasMedia) {
			return false;
		}
		return true;
	}

	private async resolveEnrichedArticleHtml(
		canonicalUrl: string,
		existingContentHtml: string | null,
	) {
		const articlePageHtml = await this.fetchArticlePageContent(canonicalUrl);
		if (!articlePageHtml) return null;

		const fallbackTextLength = stripHtml(articlePageHtml).length;
		const existingTextLength = stripHtml(existingContentHtml ?? '').length;
		if (!hasRichMedia(articlePageHtml) && fallbackTextLength <= existingTextLength) {
			return null;
		}

		return articlePageHtml;
	}

	private async fetchAndParse(feedUrl: string, ignoreCache = false) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

		try {
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
				return { items: [] };
			}

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const newEtag = response.headers.get('etag');
			const newLastMod = response.headers.get('last-modified');

			const ttl = 60 * 60 * 24 * 7;
			if (newEtag) await this.redis.set(etagKey, newEtag, 'EX', ttl);
			if (newLastMod) await this.redis.set(lastModKey, newLastMod, 'EX', ttl);

			const contentLength = response.headers?.get?.('content-length');
			if (contentLength && Number.parseInt(contentLength, 10) > this.config.maxContentLength) {
				throw new Error('Feed content exceeds maximum size');
			}

			const text = await readResponseTextWithinLimit(
				response,
				this.config.maxContentLength,
				controller,
			);
			return this.parser.parseString(text);
		} finally {
			clearTimeout(timeout);
		}
	}

	private async fetchArticlePageContent(canonicalUrl: string) {
		const controller = new AbortController();
		const timeoutMs = Math.min(this.config.timeoutMs, 5000);
		const timeout = setTimeout(() => controller.abort(), timeoutMs);

		try {
			if (canonicalUrl.includes('naointendo.com.br/posts/')) {
				const match = canonicalUrl.match(/\/posts\/([a-zA-Z0-9_-]+)/);
				if (match) {
					const slug = match[1];
					const apiUrl = `https://www.naointendo.com.br/api/posts/${slug}`;
					const response = await fetchWithValidatedRedirects(
						apiUrl,
						{
							signal: controller.signal,
							headers: {
								'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
								Accept: 'application/json',
								'X-Requested-With': 'XMLHttpRequest',
							},
						},
						{ allowPrivateHosts: this.config.allowPrivateHosts, maxRedirects: 3 },
					);
					if (response.ok) {
						const text = await readResponseTextWithinLimit(
							response,
							this.config.maxContentLength,
							controller,
						);
						const data = JSON.parse(text);
						const post = data?.post;
						if (post) {
							let reconstructedHtml = '';
							if (post.media) {
								const media = post.media;
								if (media.type === 'image') {
									reconstructedHtml += `<img src="${media.content}" />`;
								} else if (media.type === 'twitter') {
									reconstructedHtml += `<iframe class="embedded-media embedded-media--x" src="https://platform.twitter.com/embed/Tweet.html?id=${media.content}"></iframe>`;
								} else if (media.type === 'html') {
									reconstructedHtml += media.content || '';
								} else if (media.type === 'video') {
									reconstructedHtml += `<video src="${media.content}" controls></video>`;
								} else {
									reconstructedHtml += media.content || '';
								}
							}
							if (post.description && typeof post.description === 'string') {
								reconstructedHtml += post.description;
							}
							return reconstructedHtml || null;
						}
					}
				}
			}

			const response = await fetchWithValidatedRedirects(
				canonicalUrl,
				{
					signal: controller.signal,
					headers: {
						'User-Agent': 'SelfFeed/1.0',
						Accept: 'text/html,application/xhtml+xml',
					},
				},
				{ allowPrivateHosts: this.config.allowPrivateHosts, maxRedirects: 3 },
			);

			if (!response.ok) {
				return null;
			}

			const contentLength = response.headers?.get?.('content-length');
			if (contentLength && Number.parseInt(contentLength, 10) > this.config.maxContentLength) {
				return null;
			}

			const pageHtml = await readResponseTextWithinLimit(
				response,
				this.config.maxContentLength,
				controller,
			);
			return extractArticleContentFromPage(pageHtml);
		} catch (error) {
			logger.warn('Unable to enrich article from canonical page', {
				canonicalUrl,
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		} finally {
			clearTimeout(timeout);
		}
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
		} | null,
		shouldEnrichArticles: boolean,
	) {
		if (!existingArticle) {
			return true;
		}

		if (!shouldEnrichArticles) {
			return false;
		}

		return !existingArticle.contentHtml || !existingArticle.heroImageUrl;
	}

	private async replaceArticleMedia(articleId: string, html: string | null) {
		const media = extractMediaFromHtml(html).map((item, index) => ({
			articleId,
			type: item.type,
			provider: item.provider,
			url: item.url,
			embedUrl: item.embedUrl,
			width: item.width,
			height: item.height,
			position: index,
		}));
		await this.articleRepo.replaceMedia(articleId, media);
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
