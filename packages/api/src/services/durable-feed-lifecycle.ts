import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { feedDiscoveryCandidates, feedSources, type feeds } from '../db/schema.js';

function latestDate(...values: Array<Date | null | undefined>) {
	return values.reduce<Date | null>((latest, value) => {
		if (!value) return latest;
		return !latest || value > latest ? value : latest;
	}, null);
}

export async function buildDurableFeedLifecycle(db: Database, feed: typeof feeds.$inferSelect) {
	const [source, pendingSource, candidates] = await Promise.all([
		feed.sourceId
			? db.query.feedSources.findFirst({ where: eq(feedSources.id, feed.sourceId) })
			: null,
		feed.pendingSourceId
			? db.query.feedSources.findFirst({ where: eq(feedSources.id, feed.pendingSourceId) })
			: null,
		db.query.feedDiscoveryCandidates.findMany({
			where: and(
				eq(feedDiscoveryCandidates.userId, feed.userId),
				eq(feedDiscoveryCandidates.status, 'pending'),
				sql`${feedDiscoveryCandidates.expiresAt} > unixepoch()`,
			),
		}),
	]);
	const effective = pendingSource ?? source;
	const lifecycleStatus = feed.pendingSourceId
		? feed.syncStatus
		: source?.state === 'paused'
			? 'paused'
			: source?.backoffUntil && source.backoffUntil > new Date()
				? 'backoff'
				: source?.lastErrorCode
					? 'error'
					: source
						? 'active'
						: feed.syncStatus;
	return {
		lifecycleStatus,
		sourceId: feed.sourceId,
		pendingSourceId: feed.pendingSourceId,
		pendingFeedUrl: pendingSource?.normalizedUrl ?? null,
		sourceState: effective?.state ?? null,
		sourceErrorCode: effective?.lastErrorCode ?? feed.lastSyncErrorCode,
		sourceErrorDetails: effective?.lastErrorDetails ?? feed.lastSyncError,
		lastFetchAt: effective?.lastFetchAt?.toISOString() ?? null,
		lastSuccessAt: effective?.lastSuccessAt?.toISOString() ?? null,
		nextEligibleFetchAt:
			latestDate(
				effective?.nextFetchAt,
				effective?.backoffUntil,
				feed.refreshBlockedUntil,
			)?.toISOString() ?? null,
		replacementRequestedAt: feed.replacementRequestedAt?.toISOString() ?? null,
		discovery: {
			required: feed.syncStatus === 'discovery_required',
			candidates: candidates
				.filter((candidate) => candidate.selectionMetadata?.feedId === feed.id)
				.map((candidate) => ({
					id: candidate.id,
					requestId: candidate.requestId,
					url: candidate.normalizedCandidateUrl,
					title: candidate.title,
					type: candidate.type,
					expiresAt: candidate.expiresAt.toISOString(),
				})),
		},
	};
}
