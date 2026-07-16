import type { FeedSyncProgressEvent, RealtimeEvent } from '@self-feed/shared';
import type Redis from 'ioredis';
import { CacheKeys } from '../db/redis.js';
import { createLogger } from '../utils/logger.js';
import { getSyncErrorDetails } from './feed-sync-errors.js';
import {
	acquireManualSyncAllFeedsLock,
	getManualSyncAllFeedsRequest,
	getManualSyncAllFeedsStatus,
	type ManualSyncRequest,
	type ManualSyncScope,
	releaseManualSyncAllFeedsState,
	startManualSyncAllFeedsHeartbeat,
	updateManualSyncAllFeedsProgress,
} from './feed-sync-status.js';
import type { RealtimeService } from './realtime.service.js';

const logger = createLogger();

export interface SyncResult {
	totalFeeds: number;
	completedFeeds?: number;
	syncedFeeds: number;
	failedFeeds: number;
	skippedFeeds: number;
	newArticles: number;
}

interface SyncProgress extends SyncResult {
	completedFeeds: number;
}

interface ProcessQueuedSyncOptions {
	redis: Redis;
	realtimeService?: RealtimeService;
	syncAllFeeds: (
		userId: string,
		scope: ManualSyncScope,
		onProgress: (progress: SyncProgress) => Promise<void>,
	) => Promise<SyncResult>;
}

export async function processNextQueuedFeedSync({
	redis,
	realtimeService,
	syncAllFeeds,
}: ProcessQueuedSyncOptions) {
	const userId = await redis.lindex(CacheKeys.feedSyncAllQueue(), 0);
	if (!userId) return null;

	const ownerToken = await acquireManualSyncAllFeedsLock(redis, userId);
	if (!ownerToken) {
		logger.warn('Skipping queued bulk feed sync because one is already running', { userId });
		return { userId, skipped: true as const };
	}

	const stopHeartbeat = startManualSyncAllFeedsHeartbeat(redis, userId, ownerToken);
	try {
		const request = await getManualSyncAllFeedsRequest(redis, userId);
		const scope = syncScope(request);
		const emptyProgress: SyncProgress = {
			totalFeeds: 0,
			completedFeeds: 0,
			syncedFeeds: 0,
			failedFeeds: 0,
			skippedFeeds: 0,
			newArticles: 0,
		};
		await updateManualSyncAllFeedsProgress(redis, userId, emptyProgress);
		const startedAt = new Date().toISOString();
		await publishFeedSyncProgress(realtimeService, userId, request, 'running', {
			...emptyProgress,
			startedAt,
		});
		logger.info('Starting queued bulk feed sync', { userId, jobId: request.jobId });
		const result = await syncAllFeeds(userId, scope, async (progress) => {
			await updateManualSyncAllFeedsProgress(redis, userId, progress);
			await publishFeedSyncProgress(realtimeService, userId, request, 'running', {
				...progress,
				startedAt,
			});
		});
		await publishFeedSyncProgress(realtimeService, userId, request, 'completed', {
			...result,
			completedFeeds: result.totalFeeds,
			startedAt,
		});
		logger.info('Queued bulk feed sync complete', { userId, ...result });
		return { userId, skipped: false as const, result };
	} catch (error) {
		const request = await getManualSyncAllFeedsRequest(redis, userId);
		const status = await getManualSyncAllFeedsStatus(redis, userId);
		await publishFeedSyncProgress(realtimeService, userId, request, 'failed', {
			...status,
			error: getSyncErrorDetails(error).error,
		});
		throw error;
	} finally {
		stopHeartbeat();
		await releaseManualSyncAllFeedsState(redis, userId, ownerToken);
	}
}

export async function publishFeedSyncProgress(
	realtimeService: RealtimeService | undefined,
	userId: string,
	request: ManualSyncRequest,
	phase: FeedSyncProgressEvent['phase'],
	progress: SyncProgress & { startedAt?: string | null; error?: string | null },
) {
	await publishRealtimeEvent(realtimeService, userId, {
		type: 'feed.sync.progress',
		eventId: crypto.randomUUID(),
		jobId: request.jobId,
		phase,
		scope: syncScope(request),
		totalFeeds: progress.totalFeeds,
		completedFeeds: progress.completedFeeds,
		syncedFeeds: progress.syncedFeeds,
		failedFeeds: progress.failedFeeds,
		skippedFeeds: progress.skippedFeeds,
		newArticles: progress.newArticles,
		queuedAt: new Date(request.queuedAt).toISOString(),
		startedAt: progress.startedAt ?? null,
		error: progress.error ?? null,
		updatedAt: new Date().toISOString(),
	});
}

export async function publishQueuedFeedSync(
	realtimeService: RealtimeService | undefined,
	userId: string,
	request: ManualSyncRequest,
) {
	await publishFeedSyncProgress(realtimeService, userId, request, 'queued', {
		totalFeeds: 0,
		completedFeeds: 0,
		syncedFeeds: 0,
		failedFeeds: 0,
		skippedFeeds: 0,
		newArticles: 0,
	});
}

export async function publishRealtimeEvent(
	realtimeService: RealtimeService | undefined,
	userId: string,
	event: RealtimeEvent,
) {
	if (!realtimeService) return;
	await realtimeService.publishEvent(userId, event).catch((error) => {
		logger.warn('Unable to publish realtime feed event', {
			userId,
			eventType: event.type,
			error: error instanceof Error ? error.message : String(error),
		});
	});
}

function syncScope(request: Pick<ManualSyncRequest, 'feedId' | 'categoryId'>) {
	const scope: ManualSyncScope = {};
	if (request.feedId) scope.feedId = request.feedId;
	if (request.categoryId) scope.categoryId = request.categoryId;
	return scope;
}
