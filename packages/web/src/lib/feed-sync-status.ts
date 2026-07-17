import { REFRESH_INTERVALS } from '@/lib/constants';

export interface FeedSyncAllStatus {
	queued: boolean;
	running: boolean;
	active: boolean;
	stale?: boolean;
	queuedAt?: string | null;
	startedAt?: string | null;
	heartbeatAt?: string | null;
	totalFeeds?: number;
	completedFeeds?: number;
	newArticles?: number;
	articleRevision?: number;
	syncedFeeds?: number;
	failedFeeds?: number;
	skippedFeeds?: number;
	jobId?: string | null;
	scope?: { feedId?: string; categoryId?: string };
	phase?: 'queued' | 'running' | 'completed' | 'failed';
	error?: string | null;
}

export const ALL_FEEDS_SYNC_ID = '__all_feeds__';

export function mergeFeedSyncStatus(
	current: FeedSyncAllStatus | undefined,
	incoming: FeedSyncAllStatus,
) {
	if (!current?.jobId || !incoming.jobId || current.jobId !== incoming.jobId) {
		return incoming;
	}

	return feedSyncPhaseRank(resolveStatusPhase(current)) >
		feedSyncPhaseRank(resolveStatusPhase(incoming))
		? current
		: incoming;
}

function resolveStatusPhase(status: FeedSyncAllStatus) {
	if (status.phase) return status.phase;
	if (status.running) return 'running';
	if (status.queued) return 'queued';
	return 'completed';
}

function feedSyncPhaseRank(phase: NonNullable<FeedSyncAllStatus['phase']>) {
	return phase === 'queued' ? 0 : phase === 'running' ? 1 : 2;
}

export type FeedRefreshPhase = 'idle' | 'starting' | 'queued' | 'syncing' | 'background';

export interface AllFeedsRefreshActivity {
	phase: FeedRefreshPhase;
	isActive: boolean;
	isBlocking: boolean;
	isTakingLonger: boolean;
	shouldShowStatus: boolean;
	activeSinceMs: number | null;
	elapsedMs: number | null;
}

interface BuildAllFeedsRefreshActivityOptions {
	status: FeedSyncAllStatus | undefined;
	statusUpdatedAt: number;
	localQueuedAt: number;
	isMutationPending: boolean;
	isLocalRefreshSelected: boolean;
	now: number;
	foregroundTimeoutMs?: number;
}

interface FeedSyncStatusFreshnessOptions {
	status: FeedSyncAllStatus | undefined;
	statusUpdatedAt: number;
	localQueuedAt: number;
	isMutationPending: boolean;
}

export function hasFreshInactiveFeedSyncStatus({
	status,
	statusUpdatedAt,
	localQueuedAt,
	isMutationPending,
}: FeedSyncStatusFreshnessOptions) {
	if (isMutationPending || status?.active !== false) {
		return false;
	}

	return localQueuedAt === 0 || statusUpdatedAt >= localQueuedAt;
}

export function buildAllFeedsRefreshActivity({
	status,
	statusUpdatedAt,
	localQueuedAt,
	isMutationPending,
	isLocalRefreshSelected,
	now,
	foregroundTimeoutMs = REFRESH_INTERVALS.SYNC_STATUS_FOREGROUND_TIMEOUT_MS,
}: BuildAllFeedsRefreshActivityOptions): AllFeedsRefreshActivity {
	const serverActive = status?.active === true;
	const serverSettledInactive = hasFreshInactiveFeedSyncStatus({
		status,
		statusUpdatedAt,
		localQueuedAt,
		isMutationPending,
	});
	const localActive =
		isMutationPending || (!serverSettledInactive && (isLocalRefreshSelected || localQueuedAt > 0));
	const isActive = serverActive || localActive;

	if (!isActive) {
		return {
			phase: 'idle',
			isActive: false,
			isBlocking: false,
			isTakingLonger: false,
			shouldShowStatus: false,
			activeSinceMs: null,
			elapsedMs: null,
		};
	}

	const activeSinceMs =
		getFeedSyncStatusActiveSince(status) ??
		(localQueuedAt > 0 ? localQueuedAt : null) ??
		(statusUpdatedAt > 0 ? statusUpdatedAt : now);
	const elapsedMs = Math.max(0, now - activeSinceMs);
	const isTakingLonger = status?.stale === true || elapsedMs >= foregroundTimeoutMs;
	// A refresh can be started by another tab/client or restored after a page
	// reload. Server activity is still foreground UX state even when this hook
	// did not create the local mutation that discovered it.
	const isForeground = !isTakingLonger;
	const phase = resolveRefreshPhase(status, isMutationPending, isTakingLonger);

	return {
		phase,
		isActive,
		isBlocking: isMutationPending || isForeground,
		isTakingLonger,
		shouldShowStatus: isForeground || isTakingLonger,
		activeSinceMs,
		elapsedMs,
	};
}

export function getFeedSyncStatusPollInterval(status: FeedSyncAllStatus | undefined) {
	if (!status?.active) {
		return false;
	}

	// Retained for non-SSE clients. The web query no longer calls this function.
	return REFRESH_INTERVALS.SYNC_STATUS_FALLBACK_MS;
}

export function getFeedSyncStatusActiveSince(status: FeedSyncAllStatus | undefined) {
	return (
		parseOptionalDate(status?.startedAt) ??
		parseOptionalDate(status?.queuedAt) ??
		parseOptionalDate(status?.heartbeatAt)
	);
}

function resolveRefreshPhase(
	status: FeedSyncAllStatus | undefined,
	isMutationPending: boolean,
	isTakingLonger: boolean,
): FeedRefreshPhase {
	if (isTakingLonger) {
		return 'background';
	}
	if (isMutationPending) {
		return 'starting';
	}
	if (status?.queued) {
		return 'queued';
	}
	if (status?.running) {
		return 'syncing';
	}
	return 'starting';
}

function parseOptionalDate(value?: string | null) {
	if (!value) {
		return null;
	}
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : null;
}
