import RSSParser from 'rss-parser';
import { AppError } from '../middleware/errors.js';
import type { ArticleRepository } from '../repositories/article.repository.js';
import type { CategoryRepository } from '../repositories/category.repository.js';
import type { FeedRepository } from '../repositories/feed.repository.js';
import { readResponseTextWithinLimit } from '../utils/bounded-response.js';
import { fetchWithRetry } from '../utils/retry.js';
import { assertSafeRemoteUrl, fetchWithValidatedRedirects } from '../utils/safe-fetch.js';

interface FeedMetadata {
	title: string;
	siteUrl: string | null;
	faviconUrl: string | null;
	description: string | null;
}

interface FeedFetchConfig {
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
	) {
		this.parser = new RSSParser({
			timeout: 15_000,
			maxRedirects: 3,
			headers: {
				'User-Agent': 'SelfFeed/1.0',
				Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
			},
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
		data: { categoryId?: string; title?: string; pollingIntervalMinutes?: number },
	) {
		const feed = await this.feedRepo.findById(feedId, userId);
		if (!feed) throw AppError.notFound('Feed not found');

		if (data.categoryId) {
			const category = await this.categoryRepo.findById(data.categoryId, userId);
			if (!category) {
				throw AppError.notFound('Category not found');
			}
		}

		return this.feedRepo.update(feedId, userId, data);
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
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 15_000);
		try {
			const response = await fetchWithRetry(
				() =>
					fetchWithValidatedRedirects(
						feedUrl,
						{
							signal: controller.signal,
							headers: {
								'User-Agent': 'SelfFeed/1.0',
								Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
							},
						},
						{ allowPrivateHosts: this.config.allowPrivateHosts, maxRedirects: 3 },
					),
				{ maxRetries: 3 },
				{ operation: 'fetchFeedMetadata', feedUrl },
			);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
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
			const parsed = await this.parser.parseString(text);

			return {
				title: parsed.title?.trim() ?? '',
				siteUrl: parsed.link ?? null,
				faviconUrl: parsed.image?.url ?? null,
				description: parsed.description ?? null,
			};
		} catch (error) {
			throw AppError.badRequest(
				'Could not fetch or parse the feed URL',
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			clearTimeout(timeout);
		}
	}
}
