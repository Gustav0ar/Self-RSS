import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	BulkSyncDeadlineError,
	feedHostname,
	syncFeedsForBulk,
} from '../../src/services/feed-sync-bulk.js';

interface TestFeed {
	id: string;
	feedUrl: string;
}

const feed = (id: string, feedUrl: string): TestFeed => ({ id, feedUrl });
const groupByHostname = (item: TestFeed) => feedHostname(item.feedUrl, item.id);

describe('syncFeedsForBulk', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('runs different domains concurrently while serializing feeds on the same domain', async () => {
		const started: string[] = [];
		const releases = new Map<string, () => void>();
		const syncPromise = syncFeedsForBulk({
			feeds: [
				feed('same-1', 'https://news.example.com/one.xml'),
				feed('same-2', 'https://news.example.com/two.xml'),
				feed('other', 'https://other.example.net/feed.xml'),
			],
			groupBy: groupByHostname,
			deadlineMs: 5_000,
			syncFeed: (item) =>
				new Promise((resolve) => {
					started.push(item.id);
					releases.set(item.id, () => resolve({ newArticles: 1, total: 1 }));
				}),
		});

		await vi.waitFor(() => expect(started).toEqual(['same-1', 'other']));
		releases.get('same-1')?.();
		await vi.waitFor(() => expect(started).toEqual(['same-1', 'other', 'same-2']));
		releases.get('same-2')?.();
		releases.get('other')?.();

		await expect(syncPromise).resolves.toEqual({
			syncedFeeds: 3,
			failedFeeds: 0,
			skippedFeeds: 0,
			newArticles: 3,
		});
	});

	it('continues a domain queue after one feed fails and reports progress', async () => {
		const started: string[] = [];
		const progress: number[] = [];
		const errors: string[] = [];
		const result = await syncFeedsForBulk({
			feeds: [
				feed('bad', 'https://example.com/bad.xml'),
				feed('good', 'https://example.com/good.xml'),
			],
			groupBy: groupByHostname,
			deadlineMs: 5_000,
			syncFeed: async (item) => {
				started.push(item.id);
				if (item.id === 'bad') throw new Error('publisher failed');
				return { newArticles: 2, total: 2 };
			},
			onFeedError: (item) => errors.push(item.id),
			onProgress: ({ completedFeeds }) => {
				progress.push(completedFeeds);
			},
		});

		expect(started).toEqual(['bad', 'good']);
		expect(errors).toEqual(['bad']);
		expect(progress).toEqual([1, 2]);
		expect(result).toEqual({
			syncedFeeds: 1,
			failedFeeds: 1,
			skippedFeeds: 0,
			newArticles: 2,
		});
	});

	it('counts guarded and missing feeds as skipped without failing the batch', async () => {
		const result = await syncFeedsForBulk({
			feeds: [
				feed('guarded', 'https://one.example/feed'),
				feed('missing', 'https://two.example/feed'),
			],
			groupBy: groupByHostname,
			deadlineMs: 5_000,
			syncFeed: async (item) =>
				item.id === 'guarded' ? { newArticles: 0, total: 0, skipped: true } : null,
		});

		expect(result).toEqual({
			syncedFeeds: 0,
			failedFeeds: 0,
			skippedFeeds: 2,
			newArticles: 0,
		});
	});

	it('aborts active work at the deadline and fails every unfinished feed', async () => {
		vi.useFakeTimers();
		const errors: Array<{ id: string; error: unknown }> = [];
		const observedSignals: AbortSignal[] = [];
		const syncPromise = syncFeedsForBulk({
			feeds: [
				feed('active', 'https://example.com/active'),
				feed('waiting', 'https://example.com/waiting'),
			],
			groupBy: groupByHostname,
			deadlineMs: 300,
			syncFeed: (_item, signal) => {
				observedSignals.push(signal);
				return new Promise((_resolve, reject) => {
					signal.addEventListener('abort', () => reject(signal.reason), { once: true });
				});
			},
			onFeedError: (item, error) => errors.push({ id: item.id, error }),
		});

		await vi.advanceTimersByTimeAsync(300);
		await expect(syncPromise).resolves.toEqual({
			syncedFeeds: 0,
			failedFeeds: 2,
			skippedFeeds: 0,
			newArticles: 0,
		});
		expect(observedSignals).toHaveLength(1);
		expect(observedSignals[0]?.aborted).toBe(true);
		expect(errors.map(({ id }) => id).sort()).toEqual(['active', 'waiting']);
		expect(errors.every(({ error }) => error instanceof BulkSyncDeadlineError)).toBe(true);
	});

	it('uses a unique fallback group for malformed feed URLs', () => {
		expect(feedHostname('not a url', 'feed-1')).toBe('feed-1');
		expect(feedHostname('https://EXAMPLE.com:8443/feed', 'feed-2')).toBe('example.com');
	});
});
