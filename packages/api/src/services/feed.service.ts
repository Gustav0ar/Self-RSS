import type Redis from 'ioredis';
import RSSParser from 'rss-parser';
import { AppError } from '../middleware/errors.js';
import type { ArticleRepository } from '../repositories/article.repository.js';
import type { CategoryRepository } from '../repositories/category.repository.js';
import type { FeedRepository } from '../repositories/feed.repository.js';
import { readResponseTextWithinLimit } from '../utils/bounded-response.js';
import { createFeedFetchHeaders } from '../utils/feed-fetch-headers.js';
import type { FeedFetchRelayConfig } from '../utils/feed-fetch-relay.js';
import { fetchFeedWithRelayFallback } from '../utils/feed-fetch-relay.js';
import { assertSafeRemoteUrl } from '../utils/safe-fetch.js';
import type { DurableFeedFacadeService } from './durable-feed-facade.service.js';
import {
	acquireFeedFetchGuard,
	cachePrefetchedFeed,
	readPrefetchedFeed,
} from './feed-fetch-guard.js';
import { getSyncErrorDetails } from './feed-sync-errors.js';

interface FeedMetadata {
	title: string;
	siteUrl: string | null;
	faviconUrl: string | null;
	description: string | null;
}

interface FeedFetchConfig extends FeedFetchRelayConfig {
	maxContentLength: number;
	allowPrivateHosts: boolean;
}

export class FeedService {
	private parser: RSSParser;

	constructor(
		private feedRepo: FeedRepository,
		private categoryRepo: CategoryRepository,
		private articleRepo: ArticleRepository,
		private config: FeedFetchConfig,
		private redis?: Redis,
		private durableFacade?: DurableFeedFacadeService,
		private pipelineMode: 'legacy' | 'v2' = 'legacy',
	) {
		this.parser = new RSSParser({
			timeout: 15_000,
			maxRedirects: 3,
			headers: createFeedFetchHeaders(),
		});
	}

	usesDurablePipeline() {
		return this.pipelineMode === 'v2' && Boolean(this.durableFacade);
	}

	async getAll(userId: string) {
		const feeds = await this.feedRepo.findAllByUser(userId);
		return this.serializeFeedsWithCounts(userId, feeds);
	}

	async getByCategory(userId: string, categoryId: string) {
		const category = await this.categoryRepo.findById(categoryId, userId);
		if (!category) {
			throw AppError.notFound('Category not found');
		}

		const feeds = await this.feedRepo.findByCategory(userId, categoryId);
		return this.serializeFeedsWithCounts(userId, feeds);
	}

	async create(userId: string, data: { categoryId: string; feedUrl: string; title?: string }) {
		if (this.pipelineMode === 'v2' && this.durableFacade) {
			const pending = await this.durableFacade.createPendingFeed(userId, data);
			return Object.assign(pending.feed, {
				ingestionRequestId: pending.requestId,
				ingestionJobId: pending.jobId,
			});
		}
		const category = await this.categoryRepo.findById(data.categoryId, userId);
		if (!category) {
			throw AppError.notFound('Category not found');
		}

		const normalizedFeedUrl = await this.normalizeFeedUrl(data.feedUrl);
		const existing = await this.feedRepo.findByUrl(userId, normalizedFeedUrl);
		if (existing) {
			throw AppError.conflict('You already have this feed');
		}

		const metadata = await this.fetchFeedMetadata(normalizedFeedUrl);
		const resolvedTitle = data.title?.trim() || metadata.title;
		if (!resolvedTitle) {
			throw AppError.badRequest('Could not determine feed title');
		}

		return this.feedRepo.create({
			userId,
			categoryId: data.categoryId,
			title: resolvedTitle,
			feedUrl: normalizedFeedUrl,
			siteUrl: metadata.siteUrl,
			faviconUrl: metadata.faviconUrl,
			description: metadata.description,
		});
	}

	async createWithCounts(
		userId: string,
		data: { categoryId: string; feedUrl: string; title?: string },
	) {
		const feed = await this.create(userId, data);
		return this.serializeFeedWithCount(feed, 0);
	}

	async update(
		userId: string,
		feedId: string,
		data: {
			categoryId?: string;
			feedUrl?: string;
			title?: string;
			pollingIntervalMinutes?: number;
		},
	) {
		const feed = await this.feedRepo.findById(feedId, userId);
		if (!feed) throw AppError.notFound('Feed not found');
		const updates: Partial<typeof data> & {
			siteUrl?: string | null;
			faviconUrl?: string | null;
			description?: string | null;
			nextSyncAt?: Date;
			syncStatus?: string;
			lastSyncError?: string | null;
			lastSyncErrorAt?: Date | null;
			customTitle?: string | null;
		} = { ...data };
		if (this.pipelineMode === 'v2' && data.title !== undefined) {
			updates.customTitle = data.title.trim();
		}

		if (data.categoryId) {
			const category = await this.categoryRepo.findById(data.categoryId, userId);
			if (!category) {
				throw AppError.notFound('Category not found');
			}
		}

		if (data.feedUrl !== undefined) {
			if (this.pipelineMode === 'v2' && this.durableFacade && data.feedUrl !== feed.feedUrl) {
				const immediate = { ...data };
				delete immediate.feedUrl;
				if (Object.keys(immediate).length > 0) {
					await this.feedRepo.update(feedId, userId, {
						...immediate,
						customTitle: immediate.title?.trim(),
					});
				}
				const replacement = await this.durableFacade.requestReplacement(
					userId,
					feedId,
					data.feedUrl,
				);
				return Object.assign(replacement.feed, {
					ingestionRequestId: replacement.requestId,
					ingestionJobId: replacement.jobId,
					replacementWarning:
						'Existing articles remain available until the new source validates; activation replaces them atomically.',
				});
			}
			if (data.feedUrl === feed.feedUrl) {
				delete updates.feedUrl;
			} else {
				const normalizedFeedUrl = await this.normalizeFeedUrl(data.feedUrl);
				const existing = await this.feedRepo.findByUrl(userId, normalizedFeedUrl);
				if (existing && existing.id !== feedId) {
					throw AppError.conflict('You already have this feed');
				}

				// Validate the replacement as an actual parseable feed before
				// mutating the subscription. A failed fetch or parse therefore
				// leaves the existing URL and health state untouched.
				const metadata = await this.fetchFeedMetadata(normalizedFeedUrl);
				updates.feedUrl = normalizedFeedUrl;
				updates.siteUrl = metadata.siteUrl;
				updates.faviconUrl = metadata.faviconUrl;
				updates.description = metadata.description;
				updates.nextSyncAt = new Date();
				updates.syncStatus = 'idle';
				updates.lastSyncError = null;
				updates.lastSyncErrorAt = null;
			}
		}

		const updatedFeed = await this.feedRepo.update(feedId, userId, updates);
		if (!updatedFeed) throw AppError.notFound('Feed not found');
		return updatedFeed;
	}

	async updateWithCounts(
		userId: string,
		feedId: string,
		data: {
			categoryId?: string;
			feedUrl?: string;
			title?: string;
			pollingIntervalMinutes?: number;
		},
	) {
		// Read the count before the mutation so a count-query failure cannot
		// turn a successful database update into an apparent API failure.
		const unreadCountByFeedId = await this.articleRepo.unreadCountByFeed(userId, [feedId]);
		const feed = await this.update(userId, feedId, data);
		return this.serializeFeedWithCount(feed, unreadCountByFeedId.get(feedId) ?? 0);
	}

	async cancelReplacementWithCounts(userId: string, feedId: string) {
		if (!this.usesDurablePipeline() || !this.durableFacade) {
			throw AppError.notFound('Feed replacement cancellation is unavailable in legacy feed mode');
		}
		const unreadCountByFeedId = await this.articleRepo.unreadCountByFeed(userId, [feedId]);
		const feed = await this.durableFacade.cancelReplacement(userId, feedId);
		return this.serializeFeedWithCount(feed, unreadCountByFeedId.get(feedId) ?? 0);
	}

	async delete(userId: string, feedId: string) {
		const feed = await this.feedRepo.findById(feedId, userId);
		if (!feed) throw AppError.notFound('Feed not found');

		return this.feedRepo.delete(feedId, userId);
	}

	async normalizeFeedUrl(feedUrl: string) {
		return assertSafeRemoteUrl(feedUrl, {
			allowPrivateHosts: this.config.allowPrivateHosts,
		});
	}

	private async serializeFeedsWithCounts(
		userId: string,
		feeds: Awaited<ReturnType<FeedRepository['findAllByUser']>>,
	) {
		const unreadCountByFeedId = await this.articleRepo.unreadCountByFeed(
			userId,
			feeds.map((feed) => feed.id),
		);

		return Promise.all(
			feeds.map((feed) => this.serializeFeedWithCount(feed, unreadCountByFeedId.get(feed.id) ?? 0)),
		);
	}

	private async serializeFeedWithCount(
		feed: NonNullable<Awaited<ReturnType<FeedRepository['findById']>>>,
		unreadCount: number,
	) {
		const lifecycle =
			this.pipelineMode === 'v2' && this.durableFacade
				? await this.durableFacade.lifecycleForFeed(feed)
				: {};
		return {
			...feed,
			...lifecycle,
			unreadCount,
			createdAt: feed.createdAt.toISOString(),
			updatedAt: feed.updatedAt.toISOString(),
			lastSyncedAt: feed.lastSyncedAt?.toISOString() ?? null,
			lastSyncErrorAt: feed.lastSyncErrorAt?.toISOString() ?? null,
		};
	}

	private async fetchFeedMetadata(feedUrl: string): Promise<FeedMetadata> {
		const cached = this.redis ? await readPrefetchedFeed(this.redis, feedUrl) : null;
		if (cached) return this.parseFeedMetadata(cached.text);

		const releaseFeedFetchLock = this.redis
			? await acquireFeedFetchGuard(this.redis, feedUrl)
			: async () => undefined;
		if (!releaseFeedFetchLock) {
			throw AppError.tooManyRequests('This feed was fetched recently; try again in one minute');
		}
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 15_000);
		try {
			const response = await fetchFeedWithRelayFallback(
				feedUrl,
				{
					signal: controller.signal,
					headers: createFeedFetchHeaders(),
				},
				{ allowPrivateHosts: this.config.allowPrivateHosts, maxRedirects: 3 },
				{
					relayUrl: this.config.relayUrl,
					relayToken: this.config.relayToken,
					allowedHosts: this.config.allowedHosts,
				},
			);
			if (!response.ok) {
				await response.body?.cancel().catch(() => undefined);
				throw response;
			}

			const contentLength = response.headers?.get?.('content-length');
			if (contentLength && Number.parseInt(contentLength, 10) > this.config.maxContentLength) {
				throw new Error('Feed content exceeds maximum size');
			}

			const text = await readResponseTextWithinLimit(
				response,
				this.config.maxContentLength,
				controller,
			);
			const metadata = await this.parseFeedMetadata(text);
			if (this.redis) {
				await cachePrefetchedFeed(this.redis, feedUrl, {
					text,
					etag: response.headers.get('etag'),
					lastModified: response.headers.get('last-modified'),
				});
			}
			return metadata;
		} catch (error) {
			const errorDetails = getSyncErrorDetails(error);
			throw AppError.badRequest('Could not fetch or parse the feed URL', errorDetails.error);
		} finally {
			clearTimeout(timeout);
			await releaseFeedFetchLock();
		}
	}

	private async parseFeedMetadata(text: string): Promise<FeedMetadata> {
		const parsed = await this.parser.parseString(text);
		return {
			title: parsed.title?.trim() ?? '',
			siteUrl: parsed.link ?? null,
			faviconUrl: parsed.image?.url ?? null,
			description: parsed.description ?? null,
		};
	}
}
