import { and, asc, desc, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
	feedFetchJobs,
	feedFetchSnapshots,
	feedOrigins,
	feedRefreshRequestItems,
	feedRefreshRequests,
	feedSnapshotDeliveries,
	feedSources,
} from '../db/schema.js';

type OriginInsert = typeof feedOrigins.$inferInsert;
type SourceInsert = typeof feedSources.$inferInsert;
type JobInsert = typeof feedFetchJobs.$inferInsert;
type SnapshotInsert = typeof feedFetchSnapshots.$inferInsert;
type DeliveryInsert = typeof feedSnapshotDeliveries.$inferInsert;

export interface RefreshRequestItemInput {
	feedId: string;
	sourceId: string | null;
	jobId?: string | null;
}

export class FeedIngestionRepository {
	constructor(private db: Database) {}

	async upsertOrigin(data: OriginInsert) {
		const now = new Date();
		const [origin] = await this.db
			.insert(feedOrigins)
			.values({ ...data, updatedAt: now })
			.onConflictDoUpdate({
				target: [feedOrigins.scheme, feedOrigins.host, feedOrigins.port],
				set: {
					updatedAt: now,
					lastRequestAt: data.lastRequestAt,
					nextAllowedRequestAt: data.nextAllowedRequestAt,
					retryAfterUntil: data.retryAfterUntil,
					blockedUntil: data.blockedUntil,
					blockReason: data.blockReason,
					circuitState: data.circuitState,
					circuitOpenedAt: data.circuitOpenedAt,
					consecutiveFailureCount: data.consecutiveFailureCount,
					lastFailureAt: data.lastFailureAt,
					lastSuccessAt: data.lastSuccessAt,
				},
			})
			.returning();
		return origin!;
	}

	async upsertSource(data: SourceInsert) {
		const now = new Date();
		const [source] = await this.db
			.insert(feedSources)
			.values({ ...data, minIntervalSeconds: Math.max(900, data.minIntervalSeconds ?? 900) })
			.onConflictDoUpdate({
				target: feedSources.normalizedUrl,
				set: {
					requestedUrl: data.requestedUrl,
					resolvedUrl: data.resolvedUrl,
					originId: data.originId,
					minIntervalSeconds: Math.max(900, data.minIntervalSeconds ?? 900),
					updatedAt: now,
				},
			})
			.returning();
		return source!;
	}

	/**
	 * Enqueues at most one queued/running job for a source. The partial
	 * unique index is the final concurrency guard; the fallback lookup makes a
	 * duplicate enqueue idempotent for callers.
	 */
	async enqueueJob(data: JobInsert) {
		const [created] = await this.db
			.insert(feedFetchJobs)
			.values(data)
			.onConflictDoNothing()
			.returning();
		if (created) return { job: created, created: true };

		const active = await this.db.query.feedFetchJobs.findFirst({
			where: and(
				eq(feedFetchJobs.sourceId, data.sourceId),
				inArray(feedFetchJobs.status, ['queued', 'running']),
			),
		});
		if (!active) {
			throw new Error('Feed fetch job conflicted without active work for the source');
		}
		return { job: active, created: false };
	}

	/**
	 * Claims one due job inside a write transaction. Expired running leases are
	 * eligible alongside queued jobs, while exhausted expired work is marked dead.
	 */
	async claimNextJob(workerId: string, leaseSeconds: number, now = new Date()) {
		return this.db.transaction((tx) => {
			tx.update(feedFetchJobs)
				.set({
					status: 'dead',
					deadAt: now,
					leaseOwner: null,
					leaseExpiresAt: null,
					updatedAt: now,
				})
				.where(
					and(
						eq(feedFetchJobs.status, 'running'),
						lte(feedFetchJobs.leaseExpiresAt, now),
						gte(feedFetchJobs.attempts, feedFetchJobs.maxAttempts),
					),
				)
				.run();

			const eligibility = or(
				and(
					eq(feedFetchJobs.status, 'queued'),
					lte(feedFetchJobs.availableAt, now),
					lt(feedFetchJobs.attempts, feedFetchJobs.maxAttempts),
				),
				and(
					eq(feedFetchJobs.status, 'running'),
					lte(feedFetchJobs.leaseExpiresAt, now),
					lt(feedFetchJobs.attempts, feedFetchJobs.maxAttempts),
				),
			);
			const candidate = tx
				.select({ id: feedFetchJobs.id })
				.from(feedFetchJobs)
				.where(eligibility)
				.orderBy(
					desc(feedFetchJobs.priority),
					asc(feedFetchJobs.availableAt),
					asc(feedFetchJobs.createdAt),
					asc(feedFetchJobs.id),
				)
				.limit(1)
				.get();
			if (!candidate) return null;

			return tx
				.update(feedFetchJobs)
				.set({
					status: 'running',
					leaseOwner: workerId,
					leaseExpiresAt: new Date(now.getTime() + Math.max(1, leaseSeconds) * 1_000),
					attempts: sql`${feedFetchJobs.attempts} + 1`,
					startedAt: now,
					updatedAt: now,
				})
				.where(and(eq(feedFetchJobs.id, candidate.id), eligibility))
				.returning()
				.get();
		});
	}

	async createSnapshot(data: SnapshotInsert) {
		return this.db.transaction((tx) => {
			const created = tx
				.insert(feedFetchSnapshots)
				.values(data)
				.onConflictDoNothing()
				.returning()
				.get();
			const snapshot =
				created ??
				(data.jobId
					? tx.query.feedFetchSnapshots.findFirst({
							where: eq(feedFetchSnapshots.jobId, data.jobId),
						})
					: undefined);
			if (!snapshot) throw new Error('Snapshot conflicted without a matching job snapshot');
			if (data.jobId) {
				tx.update(feedFetchJobs)
					.set({ snapshotId: snapshot.id, updatedAt: new Date() })
					.where(eq(feedFetchJobs.id, data.jobId))
					.run();
			}
			return snapshot;
		});
	}

	async createSnapshotDelivery(data: DeliveryInsert) {
		const [created] = await this.db
			.insert(feedSnapshotDeliveries)
			.values(data)
			.onConflictDoNothing()
			.returning();
		if (created) return { delivery: created, created: true };
		const existing = await this.db.query.feedSnapshotDeliveries.findFirst({
			where: and(
				eq(feedSnapshotDeliveries.snapshotId, data.snapshotId),
				eq(feedSnapshotDeliveries.feedId, data.feedId),
			),
		});
		if (!existing) throw new Error('Snapshot delivery conflict did not resolve to an existing row');
		return { delivery: existing, created: false };
	}

	async createRefreshRequest(
		data: Omit<typeof feedRefreshRequests.$inferInsert, 'totalItems' | 'pendingItems'>,
		items: RefreshRequestItemInput[],
	) {
		return this.db.transaction((tx) => {
			const now = new Date();
			const request = tx
				.insert(feedRefreshRequests)
				.values({ ...data, totalItems: items.length, pendingItems: items.length })
				.returning()
				.get();
			if (items.length > 0) {
				tx.insert(feedRefreshRequestItems)
					.values(
						items.map((item) => ({
							id: crypto.randomUUID(),
							requestId: request.id,
							feedId: item.feedId,
							sourceId: item.sourceId,
							jobId: item.jobId,
							createdAt: now,
							updatedAt: now,
						})),
					)
					.run();
			}
			return request;
		});
	}

	async aggregateRefreshRequest(requestId: string, now = new Date()) {
		return this.db.transaction((tx) => {
			const grouped = tx
				.select({ status: feedRefreshRequestItems.status, count: sql<number>`count(*)` })
				.from(feedRefreshRequestItems)
				.where(eq(feedRefreshRequestItems.requestId, requestId))
				.groupBy(feedRefreshRequestItems.status)
				.all();
			const counts = new Map(grouped.map((row) => [row.status, Number(row.count)]));
			const pendingItems = counts.get('pending') ?? 0;
			const runningItems = counts.get('running') ?? 0;
			const completedItems = counts.get('completed') ?? 0;
			const failedItems = counts.get('failed') ?? 0;
			const deadItems = counts.get('dead') ?? 0;
			const totalItems = [...counts.values()].reduce((total, count) => total + count, 0);
			const terminalItems = completedItems + failedItems + deadItems;
			const status =
				totalItems > 0 && terminalItems === totalItems
					? failedItems + deadItems > 0
						? 'completed_with_errors'
						: 'completed'
					: runningItems > 0
						? 'running'
						: 'pending';

			return tx
				.update(feedRefreshRequests)
				.set({
					status,
					totalItems,
					pendingItems,
					runningItems,
					completedItems,
					failedItems,
					deadItems,
					startedAt: runningItems > 0 || terminalItems > 0 ? now : undefined,
					completedAt: terminalItems === totalItems && totalItems > 0 ? now : null,
					updatedAt: now,
				})
				.where(eq(feedRefreshRequests.id, requestId))
				.returning()
				.get();
		});
	}

	async updateRefreshItemStatus(
		itemId: string,
		status: 'pending' | 'running' | 'completed' | 'failed' | 'dead',
		error?: { code: string; details?: string },
	) {
		const now = new Date();
		const [item] = await this.db
			.update(feedRefreshRequestItems)
			.set({
				status,
				startedAt: status === 'running' ? now : undefined,
				completedAt: ['completed', 'failed', 'dead'].includes(status) ? now : null,
				attempts:
					status === 'running'
						? sql`${feedRefreshRequestItems.attempts} + 1`
						: feedRefreshRequestItems.attempts,
				lastErrorCode: error?.code,
				lastErrorDetails: error?.details,
				updatedAt: now,
			})
			.where(eq(feedRefreshRequestItems.id, itemId))
			.returning();
		return item;
	}
}
