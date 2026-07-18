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
	groupBy: (feed: TFeed) => string;
	maxConcurrency: number;
	deadlineMs: number;
	syncFeed: (feed: TFeed, signal: AbortSignal) => Promise<BulkSyncFeedResult | null>;
	onFeedError?: (feed: TFeed, error: unknown) => void;
	onProgress?: (
		progress: BulkSyncResult & { completedFeeds: number; totalFeeds: number },
	) => Promise<void> | void;
}

export class BulkSyncDeadlineError extends Error {
	constructor(readonly deadlineMs: number) {
		super(`All feeds refresh exceeded its ${Math.floor(deadlineMs / 1000)}-second deadline`);
		this.name = 'BulkSyncDeadlineError';
	}
}

export function feedHostname(feedUrl: string, fallback: string) {
	try {
		return new URL(feedUrl).hostname.toLowerCase() || fallback;
	} catch {
		return fallback;
	}
}

export async function syncFeedsForBulk<TFeed extends BulkSyncFeed>({
	feeds,
	groupBy,
	maxConcurrency,
	deadlineMs,
	syncFeed,
	onFeedError,
	onProgress,
}: BulkSyncOptions<TFeed>): Promise<BulkSyncResult> {
	const result: BulkSyncResult = {
		syncedFeeds: 0,
		failedFeeds: 0,
		skippedFeeds: 0,
		newArticles: 0,
	};
	let completedFeeds = 0;
	let deadlineReached = false;
	const completedFeedIds = new Set<string>();
	const controller = new AbortController();
	const groups = new Map<string, TFeed[]>();
	for (const feed of feeds) {
		const key = groupBy(feed);
		groups.set(key, [...(groups.get(key) ?? []), feed]);
	}

	const reportProgress = () =>
		onProgress?.({ ...result, completedFeeds, totalFeeds: feeds.length });
	const finishFeed = async (
		feed: TFeed,
		outcome: 'synced' | 'failed' | 'skipped',
		newArticles = 0,
		error?: unknown,
	) => {
		if (completedFeedIds.has(feed.id)) return;
		completedFeedIds.add(feed.id);
		completedFeeds += 1;
		if (outcome === 'synced') {
			result.syncedFeeds += 1;
			result.newArticles += newArticles;
		} else if (outcome === 'skipped') {
			result.skippedFeeds += 1;
		} else {
			result.failedFeeds += 1;
			onFeedError?.(feed, error);
		}
		await reportProgress();
	};

	const runGroup = async (groupFeeds: TFeed[]) => {
		for (const feed of groupFeeds) {
			if (deadlineReached) return;
			try {
				const feedResult = await syncFeed(feed, controller.signal);
				if (!feedResult) {
					await finishFeed(feed, 'skipped');
				} else if (feedResult.skipped) {
					await finishFeed(feed, 'skipped');
				} else {
					await finishFeed(feed, 'synced', feedResult.newArticles);
				}
			} catch (error) {
				await finishFeed(feed, 'failed', 0, error);
			}
		}
	};

	let resolveDeadline: () => void = () => undefined;
	const deadlinePromise = new Promise<void>((resolve) => {
		resolveDeadline = resolve;
	});
	const deadlineError = new BulkSyncDeadlineError(deadlineMs);
	const deadlineTimer = setTimeout(() => {
		deadlineReached = true;
		controller.abort(deadlineError);
		resolveDeadline();
	}, deadlineMs);
	const groupQueues = [...groups.values()];
	let nextGroupIndex = 0;
	const runWorker = async () => {
		while (!deadlineReached) {
			const groupIndex = nextGroupIndex;
			nextGroupIndex += 1;
			const group = groupQueues[groupIndex];
			if (!group) return;
			await runGroup(group);
		}
	};
	const workerCount = Math.min(Math.max(1, maxConcurrency), groupQueues.length);
	const workers = Promise.all(Array.from({ length: workerCount }, () => runWorker()));
	const outcome = await Promise.race([
		workers.then(() => 'completed' as const),
		deadlinePromise.then(() => 'deadline' as const),
	]);

	if (outcome === 'deadline') {
		for (const feed of feeds) {
			if (!completedFeedIds.has(feed.id)) {
				completedFeedIds.add(feed.id);
				completedFeeds += 1;
				result.failedFeeds += 1;
				onFeedError?.(feed, deadlineError);
			}
		}
		await reportProgress();
		void workers.catch(() => undefined);
	} else {
		clearTimeout(deadlineTimer);
	}

	return result;
}
