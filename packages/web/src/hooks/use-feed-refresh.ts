import { useCallback } from 'react';
import { useFeeds, useSyncAllFeeds, useSyncFeed } from '@/hooks/queries';
import { useAppState } from '@/providers/app-state';

const ALL_FEEDS_SYNC_ID = '__all_feeds__';

interface RefreshOptions {
	force?: boolean;
}

export function useFeedRefresh() {
	const { data: feeds } = useFeeds();
	const syncAllFeeds = useSyncAllFeeds();
	const syncFeed = useSyncFeed();
	const { feedSyncError, setFeedSyncError, setSyncingFeedId, syncingFeedId } = useAppState();

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
					return true;
				} catch (error) {
					setFeedSyncError(error instanceof Error ? error.message : 'Unable to sync feeds');
					return false;
				} finally {
					setSyncingFeedId((current) => (current === ALL_FEEDS_SYNC_ID ? null : current));
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
		[feeds, setFeedSyncError, setSyncingFeedId, syncAllFeeds, syncFeed, syncingFeedId],
	);

	return {
		feedSyncError,
		isRefreshingAllFeeds: syncingFeedId === ALL_FEEDS_SYNC_ID,
		isRefreshingFeed: (feedId?: string) => !!feedId && syncingFeedId === feedId,
		refreshFeed,
	};
}
