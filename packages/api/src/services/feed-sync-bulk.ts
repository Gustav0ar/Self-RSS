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
}

const BULK_SYNC_LOCK_RETRY_ATTEMPTS = 3;
const BULK_SYNC_LOCK_RETRY_DELAY_MS = 750;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncFeedWithLockRetry<TFeed extends BulkSyncFeed>(
	feed: TFeed,
	syncFeed: (feed: TFeed) => Promise<BulkSyncFeedResult | null>,
) {
	let lastResult: BulkSyncFeedResult | null = null;
	for (let attempt = 1; attempt <= BULK_SYNC_LOCK_RETRY_ATTEMPTS; attempt += 1) {
		const result = await syncFeed(feed);
		lastResult = result;
		if (!result?.skipped) {
			return result;
		}
		if (attempt < BULK_SYNC_LOCK_RETRY_ATTEMPTS) {
			await sleep(BULK_SYNC_LOCK_RETRY_DELAY_MS * attempt);
		}
	}
	return lastResult;
}

export async function syncFeedsForBulk<TFeed extends BulkSyncFeed>({
	feeds,
	concurrency,
	syncFeed,
	onFeedError,
}: BulkSyncOptions<TFeed>): Promise<BulkSyncResult> {
	let syncedFeeds = 0;
	let failedFeeds = 0;
	let skippedFeeds = 0;
	let newArticles = 0;
	let nextFeedIndex = 0;

	const worker = async () => {
		while (nextFeedIndex < feeds.length) {
			const currentIndex = nextFeedIndex;
			nextFeedIndex += 1;
			const feed = feeds[currentIndex];
			if (!feed) {
				continue;
			}
			try {
				const result = await syncFeedWithLockRetry(feed, syncFeed);
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
			}
		}
	};

	await Promise.all(
		Array.from({ length: Math.min(Math.max(1, concurrency), feeds.length) }, () => worker()),
	);

	return { syncedFeeds, failedFeeds, skippedFeeds, newArticles };
}
