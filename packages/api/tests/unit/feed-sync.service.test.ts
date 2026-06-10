import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedSyncService } from '../../src/services/feed-sync.service.js';

describe('FeedSyncService', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('stores feed content immediately and triggers lazy enrichment for new articles', async () => {
		const feedRepo = {
			findById: vi.fn(async () => ({
				id: 'feed-1',
				title: 'Ah Negao',
				feedUrl: 'https://example.com/feed.xml',
				userId: 'user-1',
			})),
			update: vi.fn(async () => undefined),
		};

		const articleRepo = {
			findExistingGuids: vi.fn(async () => []),
			findByFeedAndGuids: vi.fn(async () => []),
			insertMany: vi.fn(async (data: Array<Record<string, unknown>>) =>
				data.map((item, index) => ({ id: `article-${index + 1}`, ...item })),
			),
			insertMedia: vi.fn(async () => undefined),
			updateContent: vi.fn(async () => undefined),
			replaceMedia: vi.fn(async () => undefined),
		};

		const syncRunRepo = {
			create: vi.fn(async () => ({ id: 'run-1' })),
			complete: vi.fn(async () => undefined),
		};

		const metricsRepo = {
			incrementSyncCount: vi.fn(async () => undefined),
		};

		const redis = {
			del: vi.fn(async () => 0),
		};

		const service = new FeedSyncService(
			feedRepo as never,
			articleRepo as never,
			syncRunRepo as never,
			metricsRepo as never,
			redis as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 1, allowPrivateHosts: false },
		);

		const fetchAndParseSpy = vi.spyOn(
			service as unknown as { fetchAndParse: () => Promise<unknown> },
			'fetchAndParse',
		);
		fetchAndParseSpy.mockResolvedValue({
			title: 'Ah Negao',
			items: [
				{
					guid: 'guid-1',
					link: 'https://example.com/post-1',
					title: 'Post 1',
					description: 'Only text in the RSS feed',
				},
			],
		} as never);

		const enrichSpy = vi
			.spyOn(
				service as unknown as { enrichArticlesInBackground: () => Promise<void> },
				'enrichArticlesInBackground',
			)
			.mockResolvedValue(undefined);

		const result = await service.syncFeed('feed-1', 'user-1');

		expect(articleRepo.insertMany).toHaveBeenCalledWith([
			expect.objectContaining({
				contentHtml: 'Only text in the RSS feed',
				heroImageUrl: null,
			}),
		]);
		expect(articleRepo.insertMedia).not.toHaveBeenCalled();
		expect(enrichSpy).toHaveBeenCalledWith([
			expect.objectContaining({
				articleId: 'article-1',
				canonicalUrl: 'https://example.com/post-1',
			}),
		]);
		expect(result).toEqual({ newArticles: 1, total: 1 });
	});

	it('schedules lazy enrichment for existing text-only articles', async () => {
		const feedRepo = {
			findById: vi.fn(async () => ({
				id: 'feed-1',
				title: 'Ah Negao',
				feedUrl: 'https://example.com/feed.xml',
				userId: 'user-1',
			})),
			update: vi.fn(async () => undefined),
		};

		const articleRepo = {
			findExistingGuids: vi.fn(async () => []),
			findByFeedAndGuids: vi.fn(async () => [
				{
					id: 'article-1',
					guid: 'guid-1',
					contentHtml: '<p>Only text</p>',
					heroImageUrl: null,
				},
			]),
			insertMany: vi.fn(async () => []),
			insertMedia: vi.fn(async () => undefined),
			updateContent: vi.fn(async () => undefined),
			replaceMedia: vi.fn(async () => undefined),
		};

		const syncRunRepo = {
			create: vi.fn(async () => ({ id: 'run-1' })),
			complete: vi.fn(async () => undefined),
		};

		const metricsRepo = {
			incrementSyncCount: vi.fn(async () => undefined),
		};

		const redis = {
			del: vi.fn(async () => 0),
		};

		const service = new FeedSyncService(
			feedRepo as never,
			articleRepo as never,
			syncRunRepo as never,
			metricsRepo as never,
			redis as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 1, allowPrivateHosts: false },
		);

		const fetchAndParseSpy = vi.spyOn(
			service as unknown as { fetchAndParse: () => Promise<unknown> },
			'fetchAndParse',
		);
		fetchAndParseSpy.mockResolvedValue({
			title: 'Ah Negao',
			items: [
				{
					guid: 'guid-1',
					link: 'https://example.com/post-1',
					title: 'Post 1',
					description: 'Only text in the RSS feed',
				},
			],
		} as never);

		const enrichSpy = vi
			.spyOn(
				service as unknown as { enrichArticlesInBackground: () => Promise<void> },
				'enrichArticlesInBackground',
			)
			.mockResolvedValue(undefined);

		await service.syncFeed('feed-1', 'user-1');

		expect(articleRepo.updateContent).not.toHaveBeenCalled();
		expect(enrichSpy).toHaveBeenCalledWith([
			expect.objectContaining({
				articleId: 'article-1',
				canonicalUrl: 'https://example.com/post-1',
			}),
		]);
	});

	it('syncs every non-active feed for a user with summary counts', async () => {
		const feedRepo = {
			findAllByUser: vi.fn(async () => [
				{ id: 'feed-1', syncStatus: 'idle' },
				{ id: 'feed-2', syncStatus: 'error' },
				{ id: 'feed-3', syncStatus: 'syncing' },
			]),
			update: vi.fn(async () => undefined),
		};

		const service = new FeedSyncService(
			feedRepo as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 2, allowPrivateHosts: false },
		);

		const syncFeedSpy = vi.spyOn(service, 'syncFeed');
		syncFeedSpy.mockImplementation(async (feedId) => {
			if (feedId === 'feed-2') {
				throw new Error('sync failed');
			}

			return { newArticles: 2, total: 4 };
		});

		const result = await service.syncAllFeeds('user-1');

		expect(feedRepo.findAllByUser).toHaveBeenCalledWith('user-1');
		expect(feedRepo.update).toHaveBeenCalledWith('feed-3', 'user-1', { syncStatus: 'idle' });
		expect(syncFeedSpy).toHaveBeenCalledTimes(3);
		expect(syncFeedSpy).toHaveBeenCalledWith('feed-1', 'user-1', {
			enrichArticles: false,
			warmArticleCache: false,
		});
		expect(syncFeedSpy).toHaveBeenCalledWith('feed-2', 'user-1', {
			enrichArticles: false,
			warmArticleCache: false,
		});
		expect(syncFeedSpy).toHaveBeenCalledWith('feed-3', 'user-1', {
			enrichArticles: false,
			warmArticleCache: false,
		});
		expect(result).toEqual({
			totalFeeds: 3,
			syncedFeeds: 2,
			failedFeeds: 1,
			skippedFeeds: 0,
			newArticles: 4,
		});
	});

	it('returns syncDueFeeds summary counts without retaining all results', async () => {
		const feedRepo = {
			findDueForSync: vi.fn(async () => [
				{ id: 'feed-1', userId: 'user-1' },
				{ id: 'feed-2', userId: 'user-1' },
				{ id: 'feed-3', userId: 'user-2' },
			]),
		};

		const service = new FeedSyncService(
			feedRepo as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 2, allowPrivateHosts: false },
		);

		const syncFeedSpy = vi.spyOn(service, 'syncFeed');
		syncFeedSpy.mockImplementation(async (feedId) => {
			if (feedId === 'feed-2') {
				throw new Error('sync failed');
			}
			return { newArticles: 1, total: 1 };
		});

		const result = await service.syncDueFeeds();

		expect(feedRepo.findDueForSync).toHaveBeenCalledWith(2);
		expect(result).toEqual({ total: 3, succeeded: 2, failed: 1 });
	});

	it('continues scheduling remaining feeds after timeouts or failures', async () => {
		const feedRepo = {
			findAllByUser: vi.fn(async () => [
				{ id: 'feed-1', syncStatus: 'idle' },
				{ id: 'feed-2', syncStatus: 'idle' },
				{ id: 'feed-3', syncStatus: 'idle' },
			]),
		};

		const service = new FeedSyncService(
			feedRepo as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 1, allowPrivateHosts: false },
		);

		const started: string[] = [];
		const releases = new Map<string, () => void>();
		const syncFeedSpy = vi.spyOn(service, 'syncFeed');
		syncFeedSpy.mockImplementation(
			(feedId) =>
				new Promise((resolve, reject) => {
					started.push(feedId);
					releases.set(feedId, () => {
						if (feedId === 'feed-1') {
							reject(new Error('HTTP 504: Gateway Timeout'));
							return;
						}
						resolve({ newArticles: 1, total: 1 });
					});
				}),
		);

		const syncPromise = service.syncAllFeeds('user-1');
		await vi.waitFor(() => {
			expect(started).toEqual(['feed-1']);
		});

		releases.get('feed-1')?.();
		await vi.waitFor(() => {
			expect(started).toEqual(['feed-1', 'feed-2']);
		});
		releases.get('feed-2')?.();
		await vi.waitFor(() => {
			expect(started).toEqual(['feed-1', 'feed-2', 'feed-3']);
		});
		releases.get('feed-3')?.();
		const result = await syncPromise;

		for (const call of syncFeedSpy.mock.calls) {
			expect(call[2]).toEqual({ enrichArticles: false, warmArticleCache: false });
		}

		expect(result).toEqual({
			totalFeeds: 3,
			syncedFeeds: 2,
			failedFeeds: 1,
			skippedFeeds: 0,
			newArticles: 2,
		});
	});

	it('queues bulk refresh once per user', async () => {
		const redis = {
			set: vi.fn(async () => 'OK'),
			rpush: vi.fn(async () => 1),
		};
		const service = new FeedSyncService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			redis as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 2, allowPrivateHosts: false },
		);

		const result = await service.queueSyncAllFeeds('user-1');

		expect(redis.set).toHaveBeenCalledWith('feed:sync-all:queued:user-1', '1', 'EX', 1800, 'NX');
		expect(redis.rpush).toHaveBeenCalledWith('feed:sync-all:queue', 'user-1');
		expect(result).toEqual({ accepted: true, alreadyQueued: false });
	});

	it('deduplicates already queued bulk refreshes', async () => {
		const redis = {
			set: vi.fn(async () => null),
			rpush: vi.fn(async () => 1),
		};
		const service = new FeedSyncService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			redis as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 2, allowPrivateHosts: false },
		);

		const result = await service.queueSyncAllFeeds('user-1');

		expect(redis.rpush).not.toHaveBeenCalled();
		expect(result).toEqual({ accepted: true, alreadyQueued: true });
	});

	it('reports queued bulk refresh status', async () => {
		const redis = {
			exists: vi.fn(async (key: string) => (key.includes(':queued:') ? 1 : 0)),
		};
		const service = new FeedSyncService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			redis as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 2, allowPrivateHosts: false },
		);

		const result = await service.getSyncAllFeedsStatus('user-1');

		expect(redis.exists).toHaveBeenCalledWith('feed:sync-all:queued:user-1');
		expect(redis.exists).toHaveBeenCalledWith('feed:sync-all:lock:user-1');
		expect(result).toEqual({ queued: true, running: false, active: true });
	});

	it('reports running bulk refresh status', async () => {
		const redis = {
			exists: vi.fn(async (key: string) => (key.includes(':lock:') ? 1 : 0)),
		};
		const service = new FeedSyncService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			redis as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 2, allowPrivateHosts: false },
		);

		const result = await service.getSyncAllFeedsStatus('user-1');

		expect(result).toEqual({ queued: false, running: true, active: true });
	});

	it('processes the next queued bulk refresh and clears queue state', async () => {
		const redis = {
			lpop: vi.fn(async () => 'user-1'),
			set: vi.fn(async () => 'OK'),
			del: vi.fn(async () => 2),
		};
		const service = new FeedSyncService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			redis as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 2, allowPrivateHosts: false },
		);
		const syncAllSpy = vi.spyOn(service, 'syncAllFeeds').mockResolvedValue({
			totalFeeds: 2,
			syncedFeeds: 2,
			failedFeeds: 0,
			skippedFeeds: 0,
			newArticles: 3,
		});

		const result = await service.processNextQueuedSyncAllFeeds();

		expect(redis.lpop).toHaveBeenCalledWith('feed:sync-all:queue');
		expect(redis.set).toHaveBeenCalledWith('feed:sync-all:lock:user-1', '1', 'EX', 1800, 'NX');
		expect(syncAllSpy).toHaveBeenCalledWith('user-1');
		expect(redis.del).toHaveBeenCalledWith(
			'feed:sync-all:lock:user-1',
			'feed:sync-all:queued:user-1',
		);
		expect(result).toEqual({
			userId: 'user-1',
			skipped: false,
			result: {
				totalFeeds: 2,
				syncedFeeds: 2,
				failedFeeds: 0,
				skippedFeeds: 0,
				newArticles: 3,
			},
		});
	});

	it('skips expensive processing for existing items during bulk sync prefetch', async () => {
		const feedRepo = {
			findById: vi.fn(async () => ({
				id: 'feed-1',
				title: 'Bulk Feed',
				feedUrl: 'https://example.com/feed.xml',
				userId: 'user-1',
			})),
			update: vi.fn(async () => undefined),
		};

		const articleRepo = {
			findExistingGuids: vi.fn(async () => ['guid-1', 'guid-2']),
			findByFeedAndGuids: vi.fn(async () => []),
			insertMany: vi.fn(async () => []),
			insertMedia: vi.fn(async () => undefined),
			updateContent: vi.fn(async () => undefined),
			replaceMedia: vi.fn(async () => undefined),
		};

		const syncRunRepo = {
			create: vi.fn(async () => ({ id: 'run-1' })),
			complete: vi.fn(async () => undefined),
		};

		const metricsRepo = {
			incrementSyncCount: vi.fn(async () => undefined),
		};

		const redis = {
			del: vi.fn(async () => 0),
		};

		const service = new FeedSyncService(
			feedRepo as never,
			articleRepo as never,
			syncRunRepo as never,
			metricsRepo as never,
			redis as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 2, allowPrivateHosts: false },
		);

		const fetchAndParseSpy = vi.spyOn(
			service as unknown as { fetchAndParse: () => Promise<unknown> },
			'fetchAndParse',
		);
		fetchAndParseSpy.mockResolvedValue({
			title: 'Bulk Feed',
			items: [
				{ guid: 'guid-1', title: 'Known 1' },
				{ guid: 'guid-2', title: 'Known 2' },
			],
		} as never);

		const enrichSpy = vi
			.spyOn(
				service as unknown as { enrichArticlesInBackground: () => Promise<void> },
				'enrichArticlesInBackground',
			)
			.mockResolvedValue(undefined);

		const result = await service.syncFeed('feed-1', 'user-1', { enrichArticles: false });

		expect(articleRepo.findExistingGuids).toHaveBeenCalledWith('feed-1', ['guid-1', 'guid-2']);
		expect(articleRepo.findByFeedAndGuids).not.toHaveBeenCalled();
		expect(enrichSpy).not.toHaveBeenCalled();
		expect(articleRepo.insertMany).not.toHaveBeenCalled();
		expect(result).toEqual({ newArticles: 0, total: 2 });
	});

	it('skips reprocessing existing articles that already have full content and media', async () => {
		const feedRepo = {
			findById: vi.fn(async () => ({
				id: 'feed-1',
				title: 'Existing Feed',
				feedUrl: 'https://example.com/feed.xml',
				userId: 'user-1',
			})),
			update: vi.fn(async () => undefined),
		};

		const articleRepo = {
			findByFeedAndGuids: vi.fn(async () => [
				{
					id: 'article-1',
					guid: 'guid-1',
					contentHtml: '<p>Stored</p><img src="https://example.com/image.jpg" />',
					heroImageUrl: 'https://example.com/image.jpg',
				},
			]),
			insertMany: vi.fn(async () => []),
			insertMedia: vi.fn(async () => undefined),
			updateContent: vi.fn(async () => undefined),
			replaceMedia: vi.fn(async () => undefined),
		};

		const syncRunRepo = {
			create: vi.fn(async () => ({ id: 'run-1' })),
			complete: vi.fn(async () => undefined),
		};

		const metricsRepo = {
			incrementSyncCount: vi.fn(async () => undefined),
		};

		const redis = {
			del: vi.fn(async () => 0),
		};

		const service = new FeedSyncService(
			feedRepo as never,
			articleRepo as never,
			syncRunRepo as never,
			metricsRepo as never,
			redis as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 1, allowPrivateHosts: false },
		);

		const fetchAndParseSpy = vi.spyOn(
			service as unknown as { fetchAndParse: () => Promise<unknown> },
			'fetchAndParse',
		);
		fetchAndParseSpy.mockResolvedValue({
			title: 'Existing Feed',
			items: [
				{
					guid: 'guid-1',
					link: 'https://example.com/post-1',
					title: 'Post 1',
					description: '<p>Updated</p>',
				},
			],
		} as never);

		const enrichSpy = vi
			.spyOn(
				service as unknown as { enrichArticlesInBackground: () => Promise<void> },
				'enrichArticlesInBackground',
			)
			.mockResolvedValue(undefined);

		await service.syncFeed('feed-1', 'user-1');

		expect(enrichSpy).not.toHaveBeenCalled();
		expect(articleRepo.updateContent).not.toHaveBeenCalled();
		expect(articleRepo.insertMany).not.toHaveBeenCalled();
	});

	it('handles malformed object content from feeds without failing the sync', async () => {
		const feedRepo = {
			findById: vi.fn(async () => ({
				id: 'feed-1',
				title: 'Malformed Feed',
				feedUrl: 'https://example.com/feed.xml',
				userId: 'user-1',
			})),
			update: vi.fn(async () => undefined),
		};

		const articleRepo = {
			findExistingGuids: vi.fn(async () => []),
			findByFeedAndGuids: vi.fn(async () => []),
			insertMany: vi.fn(async (data: Array<Record<string, unknown>>) =>
				data.map((item, index) => ({ id: `article-${index + 1}`, ...item })),
			),
			insertMedia: vi.fn(async () => undefined),
			updateContent: vi.fn(async () => undefined),
			replaceMedia: vi.fn(async () => undefined),
		};

		const syncRunRepo = {
			create: vi.fn(async () => ({ id: 'run-1' })),
			complete: vi.fn(async () => undefined),
		};

		const metricsRepo = {
			incrementSyncCount: vi.fn(async () => undefined),
		};

		const redis = {
			del: vi.fn(async () => 0),
		};

		const service = new FeedSyncService(
			feedRepo as never,
			articleRepo as never,
			syncRunRepo as never,
			metricsRepo as never,
			redis as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 1, allowPrivateHosts: false },
		);

		const fetchAndParseSpy = vi.spyOn(
			service as unknown as { fetchAndParse: () => Promise<unknown> },
			'fetchAndParse',
		);
		fetchAndParseSpy.mockResolvedValue({
			title: 'Malformed Feed',
			items: [
				{
					guid: 'guid-1',
					link: 'https://example.com/post-1',
					title: 'Post 1',
					description: { '#text': 'Only text', nested: { value: 'plus more' } },
				},
			],
		} as never);

		const result = await service.syncFeed('feed-1', 'user-1');

		expect(articleRepo.insertMany).toHaveBeenCalledWith([
			expect.objectContaining({
				contentHtml: 'Only text plus more',
				contentText: 'Only text plus more',
			}),
		]);
		expect(result).toEqual({ newArticles: 1, total: 1 });
	});

	it('schedules canonical enrichment when feed HTML has no directly extractable media', async () => {
		const feedRepo = {
			findById: vi.fn(async () => ({
				id: 'feed-1',
				title: 'Fallback Feed',
				feedUrl: 'https://example.com/feed.xml',
				userId: 'user-1',
			})),
			update: vi.fn(async () => undefined),
		};

		const articleRepo = {
			findExistingGuids: vi.fn(async () => []),
			findByFeedAndGuids: vi.fn(async () => []),
			insertMany: vi.fn(async (data: Array<Record<string, unknown>>) =>
				data.map((item, index) => ({ id: `article-${index + 1}`, ...item })),
			),
			insertMedia: vi.fn(async () => undefined),
			updateContent: vi.fn(async () => undefined),
			replaceMedia: vi.fn(async () => undefined),
		};

		const syncRunRepo = {
			create: vi.fn(async () => ({ id: 'run-1' })),
			complete: vi.fn(async () => undefined),
		};

		const metricsRepo = {
			incrementSyncCount: vi.fn(async () => undefined),
		};

		const redis = {
			del: vi.fn(async () => 0),
		};

		const service = new FeedSyncService(
			feedRepo as never,
			articleRepo as never,
			syncRunRepo as never,
			metricsRepo as never,
			redis as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 1, allowPrivateHosts: false },
		);

		const fetchAndParseSpy = vi.spyOn(
			service as unknown as { fetchAndParse: () => Promise<unknown> },
			'fetchAndParse',
		);
		fetchAndParseSpy.mockResolvedValue({
			title: 'Fallback Feed',
			items: [
				{
					guid: 'guid-1',
					link: 'https://example.com/post-1',
					title: 'Post 1',
					description:
						'<div class="eosb_video_widget"><div id="eos-video-test-iframe"></div><script>const i = document.createElement("iframe"); i.src = "https://videopress.com/v/bskzi1r2?autoplay=1";</script></div>',
				},
			],
		} as never);

		const enrichSpy = vi
			.spyOn(
				service as unknown as { enrichArticlesInBackground: () => Promise<void> },
				'enrichArticlesInBackground',
			)
			.mockResolvedValue(undefined);

		await service.syncFeed('feed-1', 'user-1');

		expect(articleRepo.insertMedia).not.toHaveBeenCalled();
		expect(enrichSpy).toHaveBeenCalledWith([
			expect.objectContaining({
				articleId: 'article-1',
				canonicalUrl: 'https://example.com/post-1',
			}),
		]);
	});

	it('returns only new feed content when canonical page fetch fails', async () => {
		const feedRepo = {
			findById: vi.fn(async () => ({
				id: 'feed-1',
				title: 'Fallback Feed',
				feedUrl: 'https://example.com/feed.xml',
				userId: 'user-1',
			})),
			update: vi.fn(async () => undefined),
		};

		const articleRepo = {
			findExistingGuids: vi.fn(async () => []),
			findByFeedAndGuids: vi.fn(async () => []),
			insertMany: vi.fn(async (data: Array<Record<string, unknown>>) =>
				data.map((item, index) => ({ id: `article-${index + 1}`, ...item })),
			),
			insertMedia: vi.fn(async () => undefined),
			updateContent: vi.fn(async () => undefined),
			replaceMedia: vi.fn(async () => undefined),
		};

		const syncRunRepo = {
			create: vi.fn(async () => ({ id: 'run-1' })),
			complete: vi.fn(async () => undefined),
		};

		const metricsRepo = {
			incrementSyncCount: vi.fn(async () => undefined),
		};

		const redis = {
			del: vi.fn(async () => 0),
		};

		const service = new FeedSyncService(
			feedRepo as never,
			articleRepo as never,
			syncRunRepo as never,
			metricsRepo as never,
			redis as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 1, allowPrivateHosts: false },
		);

		const fetchAndParseSpy = vi.spyOn(
			service as unknown as { fetchAndParse: () => Promise<unknown> },
			'fetchAndParse',
		);
		fetchAndParseSpy.mockResolvedValue({
			title: 'Fallback Feed',
			items: [
				{
					guid: 'guid-1',
					link: 'https://example.com/post-1',
					title: 'Post 1',
					description: 'Simple feed content',
				},
			],
		} as never);

		const enrichSpy = vi
			.spyOn(
				service as unknown as { enrichArticlesInBackground: () => Promise<void> },
				'enrichArticlesInBackground',
			)
			.mockResolvedValue(undefined);

		const result = await service.syncFeed('feed-1', 'user-1');

		expect(articleRepo.insertMany).toHaveBeenCalledWith([
			expect.objectContaining({
				contentHtml: 'Simple feed content',
			}),
		]);
		expect(enrichSpy).toHaveBeenCalled();
		expect(result).toEqual({ newArticles: 1, total: 1 });
	});

	it('normalizes nested object metadata into strings', async () => {
		const feedRepo = {
			findById: vi.fn(async () => ({
				id: 'feed-1',
				title: 'Normalization Feed',
				feedUrl: 'https://example.com/feed.xml',
				userId: 'user-1',
			})),
			update: vi.fn(async () => undefined),
		};

		const articleRepo = {
			findExistingGuids: vi.fn(async () => []),
			findByFeedAndGuids: vi.fn(async () => []),
			insertMany: vi.fn(async (data: Array<Record<string, unknown>>) =>
				data.map((item, index) => ({ id: `article-${index + 1}`, ...item })),
			),
			insertMedia: vi.fn(async () => undefined),
			updateContent: vi.fn(async () => undefined),
			replaceMedia: vi.fn(async () => undefined),
		};

		const syncRunRepo = {
			create: vi.fn(async () => ({ id: 'run-1' })),
			complete: vi.fn(async () => undefined),
		};

		const metricsRepo = {
			incrementSyncCount: vi.fn(async () => undefined),
		};

		const redis = {
			del: vi.fn(async () => 0),
		};

		const service = new FeedSyncService(
			feedRepo as never,
			articleRepo as never,
			syncRunRepo as never,
			metricsRepo as never,
			redis as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 1, allowPrivateHosts: false },
		);

		const fetchAndParseSpy = vi.spyOn(
			service as unknown as { fetchAndParse: () => Promise<unknown> },
			'fetchAndParse',
		);
		fetchAndParseSpy.mockResolvedValue({
			title: { '#text': 'Normalization Feed' },
			link: { href: 'https://example.com' },
			description: { summary: 'Description text' },
			items: [
				{
					guid: { '#text': 'guid-1' },
					link: { href: 'https://example.com/post-1' },
					title: { '#text': 'Post 1' },
					creator: { name: 'Author' },
					description: { summary: 'Description text' },
					pubDate: { value: '2026-01-01T10:00:00.000Z' },
				},
			],
		} as never);

		await service.syncFeed('feed-1', 'user-1');

		expect(articleRepo.insertMany).toHaveBeenCalledWith([
			expect.objectContaining({
				guid: 'guid-1',
				canonicalUrl: 'https://example.com/post-1',
				title: 'Post 1',
				author: 'Author',
				excerpt: 'Description text',
			}),
		]);
		expect(feedRepo.update).toHaveBeenNthCalledWith(
			2,
			'feed-1',
			'user-1',
			expect.objectContaining({
				siteUrl: 'https://example.com',
				description: 'Description text',
			}),
		);
	});

	it('reconstructs naointendo posts HTML content correctly from JSON API', async () => {
		const service = new FeedSyncService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 1, allowPrivateHosts: true },
		);

		const originalFetch = globalThis.fetch;
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers({ 'content-type': 'application/json' }),
			text: async () =>
				JSON.stringify({
					post: {
						title: 'Test Post',
						description: '<p>Paragraph text</p>',
						media: {
							type: 'twitter',
							content: '123456789',
						},
					},
				}),
		});
		globalThis.fetch = mockFetch as unknown as typeof fetch;

		try {
			const content = await (
				service as unknown as {
					fetchArticlePageContent(canonicalUrl: string): Promise<string | null>;
				}
			).fetchArticlePageContent('https://www.naointendo.com.br/posts/12345-test-post');

			expect(content).toContain(
				'<iframe class="embedded-media embedded-media--x" src="https://platform.twitter.com/embed/Tweet.html?id=123456789"></iframe>',
			);
			expect(content).toContain('<p>Paragraph text</p>');
			expect(mockFetch).toHaveBeenCalledWith(
				'https://www.naointendo.com.br/api/posts/12345-test-post',
				expect.any(Object),
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
