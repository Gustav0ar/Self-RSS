import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { syncRuns } from '../db/schema.js';

type SyncOutcome = Pick<
	typeof syncRuns.$inferInsert,
	'id' | 'feedId' | 'startedAt' | 'httpStatus' | 'itemCount' | 'errorMessage'
> & {
	status: 'success' | 'failed';
	finishedAt: Date;
};

/** Record history and count its outcome exactly once, even after a worker restart. */
export function recordDurableSyncRun(
	tx: Parameters<Parameters<Database['transaction']>[0]>[0],
	outcome: SyncOutcome,
) {
	const inserted = tx
		.insert(syncRuns)
		.values(outcome)
		.onConflictDoNothing({ target: syncRuns.id })
		.returning({ id: syncRuns.id })
		.get();
	if (inserted) {
		tx.run(sql`
			INSERT INTO user_metrics_daily (user_id, date, is_active, feeds_synced_count, feed_failures_count)
			SELECT user_id, ${outcome.finishedAt.toISOString().slice(0, 10)}, 0, ${Number(outcome.status === 'success')}, ${Number(outcome.status === 'failed')}
			FROM feeds WHERE id = ${outcome.feedId}
			ON CONFLICT(user_id, date) DO UPDATE SET
				feeds_synced_count = feeds_synced_count + excluded.feeds_synced_count,
				feed_failures_count = feed_failures_count + excluded.feed_failures_count
		`);
	}
}
