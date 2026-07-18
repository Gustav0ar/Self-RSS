import { and, asc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import {
	feedFetchSnapshots,
	feedRefreshRequestItems,
	feedSnapshotDeliveries,
	feedSources,
	feeds,
} from '../db/schema.js';
import { FeedIngestionSourceWorkRepository } from './feed-ingestion-source-work.repository.js';
import { aggregateRefreshRequests } from './refresh-request-aggregation.js';

export class FeedIngestionDeliveryWorkRepository extends FeedIngestionSourceWorkRepository {
	async claimNextDelivery(workerId: string, leaseSeconds: number, now = new Date()) {
		const result = await this.db.transaction((tx) => {
			const exhausted = tx
				.update(feedSnapshotDeliveries)
				.set({
					status: 'dead',
					deadAt: now,
					leaseOwner: null,
					leaseExpiresAt: null,
					updatedAt: now,
				})
				.where(
					and(
						eq(feedSnapshotDeliveries.status, 'running'),
						lte(feedSnapshotDeliveries.leaseExpiresAt, now),
						gte(feedSnapshotDeliveries.attempts, feedSnapshotDeliveries.maxAttempts),
					),
				)
				.returning({
					id: feedSnapshotDeliveries.id,
					snapshotId: feedSnapshotDeliveries.snapshotId,
					feedId: feedSnapshotDeliveries.feedId,
				})
				.all();
			const expiredRequestIds: string[] = [];
			for (const delivery of exhausted) {
				const snapshot = tx
					.select({ jobId: feedFetchSnapshots.jobId })
					.from(feedFetchSnapshots)
					.where(eq(feedFetchSnapshots.id, delivery.snapshotId))
					.get();
				if (!snapshot?.jobId) continue;
				expiredRequestIds.push(
					...tx
						.select({ requestId: feedRefreshRequestItems.requestId })
						.from(feedRefreshRequestItems)
						.where(
							and(
								eq(feedRefreshRequestItems.jobId, snapshot.jobId),
								eq(feedRefreshRequestItems.feedId, delivery.feedId),
							),
						)
						.all()
						.map((item) => item.requestId),
				);
				tx.update(feedRefreshRequestItems)
					.set({ status: 'dead', completedAt: now, updatedAt: now })
					.where(
						and(
							eq(feedRefreshRequestItems.jobId, snapshot.jobId),
							eq(feedRefreshRequestItems.feedId, delivery.feedId),
						),
					)
					.run();
			}
			const eligible = or(
				and(
					eq(feedSnapshotDeliveries.status, 'pending'),
					lte(feedSnapshotDeliveries.availableAt, now),
					lt(feedSnapshotDeliveries.attempts, feedSnapshotDeliveries.maxAttempts),
				),
				and(
					eq(feedSnapshotDeliveries.status, 'running'),
					lte(feedSnapshotDeliveries.leaseExpiresAt, now),
					lt(feedSnapshotDeliveries.attempts, feedSnapshotDeliveries.maxAttempts),
				),
			);
			const candidate = tx
				.select({ id: feedSnapshotDeliveries.id })
				.from(feedSnapshotDeliveries)
				.where(eligible)
				.orderBy(asc(feedSnapshotDeliveries.availableAt), asc(feedSnapshotDeliveries.createdAt))
				.limit(1)
				.get();
			if (!candidate) return { delivery: null, expiredRequestIds };
			const delivery = tx
				.update(feedSnapshotDeliveries)
				.set({
					status: 'running',
					leaseOwner: workerId,
					leaseExpiresAt: new Date(now.getTime() + Math.max(1, leaseSeconds) * 1_000),
					attempts: sql`${feedSnapshotDeliveries.attempts} + 1`,
					startedAt: now,
					updatedAt: now,
				})
				.where(and(eq(feedSnapshotDeliveries.id, candidate.id), eligible))
				.returning()
				.get();
			return { delivery, expiredRequestIds };
		});
		await aggregateRefreshRequests(this.db, result.expiredRequestIds, now);
		return result.delivery;
	}

	async renewDelivery(
		deliveryId: string,
		workerId: string,
		leaseSeconds: number,
		now = new Date(),
	) {
		return this.db
			.update(feedSnapshotDeliveries)
			.set({
				leaseExpiresAt: new Date(now.getTime() + Math.max(1, leaseSeconds) * 1_000),
				updatedAt: now,
			})
			.where(
				and(
					eq(feedSnapshotDeliveries.id, deliveryId),
					eq(feedSnapshotDeliveries.status, 'running'),
					eq(feedSnapshotDeliveries.leaseOwner, workerId),
				),
			)
			.returning()
			.get();
	}

	async finishDelivery(
		deliveryId: string,
		workerId: string,
		data: {
			status: 'pending' | 'completed' | 'dead';
			availableAt?: Date;
			error?: { code: string; details?: string };
		},
		now = new Date(),
	) {
		return this.db.transaction((tx) => {
			const delivery = tx
				.select()
				.from(feedSnapshotDeliveries)
				.where(
					and(
						eq(feedSnapshotDeliveries.id, deliveryId),
						eq(feedSnapshotDeliveries.status, 'running'),
						eq(feedSnapshotDeliveries.leaseOwner, workerId),
					),
				)
				.get();
			if (!delivery) return null;
			const updated = tx
				.update(feedSnapshotDeliveries)
				.set({
					status: data.status,
					availableAt: data.availableAt ?? delivery.availableAt,
					leaseOwner: null,
					leaseExpiresAt: null,
					lastErrorCode: data.error?.code ?? null,
					lastErrorDetails: data.error?.details ?? null,
					completedAt: data.status === 'completed' ? now : null,
					deadAt: data.status === 'dead' ? now : null,
					updatedAt: now,
				})
				.where(eq(feedSnapshotDeliveries.id, deliveryId))
				.returning()
				.get();
			const snapshot = tx
				.select({ jobId: feedFetchSnapshots.jobId })
				.from(feedFetchSnapshots)
				.where(eq(feedFetchSnapshots.id, delivery.snapshotId))
				.get();
			let requestIds: string[] = [];
			if (snapshot?.jobId && data.status !== 'pending') {
				requestIds = tx
					.select({ requestId: feedRefreshRequestItems.requestId })
					.from(feedRefreshRequestItems)
					.where(
						and(
							eq(feedRefreshRequestItems.jobId, snapshot.jobId),
							eq(feedRefreshRequestItems.feedId, delivery.feedId),
						),
					)
					.all()
					.map((item) => item.requestId);
				tx.update(feedRefreshRequestItems)
					.set({
						status: data.status === 'completed' ? 'completed' : 'dead',
						completedAt: now,
						lastErrorCode: data.error?.code,
						lastErrorDetails: data.error?.details,
						updatedAt: now,
					})
					.where(
						and(
							eq(feedRefreshRequestItems.jobId, snapshot.jobId),
							eq(feedRefreshRequestItems.feedId, delivery.feedId),
						),
					)
					.run();
			}
			return { delivery: updated, requestIds };
		});
	}

	async updateFeedFromSource(feedId: string, sourceId: string, now = new Date()) {
		return this.db.transaction((tx) => {
			const source = tx.select().from(feedSources).where(eq(feedSources.id, sourceId)).get();
			if (!source) return null;
			return tx
				.update(feeds)
				.set({
					title: sql`coalesce(${feeds.customTitle}, ${source.title}, ${feeds.title})`,
					siteUrl: source.siteUrl,
					faviconUrl: source.imageUrl,
					description: source.description,
					lastSyncedAt: source.lastSuccessAt ?? now,
					lastSyncError: source.lastErrorDetails,
					lastSyncErrorCode: source.lastErrorCode,
					lastSyncErrorAt: source.lastErrorCode ? now : null,
					nextSyncAt: source.nextFetchAt,
					syncStatus: source.lastErrorCode ? 'error' : 'idle',
					updatedAt: now,
				})
				.where(and(eq(feeds.id, feedId), eq(feeds.sourceId, sourceId)))
				.returning()
				.get();
		});
	}

	async findDeliveryContext(deliveryId: string) {
		const delivery = await this.db.query.feedSnapshotDeliveries.findFirst({
			where: eq(feedSnapshotDeliveries.id, deliveryId),
		});
		if (!delivery) return null;
		const [snapshot, feed] = await Promise.all([
			this.db.query.feedFetchSnapshots.findFirst({
				where: eq(feedFetchSnapshots.id, delivery.snapshotId),
			}),
			this.db.query.feeds.findFirst({ where: eq(feeds.id, delivery.feedId) }),
		]);
		if (!snapshot || !feed) return null;
		const source = await this.db.query.feedSources.findFirst({
			where: eq(feedSources.id, snapshot.sourceId),
		});
		return source ? { delivery, snapshot, feed, source } : null;
	}

	async findSubscriptionsForSource(sourceId: string) {
		return this.db.select().from(feeds).where(eq(feeds.sourceId, sourceId));
	}

	async findSnapshotNormalizedPayload(snapshotId: string) {
		return this.db
			.select({ normalizedPayload: feedFetchSnapshots.normalizedPayload })
			.from(feedFetchSnapshots)
			.where(eq(feedFetchSnapshots.id, snapshotId))
			.get()?.normalizedPayload;
	}

	async linkRefreshItemsToJob(sourceId: string, jobId: string, now = new Date()) {
		return this.db
			.update(feedRefreshRequestItems)
			.set({ jobId, updatedAt: now })
			.where(
				and(
					eq(feedRefreshRequestItems.sourceId, sourceId),
					isNull(feedRefreshRequestItems.jobId),
					inArray(feedRefreshRequestItems.status, ['pending', 'running']),
				),
			)
			.returning();
	}
}
