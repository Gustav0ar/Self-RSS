import { type BulkSyncFeedResult, feedHostname, syncFeedsForBulk } from './feed-sync-bulk.js';
import type { ManualSyncScope } from './feed-sync-status.js';

const MANUAL_FEED_SYNC_DEADLINE_MS = 5 * 60_000;
const MANUAL_FEED_SYNC_MIN_INTERVAL_MS = 2 * 60_000;

interface ManualSyncFeed {
	id: string;
	feedUrl: string;
}

export interface ManualSyncProgress {
	totalFeeds: number;
	completedFeeds: number;
	syncedFeeds: number;
	failedFeeds: number;
	skippedFeeds: number;
	newArticles: number;
}

interface ManualFeedBatchOptions<TFeed extends ManualSyncFeed> {
	feeds: TFeed[];
	categoryFeedIds: Set<string>;
	scope: ManualSyncScope;
	syncFeed: (
		feed: TFeed,
		controls: { signal: AbortSignal; skipIfSyncedWithinMs: number },
	) => Promise<BulkSyncFeedResult | null>;
	onFeedError?: (feed: TFeed, error: unknown) => void;
	onProgress?: (progress: ManualSyncProgress) => Promise<void> | void;
}

export async function syncManualFeedBatch<TFeed extends ManualSyncFeed>({
	feeds,
	categoryFeedIds,
	scope,
	syncFeed,
	onFeedError,
	onProgress,
}: ManualFeedBatchOptions<TFeed>) {
	// Feed scope wins over category scope when both legacy parameters are present.
	const syncableFeeds = scope.feedId
		? feeds.filter((feed) => feed.id === scope.feedId)
		: scope.categoryId
			? feeds.filter((feed) => categoryFeedIds.has(feed.id))
			: feeds;

	if (syncableFeeds.length === 0) {
		return {
			totalFeeds: 0,
			syncedFeeds: 0,
			failedFeeds: 0,
			skippedFeeds: 0,
			newArticles: 0,
		};
	}

	const result = await syncFeedsForBulk({
		feeds: syncableFeeds,
		groupBy: (feed) => feedHostname(feed.feedUrl, feed.id),
		deadlineMs: MANUAL_FEED_SYNC_DEADLINE_MS,
		syncFeed: (feed, signal) =>
			syncFeed(feed, { signal, skipIfSyncedWithinMs: MANUAL_FEED_SYNC_MIN_INTERVAL_MS }),
		onFeedError,
		onProgress,
	});
	return { totalFeeds: syncableFeeds.length, ...result };
}
