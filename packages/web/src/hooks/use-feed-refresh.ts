import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	invalidateReaderQueries,
	useFeeds,
	useSyncAllFeeds,
	useSyncAllFeedsStatus,
	useSyncFeed,
} from '@/hooks/queries';
import { REFRESH_INTERVALS } from '@/lib/constants';
import {
	ALL_FEEDS_SYNC_ID,
	buildAllFeedsRefreshActivity,
	getFeedSyncStatusActiveSince,
} from '@/lib/feed-sync-status';
import { useAppState } from '@/providers/app-state';

interface RefreshOptions {
	force?: boolean;
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
	const syncFeed = useSyncFeed();
	const { feedSyncError, setFeedSyncError, setSyncingFeedId, syncingFeedId } = useAppState();
	const [allFeedsRefreshQueuedAt, setAllFeedsRefreshQueuedAt] = useState(0);
	const [untimedStatusActiveSince, setUntimedStatusActiveSince] = useState(0);
	const [, setRefreshClock] = useState(0);
	const wasRefreshingAllFeeds = useRef(false);
	const allFeedsRefreshActivity = buildAllFeedsRefreshActivity({
		status: allFeedsSyncStatus,
		statusUpdatedAt: untimedStatusActiveSince || allFeedsSyncStatusUpdatedAt,
		localQueuedAt: allFeedsRefreshQueuedAt,
		isMutationPending: syncAllFeeds.isPending,
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
		if (syncingFeedId !== ALL_FEEDS_SYNC_ID || syncAllFeeds.isPending) {
			return;
		}
		if (allFeedsRefreshQueuedAt === 0) {
			return;
		}
		if (!allFeedsSyncStatus || allFeedsSyncStatusUpdatedAt < allFeedsRefreshQueuedAt) {
			return;
		}
		if (allFeedsSyncStatus.active) {
			return;
		}

		setAllFeedsRefreshQueuedAt(0);
		setSyncingFeedId((current) => (current === ALL_FEEDS_SYNC_ID ? null : current));
	}, [
		allFeedsRefreshQueuedAt,
		allFeedsSyncStatus,
		allFeedsSyncStatusUpdatedAt,
		setSyncingFeedId,
		syncAllFeeds.isPending,
		syncingFeedId,
	]);

	useEffect(() => {
		if (syncingFeedId !== ALL_FEEDS_SYNC_ID || !allFeedsRefreshActivity.isTakingLonger) {
			return;
		}

		setAllFeedsRefreshQueuedAt(0);
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
		invalidateReaderQueries(qc);
	}, [allFeedsRefreshActivity.isActive, qc]);

	const refreshFeed = useCallback(
		async (feedId?: string, options: RefreshOptions = {}) => {
			if (!feedId) {
				if (syncingFeedId === ALL_FEEDS_SYNC_ID) {
					return false;
				}

				setFeedSyncError(null);
				setSyncingFeedId(ALL_FEEDS_SYNC_ID);

				try {
					await syncAllFeeds.mutateAsync();
					setAllFeedsRefreshQueuedAt(Date.now());
					setRefreshClock((tick) => tick + 1);
					void refetchAllFeedsSyncStatus();
					return true;
				} catch (error) {
					setFeedSyncError(error instanceof Error ? error.message : 'Unable to sync feeds');
					setAllFeedsRefreshQueuedAt(0);
					setSyncingFeedId((current) => (current === ALL_FEEDS_SYNC_ID ? null : current));
					return false;
				}
			}

			if (syncingFeedId === feedId) {
				return false;
			}

			const selectedFeed = feeds?.find((feed) => feed.id === feedId);
			const shouldAutoSync =
				options.force ||
				(!!selectedFeed && !selectedFeed.lastSyncedAt && (selectedFeed.unreadCount ?? 0) === 0) ||
				selectedFeed?.syncStatus === 'error';
			if (!shouldAutoSync) {
				setFeedSyncError(null);
				setSyncingFeedId(null);
				return false;
			}

			setFeedSyncError(null);
			setSyncingFeedId(feedId);

			try {
				await syncFeed.mutateAsync(feedId);
				return true;
			} catch (error) {
				setFeedSyncError(error instanceof Error ? error.message : 'Unable to sync feed');
				return false;
			} finally {
				setSyncingFeedId((current) => (current === feedId ? null : current));
			}
		},
		[
			feeds,
			refetchAllFeedsSyncStatus,
			setFeedSyncError,
			setSyncingFeedId,
			syncAllFeeds,
			syncFeed,
			syncingFeedId,
		],
	);

	return {
		feedSyncError,
		allFeedsSyncStatus,
		allFeedsRefreshActivity,
		isRefreshingAllFeeds,
		isRefreshingFeed: (feedId?: string) => !!feedId && syncingFeedId === feedId,
		refreshFeed,
	};
}
