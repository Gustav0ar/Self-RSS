import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	invalidateReaderQueries,
	useFeeds,
	useSyncAllFeeds,
	useSyncAllFeedsStatus,
	useSyncFeed,
} from '@/hooks/queries';
import { useAppState } from '@/providers/app-state';

const ALL_FEEDS_SYNC_ID = '__all_feeds__';

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
	const wasRefreshingAllFeeds = useRef(false);
	const isRefreshingAllFeeds =
		syncAllFeeds.isPending ||
		syncingFeedId === ALL_FEEDS_SYNC_ID ||
		allFeedsSyncStatus?.active === true;

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
		if (isRefreshingAllFeeds) {
			wasRefreshingAllFeeds.current = true;
			return;
		}

		if (!wasRefreshingAllFeeds.current) {
			return;
		}

		wasRefreshingAllFeeds.current = false;
		invalidateReaderQueries(qc);
	}, [isRefreshingAllFeeds, qc]);

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
		isRefreshingAllFeeds,
		isRefreshingFeed: (feedId?: string) => !!feedId && syncingFeedId === feedId,
		refreshFeed,
	};
}
