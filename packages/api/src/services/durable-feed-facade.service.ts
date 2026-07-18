import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
	feedDiscoveryCandidates,
	feedFetchJobs,
	feedRefreshRequestItems,
	feedRefreshRequests,
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
import { getDurableRefreshStatus } from './durable-refresh-status.js';

type RefreshScope = { feedId?: string; categoryId?: string };

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
			const feed = tx
				.insert(feeds)
				.values({
					id: crypto.randomUUID(),
					userId,
					categoryId: data.categoryId,
					title,
					customTitle: data.title?.trim() || null,
					feedUrl: source.normalizedUrl,
					sourceId: null,
					pendingSourceId: source.id,
					syncStatus: 'pending',
					nextSyncAt: now,
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
			const job = this.enqueueOrAttachInTransaction(tx, source, 100, now);
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
		);
		const updated = await this.feedRepository.findById(feedId, userId);
		return { feed: updated!, requestId: request.requestId, jobId: request.jobIds[0] ?? null };
	}

	async cancelReplacement(userId: string, feedId: string) {
		const updated = await this.db
			.update(feeds)
			.set({
				pendingSourceId: null,
				replacementRequestedAt: null,
				syncStatus: 'idle',
				lastSyncError: null,
				lastSyncErrorCode: null,
				lastSyncErrorAt: null,
				updatedAt: new Date(),
			})
			.where(
				and(eq(feeds.id, feedId), eq(feeds.userId, userId), sql`${feeds.sourceId} IS NOT NULL`),
			)
			.returning()
			.get();
		if (!updated) throw AppError.notFound('Feed not found');
		return updated;
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
		return getDurableRefreshStatus(this.db, this.ingestionRepository, userId, requestId);
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
		prepare?: (tx: Parameters<Parameters<Database['transaction']>[0]>[0], now: Date) => void,
	) {
		if (idempotencyKey) {
			const existing = await this.db.query.feedRefreshRequests.findFirst({
				where: and(
					eq(feedRefreshRequests.userId, userId),
					eq(feedRefreshRequests.idempotencyKey, idempotencyKey),
				),
			});
			if (existing) {
				const jobs = await this.db
					.selectDistinct({ jobId: feedRefreshRequestItems.jobId })
					.from(feedRefreshRequestItems)
					.where(eq(feedRefreshRequestItems.requestId, existing.id));
				return {
					requestId: existing.id,
					jobIds: jobs.flatMap((job) => (job.jobId ? [job.jobId] : [])),
					alreadyQueued: true,
				};
			}
		}
		const now = new Date();
		const requestId = crypto.randomUUID();
		return this.db.transaction((tx) => {
			const createdRequest = tx
				.insert(feedRefreshRequests)
				.values({
					id: requestId,
					userId,
					idempotencyKey,
					scopeType,
					scopeFeedId: scope.feedId,
					scopeCategoryId: scope.categoryId,
					status: selectedFeeds.length === 0 ? 'completed' : 'pending',
					totalItems: selectedFeeds.length,
					pendingItems: selectedFeeds.length,
					completedAt: selectedFeeds.length === 0 ? now : null,
					requestedAt: now,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoNothing()
				.returning()
				.get();
			if (!createdRequest) {
				const existing = idempotencyKey
					? tx
							.select()
							.from(feedRefreshRequests)
							.where(
								and(
									eq(feedRefreshRequests.userId, userId),
									eq(feedRefreshRequests.idempotencyKey, idempotencyKey),
								),
							)
							.get()
					: null;
				if (!existing) throw new Error('Refresh request conflict did not resolve');
				const existingJobs = tx
					.selectDistinct({ jobId: feedRefreshRequestItems.jobId })
					.from(feedRefreshRequestItems)
					.where(eq(feedRefreshRequestItems.requestId, existing.id))
					.all();
				return {
					requestId: existing.id,
					jobIds: existingJobs.flatMap((job) => (job.jobId ? [job.jobId] : [])),
					alreadyQueued: true,
				};
			}
			prepare?.(tx, now);
			const sourceIds = [
				...new Set(
					selectedFeeds
						.map((feed) => feed.pendingSourceId ?? feed.sourceId)
						.filter((id): id is string => Boolean(id)),
				),
			];
			const sources = sourceIds.length
				? tx.select().from(feedSources).where(inArray(feedSources.id, sourceIds)).all()
				: [];
			const sourceById = new Map(sources.map((source) => [source.id, source]));
			const jobs = new Map<string, typeof feedFetchJobs.$inferSelect>();
			for (const source of sources) {
				jobs.set(source.id, this.enqueueOrAttachInTransaction(tx, source, 100, now));
			}
			if (selectedFeeds.length > 0) {
				tx.insert(feedRefreshRequestItems)
					.values(
						selectedFeeds.map((feed) => {
							const sourceId = feed.pendingSourceId ?? feed.sourceId;
							return {
								id: crypto.randomUUID(),
								requestId,
								feedId: feed.id,
								sourceId,
								jobId: sourceId ? jobs.get(sourceId)?.id : null,
								status: sourceId && sourceById.has(sourceId) ? 'pending' : 'failed',
								lastErrorCode: sourceId ? null : 'source_unavailable',
								lastErrorDetails: sourceId ? null : 'Feed has no source to refresh',
								completedAt: sourceId ? null : now,
								createdAt: now,
								updatedAt: now,
							};
						}),
					)
					.run();
			}
			return {
				requestId,
				jobIds: [...jobs.values()].map((job) => job.id),
				alreadyQueued: false,
			};
		});
	}

	private enqueueOrAttachInTransaction(
		tx: Parameters<Parameters<Database['transaction']>[0]>[0],
		source: typeof feedSources.$inferSelect,
		priority: number,
		now: Date,
	) {
		const created = tx
			.insert(feedFetchJobs)
			.values({
				id: crypto.randomUUID(),
				kind: 'manual',
				priority,
				sourceId: source.id,
				originId: source.originId,
				refreshRequestId: null,
				availableAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing()
			.returning()
			.get();
		if (created) return created;
		const active = tx
			.select()
			.from(feedFetchJobs)
			.where(
				and(
					eq(feedFetchJobs.sourceId, source.id),
					inArray(feedFetchJobs.status, ['queued', 'running']),
				),
			)
			.get();
		if (!active) throw new Error('Active source job disappeared during refresh attachment');
		tx.update(feedFetchJobs)
			.set({ priority: sql`max(${feedFetchJobs.priority}, ${priority})`, updatedAt: now })
			.where(eq(feedFetchJobs.id, active.id))
			.run();
		return { ...active, priority: Math.max(active.priority, priority) };
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
