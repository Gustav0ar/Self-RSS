import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	invalidateReaderQueries,
	useFeeds,
	useSyncAllFeeds,
	useSyncAllFeedsStatus,
} from '@/hooks/queries';
import { REFRESH_INTERVALS } from '@/lib/constants';
import {
	ALL_FEEDS_SYNC_ID,
	buildAllFeedsRefreshActivity,
	getFeedSyncStatusActiveSince,
	hasFreshInactiveFeedSyncStatus,
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
				syncStatus: 'idle' | 'syncing' | 'error';
				unreadCount?: number;
		  }
		| undefined,
) {
	return (
		!!feed && feed.syncStatus !== 'error' && !feed.lastSyncedAt && (feed.unreadCount ?? 0) === 0
	);
}

export function useFeedRefresh() {
	const qc = useQueryClient();
	const { data: feeds } = useFeeds();
	const syncAllFeeds = useSyncAllFeeds();
	const {
		data: allFeedsSyncStatus,
		dataUpdatedAt: allFeedsSyncStatusUpdatedAt,
		refetch: refetchAllFeedsSyncStatus,
	} = useSyncAllFeedsStatus();
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
		const timer = globalThis.setTimeout(
			() => {
				void refetchAllFeedsSyncStatus();
			},
			isRealtimeConnected
				? REFRESH_INTERVALS.SYNC_STATUS_CONNECTED_FALLBACK_MS
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
				if (syncingFeedId === ALL_FEEDS_SYNC_ID && !hasSettledInactiveAllFeedsStatus) {
					return false;
				}

				const queuedAt = Date.now();
				setFeedSyncError(null);
				setLocalRefreshQueuedAt(queuedAt);
				setSyncingFeedId(ALL_FEEDS_SYNC_ID);
				setRefreshClock((tick) => tick + 1);

				try {
					await syncAllFeeds.mutateAsync({ categoryId: options.categoryId });
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
				await syncAllFeeds.mutateAsync({ feedId });
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
			hasSettledInactiveAllFeedsStatus,
			refetchAllFeedsSyncStatus,
			setFeedSyncError,
			setSyncingFeedId,
			syncAllFeeds,
			syncingFeedId,
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
		refreshFeed,
	};
}
