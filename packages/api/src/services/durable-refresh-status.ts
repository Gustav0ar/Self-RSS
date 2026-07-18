import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
	feedFetchJobs,
	feedOrigins,
	feedRefreshRequestItems,
	feedRefreshRequests,
	feedSources,
	feeds,
} from '../db/schema.js';
import type { FeedIngestionRepository } from '../repositories/feed-ingestion.repository.js';

function latestDate(...values: Array<Date | null | undefined>) {
	return values.reduce<Date | null>((latest, value) => {
		if (!value) return latest;
		return !latest || value > latest ? value : latest;
	}, null);
}

export async function getDurableRefreshStatus(
	db: Database,
	ingestionRepository: FeedIngestionRepository,
	userId: string,
	requestId?: string | null,
) {
	const request = requestId
		? await db.query.feedRefreshRequests.findFirst({
				where: and(eq(feedRefreshRequests.id, requestId), eq(feedRefreshRequests.userId, userId)),
			})
		: await db.query.feedRefreshRequests.findFirst({
				where: eq(feedRefreshRequests.userId, userId),
				orderBy: [desc(feedRefreshRequests.createdAt)],
			});
	if (!request) return emptyDurableRefreshStatus();
	await ingestionRepository.aggregateRefreshRequest(request.id);
	const refreshed = (await db.query.feedRefreshRequests.findFirst({
		where: eq(feedRefreshRequests.id, request.id),
	}))!;
	const rows = await db
		.select({
			item: feedRefreshRequestItems,
			feed: feeds,
			source: feedSources,
			job: feedFetchJobs,
		})
		.from(feedRefreshRequestItems)
		.leftJoin(feeds, eq(feeds.id, feedRefreshRequestItems.feedId))
		.leftJoin(feedSources, eq(feedSources.id, feedRefreshRequestItems.sourceId))
		.leftJoin(feedFetchJobs, eq(feedFetchJobs.id, feedRefreshRequestItems.jobId))
		.where(eq(feedRefreshRequestItems.requestId, request.id));
	const items = await Promise.all(
		rows.map(async (row) => {
			const origin = row.source
				? await db.query.feedOrigins.findFirst({ where: eq(feedOrigins.id, row.source.originId) })
				: null;
			const nextEligibleAt = latestDate(
				row.job?.availableAt,
				row.source?.nextFetchAt,
				row.source?.backoffUntil,
				origin?.nextAllowedRequestAt,
				origin?.retryAfterUntil,
				origin?.blockedUntil,
			);
			return {
				feedId: row.item.feedId,
				sourceId: row.item.sourceId,
				jobId: row.item.jobId,
				status: row.item.status,
				feedTitle: row.feed?.title ?? null,
				errorCode: row.item.lastErrorCode ?? row.job?.lastErrorCode ?? row.source?.lastErrorCode,
				errorDetails:
					row.item.lastErrorDetails ?? row.job?.lastErrorDetails ?? row.source?.lastErrorDetails,
				nextEligibleAt: nextEligibleAt?.toISOString() ?? null,
				publisherRequestStarted: Boolean(row.job?.startedAt),
				lastFetchAt: row.source?.lastFetchAt?.toISOString() ?? null,
			};
		}),
	);
	const running = refreshed.status === 'running';
	const queued = refreshed.status === 'pending';
	return {
		requestId: refreshed.id,
		status: refreshed.status,
		queued,
		running,
		active: queued || running,
		stale: false,
		queuedAt: refreshed.requestedAt.toISOString(),
		startedAt: refreshed.startedAt?.toISOString() ?? null,
		heartbeatAt: refreshed.updatedAt.toISOString(),
		totalFeeds: refreshed.totalItems,
		completedFeeds: refreshed.completedItems + refreshed.failedItems + refreshed.deadItems,
		syncedFeeds: refreshed.completedItems,
		failedFeeds: refreshed.failedItems + refreshed.deadItems,
		skippedFeeds: 0,
		pendingFeeds: refreshed.pendingItems,
		runningFeeds: refreshed.runningItems,
		deadFeeds: refreshed.deadItems,
		newArticles: 0,
		articleRevision: 0,
		jobId: items.find((item) => item.jobId)?.jobId ?? null,
		scope: {
			feedId: refreshed.scopeFeedId ?? undefined,
			categoryId: refreshed.scopeCategoryId ?? undefined,
		},
		items,
	};
}

function emptyDurableRefreshStatus() {
	return {
		requestId: null,
		status: 'completed',
		queued: false,
		running: false,
		active: false,
		stale: false,
		queuedAt: null,
		startedAt: null,
		heartbeatAt: null,
		totalFeeds: 0,
		completedFeeds: 0,
		syncedFeeds: 0,
		failedFeeds: 0,
		skippedFeeds: 0,
		pendingFeeds: 0,
		runningFeeds: 0,
		deadFeeds: 0,
		newArticles: 0,
		articleRevision: 0,
		jobId: null,
		scope: {},
		items: [],
	};
}
