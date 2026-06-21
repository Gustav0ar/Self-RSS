import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedSyncService } from '../../src/services/feed-sync.service.js';

describe('FeedSyncService', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('skips article enrichment when another worker holds the article lock', async () => {
		const redis = {
			set: vi.fn(async () => null),
			del: vi.fn(async () => 0),
		};
		const service = new FeedSyncService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			redis as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 1, allowPrivateHosts: false },
		);
		const resolveSpy = vi
			.spyOn(
				service as unknown as {
					resolveEnrichedArticleHtml: () => Promise<string | null>;
				},
				'resolveEnrichedArticleHtml',
			)
			.mockResolvedValue('<p>Enriched</p>');

		await (
			service as unknown as {
				enrichSingleArticle: (enrichment: {
					articleId: string;
					userId: string;
					canonicalUrl: string;
					contentHtml: string | null;
					heroImageUrl: string | null;
					fetchedAt: Date;
				}) => Promise<void>;
			}
		).enrichSingleArticle({
			articleId: 'article-1',
			userId: 'user-1',
			canonicalUrl: 'https://example.com/post-1',
			contentHtml: null,
			heroImageUrl: null,
			fetchedAt: new Date('2026-01-01T00:00:00.000Z'),
		});

		expect(redis.set).toHaveBeenCalledWith('articles:enriching:article-1', '1', 'EX', 60, 'NX');
		expect(resolveSpy).not.toHaveBeenCalled();
		expect(redis.del).not.toHaveBeenCalled();
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
			persistSyncResults: vi.fn(
				async ({ articlesToInsert }: { articlesToInsert: Array<Record<string, unknown>> }) =>
					articlesToInsert.map((item, index) => ({ id: `article-${index + 1}`, ...item })),
			),
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

		expect(articleRepo.persistSyncResults).toHaveBeenCalledWith(
			expect.objectContaining({
				articlesToInsert: [
					expect.objectContaining({
						contentHtml: 'Only text in the RSS feed',
						heroImageUrl: null,
					}),
				],
			}),
		);
		expect(enrichSpy).toHaveBeenCalledWith([
			expect.objectContaining({
				articleId: 'article-1',
				canonicalUrl: 'https://example.com/post-1',
			}),
		]);
		expect(result).toEqual({ newArticles: 1, total: 1 });
	});

	it('records malformed item failures without failing the whole feed sync', async () => {
		const badTitle: Record<string, unknown> = {};
		Object.defineProperty(badTitle, 'value', {
			enumerable: true,
			get() {
				throw new Error('bad title payload');
			},
		});
		const feedRepo = {
			findById: vi.fn(async () => ({
				id: 'feed-1',
				title: 'Feed',
				feedUrl: 'https://example.com/feed.xml',
				userId: 'user-1',
				pollingIntervalMinutes: 60,
			})),
			update: vi.fn(async () => undefined),
		};
		const articleRepo = {
			findExistingGuids: vi.fn(async () => []),
			findByFeedAndGuids: vi.fn(async () => []),
			persistSyncResults: vi.fn(
				async ({ articlesToInsert }: { articlesToInsert: Array<Record<string, unknown>> }) =>
					articlesToInsert.map((item, index) => ({ id: `article-${index + 1}`, ...item })),
			),
		};
		const syncRunRepo = {
			create: vi.fn(async () => ({ id: 'run-1' })),
			complete: vi.fn(async () => undefined),
		};
		const metricsRepo = {
			incrementSyncCount: vi.fn(async () => undefined),
		};
		const redis = {
			set: vi.fn(async () => 'OK'),
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
		vi.spyOn(
			service as unknown as { fetchAndParse: () => Promise<unknown> },
			'fetchAndParse',
		).mockResolvedValue({
			title: 'Feed',
			items: [
				{ guid: 'good-1', title: 'Good post', description: 'Readable text' },
				{ guid: 'bad-1', title: badTitle, description: 'Unreadable text' },
			],
		} as never);

		const result = await service.syncFeed('feed-1', 'user-1');

		expect(articleRepo.persistSyncResults).toHaveBeenCalledWith(
			expect.objectContaining({
				articlesToInsert: [expect.objectContaining({ guid: 'good-1' })],
			}),
		);
		expect(syncRunRepo.complete).toHaveBeenCalledWith(
			'run-1',
			expect.objectContaining({
				status: 'success',
				errorMessage: 'Skipped 1 malformed article item(s)',
			}),
		);
		expect(result).toEqual({ newArticles: 1, total: 2 });
	});

	it('derives enriched text and excerpt from sanitized content', async () => {
		const redis = {
			set: vi.fn(async () => 'OK'),
			del: vi.fn(async () => 1),
		};
		const articleRepo = {
			findById: vi.fn(async () => ({
				id: 'article-1',
				canonicalUrl: 'https://example.com/post-1',
				title: 'Post 1',
				author: null,
				contentHtml: '<p>Short</p>',
				heroImageUrl: null,
			})),
			updateContent: vi.fn(async () => undefined),
			replaceMedia: vi.fn(async () => undefined),
		};
		const service = new FeedSyncService(
			{} as never,
			articleRepo as never,
			{} as never,
			{} as never,
			redis as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 1, allowPrivateHosts: false },
		);
		vi.spyOn(
			service as unknown as { resolveEnrichedArticleHtml: () => Promise<string | null> },
			'resolveEnrichedArticleHtml',
		).mockResolvedValue(
			'<article><p>Visible article body with enough useful text to refresh the stored article content and clearly exceed the refresh threshold for this enrichment regression test.</p><iframe src="javascript:alert(1)">hiddenToken</iframe></article>',
		);

		await (
			service as unknown as {
				enrichSingleArticle: (enrichment: {
					articleId: string;
					userId: string;
					canonicalUrl: string;
					contentHtml: string | null;
					heroImageUrl: string | null;
					fetchedAt: Date;
				}) => Promise<void>;
			}
		).enrichSingleArticle({
			articleId: 'article-1',
			userId: 'user-1',
			canonicalUrl: 'https://example.com/post-1',
			contentHtml: '<p>Short</p>',
			heroImageUrl: null,
			fetchedAt: new Date('2026-01-01T00:00:00.000Z'),
		});

		expect(articleRepo.updateContent).toHaveBeenCalledWith(
			'article-1',
			expect.objectContaining({
				contentHtml:
					'<article><p>Visible article body with enough useful text to refresh the stored article content and clearly exceed the refresh threshold for this enrichment regression test.</p></article>',
				contentText:
					'Visible article body with enough useful text to refresh the stored article content and clearly exceed the refresh threshold for this enrichment regression test.',
				excerpt:
					'Visible article body with enough useful text to refresh the stored article content and clearly exceed the refresh threshold for this enrichment regression test.',
			}),
		);
	});

	it('skips a feed sync when the per-feed lock is already held', async () => {
		const feedRepo = {
			findById: vi.fn(async () => ({
				id: 'feed-1',
				title: 'Locked Feed',
				feedUrl: 'https://example.com/feed.xml',
				userId: 'user-1',
			})),
			update: vi.fn(async () => undefined),
		};
		const syncRunRepo = {
			create: vi.fn(async () => ({ id: 'run-1' })),
		};
		const redis = {
			set: vi.fn(async () => null),
			del: vi.fn(async () => 0),
		};
		const service = new FeedSyncService(
			feedRepo as never,
			{} as never,
			syncRunRepo as never,
			{} as never,
			redis as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 1, allowPrivateHosts: false },
		);

		const result = await service.syncFeed('feed-1', 'user-1');

		expect(redis.set).toHaveBeenCalledWith('feed:sync:lock:feed-1', '1', 'EX', 1200, 'NX');
		expect(syncRunRepo.create).not.toHaveBeenCalled();
		expect(feedRepo.update).not.toHaveBeenCalled();
		expect(result).toEqual({ newArticles: 0, total: 0, skipped: true });
	});

	it('schedules lazy enrichment for existing text-only articles with inert feed images', async () => {
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
			persistSyncResults: vi.fn(async () => []),
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
					description:
						'<p>Only text in the RSS feed</p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />',
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

		expect(enrichSpy).toHaveBeenCalledWith([
			expect.objectContaining({
				articleId: 'article-1',
				canonicalUrl: 'https://example.com/post-1',
			}),
		]);
	});

	it('updates the article hash when existing article content is refreshed', async () => {
		const feedRepo = {
			findById: vi.fn(async () => ({
				id: 'feed-1',
				title: 'Refresh Feed',
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
					canonicalUrl: 'https://example.com/post-1',
					title: 'Post 1',
					author: 'Author',
					contentHtml: '<p>Short</p>',
					heroImageUrl: null,
				},
			]),
			persistSyncResults: vi.fn(async () => []),
		};

		const syncRunRepo = {
			create: vi.fn(async () => ({ id: 'run-1' })),
			complete: vi.fn(async () => undefined),
		};

		const service = new FeedSyncService(
			feedRepo as never,
			articleRepo as never,
			syncRunRepo as never,
			{ incrementSyncCount: vi.fn(async () => undefined) } as never,
			{ del: vi.fn(async () => 0) } as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 1, allowPrivateHosts: false },
		);

		vi.spyOn(
			service as unknown as { fetchAndParse: () => Promise<unknown> },
			'fetchAndParse',
		).mockResolvedValue({
			title: 'Refresh Feed',
			items: [
				{
					guid: 'guid-1',
					link: 'https://example.com/post-1',
					title: 'Post 1',
					creator: 'Author',
					description:
						'<p>This is a much longer updated article body with enough extra text to exceed the refresh threshold by more than eighty characters.</p>',
				},
			],
		} as never);

		await service.syncFeed('feed-1', 'user-1');

		expect(articleRepo.persistSyncResults).toHaveBeenCalledWith(
			expect.objectContaining({
				articlesToUpdate: [
					expect.objectContaining({
						id: 'article-1',
						contentHtml:
							'<p>This is a much longer updated article body with enough extra text to exceed the refresh threshold by more than eighty characters.</p>',
						hash: expect.stringMatching(/^[a-f0-9]{64}$/),
					}),
				],
			}),
		);
	});

	it('keeps failed feeds retryable by storing a bounded next sync time', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
		const feedRepo = {
			findById: vi.fn(async () => ({
				id: 'feed-1',
				title: 'Failing Feed',
				feedUrl: 'https://example.com/feed.xml',
				userId: 'user-1',
				pollingIntervalMinutes: 15,
			})),
			update: vi.fn(async () => undefined),
		};
		const syncRunRepo = {
			create: vi.fn(async () => ({ id: 'run-1' })),
			complete: vi.fn(async () => undefined),
		};
		const service = new FeedSyncService(
			feedRepo as never,
			{
				countByFeeds: vi.fn(async () => 1),
			} as never,
			syncRunRepo as never,
			{} as never,
			{ del: vi.fn(async () => 0) } as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 1, allowPrivateHosts: false },
		);
		vi.spyOn(
			service as unknown as { fetchAndParse: () => Promise<unknown> },
			'fetchAndParse',
		).mockRejectedValue(new Error('network failed'));

		await expect(service.syncFeed('feed-1', 'user-1')).rejects.toMatchObject({
			code: 'BAD_GATEWAY',
			details: 'network failed',
			message: 'Could not fetch or parse the feed URL',
			statusCode: 502,
		});

		expect(feedRepo.update).toHaveBeenNthCalledWith(1, 'feed-1', 'user-1', {
			syncStatus: 'syncing',
		});
		expect(feedRepo.update).toHaveBeenNthCalledWith(
			2,
			'feed-1',
			'user-1',
			expect.objectContaining({
				nextSyncAt: new Date('2026-01-01T00:15:00.000Z'),
				syncStatus: 'error',
			}),
		);
		expect(syncRunRepo.complete).toHaveBeenCalledWith(
			'run-1',
			expect.objectContaining({ status: 'failed' }),
		);
	});

	it('stores useful HTTP details when feed fetching throws a response', async () => {
		const feedRepo = {
			findById: vi.fn(async () => ({
				id: 'feed-1',
				title: 'Failing Feed',
				feedUrl: 'https://example.com/feed.xml',
				userId: 'user-1',
				pollingIntervalMinutes: 15,
			})),
			update: vi.fn(async () => undefined),
		};
		const syncRunRepo = {
			create: vi.fn(async () => ({ id: 'run-1' })),
			complete: vi.fn(async () => undefined),
		};
		const service = new FeedSyncService(
			feedRepo as never,
			{
				countByFeeds: vi.fn(async () => 1),
			} as never,
			syncRunRepo as never,
			{} as never,
			{ del: vi.fn(async () => 0) } as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 1, allowPrivateHosts: false },
		);
		const response = new Response(null, { status: 404, statusText: 'Not Found' });
		vi.spyOn(
			service as unknown as { fetchAndParse: () => Promise<unknown> },
			'fetchAndParse',
		).mockRejectedValue(response);

		await expect(service.syncFeed('feed-1', 'user-1')).rejects.toMatchObject({
			code: 'BAD_GATEWAY',
			details: 'HTTP 404: Not Found',
			message: 'Could not fetch or parse the feed URL',
			statusCode: 502,
		});

		expect(syncRunRepo.complete).toHaveBeenCalledWith(
			'run-1',
			expect.objectContaining({
				status: 'failed',
				errorMessage: 'HTTP 404: Not Found',
			}),
		);
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
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-21T12:00:00.000Z'));
		const redis = {
			eval: vi.fn(async () => 1),
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

		expect(redis.eval).toHaveBeenCalledWith(
			expect.stringContaining('RPUSH'),
			2,
			'feed:sync-all:queued:user-1',
			'feed:sync-all:queue',
			String(new Date('2026-06-21T12:00:00.000Z').getTime()),
			'1800',
			'user-1',
		);
		expect(result).toEqual({ accepted: true, alreadyQueued: false });
	});

	it('deduplicates already queued bulk refreshes', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-21T12:00:00.000Z'));
		const redis = {
			eval: vi.fn(async () => 0),
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

		expect(redis.eval).toHaveBeenCalledWith(
			expect.stringContaining('EXISTS'),
			2,
			'feed:sync-all:queued:user-1',
			'feed:sync-all:queue',
			String(new Date('2026-06-21T12:00:00.000Z').getTime()),
			'1800',
			'user-1',
		);
		expect(result).toEqual({ accepted: true, alreadyQueued: true });
	});

	it('reports queued bulk refresh status', async () => {
		const redis = {
			get: vi.fn(async (key: string) => (key.includes(':queued:') ? String(Date.now()) : null)),
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

		expect(redis.get).toHaveBeenCalledWith('feed:sync-all:queued:user-1');
		expect(redis.get).toHaveBeenCalledWith('feed:sync-all:lock:user-1');
		expect(result).toEqual({ queued: true, running: false, active: true });
	});

	it('reports running bulk refresh status', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-21T12:00:00.000Z'));
		const redis = {
			get: vi.fn(async (key: string) => (key.includes(':lock:') ? String(Date.now()) : null)),
			del: vi.fn(async () => 0),
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

		expect(redis.del).not.toHaveBeenCalled();
		expect(result).toEqual({ queued: false, running: true, active: true });
	});

	it('clears stale running bulk refresh locks and releases active status', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-21T12:00:00.000Z'));
		const redis = {
			get: vi.fn(async (key: string) =>
				key.includes(':lock:')
					? String(new Date('2026-06-21T11:58:00.000Z').getTime())
					: key.includes(':queued:')
						? String(new Date('2026-06-21T11:57:30.000Z').getTime())
						: null,
			),
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

		const result = await service.getSyncAllFeedsStatus('user-1');

		expect(redis.del).toHaveBeenCalledWith(
			'feed:sync-all:lock:user-1',
			'feed:sync-all:queued:user-1',
		);
		expect(result).toEqual({ queued: false, running: false, active: false });
	});

	it('clears legacy running bulk refresh locks that have no heartbeat timestamp', async () => {
		const redis = {
			get: vi.fn(async (key: string) => (key.includes(':lock:') ? '1' : null)),
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

		const result = await service.getSyncAllFeedsStatus('user-1');

		expect(redis.del).toHaveBeenCalledWith(
			'feed:sync-all:lock:user-1',
			'feed:sync-all:queued:user-1',
		);
		expect(result).toEqual({ queued: false, running: false, active: false });
	});

	it('clears stale queued bulk refresh markers and releases active status', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-21T12:00:00.000Z'));
		const redis = {
			get: vi.fn(async (key: string) =>
				key.includes(':queued:') ? String(new Date('2026-06-21T11:58:00.000Z').getTime()) : null,
			),
			del: vi.fn(async () => 1),
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

		expect(redis.del).toHaveBeenCalledWith('feed:sync-all:queued:user-1');
		expect(result).toEqual({ queued: false, running: false, active: false });
	});

	it('processes the next queued bulk refresh and clears queue state', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-21T12:00:00.000Z'));
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
		expect(redis.set).toHaveBeenCalledWith(
			'feed:sync-all:lock:user-1',
			String(new Date('2026-06-21T12:00:00.000Z').getTime()),
			'EX',
			1800,
			'NX',
		);
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
			persistSyncResults: vi.fn(async () => []),
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
			persistSyncResults: vi.fn(async () => []),
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
			persistSyncResults: vi.fn(
				async ({ articlesToInsert }: { articlesToInsert: Array<Record<string, unknown>> }) =>
					articlesToInsert.map((item, index) => ({ id: `article-${index + 1}`, ...item })),
			),
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

		expect(articleRepo.persistSyncResults).toHaveBeenCalledWith(
			expect.objectContaining({
				articlesToInsert: [
					expect.objectContaining({
						contentHtml: 'Only text plus more',
						contentText: 'Only text plus more',
					}),
				],
			}),
		);
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
			persistSyncResults: vi.fn(
				async ({ articlesToInsert }: { articlesToInsert: Array<Record<string, unknown>> }) =>
					articlesToInsert.map((item, index) => ({ id: `article-${index + 1}`, ...item })),
			),
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
			persistSyncResults: vi.fn(
				async ({ articlesToInsert }: { articlesToInsert: Array<Record<string, unknown>> }) =>
					articlesToInsert.map((item, index) => ({ id: `article-${index + 1}`, ...item })),
			),
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

		expect(articleRepo.persistSyncResults).toHaveBeenCalledWith(
			expect.objectContaining({
				articlesToInsert: [
					expect.objectContaining({
						contentHtml: 'Simple feed content',
					}),
				],
			}),
		);
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
			persistSyncResults: vi.fn(
				async ({ articlesToInsert }: { articlesToInsert: Array<Record<string, unknown>> }) =>
					articlesToInsert.map((item, index) => ({ id: `article-${index + 1}`, ...item })),
			),
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

		expect(articleRepo.persistSyncResults).toHaveBeenCalledWith(
			expect.objectContaining({
				articlesToInsert: [
					expect.objectContaining({
						guid: 'guid-1',
						canonicalUrl: 'https://example.com/post-1',
						title: 'Post 1',
						author: 'Author',
						excerpt: 'Description text',
					}),
				],
			}),
		);
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
		const originalFetch = globalThis.fetch;
		const mockFetch = vi.fn().mockImplementation((url: string) => {
			// Return different responses for HTML page fetch vs API fetch
			if (url.includes('/api/posts/')) {
				return Promise.resolve({
					ok: true,
					status: 200,
					headers: new Headers({ 'content-type': 'application/json' }),
					text: async () =>
						JSON.stringify({
							post: {
								title: 'Test Post',
								description: '<p onclick="alert(1)">Paragraph text</p><script>alert(1)</script>',
								media: {
									type: 'twitter',
									content: '123456789',
								},
							},
						}),
					json: async () => ({
						post: {
							title: 'Test Post',
							description: '<p onclick="alert(1)">Paragraph text</p><script>alert(1)</script>',
							media: {
								type: 'twitter',
								content: '123456789',
							},
						},
					}),
				});
			}
			// Default response for HTML page fetch
			return Promise.resolve({
				ok: true,
				status: 200,
				headers: new Headers({ 'content-type': 'text/html' }),
				text: async () =>
					'<html><body><article><div class="entry-content"><p>Dummy content</p></div></article></body></html>',
			});
		});
		globalThis.fetch = mockFetch as unknown as typeof fetch;

		try {
			// Create service AFTER setting up the mock
			const service = new FeedSyncService(
				{} as never,
				{} as never,
				{} as never,
				{} as never,
				{} as never,
				{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 1, allowPrivateHosts: true },
			);

			const content = await (
				service as unknown as {
					fetchArticlePageContent(canonicalUrl: string): Promise<string | null>;
				}
			).fetchArticlePageContent('https://www.naointendo.com.br/posts/12345-test-post');

			expect(content).toContain(
				'<iframe class="embedded-media embedded-media--x" src="https://platform.twitter.com/embed/Tweet.html?id=123456789"></iframe>',
			);
			expect(content).toContain('<p>Paragraph text</p>');
			expect(content).not.toContain('onclick');
			expect(content).not.toContain('<script');
			expect(mockFetch).toHaveBeenCalledWith(
				'https://www.naointendo.com.br/api/posts/12345-test-post',
				expect.any(Object),
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	describe('error logging in syncAllFeeds', () => {
		const ORIGINAL_CONSOLE_ERROR = console.error;
		let errorLogs: Array<{ msg: string; extra: Record<string, unknown> }>;

		beforeEach(() => {
			errorLogs = [];
			console.error = vi.fn((output: string) => {
				const parsed = JSON.parse(output);
				errorLogs.push({ msg: parsed.msg, extra: parsed });
			});
		});

		afterEach(() => {
			console.error = ORIGINAL_CONSOLE_ERROR;
		});

		it('logs errors when syncFeed fails during bulk sync', async () => {
			const feedRepo = {
				findAllByUser: vi.fn(async () => [
					{ id: 'feed-1', syncStatus: 'idle' },
					{ id: 'feed-2', syncStatus: 'error' },
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
				if (feedId === 'feed-1') {
					return { newArticles: 2, total: 4 };
				}
				throw new Error('Database connection failed');
			});

			const result = await service.syncAllFeeds('user-1');

			expect(result.failedFeeds).toBe(1);
			expect(errorLogs.length).toBeGreaterThan(0);

			const errorLog = errorLogs.find((l) => l.msg === 'Feed sync failed during bulk sync');
			expect(errorLog).toBeDefined();
			expect(errorLog!.extra.operation).toBe('bulkFeedSync');
			expect(errorLog!.extra.feedId).toBe('feed-2');
			expect(errorLog!.extra.userId).toBe('user-1');
			expect(errorLog!.extra.error).toBe('Database connection failed');
			expect(errorLog!.extra.stack).toBeDefined();
		});

		it('logs errors with non-Error thrown values', async () => {
			const feedRepo = {
				findAllByUser: vi.fn(async () => [{ id: 'feed-1', syncStatus: 'idle' }]),
			};

			const service = new FeedSyncService(
				feedRepo as never,
				{} as never,
				{} as never,
				{} as never,
				{} as never,
				{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 1, allowPrivateHosts: false },
			);

			const syncFeedSpy = vi.spyOn(service, 'syncFeed');
			syncFeedSpy.mockRejectedValue('String error thrown');

			await service.syncAllFeeds('user-1');

			const errorLog = errorLogs.find((l) => l.msg === 'Feed sync failed during bulk sync');
			expect(errorLog!.extra.error).toBe('String error thrown');
		});

		it('logs HTTP details for response values thrown during bulk sync', async () => {
			const feedRepo = {
				findAllByUser: vi.fn(async () => [{ id: 'feed-1', syncStatus: 'idle' }]),
			};

			const service = new FeedSyncService(
				feedRepo as never,
				{} as never,
				{} as never,
				{} as never,
				{} as never,
				{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 1, allowPrivateHosts: false },
			);

			const syncFeedSpy = vi.spyOn(service, 'syncFeed');
			syncFeedSpy.mockRejectedValue(
				new Response(null, { status: 503, statusText: 'Service Unavailable' }),
			);

			await service.syncAllFeeds('user-1');

			const errorLog = errorLogs.find((l) => l.msg === 'Feed sync failed during bulk sync');
			expect(errorLog!.extra.error).toBe('HTTP 503: Service Unavailable');
			expect(errorLog!.extra.status).toBe(503);
			expect(errorLog!.extra.statusText).toBe('Service Unavailable');
		});

		it('continues syncing remaining feeds after one fails', async () => {
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

			const syncFeedSpy = vi.spyOn(service, 'syncFeed');
			syncFeedSpy.mockImplementation(async (feedId) => {
				if (feedId === 'feed-2') {
					throw new Error('Network timeout');
				}
				return { newArticles: 1, total: 1 };
			});

			const result = await service.syncAllFeeds('user-1');

			expect(result.syncedFeeds).toBe(2);
			expect(result.failedFeeds).toBe(1);
			expect(errorLogs.filter((l) => l.msg === 'Feed sync failed during bulk sync')).toHaveLength(
				1,
			);
		});
	});
});
