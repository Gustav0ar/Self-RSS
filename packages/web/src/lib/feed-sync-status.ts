import { REFRESH_INTERVALS } from '@/lib/constants';

export interface FeedSyncAllStatus {
	queued: boolean;
	running: boolean;
	active: boolean;
	stale?: boolean;
	queuedAt?: string | null;
	startedAt?: string | null;
	heartbeatAt?: string | null;
}

export const ALL_FEEDS_SYNC_ID = '__all_feeds__';

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
	const localActive = isMutationPending || isLocalRefreshSelected || localQueuedAt > 0;
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
	const isForeground = localActive && !isTakingLonger;
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

	const activeSinceMs = getFeedSyncStatusActiveSince(status);
	if (!activeSinceMs) {
		return REFRESH_INTERVALS.SYNC_STATUS_POLL_MS;
	}

	const elapsedMs = Date.now() - activeSinceMs;
	if (status.stale || elapsedMs >= REFRESH_INTERVALS.SYNC_STATUS_FOREGROUND_TIMEOUT_MS) {
		return REFRESH_INTERVALS.SYNC_STATUS_BACKGROUND_POLL_MS;
	}

	return REFRESH_INTERVALS.SYNC_STATUS_POLL_MS;
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
