import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { feedRefreshRequestItems, feedRefreshRequests } from '../db/schema.js';

export async function aggregateRefreshRequest(db: Database, requestId: string, now = new Date()) {
	return db.transaction((tx) => {
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
				completedAt: terminalItems === totalItems ? now : null,
				updatedAt: now,
			})
			.where(eq(feedRefreshRequests.id, requestId))
			.returning()
			.get();
	});
}

export function aggregateRefreshRequests(
	db: Database,
	requestIds: Iterable<string>,
	now = new Date(),
) {
	return Promise.all([...new Set(requestIds)].map((id) => aggregateRefreshRequest(db, id, now)));
}
