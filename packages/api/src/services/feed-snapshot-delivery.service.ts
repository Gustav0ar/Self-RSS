import { createHash } from 'node:crypto';
import type { articleMedia, articles } from '../db/schema.js';
import type { ArticleRepository } from '../repositories/article.repository.js';
import type { FeedIngestionRepository } from '../repositories/feed-ingestion.repository.js';
import { withLeaseHeartbeat } from './durable-worker-loop.js';
import type { NormalizedFeedItem, NormalizedFeedPayload } from './normalized-feed.types.js';

function hash(value: unknown) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function mapNormalizedItemToArticle(
	feedId: string,
	item: NormalizedFeedItem,
	fetchedAt = new Date(),
): {
	article: typeof articles.$inferInsert;
	media: (typeof articleMedia.$inferInsert)[];
} {
	const shouldEnrich = Boolean(item.canonicalUrl?.trim());
	const hero = item.media.find(
		(entry) => entry.medium === 'image' || entry.type?.toLowerCase().startsWith('image/'),
	);
	const media = item.media.map((entry, index) => ({
		articleId: '',
		type: entry.medium ?? entry.type?.split('/')[0] ?? 'unknown',
		provider: (() => {
			try {
				return new URL(entry.url).hostname;
			} catch {
				return 'feed';
			}
		})(),
		url: entry.url,
		width: entry.width,
		height: entry.height,
		position: index,
	}));
	const articleHash = hash({
		canonicalUrl: item.canonicalUrl,
		title: item.title,
		author: item.author,
		excerpt: item.summary,
		contentHtml: item.contentHtml,
		contentText: item.contentText,
		heroImageUrl: hero?.url ?? null,
		publishedAt: item.publishedAt,
		media: item.media,
	});
	return {
		article: {
			feedId,
			guid: item.guid,
			canonicalUrl: item.canonicalUrl,
			title: item.title,
			author: item.author,
			excerpt: item.summary,
			contentHtml: item.contentHtml,
			contentText: item.contentText,
			heroImageUrl: hero?.url ?? null,
			publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
			fetchedAt,
			hash: articleHash,
			contentStatus: shouldEnrich ? 'enrichment_pending' : 'feed_ready',
			enrichmentQueuedAt: shouldEnrich ? fetchedAt : null,
			nextEnrichmentAt: shouldEnrich ? fetchedAt : null,
		},
		media,
	};
}

export interface FeedSnapshotDeliveryCallbacks {
	beforePersist?: (deliveryId: string) => void | Promise<void>;
	afterCommit?: (event: {
		feedId: string;
		userId: string;
		insertedArticleIds: string[];
		updatedArticleIds: string[];
	}) => void | Promise<void>;
}

class PostCommitCallbackError extends Error {
	constructor(readonly original: unknown) {
		super('Post-commit delivery callback failed');
	}
}

export class FeedSnapshotDeliveryService {
	constructor(
		private ingestionRepository: FeedIngestionRepository,
		private articleRepository: ArticleRepository,
		private callbacks: FeedSnapshotDeliveryCallbacks = {},
	) {}

	async drainOnce(
		workerId: string,
		options: { limit?: number; leaseSeconds?: number; now?: Date } = {},
	) {
		let processed = 0;
		const limit = Math.max(1, Math.floor(options.limit ?? 20));
		for (; processed < limit; processed += 1) {
			const delivery = await this.ingestionRepository.claimNextDelivery(
				workerId,
				options.leaseSeconds ?? 60,
				options.now ?? new Date(),
			);
			if (!delivery) break;
			const leaseSeconds = options.leaseSeconds ?? 60;
			await withLeaseHeartbeat({
				operation: () => this.processDelivery(delivery.id, workerId, options.now ?? new Date()),
				renew: () =>
					this.ingestionRepository.renewDelivery(
						delivery.id,
						workerId,
						leaseSeconds,
						options.now ?? new Date(),
					),
				leaseSeconds,
			});
		}
		return processed;
	}

	async processDelivery(deliveryId: string, workerId: string, now = new Date()) {
		const context = await this.ingestionRepository.findDeliveryContext(deliveryId);
		if (!context) throw new Error('Snapshot delivery context was not found');
		try {
			if (context.snapshot.parseState !== 'parsed' || !context.snapshot.normalizedPayload) {
				throw new Error('Snapshot delivery payload is not parsed');
			}
			const payload = JSON.parse(context.snapshot.normalizedPayload) as NormalizedFeedPayload;
			const mapped = payload.items.map((item) =>
				mapNormalizedItemToArticle(context.feed.id, item, now),
			);
			const existing = await this.articleRepository.findByFeedGuids(
				context.feed.id,
				mapped.map(({ article }) => article.guid),
			);
			const byGuid = new Map(existing.map((article) => [article.guid, article]));
			const articlesToInsert: (typeof articles.$inferInsert)[] = [];
			const articlesToUpdate: Parameters<
				ArticleRepository['persistSyncResults']
			>[0]['articlesToUpdate'] = [];
			const mediaByGuid = new Map<string, (typeof articleMedia.$inferInsert)[]>();
			const updatedMediaByArticleId = new Map<string, (typeof articleMedia.$inferInsert)[]>();
			await this.callbacks.beforePersist?.(deliveryId);
			for (const item of mapped) {
				const current = byGuid.get(item.article.guid);
				if (!current) {
					articlesToInsert.push(item.article);
					mediaByGuid.set(item.article.guid, item.media);
					continue;
				}
				if (current.hash === item.article.hash || current.contentStatus === 'full_ready') continue;
				articlesToUpdate.push({
					id: current.id,
					canonicalUrl: item.article.canonicalUrl ?? null,
					title: item.article.title,
					author: item.article.author ?? null,
					contentHtml: item.article.contentHtml ?? null,
					contentText: item.article.contentText ?? null,
					excerpt: item.article.excerpt ?? null,
					heroImageUrl: item.article.heroImageUrl ?? null,
					publishedAt: item.article.publishedAt ?? null,
					fetchedAt: now,
					incrementContentVersion: true,
					hash: item.article.hash,
				});
				updatedMediaByArticleId.set(
					current.id,
					item.media.map((media) => ({ ...media, articleId: current.id })),
				);
			}
			const inserted = await this.articleRepository.persistSyncResults({
				articlesToInsert,
				articlesToUpdate,
				mediaByGuid,
				updatedMediaByArticleId,
			});
			await this.ingestionRepository.updateFeedFromSource(context.feed.id, context.source.id, now);
			const completion = await this.ingestionRepository.finishDelivery(
				deliveryId,
				workerId,
				{ status: 'completed' },
				now,
			);
			if (!completion) return null;
			for (const requestId of completion.requestIds) {
				await this.ingestionRepository.aggregateRefreshRequest(requestId, now);
			}
			try {
				await this.callbacks.afterCommit?.({
					feedId: context.feed.id,
					userId: context.feed.userId,
					insertedArticleIds: inserted.map((article) => article.id),
					updatedArticleIds: articlesToUpdate.map((article) => article.id),
				});
			} catch (error) {
				throw new PostCommitCallbackError(error);
			}
			return completion.delivery;
		} catch (error) {
			if (error instanceof PostCommitCallbackError) throw error.original;
			const attempts = context.delivery.attempts;
			const dead = attempts >= context.delivery.maxAttempts;
			const delaySeconds = [60, 300, 1_800][Math.min(Math.max(attempts - 1, 0), 2)]!;
			const completion = await this.ingestionRepository.finishDelivery(
				deliveryId,
				workerId,
				{
					status: dead ? 'dead' : 'pending',
					availableAt: new Date(now.getTime() + delaySeconds * 1_000),
					error: {
						code: 'delivery_failed',
						details: error instanceof Error ? error.message : String(error),
					},
				},
				now,
			);
			if (dead && completion) {
				for (const requestId of completion.requestIds) {
					await this.ingestionRepository.aggregateRefreshRequest(requestId, now);
				}
			}
			return null;
		}
	}
}
