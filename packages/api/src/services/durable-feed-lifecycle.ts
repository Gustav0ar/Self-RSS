import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { feedDiscoveryCandidates, feedSources, type feeds } from '../db/schema.js';

function latestDate(...values: Array<Date | null | undefined>) {
	return values.reduce<Date | null>((latest, value) => {
		if (!value) return latest;
		return !latest || value > latest ? value : latest;
	}, null);
}

export async function buildDurableFeedLifecycle(db: Database, feed: typeof feeds.$inferSelect) {
	const data = await loadLifecycleData(db, feed.userId, [feed]);
	return serializeLifecycle(feed, data);
}

export async function buildDurableFeedLifecycles(
	db: Database,
	userId: string,
	feedRows: (typeof feeds.$inferSelect)[],
) {
	if (feedRows.length === 0) return [];
	const data = await loadLifecycleData(db, userId, feedRows);
	return feedRows.map((feed) => ({ feed, lifecycle: serializeLifecycle(feed, data) }));
}

async function loadLifecycleData(
	db: Database,
	userId: string,
	feedRows: (typeof feeds.$inferSelect)[],
) {
	const sourceIds = [
		...new Set(
			feedRows.flatMap((feed) => [feed.sourceId, feed.pendingSourceId]).filter((id) => id !== null),
		),
	];
	const [sources, candidates] = await Promise.all([
		sourceIds.length > 0
			? db.query.feedSources.findMany({ where: inArray(feedSources.id, sourceIds) })
			: [],
		db.query.feedDiscoveryCandidates.findMany({
			where: and(
				eq(feedDiscoveryCandidates.userId, userId),
				eq(feedDiscoveryCandidates.status, 'pending'),
				sql`${feedDiscoveryCandidates.expiresAt} > unixepoch()`,
			),
		}),
	]);
	const candidatesByFeedId = new Map<string, typeof candidates>();
	for (const candidate of candidates) {
		const feedId = candidate.selectionMetadata?.feedId;
		if (typeof feedId !== 'string') continue;
		const existing = candidatesByFeedId.get(feedId);
		if (existing) existing.push(candidate);
		else candidatesByFeedId.set(feedId, [candidate]);
	}
	return {
		sourcesById: new Map(sources.map((source) => [source.id, source])),
		candidatesByFeedId,
	};
}

function serializeLifecycle(
	feed: typeof feeds.$inferSelect,
	data: Awaited<ReturnType<typeof loadLifecycleData>>,
) {
	const source = feed.sourceId ? data.sourcesById.get(feed.sourceId) : undefined;
	const pendingSource = feed.pendingSourceId
		? data.sourcesById.get(feed.pendingSourceId)
		: undefined;
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
			candidates: (data.candidatesByFeedId.get(feed.id) ?? []).map((candidate) => ({
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
