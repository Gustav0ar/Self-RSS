import { and, desc, eq, gte, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
	feedDiscoveryCandidates,
	feedFetchSnapshots,
	feedRefreshRequestItems,
	feedRefreshRequests,
	feedSnapshotDeliveries,
	feedSources,
	feeds,
} from '../db/schema.js';
import { AppError } from '../middleware/errors.js';
import type { CategoryRepository } from '../repositories/category.repository.js';
import type { FeedRepository } from '../repositories/feed.repository.js';
import type { FeedIngestionRepository } from '../repositories/feed-ingestion.repository.js';
import { normalizeFeedSourceUrl } from '../utils/feed-source-url.js';
import {
	cleanupDurableDiscoveryCandidates,
	listDurableDiscoveryCandidates,
	persistDurableDiscoveryCandidates,
} from './durable-feed-discovery.js';
import { buildDurableFeedLifecycle } from './durable-feed-lifecycle.js';
import {
	enqueueOrAttachDurableJob,
	queueDurableRefresh,
	type RefreshScope,
	type RefreshTransaction,
} from './durable-refresh-queue.js';
import { getDurableRefreshStatus } from './durable-refresh-status.js';

export class DurableFeedFacadeService {
	constructor(
		private db: Database,
		private feedRepository: FeedRepository,
		private categoryRepository: CategoryRepository,
		private ingestionRepository: FeedIngestionRepository,
	) {}

	async ensureSource(inputUrl: string) {
		const identity = normalizeFeedSourceUrl(inputUrl);
		const origin = await this.ingestionRepository.upsertOrigin({
			id: crypto.randomUUID(),
			scheme: identity.scheme,
			host: identity.host,
			port: identity.port,
		});
		const source = await this.ingestionRepository.upsertSource({
			id: crypto.randomUUID(),
			normalizedUrl: identity.normalizedUrl,
			requestedUrl: identity.normalizedUrl,
			originId: origin.id,
			nextFetchAt: new Date(),
		});
		return { source, origin };
	}

	async lifecycleForFeed(feed: typeof feeds.$inferSelect) {
		return buildDurableFeedLifecycle(this.db, feed);
	}

	async createPendingFeed(
		userId: string,
		data: { categoryId: string; feedUrl: string; title?: string },
	) {
		if (!(await this.categoryRepository.findById(data.categoryId, userId))) {
			throw AppError.notFound('Category not found');
		}
		const { source } = await this.ensureSource(data.feedUrl);
		const duplicate = await this.db.query.feeds.findFirst({
			where: and(
				eq(feeds.userId, userId),
				or(eq(feeds.feedUrl, source.normalizedUrl), eq(feeds.pendingSourceId, source.id)),
			),
		});
		if (duplicate) throw AppError.conflict('You already have this feed');
		const now = new Date();
		const title = data.title?.trim() || new URL(source.normalizedUrl).hostname;
		return this.db.transaction((tx) => {
			const currentSource = tx
				.select()
				.from(feedSources)
				.where(eq(feedSources.id, source.id))
				.get();
			const reusableSnapshot =
				currentSource?.state === 'active' && currentSource.lastSuccessAt
					? tx
							.select()
							.from(feedFetchSnapshots)
							.where(
								and(
									eq(feedFetchSnapshots.sourceId, source.id),
									eq(feedFetchSnapshots.parseState, 'parsed'),
									isNotNull(feedFetchSnapshots.normalizedPayload),
									isNotNull(feedFetchSnapshots.jobId),
									gte(feedFetchSnapshots.retainUntil, now),
								),
							)
							.orderBy(desc(feedFetchSnapshots.fetchedAt))
							.get()
					: null;
			let parsedTitle: string | null = null;
			if (reusableSnapshot?.normalizedPayload) {
				try {
					parsedTitle =
						(
							JSON.parse(reusableSnapshot.normalizedPayload) as {
								source?: { title?: string | null };
							}
						).source?.title ?? null;
				} catch {
					// A validated snapshot should parse; source metadata remains a safe fallback.
				}
			}
			const canReuse = Boolean(reusableSnapshot?.jobId && currentSource);
			const feed = tx
				.insert(feeds)
				.values({
					id: crypto.randomUUID(),
					userId,
					categoryId: data.categoryId,
					title: data.title?.trim() || parsedTitle || currentSource?.title || title,
					customTitle: data.title?.trim() || null,
					feedUrl: source.normalizedUrl,
					sourceId: canReuse ? source.id : null,
					pendingSourceId: canReuse ? null : source.id,
					siteUrl: canReuse ? currentSource?.siteUrl : null,
					faviconUrl: canReuse ? currentSource?.imageUrl : null,
					description: canReuse ? currentSource?.description : null,
					lastSyncedAt: canReuse ? currentSource?.lastSuccessAt : null,
					syncStatus: canReuse ? 'idle' : 'pending',
					nextSyncAt: canReuse ? (currentSource?.nextFetchAt ?? now) : now,
					createdAt: now,
					updatedAt: now,
				})
				.returning()
				.get();
			const requestId = crypto.randomUUID();
			tx.insert(feedRefreshRequests)
				.values({
					id: requestId,
					userId,
					idempotencyKey: `feed-create:${feed.id}`,
					scopeType: 'feed_create',
					scopeFeedId: feed.id,
					totalItems: 1,
					pendingItems: 1,
					requestedAt: now,
					createdAt: now,
					updatedAt: now,
				})
				.run();
			if (canReuse && reusableSnapshot?.jobId) {
				tx.insert(feedRefreshRequestItems)
					.values({
						id: crypto.randomUUID(),
						requestId,
						feedId: feed.id,
						sourceId: source.id,
						jobId: reusableSnapshot.jobId,
						createdAt: now,
						updatedAt: now,
					})
					.run();
				tx.insert(feedSnapshotDeliveries)
					.values({
						id: crypto.randomUUID(),
						snapshotId: reusableSnapshot.id,
						feedId: feed.id,
						availableAt: now,
						createdAt: now,
						updatedAt: now,
					})
					.run();
				return { feed, requestId, jobId: reusableSnapshot.jobId };
			}
			const job = enqueueOrAttachDurableJob(tx, source, 100, now);
			tx.insert(feedRefreshRequestItems)
				.values({
					id: crypto.randomUUID(),
					requestId,
					feedId: feed.id,
					sourceId: source.id,
					jobId: job.id,
					createdAt: now,
					updatedAt: now,
				})
				.run();
			return { feed, requestId, jobId: job.id };
		});
	}

	async requestReplacement(userId: string, feedId: string, inputUrl: string) {
		const feed = await this.feedRepository.findById(feedId, userId);
		if (!feed) throw AppError.notFound('Feed not found');
		const { source } = await this.ensureSource(inputUrl);
		if (source.id === feed.sourceId) return { feed, requestId: null, jobId: null };
		await this.assertTargetAvailable(userId, feedId, source.id, source.normalizedUrl);
		const request = await this.queueRefreshForFeeds(
			userId,
			[{ ...feed, sourceId: source.id, pendingSourceId: source.id }],
			{ feedId },
			`feed-replacement:${feedId}:${source.id}`,
			'feed_replacement',
			(tx, now) => {
				this.assertTargetAvailableInTransaction(
					tx,
					userId,
					feedId,
					source.id,
					source.normalizedUrl,
				);
				tx.update(feeds)
					.set({
						pendingSourceId: source.id,
						replacementRequestedAt: now,
						syncStatus: 'replacement_pending',
						lastSyncError: null,
						lastSyncErrorCode: null,
						lastSyncErrorAt: null,
						updatedAt: now,
					})
					.where(and(eq(feeds.id, feedId), eq(feeds.userId, userId)))
					.run();
			},
			'active',
		);
		const updated = await this.feedRepository.findById(feedId, userId);
		return { feed: updated!, requestId: request.requestId, jobId: request.jobIds[0] ?? null };
	}

	async cancelReplacement(userId: string, feedId: string) {
		return this.db.transaction((tx) => {
			const feed = tx
				.select()
				.from(feeds)
				.where(and(eq(feeds.id, feedId), eq(feeds.userId, userId)))
				.get();
			if (!feed?.sourceId) throw AppError.notFound('Feed not found');
			if (!feed.pendingSourceId) return feed;
			const now = new Date();
			const activeItems = tx
				.select({ id: feedRefreshRequestItems.id, requestId: feedRefreshRequestItems.requestId })
				.from(feedRefreshRequestItems)
				.innerJoin(
					feedRefreshRequests,
					eq(feedRefreshRequests.id, feedRefreshRequestItems.requestId),
				)
				.where(
					and(
						eq(feedRefreshRequestItems.feedId, feedId),
						eq(feedRefreshRequestItems.sourceId, feed.pendingSourceId),
						inArray(feedRefreshRequestItems.status, ['pending', 'running']),
						eq(feedRefreshRequests.scopeType, 'feed_replacement'),
						inArray(feedRefreshRequests.status, ['pending', 'running']),
					),
				)
				.all();
			if (activeItems.length > 0) {
				tx.update(feedRefreshRequestItems)
					.set({
						jobId: null,
						status: 'failed',
						completedAt: now,
						lastErrorCode: 'replacement_cancelled',
						lastErrorDetails: 'Replacement cancelled by user',
						updatedAt: now,
					})
					.where(
						inArray(
							feedRefreshRequestItems.id,
							activeItems.map((item) => item.id),
						),
					)
					.run();
				for (const requestId of new Set(activeItems.map((item) => item.requestId))) {
					tx.update(feedRefreshRequests)
						.set({
							idempotencyKey: null,
							status: 'completed_with_errors',
							pendingItems: 0,
							runningItems: 0,
							completedItems: 0,
							failedItems: 1,
							deadItems: 0,
							startedAt: now,
							completedAt: now,
							updatedAt: now,
						})
						.where(eq(feedRefreshRequests.id, requestId))
						.run();
				}
			}
			return tx
				.update(feeds)
				.set({
					pendingSourceId: null,
					replacementRequestedAt: null,
					syncStatus: 'idle',
					lastSyncError: null,
					lastSyncErrorCode: null,
					lastSyncErrorAt: null,
					updatedAt: now,
				})
				.where(and(eq(feeds.id, feedId), eq(feeds.userId, userId)))
				.returning()
				.get()!;
		});
	}

	async queueRefresh(userId: string, scope: RefreshScope, idempotencyKey?: string | null) {
		const selected = scope.feedId
			? [await this.feedRepository.findById(scope.feedId, userId)].filter(Boolean)
			: scope.categoryId
				? await this.feedRepository.findByCategory(userId, scope.categoryId)
				: await this.feedRepository.findAllByUser(userId);
		if (scope.feedId && selected.length === 0) throw AppError.notFound('Feed not found');
		if (scope.categoryId && !(await this.categoryRepository.findById(scope.categoryId, userId))) {
			throw AppError.notFound('Category not found');
		}
		const queued = await this.queueRefreshForFeeds(
			userId,
			selected as NonNullable<(typeof selected)[number]>[],
			scope,
			idempotencyKey ?? null,
			'manual',
		);
		return {
			accepted: true as const,
			alreadyQueued: queued.alreadyQueued,
			requestId: queued.requestId,
			jobId: queued.jobIds[0] ?? queued.requestId,
			jobIds: queued.jobIds,
			status: await this.getRefreshStatus(userId, queued.requestId),
		};
	}

	async getRefreshStatus(userId: string, requestId?: string | null) {
		return getDurableRefreshStatus(this.db, userId, requestId);
	}

	async listDiscoveryCandidates(userId: string, requestId: string) {
		return listDurableDiscoveryCandidates(this.db, userId, requestId);
	}

	async selectDiscoveryCandidate(userId: string, candidateId: string) {
		const candidate = await this.db.query.feedDiscoveryCandidates.findFirst({
			where: and(
				eq(feedDiscoveryCandidates.id, candidateId),
				eq(feedDiscoveryCandidates.userId, userId),
				eq(feedDiscoveryCandidates.status, 'pending'),
				sql`${feedDiscoveryCandidates.expiresAt} > unixepoch()`,
			),
		});
		if (!candidate) throw AppError.notFound('Discovery candidate not found or expired');
		const feedId = String(candidate.selectionMetadata?.feedId ?? '');
		const feed = await this.feedRepository.findById(feedId, userId);
		if (!feed) throw AppError.notFound('Feed not found');
		const { source } = await this.ensureSource(candidate.normalizedCandidateUrl);
		await this.assertTargetAvailable(userId, feedId, source.id, source.normalizedUrl);
		const queued = await this.queueRefreshForFeeds(
			userId,
			[{ ...feed, sourceId: source.id, pendingSourceId: source.id }],
			{ feedId },
			`discovery:${candidate.id}`,
			'discovery',
			(tx, now) => {
				this.assertTargetAvailableInTransaction(
					tx,
					userId,
					feedId,
					source.id,
					source.normalizedUrl,
				);
				tx.update(feedDiscoveryCandidates)
					.set({ status: 'ignored', updatedAt: now })
					.where(
						and(
							eq(feedDiscoveryCandidates.requestId, candidate.requestId),
							eq(feedDiscoveryCandidates.userId, userId),
						),
					)
					.run();
				tx.update(feedDiscoveryCandidates)
					.set({ status: 'selected', selectedAt: now, updatedAt: now })
					.where(eq(feedDiscoveryCandidates.id, candidate.id))
					.run();
				tx.update(feeds)
					.set({
						pendingSourceId: source.id,
						replacementRequestedAt: feed.sourceId ? now : feed.replacementRequestedAt,
						syncStatus: feed.sourceId ? 'replacement_pending' : 'pending',
						lastSyncError: null,
						lastSyncErrorCode: null,
						lastSyncErrorAt: null,
						updatedAt: now,
					})
					.where(and(eq(feeds.id, feedId), eq(feeds.userId, userId)))
					.run();
			},
		);
		return { candidateId, feedId, requestId: queued.requestId, jobId: queued.jobIds[0] ?? null };
	}

	async persistDiscoveryCandidates(input: {
		jobId: string;
		sourceId: string;
		finalUrl: string;
		candidates: Array<{ url: string; title: string | null; type: string }>;
		now: Date;
	}) {
		return persistDurableDiscoveryCandidates(this.db, input);
	}

	async cleanupDiscoveryCandidates(now = new Date()) {
		return cleanupDurableDiscoveryCandidates(this.db, now);
	}

	private async queueRefreshForFeeds(
		userId: string,
		selectedFeeds: Array<typeof feeds.$inferSelect>,
		scope: RefreshScope,
		idempotencyKey: string | null,
		scopeType: string,
		prepare?: (tx: RefreshTransaction, now: Date) => void,
		dedupeMode: 'any' | 'active' = 'any',
	) {
		return queueDurableRefresh(this.db, {
			userId,
			selectedFeeds,
			scope,
			idempotencyKey,
			scopeType,
			prepare,
			dedupeMode,
		});
	}

	private async assertTargetAvailable(
		userId: string,
		feedId: string,
		sourceId: string,
		normalizedUrl: string,
	) {
		const duplicate = await this.db.query.feeds.findFirst({
			where: and(
				eq(feeds.userId, userId),
				sql`${feeds.id} <> ${feedId}`,
				or(eq(feeds.feedUrl, normalizedUrl), eq(feeds.pendingSourceId, sourceId)),
			),
		});
		if (duplicate) throw AppError.conflict('You already have this feed or replacement pending');
	}

	private assertTargetAvailableInTransaction(
		tx: Parameters<Parameters<Database['transaction']>[0]>[0],
		userId: string,
		feedId: string,
		sourceId: string,
		normalizedUrl: string,
	) {
		const duplicate = tx
			.select({ id: feeds.id })
			.from(feeds)
			.where(
				and(
					eq(feeds.userId, userId),
					sql`${feeds.id} <> ${feedId}`,
					or(eq(feeds.feedUrl, normalizedUrl), eq(feeds.pendingSourceId, sourceId)),
				),
			)
			.get();
		if (duplicate) throw AppError.conflict('You already have this feed or replacement pending');
	}
}
