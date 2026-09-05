import {
	and,
	asc,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	ne,
	not,
	notInArray,
	or,
	type SQLWrapper,
	sql,
} from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
	feedFetchJobs,
	feedFetchSnapshots,
	feedOrigins,
	feedRefreshRequestItems,
	feedSnapshotDeliveries,
	feedSources,
} from '../db/schema.js';
import { aggregateRefreshRequests } from './refresh-request-aggregation.js';

type SourceUpdate = Partial<typeof feedSources.$inferInsert>;
type OriginUpdate = Partial<typeof feedOrigins.$inferInsert>;

function hasSourceSubscription(sourceId: SQLWrapper) {
	return sql`EXISTS (
		SELECT 1 FROM feeds subscription
		WHERE subscription.source_id = ${sourceId}
		OR subscription.pending_source_id = ${sourceId}
	)`;
}

export class FeedIngestionSourceWorkRepository {
	constructor(protected db: Database) {}
	async enqueueDueSources(limit: number, now = new Date(), positiveJitterSeconds = 0) {
		return this.db.transaction((tx) => {
			const boundedLimit = Math.max(0, Math.floor(limit));
			if (boundedLimit === 0) return [];
			const due = tx
				.select({ sourceId: feedSources.id, originId: feedSources.originId })
				.from(feedSources)
				.where(
					and(
						inArray(feedSources.state, ['active', 'paused']),
						lte(feedSources.nextFetchAt, now),
						hasSourceSubscription(feedSources.id),
						sql`NOT EXISTS (
							SELECT 1 FROM feed_fetch_jobs active
							WHERE active.source_id = ${feedSources.id}
							AND active.status IN ('queued', 'running')
						)`,
					),
				)
				.orderBy(asc(feedSources.nextFetchAt), asc(feedSources.id))
				.limit(boundedLimit)
				.all();
			if (due.length === 0) return [];
			const availableAt = new Date(
				now.getTime() + Math.max(0, Math.floor(positiveJitterSeconds)) * 1_000,
			);
			return tx
				.insert(feedFetchJobs)
				.values(
					due.map((source) => ({
						id: crypto.randomUUID(),
						kind: 'scheduled',
						sourceId: source.sourceId,
						originId: source.originId,
						availableAt,
						createdAt: now,
						updatedAt: now,
					})),
				)
				.onConflictDoNothing()
				.returning()
				.all();
		});
	}

	/**
	 * Claims publisher work under SQLite's write lock. Eligibility, expired-lease
	 * recovery, source/origin blocks, per-origin concurrency and the request-start
	 * gap are checked in the same transaction.
	 */
	async claimEligibleFetchJob(
		workerId: string,
		leaseSeconds: number,
		now = new Date(),
		originStartGapSeconds = 5,
	) {
		const result = await this.db.transaction((tx) => {
			const exhausted = tx
				.update(feedFetchJobs)
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
				.returning({ id: feedFetchJobs.id })
				.all();
			const expiredRequestIds =
				exhausted.length === 0
					? []
					: tx
							.selectDistinct({ requestId: feedRefreshRequestItems.requestId })
							.from(feedRefreshRequestItems)
							.where(
								inArray(
									feedRefreshRequestItems.jobId,
									exhausted.map((job) => job.id),
								),
							)
							.all()
							.map((item) => item.requestId);
			if (exhausted.length > 0) {
				tx.update(feedRefreshRequestItems)
					.set({ status: 'dead', completedAt: now, updatedAt: now })
					.where(
						inArray(
							feedRefreshRequestItems.jobId,
							exhausted.map((job) => job.id),
						),
					)
					.run();
			}
			expiredRequestIds.push(...this.retireUnsubscribedJobs(tx, now));

			const jobDue = or(
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
			const manualSourceDue = and(
				eq(feedFetchJobs.kind, 'manual'),
				or(
					isNull(feedSources.lastFetchAt),
					sql`${feedSources.lastFetchAt} + ${feedSources.minIntervalSeconds} <= ${Math.floor(now.getTime() / 1_000)}`,
				),
			);
			const scheduledSourceDue = and(
				ne(feedFetchJobs.kind, 'manual'),
				lte(feedSources.nextFetchAt, now),
			);
			const sourceDue = and(
				inArray(feedSources.state, ['active', 'paused']),
				or(manualSourceDue, scheduledSourceDue),
				or(isNull(feedSources.backoffUntil), lte(feedSources.backoffUntil, now)),
			);
			const originDue = and(
				or(isNull(feedOrigins.nextAllowedRequestAt), lte(feedOrigins.nextAllowedRequestAt, now)),
				or(isNull(feedOrigins.retryAfterUntil), lte(feedOrigins.retryAfterUntil, now)),
				or(isNull(feedOrigins.blockedUntil), lte(feedOrigins.blockedUntil, now)),
				or(
					isNull(feedOrigins.lastRequestAt),
					lte(
						feedOrigins.lastRequestAt,
						new Date(now.getTime() - Math.max(0, originStartGapSeconds) * 1_000),
					),
				),
			);
			const snapshotRecovery = and(
				isNotNull(feedFetchJobs.snapshotId),
				sql`EXISTS (
					SELECT 1 FROM feed_fetch_snapshots recoverable_snapshot
					WHERE recoverable_snapshot.id = ${feedFetchJobs.snapshotId}
					AND (
						recoverable_snapshot.parse_state = 'parsed'
						OR (
							recoverable_snapshot.parse_state IN ('pending', 'failed')
							AND recoverable_snapshot.raw_body IS NOT NULL
						)
					)
				)`,
			);
			const candidate = tx
				.select({ id: feedFetchJobs.id })
				.from(feedFetchJobs)
				.innerJoin(feedSources, eq(feedSources.id, feedFetchJobs.sourceId))
				.innerJoin(feedOrigins, eq(feedOrigins.id, feedFetchJobs.originId))
				.where(
					and(
						jobDue,
						hasSourceSubscription(feedSources.id),
						or(
							snapshotRecovery,
							and(
								sourceDue,
								originDue,
								sql`NOT EXISTS (
									SELECT 1 FROM feed_fetch_jobs running_origin
									WHERE running_origin.origin_id = ${feedFetchJobs.originId}
									AND running_origin.status = 'running'
									AND running_origin.snapshot_id IS NULL
									AND running_origin.lease_expires_at > ${Math.floor(now.getTime() / 1_000)}
								)`,
							),
						),
					),
				)
				.orderBy(
					desc(feedFetchJobs.priority),
					asc(feedFetchJobs.availableAt),
					asc(feedFetchJobs.createdAt),
					asc(feedFetchJobs.id),
				)
				.limit(1)
				.get();
			if (!candidate) return { claim: null, expiredRequestIds };

			const job = tx
				.update(feedFetchJobs)
				.set({
					status: 'running',
					leaseOwner: workerId,
					leaseExpiresAt: new Date(now.getTime() + Math.max(1, leaseSeconds) * 1_000),
					attempts: sql`${feedFetchJobs.attempts} + 1`,
					startedAt: now,
					updatedAt: now,
				})
				.where(and(eq(feedFetchJobs.id, candidate.id), jobDue))
				.returning()
				.get();
			if (!job) return { claim: null, expiredRequestIds };
			if (!job.snapshotId) {
				tx.update(feedOrigins)
					.set({
						lastRequestAt: now,
						nextAllowedRequestAt: new Date(
							now.getTime() + Math.max(0, originStartGapSeconds) * 1_000,
						),
						updatedAt: now,
					})
					.where(eq(feedOrigins.id, job.originId))
					.run();
			}
			const source = tx.select().from(feedSources).where(eq(feedSources.id, job.sourceId)).get()!;
			const origin = tx.select().from(feedOrigins).where(eq(feedOrigins.id, job.originId)).get()!;
			return { claim: { job, source, origin }, expiredRequestIds };
		});
		await aggregateRefreshRequests(this.db, result.expiredRequestIds, now);
		return result.claim;
	}

	/** Retire unclaimed work while preserving snapshots and live worker leases. */
	private retireUnsubscribedJobs(
		tx: Parameters<Parameters<Database['transaction']>[0]>[0],
		now: Date,
	) {
		const retired = tx
			.update(feedFetchJobs)
			.set({
				status: 'completed',
				completedAt: now,
				leaseOwner: null,
				leaseExpiresAt: null,
				lastErrorCode: 'no_subscribers',
				lastErrorDetails: 'No subscriptions reference this source',
				updatedAt: now,
			})
			.where(
				and(
					or(
						eq(feedFetchJobs.status, 'queued'),
						and(eq(feedFetchJobs.status, 'running'), lte(feedFetchJobs.leaseExpiresAt, now)),
					),
					not(hasSourceSubscription(feedFetchJobs.sourceId)),
				),
			)
			.returning({ id: feedFetchJobs.id })
			.all();
		if (retired.length === 0) return [];
		return tx
			.update(feedRefreshRequestItems)
			.set({
				status: 'failed',
				completedAt: now,
				lastErrorCode: 'no_subscribers',
				lastErrorDetails: 'No subscriptions reference this source',
				updatedAt: now,
			})
			.where(
				and(
					inArray(
						feedRefreshRequestItems.jobId,
						retired.map((job) => job.id),
					),
					inArray(feedRefreshRequestItems.status, ['pending', 'running']),
				),
			)
			.returning({ requestId: feedRefreshRequestItems.requestId })
			.all()
			.map((item) => item.requestId);
	}

	async renewFetchJob(jobId: string, workerId: string, leaseSeconds: number, now = new Date()) {
		return this.db
			.update(feedFetchJobs)
			.set({
				leaseExpiresAt: new Date(now.getTime() + Math.max(1, leaseSeconds) * 1_000),
				updatedAt: now,
			})
			.where(
				and(
					eq(feedFetchJobs.id, jobId),
					eq(feedFetchJobs.status, 'running'),
					eq(feedFetchJobs.leaseOwner, workerId),
				),
			)
			.returning()
			.get();
	}

	async recordUnconditionalFetchAttempt(jobId: string, workerId: string, now = new Date()) {
		return this.db.transaction((tx) => {
			const job = tx
				.select({ sourceId: feedFetchJobs.sourceId })
				.from(feedFetchJobs)
				.where(
					and(
						eq(feedFetchJobs.id, jobId),
						eq(feedFetchJobs.status, 'running'),
						eq(feedFetchJobs.leaseOwner, workerId),
					),
				)
				.get();
			if (!job) return null;
			return tx
				.update(feedSources)
				.set({ lastUnconditionalFetchAt: now, updatedAt: now })
				.where(eq(feedSources.id, job.sourceId))
				.returning()
				.get();
		});
	}

	async releaseFetchJob(jobId: string, workerId: string, now = new Date()) {
		return this.db.transaction((tx) => {
			const job = tx
				.select()
				.from(feedFetchJobs)
				.where(
					and(
						eq(feedFetchJobs.id, jobId),
						eq(feedFetchJobs.status, 'running'),
						eq(feedFetchJobs.leaseOwner, workerId),
					),
				)
				.get();
			if (!job) return null;
			return tx
				.update(feedFetchJobs)
				.set({
					status: 'queued',
					availableAt: job.snapshotId ? now : new Date(now.getTime() + 15 * 60 * 1_000),
					leaseOwner: null,
					leaseExpiresAt: null,
					attempts: sql`max(0, ${feedFetchJobs.attempts} - 1)`,
					updatedAt: now,
				})
				.where(eq(feedFetchJobs.id, jobId))
				.returning()
				.get();
		});
	}

	async finishFetchJob(
		jobId: string,
		workerId: string,
		data: {
			status: 'queued' | 'completed' | 'dead';
			completesWithoutDelivery?: boolean;
			availableAt?: Date;
			error?: { code: string; details?: string };
			source?: SourceUpdate;
			origin?: OriginUpdate;
		},
		now = new Date(),
	) {
		return this.db.transaction((tx) => {
			const job = tx
				.select()
				.from(feedFetchJobs)
				.where(
					and(
						eq(feedFetchJobs.id, jobId),
						eq(feedFetchJobs.status, 'running'),
						eq(feedFetchJobs.leaseOwner, workerId),
					),
				)
				.get();
			if (!job) return null;
			if (data.source) {
				tx.update(feedSources)
					.set({ ...data.source, updatedAt: now })
					.where(eq(feedSources.id, job.sourceId))
					.run();
			}
			if (data.origin) {
				tx.update(feedOrigins)
					.set({ ...data.origin, updatedAt: now })
					.where(eq(feedOrigins.id, job.originId))
					.run();
			}
			const terminal = data.status !== 'queued';
			const updated = tx
				.update(feedFetchJobs)
				.set({
					status: data.status,
					availableAt: data.availableAt ?? job.availableAt,
					leaseOwner: null,
					leaseExpiresAt: null,
					lastErrorCode: data.error?.code ?? null,
					lastErrorDetails: data.error?.details ?? null,
					completedAt: data.status === 'completed' ? now : null,
					deadAt: data.status === 'dead' ? now : null,
					updatedAt: now,
				})
				.where(eq(feedFetchJobs.id, jobId))
				.returning()
				.get();
			if (terminal) {
				if (data.status === 'dead') {
					tx.update(feedRefreshRequestItems)
						.set({ status: 'dead', completedAt: now, updatedAt: now })
						.where(eq(feedRefreshRequestItems.jobId, jobId))
						.run();
				} else {
					const deliveryFeedIds = job.snapshotId
						? tx
								.select({ feedId: feedSnapshotDeliveries.feedId })
								.from(feedSnapshotDeliveries)
								.where(eq(feedSnapshotDeliveries.snapshotId, job.snapshotId))
								.all()
								.map((delivery) => delivery.feedId)
						: [];
					tx.update(feedRefreshRequestItems)
						.set({ status: 'completed', completedAt: now, updatedAt: now })
						.where(
							and(
								eq(feedRefreshRequestItems.jobId, jobId),
								deliveryFeedIds.length > 0 && !data.completesWithoutDelivery
									? or(
											isNull(feedRefreshRequestItems.feedId),
											notInArray(feedRefreshRequestItems.feedId, deliveryFeedIds),
										)
									: undefined,
							),
						)
						.run();
					if (deliveryFeedIds.length > 0 && !data.completesWithoutDelivery) {
						tx.update(feedRefreshRequestItems)
							.set({ status: 'running', completedAt: null, updatedAt: now })
							.where(
								and(
									eq(feedRefreshRequestItems.jobId, jobId),
									inArray(feedRefreshRequestItems.feedId, deliveryFeedIds),
								),
							)
							.run();
					}
				}
			}
			return updated;
		});
	}

	async findFetchJobContext(jobId: string) {
		const job = await this.db.query.feedFetchJobs.findFirst({
			where: eq(feedFetchJobs.id, jobId),
		});
		if (!job) return null;
		const [source, origin, snapshot] = await Promise.all([
			this.db.query.feedSources.findFirst({ where: eq(feedSources.id, job.sourceId) }),
			this.db.query.feedOrigins.findFirst({ where: eq(feedOrigins.id, job.originId) }),
			job.snapshotId
				? this.db.query.feedFetchSnapshots.findFirst({
						where: eq(feedFetchSnapshots.id, job.snapshotId),
					})
				: Promise.resolve(undefined),
		]);
		return source && origin ? { job, source, origin, snapshot: snapshot ?? null } : null;
	}
}
