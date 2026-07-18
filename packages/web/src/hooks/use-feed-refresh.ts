import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	invalidateReaderQueries,
	useFeeds,
	useSyncAllFeeds,
	useSyncAllFeedsStatus,
} from '@/hooks/queries';
import { REFRESH_INTERVALS } from '@/lib/constants';
import { isFeedRefreshBlocked } from '@/lib/feed-lifecycle';
import {
	ALL_FEEDS_SYNC_ID,
	buildAllFeedsRefreshActivity,
	FEED_REFRESH_REQUEST_EVENT,
	forgetFeedRefreshRequestId,
	getFeedRefreshAccountKey,
	getFeedSyncStatusActiveSince,
	hasFreshInactiveFeedSyncStatus,
	readLastFeedRefreshRequestId,
	rememberFeedRefreshRequestId,
} from '@/lib/feed-sync-status';
import { useAppState } from '@/providers/app-state';

interface RefreshOptions {
	force?: boolean;
	categoryId?: string;
}

export function shouldAutoSyncSelectedFeed(
	feed:
		| {
				lastSyncedAt: string | null;
				syncStatus: string;
				unreadCount?: number;
		  }
		| undefined,
) {
	return (
		!!feed &&
		(feed.syncStatus === 'idle' || feed.syncStatus === 'syncing') &&
		!feed.lastSyncedAt &&
		(feed.unreadCount ?? 0) === 0
	);
}

export function useFeedRefresh() {
	const qc = useQueryClient();
	const accountKey = getFeedRefreshAccountKey();
	const { data: feeds } = useFeeds();
	const syncAllFeeds = useSyncAllFeeds();
	const [trackedRequestId, setTrackedRequestId] = useState<string | null>(() =>
		readLastFeedRefreshRequestId(accountKey),
	);
	const {
		data: allFeedsSyncStatus,
		dataUpdatedAt: allFeedsSyncStatusUpdatedAt,
		refetch: refetchAllFeedsSyncStatus,
	} = useSyncAllFeedsStatus(trackedRequestId);
	const { data: isRealtimeConnected = false } = useQuery<boolean>({
		queryKey: ['realtime', 'connected'],
		queryFn: () => false,
		initialData: false,
		enabled: false,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const { feedSyncError, setFeedSyncError, setSyncingFeedId, syncingFeedId } = useAppState();
	const [localRefreshQueuedAt, setLocalRefreshQueuedAt] = useState(0);
	const [untimedStatusActiveSince, setUntimedStatusActiveSince] = useState(0);
	const [, setRefreshClock] = useState(0);
	const wasRefreshingAllFeeds = useRef(false);

	useEffect(() => {
		setTrackedRequestId(readLastFeedRefreshRequestId(accountKey));
	}, [accountKey]);

	useEffect(() => {
		const onRequest = (event: Event) => {
			const detail = (event as CustomEvent<{ accountKey: string; requestId: string | null }>)
				.detail;
			if (detail?.accountKey === accountKey) setTrackedRequestId(detail.requestId);
		};
		globalThis.addEventListener(FEED_REFRESH_REQUEST_EVENT, onRequest);
		return () => globalThis.removeEventListener(FEED_REFRESH_REQUEST_EVENT, onRequest);
	}, [accountKey]);

	useEffect(() => {
		if (!trackedRequestId || !allFeedsSyncStatus) return;
		const isTrackedRequest = allFeedsSyncStatus.requestId === trackedRequestId;
		if (isTrackedRequest && allFeedsSyncStatus.active) return;
		// Effects run after the terminal snapshot has committed, so the result can
		// render once before returning to the latest cross-client status stream.
		forgetFeedRefreshRequestId(accountKey);
		setTrackedRequestId(null);
	}, [accountKey, allFeedsSyncStatus, trackedRequestId]);
	const allFeedsStatus = allFeedsSyncStatus?.scope?.feedId
		? { ...allFeedsSyncStatus, active: false, queued: false, running: false }
		: allFeedsSyncStatus;
	const hasSettledInactiveAllFeedsStatus = hasFreshInactiveFeedSyncStatus({
		status: allFeedsSyncStatus,
		statusUpdatedAt: allFeedsSyncStatusUpdatedAt,
		localQueuedAt: localRefreshQueuedAt,
		isMutationPending: syncAllFeeds.isPending,
	});
	const allFeedsRefreshStatusUpdatedAt =
		allFeedsSyncStatus?.active === true && untimedStatusActiveSince
			? untimedStatusActiveSince
			: allFeedsSyncStatusUpdatedAt;
	const allFeedsRefreshActivity = buildAllFeedsRefreshActivity({
		status: allFeedsStatus,
		statusUpdatedAt: allFeedsRefreshStatusUpdatedAt,
		localQueuedAt: localRefreshQueuedAt,
		isMutationPending: syncAllFeeds.isPending && syncingFeedId === ALL_FEEDS_SYNC_ID,
		isLocalRefreshSelected: syncingFeedId === ALL_FEEDS_SYNC_ID,
		now: Date.now(),
	});
	const isRefreshingAllFeeds = allFeedsRefreshActivity.isBlocking;

	useEffect(() => {
		const isUntimedActive =
			allFeedsSyncStatus?.active === true &&
			getFeedSyncStatusActiveSince(allFeedsSyncStatus) == null;
		setUntimedStatusActiveSince((current) => {
			if (isUntimedActive) {
				return current || Date.now();
			}
			return current === 0 ? current : 0;
		});
	}, [allFeedsSyncStatus]);

	useEffect(() => {
		if (!allFeedsSyncStatus?.active) return;
		const activeSince = getFeedSyncStatusActiveSince(allFeedsSyncStatus);
		const elapsed = activeSince == null ? 0 : Date.now() - activeSince;
		if (elapsed >= REFRESH_INTERVALS.SYNC_STATUS_MAX_MONITOR_MS) return;
		const timer = globalThis.setTimeout(
			() => {
				void refetchAllFeedsSyncStatus();
			},
			isRealtimeConnected
				? REFRESH_INTERVALS.SYNC_STATUS_CONNECTED_FALLBACK_MS
				: elapsed >= REFRESH_INTERVALS.SYNC_STATUS_FOREGROUND_TIMEOUT_MS
					? REFRESH_INTERVALS.SYNC_STATUS_BACKGROUND_POLL_MS
					: REFRESH_INTERVALS.SYNC_STATUS_FALLBACK_MS,
		);
		return () => globalThis.clearTimeout(timer);
	}, [allFeedsSyncStatus, isRealtimeConnected, refetchAllFeedsSyncStatus]);

	useEffect(() => {
		if (!allFeedsRefreshActivity.isActive) {
			return;
		}

		const elapsedMs = allFeedsRefreshActivity.elapsedMs ?? 0;
		const delayMs = allFeedsRefreshActivity.isTakingLonger
			? REFRESH_INTERVALS.SYNC_STATUS_BACKGROUND_POLL_MS
			: Math.max(250, REFRESH_INTERVALS.SYNC_STATUS_FOREGROUND_TIMEOUT_MS - elapsedMs + 50);
		const timer = globalThis.setTimeout(() => {
			setRefreshClock((tick) => tick + 1);
		}, delayMs);

		return () => globalThis.clearTimeout(timer);
	}, [
		allFeedsRefreshActivity.elapsedMs,
		allFeedsRefreshActivity.isActive,
		allFeedsRefreshActivity.isTakingLonger,
	]);

	useEffect(() => {
		if (!syncingFeedId || !hasSettledInactiveAllFeedsStatus) {
			return;
		}

		setLocalRefreshQueuedAt(0);
		setSyncingFeedId(null);
	}, [hasSettledInactiveAllFeedsStatus, setSyncingFeedId, syncingFeedId]);

	useEffect(() => {
		if (syncingFeedId !== ALL_FEEDS_SYNC_ID || !allFeedsRefreshActivity.isTakingLonger) {
			return;
		}

		setLocalRefreshQueuedAt(0);
		setSyncingFeedId((current) => (current === ALL_FEEDS_SYNC_ID ? null : current));
		invalidateReaderQueries(qc);
	}, [allFeedsRefreshActivity.isTakingLonger, qc, setSyncingFeedId, syncingFeedId]);

	useEffect(() => {
		if (allFeedsRefreshActivity.isActive) {
			wasRefreshingAllFeeds.current = true;
			return;
		}

		if (!wasRefreshingAllFeeds.current) {
			return;
		}

		wasRefreshingAllFeeds.current = false;
		const wasSettledByRealtimeEvent =
			allFeedsSyncStatus?.phase === 'completed' || allFeedsSyncStatus?.phase === 'failed';
		if (!wasSettledByRealtimeEvent) {
			invalidateReaderQueries(qc);
		}
	}, [allFeedsRefreshActivity.isActive, allFeedsSyncStatus?.phase, qc]);

	const refreshFeed = useCallback(
		async (feedId?: string, options: RefreshOptions = {}) => {
			if (!feedId) {
				if (
					allFeedsSyncStatus?.active &&
					refreshScopesOverlap({ categoryId: options.categoryId }, allFeedsSyncStatus.scope, feeds)
				)
					return false;
				if (syncingFeedId === ALL_FEEDS_SYNC_ID && !hasSettledInactiveAllFeedsStatus) {
					return false;
				}

				const queuedAt = Date.now();
				setFeedSyncError(null);
				setLocalRefreshQueuedAt(queuedAt);
				setSyncingFeedId(ALL_FEEDS_SYNC_ID);
				setRefreshClock((tick) => tick + 1);

				try {
					const response = await syncAllFeeds.mutateAsync({ categoryId: options.categoryId });
					const requestId = response.data.requestId ?? response.data.status?.requestId ?? null;
					if (requestId) {
						rememberFeedRefreshRequestId(accountKey, requestId);
						setTrackedRequestId(requestId);
					}
					return true;
				} catch (error) {
					const reconciledStatus = await refetchAllFeedsSyncStatus().catch(() => null);
					if (reconciledStatus?.data?.active) {
						return true;
					}
					setFeedSyncError(error instanceof Error ? error.message : 'Unable to sync feeds');
					setLocalRefreshQueuedAt(0);
					setSyncingFeedId((current) => (current === ALL_FEEDS_SYNC_ID ? null : current));
					return false;
				}
			}

			if (syncingFeedId === feedId) {
				return false;
			}
			const selectedFeed = feeds?.find((feed) => feed.id === feedId);
			if (
				allFeedsSyncStatus?.active &&
				refreshScopesOverlap({ feedId }, allFeedsSyncStatus.scope, feeds)
			)
				return false;
			if (isFeedRefreshBlocked(selectedFeed)) {
				setFeedSyncError(null);
				setSyncingFeedId(null);
				return false;
			}
			const shouldAutoSync = options.force || shouldAutoSyncSelectedFeed(selectedFeed);
			if (!shouldAutoSync) {
				setFeedSyncError(null);
				setSyncingFeedId(null);
				return false;
			}

			setFeedSyncError(null);
			setLocalRefreshQueuedAt(Date.now());
			setSyncingFeedId(feedId);

			try {
				const response = await syncAllFeeds.mutateAsync({ feedId });
				const requestId = response.data.requestId ?? response.data.status?.requestId ?? null;
				if (requestId) {
					rememberFeedRefreshRequestId(accountKey, requestId);
					setTrackedRequestId(requestId);
				}
				return true;
			} catch (error) {
				const reconciledStatus = await refetchAllFeedsSyncStatus().catch(() => null);
				if (reconciledStatus?.data?.active) {
					return true;
				}
				setFeedSyncError(error instanceof Error ? error.message : 'Unable to sync feed');
				setLocalRefreshQueuedAt(0);
				setSyncingFeedId((current) => (current === feedId ? null : current));
				return false;
			}
		},
		[
			feeds,
			allFeedsSyncStatus?.active,
			allFeedsSyncStatus?.scope,
			hasSettledInactiveAllFeedsStatus,
			refetchAllFeedsSyncStatus,
			setFeedSyncError,
			setSyncingFeedId,
			syncAllFeeds,
			syncingFeedId,
			accountKey,
		],
	);

	return {
		feedSyncError,
		allFeedsSyncStatus,
		allFeedsRefreshActivity,
		isRefreshingAllFeeds,
		isRefreshingFeed: (feedId?: string) =>
			!!feedId &&
			(syncingFeedId === feedId ||
				(allFeedsSyncStatus?.active === true && allFeedsSyncStatus.scope?.feedId === feedId)),
		isRefreshBlockedByActiveRequest: (feedId?: string, categoryId?: string) =>
			allFeedsSyncStatus?.active === true &&
			refreshScopesOverlap({ feedId, categoryId }, allFeedsSyncStatus.scope, feeds),
		refreshFeed,
	};
}

function refreshScopesOverlap(
	requested: { feedId?: string; categoryId?: string },
	active: { feedId?: string; categoryId?: string } | undefined,
	feeds: Array<{ id: string; categoryId: string }> | undefined,
) {
	if (!active?.feedId && !active?.categoryId) return true;
	if (!requested.feedId && !requested.categoryId) return true;
	if (requested.feedId && active.feedId) return requested.feedId === active.feedId;
	if (requested.categoryId && active.categoryId) return requested.categoryId === active.categoryId;
	const feedId = requested.feedId ?? active.feedId;
	const categoryId = requested.categoryId ?? active.categoryId;
	return feeds?.some((feed) => feed.id === feedId && feed.categoryId === categoryId) ?? true;
}
