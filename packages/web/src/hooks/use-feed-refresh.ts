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
	type FeedSyncAllStatus,
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

export function useFeedRefresh(categoryId?: string) {
	const qc = useQueryClient();
	const accountKey = getFeedRefreshAccountKey();
	const { data: feeds } = useFeeds();
	const syncAllFeeds = useSyncAllFeeds();
	const [trackedRequestId, setTrackedRequestId] = useState<string | null>(() =>
		readLastFeedRefreshRequestId(accountKey),
	);
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
	const {
		data: allFeedsSyncStatus,
		dataUpdatedAt: allFeedsSyncStatusUpdatedAt,
		refetch: refetchAllFeedsSyncStatus,
	} = useSyncAllFeedsStatus(trackedRequestId, isRealtimeConnected, untimedStatusActiveSince);
	const [, setRefreshClock] = useState(0);
	const wasRefreshing = useRef(false);

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
		// The queue response also seeded the latest key. Retire that copy unless
		// another request has already replaced it.
		const latestKey = ['feeds', 'sync', 'status'];
		if (
			isTrackedRequest &&
			qc.getQueryData<FeedSyncAllStatus>(latestKey)?.requestId === trackedRequestId
		) {
			qc.setQueryData(latestKey, allFeedsSyncStatus);
		}
		setTrackedRequestId(forgetFeedRefreshRequestId(accountKey, trackedRequestId));
	}, [accountKey, allFeedsSyncStatus, qc, trackedRequestId]);
	const singleFeedId =
		syncingFeedId === ALL_FEEDS_SYNC_ID
			? undefined
			: (syncingFeedId ?? allFeedsSyncStatus?.scope?.feedId);
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
		status: allFeedsSyncStatus,
		statusUpdatedAt: allFeedsRefreshStatusUpdatedAt,
		localQueuedAt: localRefreshQueuedAt,
		isMutationPending: syncAllFeeds.isPending,
		isLocalRefreshSelected: !!syncingFeedId,
		now: Date.now(),
	});
	const activeScope =
		syncAllFeeds.isPending || !allFeedsSyncStatus?.active
			? syncAllFeeds.variables
			: allFeedsSyncStatus.scope;
	const showsBulkRefresh =
		!singleFeedId &&
		(!categoryId || !activeScope?.categoryId || activeScope.categoryId === categoryId);
	const isRefreshingAllFeeds = showsBulkRefresh && allFeedsRefreshActivity.isBlocking;

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
		if (!syncingFeedId || (!hasSettledInactiveAllFeedsStatus && allFeedsRefreshActivity.isActive)) {
			return;
		}

		setLocalRefreshQueuedAt(0);
		setSyncingFeedId(null);
	}, [
		allFeedsRefreshActivity.isActive,
		hasSettledInactiveAllFeedsStatus,
		setSyncingFeedId,
		syncingFeedId,
	]);

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
			wasRefreshing.current = true;
			return;
		}

		if (!wasRefreshing.current) {
			return;
		}

		wasRefreshing.current = false;
		const wasSettledByRealtimeEvent =
			allFeedsSyncStatus?.phase === 'completed' || allFeedsSyncStatus?.phase === 'failed';
		if (!wasSettledByRealtimeEvent) {
			invalidateReaderQueries(qc);
		}
	}, [allFeedsRefreshActivity.isActive, allFeedsSyncStatus?.phase, qc]);

	const refreshFeed = useCallback(
		async (feedId?: string, options: RefreshOptions = {}) => {
			const scope = feedId ? { feedId } : { categoryId: options.categoryId };
			const selectionId = feedId ?? ALL_FEEDS_SYNC_ID;
			if (allFeedsRefreshActivity.isBlocking && refreshScopesOverlap(scope, activeScope, feeds))
				return false;
			if (
				syncingFeedId === selectionId &&
				(feedId || (!allFeedsSyncStatus?.active && !hasSettledInactiveAllFeedsStatus))
			)
				return false;
			if (feedId) {
				const selectedFeed = feeds?.find((feed) => feed.id === feedId);
				if (isFeedRefreshBlocked(selectedFeed)) return false;
				if (
					!options.force &&
					((allFeedsSyncStatus?.active && allFeedsSyncStatus.scope?.feedId === feedId) ||
						!shouldAutoSyncSelectedFeed(selectedFeed))
				)
					return false;
			}
			setFeedSyncError(null);
			setLocalRefreshQueuedAt(Date.now());
			setSyncingFeedId(selectionId);

			try {
				const response = await syncAllFeeds.mutateAsync(scope);
				const requestId = response.data.requestId ?? response.data.status?.requestId;
				if (requestId) {
					rememberFeedRefreshRequestId(accountKey, requestId);
					setTrackedRequestId(requestId);
				}
				return true;
			} catch (error) {
				const snapshot = await refetchAllFeedsSyncStatus().catch(() => null);
				const status = snapshot?.data;
				if (
					!snapshot?.isError &&
					status?.active &&
					status.scope?.feedId === scope.feedId &&
					status.scope?.categoryId === scope.categoryId
				)
					return true;
				setFeedSyncError(
					error instanceof Error
						? error.message
						: feedId
							? 'Unable to sync feed'
							: 'Unable to sync feeds',
				);
				setLocalRefreshQueuedAt(0);
				setSyncingFeedId((current) => (current === selectionId ? null : current));
				return false;
			}
		},
		[
			feeds,
			activeScope,
			allFeedsRefreshActivity.isBlocking,
			allFeedsSyncStatus?.scope,
			allFeedsSyncStatus?.active,
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
		allFeedsRefreshActivity: {
			...allFeedsRefreshActivity,
			shouldShowStatus: showsBulkRefresh && allFeedsRefreshActivity.shouldShowStatus,
		},
		isRefreshingAllFeeds,
		isRefreshingFeed: (feedId?: string) =>
			!!feedId && singleFeedId === feedId && allFeedsRefreshActivity.isActive,
		isRefreshBlockedByActiveRequest: (feedId?: string, categoryId?: string) =>
			allFeedsRefreshActivity.isBlocking &&
			refreshScopesOverlap({ feedId, categoryId }, activeScope, feeds),
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
