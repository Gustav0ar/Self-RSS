import { and, asc, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import {
	feedDiscoveryCandidates,
	feedFetchJobs,
	feedFetchSnapshots,
	feedRefreshRequests,
	feedSnapshotDeliveries,
} from '../db/schema.js';
import type {
	DurableIngestionCleanupResult,
	DurableIngestionOperationalSnapshot,
} from '../services/durable-ingestion-ops.types.js';
import { FeedIngestionDeliveryWorkRepository } from './feed-ingestion-delivery-work.repository.js';

export class FeedIngestionOperationsRepository extends FeedIngestionDeliveryWorkRepository {
	async getOperationalSnapshot(now = new Date()): Promise<DurableIngestionOperationalSnapshot> {
		const nowSeconds = Math.floor(now.getTime() / 1_000);
		const [row] = this.db.all(sql`
			SELECT
				(SELECT count(*) FROM feed_fetch_jobs WHERE status = 'queued') AS queuedFetchJobs,
				(SELECT count(*) FROM feed_fetch_jobs WHERE status = 'running') AS runningFetchJobs,
				(SELECT count(*) FROM feed_fetch_jobs WHERE status = 'dead') AS deadFetchJobs,
				(SELECT count(*) FROM feed_fetch_jobs WHERE status = 'queued' AND available_at <= ${nowSeconds}) AS dueFetchJobs,
				coalesce((SELECT max(0, ${nowSeconds} - min(available_at)) FROM feed_fetch_jobs WHERE status = 'queued' AND available_at <= ${nowSeconds}), 0) AS oldestDueFetchAge,
				coalesce((SELECT max(0, ${nowSeconds} - min(created_at)) FROM feed_fetch_jobs WHERE status = 'queued'), 0) AS oldestQueuedFetchAge,
				(SELECT count(*) FROM feed_fetch_snapshots WHERE parse_state IN ('pending', 'failed') AND raw_body IS NOT NULL) AS parseBacklog,
				(SELECT count(*) FROM feed_snapshot_deliveries WHERE status = 'pending') AS pendingDeliveries,
				(SELECT count(*) FROM feed_snapshot_deliveries WHERE status = 'running') AS runningDeliveries,
				(SELECT count(*) FROM feed_snapshot_deliveries WHERE status = 'dead') AS failedDeliveries,
				coalesce((SELECT max(0, ${nowSeconds} - min(available_at)) FROM feed_snapshot_deliveries WHERE status = 'pending' AND available_at <= ${nowSeconds}), 0) AS oldestDueDeliveryAge,
				(SELECT count(*) FROM feed_refresh_requests WHERE status IN ('pending', 'running')) AS activeRefreshRequests,
				(SELECT count(*) FROM feed_refresh_requests WHERE status = 'completed_with_errors') AS errorRefreshRequests,
				(SELECT count(*) FROM feed_sources WHERE state = 'active' AND (backoff_until IS NULL OR backoff_until <= ${nowSeconds})) AS activeSources,
				(SELECT count(*) FROM feed_sources WHERE state = 'active' AND backoff_until > ${nowSeconds}) AS backoffSources,
				(SELECT count(*) FROM feed_sources WHERE state = 'paused') AS pausedSources,
				(SELECT count(*) FROM feed_origins WHERE blocked_until > ${nowSeconds} OR retry_after_until > ${nowSeconds}) AS blockedOrigins,
				(SELECT count(*) FROM feed_origins WHERE circuit_state = 'open') AS openOrigins
		`) as Array<Record<string, number>>;
		return {
			fetchJobs: {
				queued: row?.queuedFetchJobs ?? 0,
				running: row?.runningFetchJobs ?? 0,
				dead: row?.deadFetchJobs ?? 0,
				due: row?.dueFetchJobs ?? 0,
				oldestDueAgeSeconds: row?.oldestDueFetchAge ?? 0,
				oldestQueuedAgeSeconds: row?.oldestQueuedFetchAge ?? 0,
			},
			parseBacklog: row?.parseBacklog ?? 0,
			deliveries: {
				pending: row?.pendingDeliveries ?? 0,
				running: row?.runningDeliveries ?? 0,
				failed: row?.failedDeliveries ?? 0,
				oldestDueAgeSeconds: row?.oldestDueDeliveryAge ?? 0,
			},
			refreshRequests: {
				active: row?.activeRefreshRequests ?? 0,
				error: row?.errorRefreshRequests ?? 0,
			},
			sources: {
				active: row?.activeSources ?? 0,
				backoff: row?.backoffSources ?? 0,
				paused: row?.pausedSources ?? 0,
			},
			origins: { blocked: row?.blockedOrigins ?? 0, circuitOpen: row?.openOrigins ?? 0 },
		};
	}

	async cleanupOperationalHistory(options: {
		now?: Date;
		retentionDays: number;
		batchSize: number;
	}): Promise<DurableIngestionCleanupResult> {
		const now = options.now ?? new Date();
		const cutoff = new Date(
			now.getTime() - Math.max(1, Math.floor(options.retentionDays)) * 24 * 60 * 60 * 1_000,
		);
		const batchSize = Math.max(1, Math.min(1_000, Math.floor(options.batchSize)));
		return this.db.transaction((tx) => {
			const expiringBodyIds = tx
				.select({ id: feedFetchSnapshots.id })
				.from(feedFetchSnapshots)
				.where(
					and(
						inArray(feedFetchSnapshots.parseState, ['pending', 'failed']),
						isNotNull(feedFetchSnapshots.rawBody),
						lte(feedFetchSnapshots.bodyExpiresAt, now),
					),
				)
				.orderBy(asc(feedFetchSnapshots.bodyExpiresAt), asc(feedFetchSnapshots.id))
				.limit(batchSize)
				.all()
				.map((row) => row.id);
			if (expiringBodyIds.length > 0) {
				tx.update(feedFetchSnapshots)
					.set({
						rawBody: null,
						rawBodyBytes: 0,
						parseState: 'expired',
						parseErrorCode: 'raw_body_expired',
						parseErrorDetails: 'Raw body expired before parsing completed',
						cleanupAfter: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
					})
					.where(inArray(feedFetchSnapshots.id, expiringBodyIds))
					.run();
			}

			const discoveryIds = tx
				.select({ id: feedDiscoveryCandidates.id })
				.from(feedDiscoveryCandidates)
				.where(lte(feedDiscoveryCandidates.expiresAt, now))
				.orderBy(asc(feedDiscoveryCandidates.expiresAt), asc(feedDiscoveryCandidates.id))
				.limit(batchSize)
				.all()
				.map((row) => row.id);
			if (discoveryIds.length > 0) {
				tx.delete(feedDiscoveryCandidates)
					.where(inArray(feedDiscoveryCandidates.id, discoveryIds))
					.run();
			}

			const refreshRequestIds = tx
				.select({ id: feedRefreshRequests.id })
				.from(feedRefreshRequests)
				.where(
					and(
						inArray(feedRefreshRequests.status, ['completed', 'completed_with_errors']),
						lte(feedRefreshRequests.completedAt, cutoff),
						sql`NOT EXISTS (
							SELECT 1 FROM feed_refresh_request_items active_item
							WHERE active_item.request_id = ${feedRefreshRequests.id}
							AND active_item.status IN ('pending', 'running')
						)`,
					),
				)
				.orderBy(asc(feedRefreshRequests.completedAt), asc(feedRefreshRequests.id))
				.limit(batchSize)
				.all()
				.map((row) => row.id);
			if (refreshRequestIds.length > 0) {
				tx.delete(feedRefreshRequests)
					.where(inArray(feedRefreshRequests.id, refreshRequestIds))
					.run();
			}

			const snapshotIds = tx
				.select({ id: feedFetchSnapshots.id })
				.from(feedFetchSnapshots)
				.where(
					and(
						inArray(feedFetchSnapshots.parseState, ['parsed', 'expired']),
						lte(feedFetchSnapshots.cleanupAfter, now),
						sql`(${feedFetchSnapshots.retainUntil} IS NULL OR ${feedFetchSnapshots.retainUntil} <= ${Math.floor(now.getTime() / 1_000)})`,
						sql`NOT EXISTS (
							SELECT 1 FROM feed_snapshot_deliveries retained_delivery
							WHERE retained_delivery.snapshot_id = ${feedFetchSnapshots.id}
							AND (
								retained_delivery.status IN ('pending', 'running')
								OR coalesce(retained_delivery.completed_at, retained_delivery.dead_at, retained_delivery.updated_at) > ${Math.floor(cutoff.getTime() / 1_000)}
							)
						)`,
					),
				)
				.orderBy(asc(feedFetchSnapshots.cleanupAfter), asc(feedFetchSnapshots.id))
				.limit(batchSize)
				.all()
				.map((row) => row.id);
			if (snapshotIds.length > 0) {
				tx.delete(feedFetchSnapshots).where(inArray(feedFetchSnapshots.id, snapshotIds)).run();
			}

			const deliveryIds = tx
				.select({ id: feedSnapshotDeliveries.id })
				.from(feedSnapshotDeliveries)
				.where(
					and(
						inArray(feedSnapshotDeliveries.status, ['completed', 'dead']),
						sql`coalesce(${feedSnapshotDeliveries.completedAt}, ${feedSnapshotDeliveries.deadAt}, ${feedSnapshotDeliveries.updatedAt}) <= ${Math.floor(cutoff.getTime() / 1_000)}`,
					),
				)
				.orderBy(asc(feedSnapshotDeliveries.updatedAt), asc(feedSnapshotDeliveries.id))
				.limit(batchSize)
				.all()
				.map((row) => row.id);
			if (deliveryIds.length > 0) {
				tx.delete(feedSnapshotDeliveries)
					.where(inArray(feedSnapshotDeliveries.id, deliveryIds))
					.run();
			}

			const fetchJobIds = tx
				.select({ id: feedFetchJobs.id })
				.from(feedFetchJobs)
				.where(
					and(
						inArray(feedFetchJobs.status, ['completed', 'dead']),
						sql`coalesce(${feedFetchJobs.completedAt}, ${feedFetchJobs.deadAt}, ${feedFetchJobs.updatedAt}) <= ${Math.floor(cutoff.getTime() / 1_000)}`,
						sql`NOT EXISTS (
							SELECT 1 FROM feed_refresh_request_items active_item
							WHERE active_item.job_id = ${feedFetchJobs.id}
							AND active_item.status IN ('pending', 'running')
						)`,
						sql`NOT EXISTS (
							SELECT 1 FROM feed_fetch_snapshots job_snapshot
							JOIN feed_snapshot_deliveries active_delivery
							ON active_delivery.snapshot_id = job_snapshot.id
							WHERE job_snapshot.job_id = ${feedFetchJobs.id}
							AND active_delivery.status IN ('pending', 'running')
						)`,
					),
				)
				.orderBy(asc(feedFetchJobs.updatedAt), asc(feedFetchJobs.id))
				.limit(batchSize)
				.all()
				.map((row) => row.id);
			if (fetchJobIds.length > 0) {
				tx.delete(feedFetchJobs).where(inArray(feedFetchJobs.id, fetchJobIds)).run();
			}

			return {
				expiredSnapshotBodies: expiringBodyIds.length,
				refreshRequests: refreshRequestIds.length,
				fetchJobs: fetchJobIds.length,
				deliveries: deliveryIds.length,
				snapshots: snapshotIds.length,
				discoveryCandidates: discoveryIds.length,
			};
		});
	}
}
