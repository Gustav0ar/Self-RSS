import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
	feedFetchJobs,
	feedOrigins,
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

export const MANUAL_REFRESH_REQUEST_MAX_AGE_MS = 5 * 60_000;

function manualRefreshDeferral(
	source: typeof feedSources.$inferSelect,
	origin: typeof feedOrigins.$inferSelect | undefined,
	now: Date,
) {
	const safetyWindowUntil = source.lastFetchAt
		? new Date(source.lastFetchAt.getTime() + source.minIntervalSeconds * 1_000)
		: null;
	const candidates = [
		safetyWindowUntil,
		source.backoffUntil,
		origin?.retryAfterUntil,
		origin?.blockedUntil,
	].filter((value): value is Date => value != null && value > now);
	if (candidates.length === 0) return null;
	const retryAt = candidates.reduce((latest, value) => (value > latest ? value : latest));
	return {
		code: 'manual_refresh_deferred',
		details: `Publisher request deferred until ${retryAt.toISOString()}`,
	};
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
		.set({
			kind: 'manual',
			priority: sql`max(${feedFetchJobs.priority}, ${priority})`,
			availableAt: active.availableAt > now ? now : active.availableAt,
			updatedAt: now,
		})
		.where(eq(feedFetchJobs.id, active.id))
		.run();
	return {
		...active,
		kind: 'manual',
		priority: Math.max(active.priority, priority),
		availableAt: active.availableAt > now ? now : active.availableAt,
	};
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
	return db.transaction(
		(tx) => {
			if (!input.idempotencyKey) {
				const existingActiveScope = tx
					.select({ id: feedRefreshRequests.id })
					.from(feedRefreshRequests)
					.where(
						and(
							eq(feedRefreshRequests.userId, input.userId),
							eq(feedRefreshRequests.scopeType, input.scopeType),
							input.scope.feedId
								? eq(feedRefreshRequests.scopeFeedId, input.scope.feedId)
								: isNull(feedRefreshRequests.scopeFeedId),
							input.scope.categoryId
								? eq(feedRefreshRequests.scopeCategoryId, input.scope.categoryId)
								: isNull(feedRefreshRequests.scopeCategoryId),
							inArray(feedRefreshRequests.status, ['pending', 'running']),
						),
					)
					.get();
				if (existingActiveScope) return existingResult(tx, existingActiveScope.id);
			}

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
			const origins =
				input.scopeType === 'manual' && sources.length > 0
					? tx
							.select()
							.from(feedOrigins)
							.where(
								inArray(feedOrigins.id, [...new Set(sources.map((source) => source.originId))]),
							)
							.all()
					: [];
			const originById = new Map(origins.map((origin) => [origin.id, origin]));
			const deferralBySourceId = new Map(
				input.scopeType === 'manual'
					? sources.flatMap((source) => {
							const deferral = manualRefreshDeferral(source, originById.get(source.originId), now);
							return deferral ? ([[source.id, deferral]] as const) : [];
						})
					: [],
			);
			const jobs = new Map<string, typeof feedFetchJobs.$inferSelect>();
			for (const source of sources) {
				if (deferralBySourceId.has(source.id)) continue;
				jobs.set(source.id, enqueueOrAttachDurableJob(tx, source, 100, now));
			}
			const itemValues = input.selectedFeeds.map((feed) => {
				const sourceId = feed.pendingSourceId ?? feed.sourceId;
				const sourceAvailable = sourceId != null && sourceById.has(sourceId);
				const deferral = sourceId ? deferralBySourceId.get(sourceId) : null;
				return {
					id: crypto.randomUUID(),
					requestId,
					feedId: feed.id,
					sourceId,
					jobId: sourceId ? jobs.get(sourceId)?.id : null,
					status: !sourceAvailable ? 'failed' : deferral ? 'completed' : 'pending',
					lastErrorCode: !sourceAvailable ? 'source_unavailable' : deferral?.code,
					lastErrorDetails: !sourceAvailable ? 'Feed has no source to refresh' : deferral?.details,
					completedAt: !sourceAvailable || deferral ? now : null,
					createdAt: now,
					updatedAt: now,
				};
			});
			if (input.selectedFeeds.length > 0) {
				tx.insert(feedRefreshRequestItems).values(itemValues).run();
			}
			const pendingItems = itemValues.filter((item) => item.status === 'pending').length;
			const completedItems = itemValues.filter((item) => item.status === 'completed').length;
			const failedItems = itemValues.filter((item) => item.status === 'failed').length;
			if (completedItems > 0 || failedItems > 0) {
				tx.update(feedRefreshRequests)
					.set({
						status:
							pendingItems > 0
								? 'pending'
								: failedItems > 0
									? 'completed_with_errors'
									: 'completed',
						pendingItems,
						completedItems,
						failedItems,
						startedAt: now,
						completedAt: pendingItems === 0 ? now : null,
						updatedAt: now,
					})
					.where(eq(feedRefreshRequests.id, requestId))
					.run();
			}
			return {
				requestId: createdRequest.id,
				jobIds: [...jobs.values()].map((job) => job.id),
				alreadyQueued: false,
			};
		},
		{ behavior: 'immediate' },
	);
}
