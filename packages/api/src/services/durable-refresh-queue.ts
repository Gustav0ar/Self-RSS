import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
	feedFetchJobs,
	feedRefreshRequestItems,
	feedRefreshRequests,
	feedSources,
	type feeds,
} from '../db/schema.js';

export type RefreshScope = { feedId?: string; categoryId?: string };
export type RefreshTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

interface QueueRefreshInput {
	userId: string;
	selectedFeeds: Array<typeof feeds.$inferSelect>;
	scope: RefreshScope;
	idempotencyKey: string | null;
	scopeType: string;
	dedupeMode?: 'any' | 'active';
	prepare?: (tx: RefreshTransaction, now: Date) => void;
}

function requestJobIds(tx: RefreshTransaction, requestId: string) {
	return tx
		.selectDistinct({ jobId: feedRefreshRequestItems.jobId })
		.from(feedRefreshRequestItems)
		.where(eq(feedRefreshRequestItems.requestId, requestId))
		.all()
		.flatMap((row) => (row.jobId ? [row.jobId] : []));
}

function existingResult(tx: RefreshTransaction, requestId: string) {
	return { requestId, jobIds: requestJobIds(tx, requestId), alreadyQueued: true };
}

export function enqueueOrAttachDurableJob(
	tx: RefreshTransaction,
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

export async function queueDurableRefresh(db: Database, input: QueueRefreshInput) {
	const dedupeMode = input.dedupeMode ?? 'any';
	if (input.idempotencyKey && dedupeMode === 'any') {
		const existing = await db.query.feedRefreshRequests.findFirst({
			where: and(
				eq(feedRefreshRequests.userId, input.userId),
				eq(feedRefreshRequests.idempotencyKey, input.idempotencyKey),
			),
		});
		if (existing) {
			const jobs = await db
				.selectDistinct({ jobId: feedRefreshRequestItems.jobId })
				.from(feedRefreshRequestItems)
				.where(eq(feedRefreshRequestItems.requestId, existing.id));
			return {
				requestId: existing.id,
				jobIds: jobs.flatMap((row) => (row.jobId ? [row.jobId] : [])),
				alreadyQueued: true,
			};
		}
	}

	const now = new Date();
	const requestId = crypto.randomUUID();
	return db.transaction((tx) => {
		if (input.idempotencyKey && dedupeMode === 'active') {
			const existing = tx
				.select()
				.from(feedRefreshRequests)
				.where(
					and(
						eq(feedRefreshRequests.userId, input.userId),
						eq(feedRefreshRequests.idempotencyKey, input.idempotencyKey),
					),
				)
				.get();
			if (existing && ['pending', 'running'].includes(existing.status)) {
				return existingResult(tx, existing.id);
			}
			if (existing) {
				tx.update(feedRefreshRequests)
					.set({ idempotencyKey: null, updatedAt: now })
					.where(eq(feedRefreshRequests.id, existing.id))
					.run();
			}
		}

		let createdRequest = tx
			.insert(feedRefreshRequests)
			.values({
				id: requestId,
				userId: input.userId,
				idempotencyKey: input.idempotencyKey,
				scopeType: input.scopeType,
				scopeFeedId: input.scope.feedId,
				scopeCategoryId: input.scope.categoryId,
				status: input.selectedFeeds.length === 0 ? 'completed' : 'pending',
				totalItems: input.selectedFeeds.length,
				pendingItems: input.selectedFeeds.length,
				completedAt: input.selectedFeeds.length === 0 ? now : null,
				requestedAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing()
			.returning()
			.get();
		if (!createdRequest) {
			const existing = input.idempotencyKey
				? tx
						.select()
						.from(feedRefreshRequests)
						.where(
							and(
								eq(feedRefreshRequests.userId, input.userId),
								eq(feedRefreshRequests.idempotencyKey, input.idempotencyKey),
							),
						)
						.get()
				: null;
			if (!existing) throw new Error('Refresh request conflict did not resolve');
			if (dedupeMode === 'any' || ['pending', 'running'].includes(existing.status)) {
				return existingResult(tx, existing.id);
			}
			tx.update(feedRefreshRequests)
				.set({ idempotencyKey: null, updatedAt: now })
				.where(eq(feedRefreshRequests.id, existing.id))
				.run();
			createdRequest = tx
				.insert(feedRefreshRequests)
				.values({
					id: requestId,
					userId: input.userId,
					idempotencyKey: input.idempotencyKey,
					scopeType: input.scopeType,
					scopeFeedId: input.scope.feedId,
					scopeCategoryId: input.scope.categoryId,
					status: input.selectedFeeds.length === 0 ? 'completed' : 'pending',
					totalItems: input.selectedFeeds.length,
					pendingItems: input.selectedFeeds.length,
					completedAt: input.selectedFeeds.length === 0 ? now : null,
					requestedAt: now,
					createdAt: now,
					updatedAt: now,
				})
				.returning()
				.get();
		}

		input.prepare?.(tx, now);
		const sourceIds = [
			...new Set(
				input.selectedFeeds
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
			jobs.set(source.id, enqueueOrAttachDurableJob(tx, source, 100, now));
		}
		if (input.selectedFeeds.length > 0) {
			tx.insert(feedRefreshRequestItems)
				.values(
					input.selectedFeeds.map((feed) => {
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
			requestId: createdRequest.id,
			jobIds: [...jobs.values()].map((job) => job.id),
			alreadyQueued: false,
		};
	});
}
