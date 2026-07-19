import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { feedRefreshRequestItems, feedRefreshRequests } from '../db/schema.js';

export async function aggregateRefreshRequest(db: Database, requestId: string, now = new Date()) {
	return db.transaction(
		(tx) => {
			const current = tx
				.select()
				.from(feedRefreshRequests)
				.where(eq(feedRefreshRequests.id, requestId))
				.get();
			if (!current) return undefined;
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
				totalItems === 0
					? 'completed'
					: terminalItems === totalItems
						? failedItems + deadItems > 0
							? 'completed_with_errors'
							: 'completed'
						: runningItems > 0
							? 'running'
							: 'pending';
			const progressChanged =
				current.status !== status ||
				current.totalItems !== totalItems ||
				current.pendingItems !== pendingItems ||
				current.runningItems !== runningItems ||
				current.completedItems !== completedItems ||
				current.failedItems !== failedItems ||
				current.deadItems !== deadItems;
			const hasStarted = runningItems > 0 || terminalItems > 0;
			const isTerminal = terminalItems === totalItems;

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
					startedAt: current.startedAt ?? (hasStarted ? now : null),
					completedAt: isTerminal ? (current.completedAt ?? now) : null,
					// Status reads reconcile counts but must not manufacture progress.
					// Clients and operations use updatedAt to detect a genuinely stalled request.
					updatedAt: progressChanged ? now : current.updatedAt,
				})
				.where(eq(feedRefreshRequests.id, requestId))
				.returning()
				.get();
		},
		// Aggregation reads request items and then updates their parent request. In WAL mode,
		// a deferred transaction can lose the race to the worker between those operations and
		// fail its read-to-write upgrade with SQLITE_BUSY_SNAPSHOT. Reserve the write slot up
		// front so SQLite's busy timeout can serialize this short critical section safely.
		{ behavior: 'immediate' },
	);
}

export function aggregateRefreshRequests(
	db: Database,
	requestIds: Iterable<string>,
	now = new Date(),
) {
	return Promise.all([...new Set(requestIds)].map((id) => aggregateRefreshRequest(db, id, now)));
}
