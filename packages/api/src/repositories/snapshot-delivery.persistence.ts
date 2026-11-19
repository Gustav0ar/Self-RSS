import { and, eq, gt, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { feedFetchSnapshots, feedSnapshotDeliveries, feeds } from '../db/schema.js';

export interface SnapshotDeliveryClaim {
	deliveryId: string;
	workerId: string;
	now: Date;
}

export class SnapshotDeliveryRejectedError extends Error {
	constructor(readonly reason: 'lease_lost' | 'source_replaced') {
		super(`Snapshot delivery rejected: ${reason}`);
	}
}

/** Must run inside the transaction that writes the snapshot's article results. */
export function assertCurrentSnapshotDelivery(
	tx: Parameters<Parameters<Database['transaction']>[0]>[0],
	claim: SnapshotDeliveryClaim,
) {
	const delivery = tx
		.select({
			id: feedSnapshotDeliveries.id,
			feedId: feeds.id,
			startedAt: feedSnapshotDeliveries.startedAt,
			httpStatus: feedFetchSnapshots.httpStatus,
			// A recovered older delivery can still contribute missing GUIDs. Once a
			// newer snapshot has committed, it must leave existing articles alone.
			newerSnapshotApplied: sql<number>`EXISTS (
				SELECT 1 FROM feed_fetch_snapshots newer
				JOIN feed_snapshot_deliveries applied ON applied.snapshot_id = newer.id AND applied.feed_id = ${feeds.id}
				JOIN sync_runs run ON run.id = applied.id AND run.status = 'success'
				WHERE newer.source_id = ${feedFetchSnapshots.sourceId}
					AND (newer.fetched_at, newer.rowid) > (${feedFetchSnapshots.fetchedAt}, ${feedFetchSnapshots}.rowid)
			)`,
			sourceId: feeds.sourceId,
			snapshotSourceId: feedFetchSnapshots.sourceId,
		})
		.from(feedSnapshotDeliveries)
		.innerJoin(feedFetchSnapshots, eq(feedFetchSnapshots.id, feedSnapshotDeliveries.snapshotId))
		.innerJoin(feeds, eq(feeds.id, feedSnapshotDeliveries.feedId))
		.where(
			and(
				eq(feedSnapshotDeliveries.id, claim.deliveryId),
				eq(feedSnapshotDeliveries.status, 'running'),
				eq(feedSnapshotDeliveries.leaseOwner, claim.workerId),
				gt(feedSnapshotDeliveries.leaseExpiresAt, claim.now),
			),
		)
		.get();
	if (!delivery) throw new SnapshotDeliveryRejectedError('lease_lost');
	if (delivery.sourceId !== delivery.snapshotSourceId) {
		throw new SnapshotDeliveryRejectedError('source_replaced');
	}
	return delivery;
}
