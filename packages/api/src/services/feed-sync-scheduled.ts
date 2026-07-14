interface ScheduledFeed {
	id: string;
	userId: string;
}

interface ScheduledSyncOptions<TFeed extends ScheduledFeed> {
	feeds: TFeed[];
	concurrency: number;
	syncFeed: (feed: TFeed) => Promise<unknown>;
}

export async function syncScheduledFeeds<TFeed extends ScheduledFeed>({
	feeds,
	concurrency,
	syncFeed,
}: ScheduledSyncOptions<TFeed>) {
	let succeeded = 0;
	let failed = 0;
	let nextFeedIndex = 0;
	const workerCount = Math.min(Math.max(1, concurrency), feeds.length);

	const worker = async () => {
		while (nextFeedIndex < feeds.length) {
			const feed = feeds[nextFeedIndex];
			nextFeedIndex += 1;
			if (!feed) continue;
			try {
				await syncFeed(feed);
				succeeded += 1;
			} catch {
				failed += 1;
			}
		}
	};

	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	return { total: feeds.length, succeeded, failed };
}
