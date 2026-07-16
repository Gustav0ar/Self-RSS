export interface BulkSyncFeed {
	id: string;
}

export interface BulkSyncFeedResult {
	newArticles: number;
	total: number;
	skipped?: true;
}

export interface BulkSyncResult {
	syncedFeeds: number;
	failedFeeds: number;
	skippedFeeds: number;
	newArticles: number;
}

interface BulkSyncOptions<TFeed extends BulkSyncFeed> {
	feeds: TFeed[];
	concurrency: number;
	syncFeed: (feed: TFeed) => Promise<BulkSyncFeedResult | null>;
	onFeedError?: (feed: TFeed, error: unknown) => void;
	onProgress?: (
		progress: BulkSyncResult & { completedFeeds: number; totalFeeds: number },
	) => Promise<void> | void;
}

export async function syncFeedsForBulk<TFeed extends BulkSyncFeed>({
	feeds,
	concurrency,
	syncFeed,
	onFeedError,
	onProgress,
}: BulkSyncOptions<TFeed>): Promise<BulkSyncResult> {
	let syncedFeeds = 0;
	let failedFeeds = 0;
	let skippedFeeds = 0;
	let newArticles = 0;
	let nextFeedIndex = 0;
	let completedFeeds = 0;

	const worker = async () => {
		while (nextFeedIndex < feeds.length) {
			const currentIndex = nextFeedIndex;
			nextFeedIndex += 1;
			const feed = feeds[currentIndex];
			if (!feed) {
				continue;
			}
			try {
				// An existing per-feed lock means a scheduled or manual fetch is
				// already doing this work. Treat the new command as a no-op instead
				// of waiting and then hitting the publisher again.
				const result = await syncFeed(feed);
				if (!result) {
					continue;
				}
				if (result.skipped) {
					skippedFeeds += 1;
				} else {
					syncedFeeds += 1;
					newArticles += result.newArticles;
				}
			} catch (error) {
				failedFeeds += 1;
				onFeedError?.(feed, error);
			} finally {
				completedFeeds += 1;
				await onProgress?.({
					syncedFeeds,
					failedFeeds,
					skippedFeeds,
					newArticles,
					completedFeeds,
					totalFeeds: feeds.length,
				});
			}
		}
	};

	await Promise.all(
		Array.from({ length: Math.min(Math.max(1, concurrency), feeds.length) }, () => worker()),
	);

	return { syncedFeeds, failedFeeds, skippedFeeds, newArticles };
}
