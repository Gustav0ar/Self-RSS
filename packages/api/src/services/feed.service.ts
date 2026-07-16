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
	) {
		this.parser = new RSSParser({
			timeout: 15_000,
			maxRedirects: 3,
			headers: createFeedFetchHeaders(),
		});
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
			nextSyncAt?: Date;
			syncStatus?: string;
			lastSyncError?: string | null;
			lastSyncErrorAt?: Date | null;
		} = { ...data };

		if (data.categoryId) {
			const category = await this.categoryRepo.findById(data.categoryId, userId);
			if (!category) {
				throw AppError.notFound('Category not found');
			}
		}

		if (data.feedUrl !== undefined) {
			if (data.feedUrl === feed.feedUrl) {
				delete updates.feedUrl;
			} else {
				const normalizedFeedUrl = await this.normalizeFeedUrl(data.feedUrl);
				const existing = await this.feedRepo.findByUrl(userId, normalizedFeedUrl);
				if (existing && existing.id !== feedId) {
					throw AppError.conflict('You already have this feed');
				}

				updates.feedUrl = normalizedFeedUrl;
				updates.nextSyncAt = new Date();
				updates.syncStatus = 'idle';
				updates.lastSyncError = null;
				updates.lastSyncErrorAt = null;
			}
		}

		return this.feedRepo.update(feedId, userId, updates);
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

		return feeds.map((f) => ({
			...f,
			unreadCount: unreadCountByFeedId.get(f.id) ?? 0,
			createdAt: f.createdAt.toISOString(),
			updatedAt: f.updatedAt.toISOString(),
			lastSyncedAt: f.lastSyncedAt?.toISOString() ?? null,
			lastSyncErrorAt: f.lastSyncErrorAt?.toISOString() ?? null,
		}));
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
