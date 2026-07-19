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

const STALLED_RUNNING_JOB_MS = 2 * 60_000;
const STALLED_ACTIONABLE_QUEUE_MS = 5 * 60_000;

function latestDate(...values: Array<Date | null | undefined>) {
	return values.reduce<Date | null>((latest, value) => {
		if (!value) return latest;
		return !latest || value > latest ? value : latest;
	}, null);
}

export async function getDurableRefreshStatus(
	db: Database,
	userId: string,
	requestId?: string | null,
	now = new Date(),
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
	const itemDetails = await Promise.all(
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
			const runningTooLong =
				row.job?.status === 'running' &&
				row.job.startedAt != null &&
				now.getTime() - row.job.startedAt.getTime() >= STALLED_RUNNING_JOB_MS;
			const actionableQueued =
				row.job?.status === 'queued' &&
				row.job.availableAt <= now &&
				row.source != null &&
				row.source.nextFetchAt <= now &&
				(row.source.backoffUntil == null || row.source.backoffUntil <= now) &&
				(origin?.nextAllowedRequestAt == null || origin.nextAllowedRequestAt <= now) &&
				(origin?.retryAfterUntil == null || origin.retryAfterUntil <= now) &&
				(origin?.blockedUntil == null || origin.blockedUntil <= now);
			return {
				item: {
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
				},
				runningTooLong,
				actionableQueued,
			};
		}),
	);
	const items = itemDetails.map((detail) => detail.item);
	const running = request.status === 'running';
	const queued = request.status === 'pending';
	const active = queued || running;
	const noProgressForMs = Math.max(0, now.getTime() - request.updatedAt.getTime());
	const stale =
		active &&
		(itemDetails.some((detail) => detail.runningTooLong) ||
			(noProgressForMs >= STALLED_ACTIONABLE_QUEUE_MS &&
				itemDetails.some((detail) => detail.actionableQueued)));
	return {
		requestId: request.id,
		status: request.status,
		queued,
		running,
		active,
		stale,
		queuedAt: request.requestedAt.toISOString(),
		startedAt: request.startedAt?.toISOString() ?? null,
		heartbeatAt: request.updatedAt.toISOString(),
		totalFeeds: request.totalItems,
		completedFeeds: request.completedItems + request.failedItems + request.deadItems,
		syncedFeeds: request.completedItems,
		failedFeeds: request.failedItems + request.deadItems,
		skippedFeeds: 0,
		pendingFeeds: request.pendingItems,
		runningFeeds: request.runningItems,
		deadFeeds: request.deadItems,
		newArticles: 0,
		articleRevision: 0,
		jobId: items.find((item) => item.jobId)?.jobId ?? null,
		scope: {
			feedId: request.scopeFeedId ?? undefined,
			categoryId: request.scopeCategoryId ?? undefined,
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
