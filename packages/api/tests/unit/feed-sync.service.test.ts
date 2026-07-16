import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchArticlePageContent } from '../../src/services/article-source-fetcher.js';
import { acquireFeedFetchGuard } from '../../src/services/feed-fetch-guard.js';
import { FeedSyncService } from '../../src/services/feed-sync.service.js';
import { acquireOwnedRedisLock } from '../../src/services/redis-owned-lock.js';
import { FEED_FETCH_USER_AGENT } from '../../src/utils/feed-fetch-headers.js';

describe('FeedSyncService', () => {
	const noonTimestamp = new Date('2026-06-21T12:00:00.000Z').getTime();
	const queuedMarker = JSON.stringify({ queuedAt: noonTimestamp });
	const emptySyncProgress = {
		totalFeeds: 0,
		completedFeeds: 0,
		newArticles: 0,
		articleRevision: 0,
	};

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('prioritizes user-visible article enrichment ahead of background work', async () => {
		const articleRepo = { queueEnrichments: vi.fn(async () => undefined) };
		const service = new FeedSyncService(
			{} as never,
			articleRepo as never,
			{} as never,
			{} as never,
			{} as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
		);

		await service.queueArticleEnrichment('article-visible');

		expect(articleRepo.queueEnrichments).toHaveBeenCalledWith(['article-visible'], new Date(0));
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
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
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
					articlesToInsert.map((item, index) => ({
						id: `article-${index + 1}`,
						...item,
					})),
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
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
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
				service as unknown as {
					enrichArticlesInBackground: () => Promise<void>;
				},
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
					articlesToInsert.map((item, index) => ({
						id: `article-${index + 1}`,
						...item,
					})),
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
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
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
				errorMessage: 'Skipped 1 malformed article item(s). First error: bad title payload',
			}),
		);
		expect(feedRepo.update).toHaveBeenNthCalledWith(
			2,
			'feed-1',
			'user-1',
			expect.objectContaining({
				lastSyncError: 'Skipped 1 malformed article item(s). First error: bad title payload',
				lastSyncErrorAt: expect.any(Date),
			}),
		);
		expect(result).toEqual({ newArticles: 1, total: 2 });
	});

	it('replaces a stale FeedBurner proxy with a fresher direct feed URL', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-23T13:30:00.000Z'));
		const feedRepo = {
			findById: vi.fn(async () => ({
				id: 'feed-1',
				title: 'Phoronix',
				feedUrl: 'http://feeds.feedburner.com/Phoronix',
				userId: 'user-1',
				pollingIntervalMinutes: 60,
			})),
			update: vi.fn(async () => undefined),
		};
		const articleRepo = {
			countByFeeds: vi.fn(async () => 10),
			findByFeedAndGuids: vi.fn(async () => []),
			persistSyncResults: vi.fn(
				async ({ articlesToInsert }: { articlesToInsert: Array<Record<string, unknown>> }) =>
					articlesToInsert.map((item, index) => ({
						id: `article-${index + 1}`,
						...item,
					})),
			),
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
			{ set: vi.fn(async () => 'OK'), del: vi.fn(async () => 0) } as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
		);

		const fetchAndParseSpy = vi.spyOn(
			service as unknown as {
				fetchAndParse: (feedUrl: string, ignoreCache?: boolean) => Promise<unknown>;
			},
			'fetchAndParse',
		);
		fetchAndParseSpy
			.mockResolvedValueOnce({
				title: 'Phoronix',
				link: 'https://www.phoronix.com/',
				items: [
					{
						guid: 'https://www.phoronix.com/news/Mesa-NVK-Vulkan-Does-DLSS',
						link: 'https://www.phoronix.com/news/Mesa-NVK-Vulkan-Does-DLSS',
						title: 'Open-Source NVIDIA NVK Vulkan Driver Now Supports DLSS',
						description: 'Stale FeedBurner item',
						pubDate: 'Fri, 19 Jun 2026 16:26:52 -0400',
					},
				],
			})
			.mockResolvedValueOnce({
				title: 'Phoronix',
				link: 'https://www.phoronix.com/',
				items: [
					{
						guid: 'https://www.phoronix.com/news/Fwupd-2.0.21-Released',
						link: 'https://www.phoronix.com/news/Fwupd-2.0.21-Released',
						title:
							'Fwupd 2.0.21 Brings Fixes For More Than 250 Potential Security Issues Found Via AI',
						description: 'Fresh direct item',
						pubDate: 'Tue, 23 Jun 2026 08:24:22 -0400',
					},
				],
			});
		const result = await service.syncFeed('feed-1', 'user-1');

		expect(fetchAndParseSpy).toHaveBeenNthCalledWith(
			1,
			'http://feeds.feedburner.com/Phoronix',
			true,
		);
		expect(fetchAndParseSpy).toHaveBeenNthCalledWith(2, 'https://www.phoronix.com/rss.php', true);
		expect(articleRepo.persistSyncResults).toHaveBeenCalledWith(
			expect.objectContaining({
				articlesToInsert: [
					expect.objectContaining({
						guid: 'https://www.phoronix.com/news/Fwupd-2.0.21-Released',
						title:
							'Fwupd 2.0.21 Brings Fixes For More Than 250 Potential Security Issues Found Via AI',
					}),
				],
			}),
		);
		expect(feedRepo.update).toHaveBeenNthCalledWith(
			2,
			'feed-1',
			'user-1',
			expect.objectContaining({
				feedUrl: 'https://www.phoronix.com/rss.php',
				lastSyncError: null,
				lastSyncErrorAt: null,
				syncStatus: 'idle',
			}),
		);
		expect(result).toEqual({ newArticles: 1, total: 1 });
	});

	it('keeps stale proxy feeds visible as warnings when no fresher direct feed is found', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-23T13:30:00.000Z'));
		const feedRepo = {
			findById: vi.fn(async () => ({
				id: 'feed-1',
				title: 'Proxy Feed',
				feedUrl: 'http://feeds.feedburner.com/ProxyFeed',
				userId: 'user-1',
				pollingIntervalMinutes: 60,
			})),
			update: vi.fn(async () => undefined),
		};
		const articleRepo = {
			countByFeeds: vi.fn(async () => 1),
			findByFeedAndGuids: vi.fn(async () => [
				{
					id: 'article-1',
					guid: 'old-guid',
					contentHtml: '<p>Old</p>',
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
			{ set: vi.fn(async () => 'OK'), del: vi.fn(async () => 0) } as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
		);
		vi.spyOn(
			service as unknown as {
				fetchAndParse: (feedUrl: string, ignoreCache?: boolean) => Promise<unknown>;
			},
			'fetchAndParse',
		).mockResolvedValue({
			title: 'Proxy Feed',
			items: [
				{
					guid: 'old-guid',
					link: 'https://example.com/old',
					title: 'Old',
					description: 'Old item',
					pubDate: 'Fri, 19 Jun 2026 16:26:52 -0400',
				},
			],
		});

		await service.syncFeed('feed-1', 'user-1');

		expect(feedRepo.update).toHaveBeenNthCalledWith(
			2,
			'feed-1',
			'user-1',
			expect.objectContaining({
				lastSyncError: 'Feed proxy appears stale; latest item is from 2026-06-19T20:26:52.000Z',
				lastSyncErrorAt: new Date('2026-06-23T13:30:00.000Z'),
				syncStatus: 'idle',
			}),
		);
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
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
		);
		vi.spyOn(
			service as unknown as {
				resolveEnrichedArticleHtml: () => Promise<string | null>;
			},
			'resolveEnrichedArticleHtml',
		).mockResolvedValue(
			'<article><p>Visible article body with enough useful text to refresh the stored article content and clearly exceed the refresh threshold for this enrichment regression test.</p><a href="../about">About</a><img src="images/hero.jpg"><iframe src="javascript:alert(1)">hiddenToken</iframe></article>',
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
					'<article><p>Visible article body with enough useful text to refresh the stored article content and clearly exceed the refresh threshold for this enrichment regression test.</p><a href="https://example.com/about">About</a><img src="https://example.com/images/hero.jpg"></article>',
				contentText:
					'Visible article body with enough useful text to refresh the stored article content and clearly exceed the refresh threshold for this enrichment regression test. About',
				excerpt:
					'Visible article body with enough useful text to refresh the stored article content and clearly exceed the refresh threshold for this enrichment regression test. About',
				heroImageUrl: 'https://example.com/images/hero.jpg',
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
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
		);

		const result = await service.syncFeed('feed-1', 'user-1');

		expect(redis.set).toHaveBeenCalledWith(
			'feed:sync:lock:feed-1',
			expect.any(String),
			'EX',
			60,
			'NX',
		);
		expect(syncRunRepo.create).not.toHaveBeenCalled();
		expect(feedRepo.update).not.toHaveBeenCalled();
		expect(result).toEqual({ newArticles: 0, total: 0, skipped: true });
	});

	it('uses a URL-scoped lock and retains it for a one-minute fetch cooldown', async () => {
		const redis = {
			set: vi.fn(async (..._args: unknown[]) => 'OK'),
			eval: vi.fn(async () => 1),
		};
		const release = await acquireFeedFetchGuard(redis as never, 'https://example.com/feed.xml');
		const [lockKey, ownerToken] = redis.set.mock.calls[0]!;

		expect(lockKey).toMatch(/^feed:fetch:lock:[a-f0-9]{64}$/);
		expect(redis.set).toHaveBeenCalledWith(lockKey, ownerToken, 'EX', 60, 'NX');
		await release?.();
		expect(redis.eval).toHaveBeenLastCalledWith(
			expect.stringContaining('EXPIRE'),
			1,
			lockKey,
			ownerToken,
			'60',
		);
	});

	it('does not let an expired per-feed lock owner release its replacement', async () => {
		vi.useFakeTimers();
		let storedOwner: string | null = null;
		const redis = {
			set: vi.fn(async (_key: string, owner: string) => {
				if (storedOwner != null) return null;
				storedOwner = owner;
				return 'OK';
			}),
			eval: vi.fn(async (script: string, _keyCount: number, _key: string, owner: string) => {
				if (storedOwner !== owner) return 0;
				if (script.includes('DEL')) storedOwner = null;
				return 1;
			}),
		};
		const acquire = () =>
			acquireOwnedRedisLock({
				redis: redis as never,
				key: 'feed:sync:lock:feed-1',
				ttlSeconds: 60,
			});

		const releaseA = await acquire();
		const ownerA = storedOwner;
		storedOwner = null;
		const releaseB = await acquire();
		const ownerB = storedOwner;

		expect(ownerA).toEqual(expect.any(String));
		expect(ownerB).toEqual(expect.any(String));
		expect(ownerB).not.toBe(ownerA);
		await releaseA?.();
		expect(storedOwner).toBe(ownerB);
		await releaseB?.();
		expect(storedOwner).toBeNull();
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
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
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
				service as unknown as {
					enrichArticlesInBackground: () => Promise<void>;
				},
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
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
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
				pollingIntervalMinutes: 60,
			})),
			update: vi.fn(async () => undefined),
		};
		const syncRunRepo = {
			create: vi.fn(async () => ({ id: 'run-1' })),
			complete: vi.fn(async () => undefined),
		};
		const realtimeService = {
			publishEvent: vi.fn(async (_userId: string, _event: unknown) => undefined),
		};
		const service = new FeedSyncService(
			feedRepo as never,
			{
				countByFeeds: vi.fn(async () => 1),
			} as never,
			syncRunRepo as never,
			{} as never,
			{ del: vi.fn(async () => 0) } as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
			undefined,
			realtimeService as never,
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
				lastSyncError: 'network failed',
				lastSyncErrorAt: new Date('2026-01-01T00:00:00.000Z'),
				syncStatus: 'error',
			}),
		);
		expect(syncRunRepo.complete).toHaveBeenCalledWith(
			'run-1',
			expect.objectContaining({ status: 'failed' }),
		);
		expect(realtimeService.publishEvent).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				type: 'feed.health.updated',
				feedId: 'feed-1',
				severity: 'error',
				syncStatus: 'error',
				lastSyncError: 'network failed',
			}),
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
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
		);
		const response = new Response(null, {
			status: 404,
			statusText: 'Not Found',
		});
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
		expect(feedRepo.update).toHaveBeenNthCalledWith(
			2,
			'feed-1',
			'user-1',
			expect.objectContaining({
				lastSyncError: 'HTTP 404: Not Found',
				lastSyncErrorAt: expect.any(Date),
				syncStatus: 'error',
			}),
		);
	});

	it('does not rewrite active feed state before bulk lock checks', async () => {
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
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 2,
				allowPrivateHosts: false,
			},
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
		expect(feedRepo.update).not.toHaveBeenCalled();
		expect(syncFeedSpy).toHaveBeenCalledTimes(3);
		expect(syncFeedSpy).toHaveBeenCalledWith('feed-1', 'user-1', {
			enrichArticles: true,
			warmArticleCache: false,
			forceFetch: true,
			fetchTimeoutMs: 5_000,
			fetchMaxRetries: 1,
			deferScopedCacheCleanup: true,
		});
		expect(syncFeedSpy).toHaveBeenCalledWith('feed-2', 'user-1', {
			enrichArticles: true,
			warmArticleCache: false,
			forceFetch: true,
			fetchTimeoutMs: 5_000,
			fetchMaxRetries: 1,
			deferScopedCacheCleanup: true,
		});
		expect(syncFeedSpy).toHaveBeenCalledWith('feed-3', 'user-1', {
			enrichArticles: true,
			warmArticleCache: false,
			forceFetch: true,
			fetchTimeoutMs: 5_000,
			fetchMaxRetries: 1,
			deferScopedCacheCleanup: true,
		});
		expect(result).toEqual({
			totalFeeds: 3,
			syncedFeeds: 2,
			failedFeeds: 1,
			skippedFeeds: 0,
			newArticles: 4,
		});
	});

	it('ignores feeds that are already locked instead of retrying the load command', async () => {
		const feedRepo = {
			findAllByUser: vi.fn(async () => [{ id: 'feed-1', syncStatus: 'idle' }]),
		};

		const service = new FeedSyncService(
			feedRepo as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
		);

		const syncFeedSpy = vi
			.spyOn(service, 'syncFeed')
			.mockResolvedValue({ newArticles: 0, total: 0, skipped: true });

		const result = await service.syncAllFeeds('user-1');

		expect(syncFeedSpy).toHaveBeenCalledTimes(1);
		expect(syncFeedSpy).toHaveBeenCalledWith('feed-1', 'user-1', {
			enrichArticles: true,
			warmArticleCache: false,
			forceFetch: true,
			fetchTimeoutMs: 5_000,
			fetchMaxRetries: 1,
			deferScopedCacheCleanup: true,
		});
		expect(result).toEqual({
			totalFeeds: 1,
			syncedFeeds: 0,
			failedFeeds: 0,
			skippedFeeds: 1,
			newArticles: 0,
		});
	});

	it('limits an interactive feed refresh to the selected feed', async () => {
		const feedRepo = {
			findAllByUser: vi.fn(async () => [
				{ id: 'other', syncStatus: 'idle' },
				{ id: 'category-feed', syncStatus: 'idle' },
				{ id: 'selected', syncStatus: 'idle' },
			]),
			findByCategory: vi.fn(async () => [{ id: 'category-feed' }]),
		};
		const service = new FeedSyncService(
			feedRepo as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
		);
		const started: string[] = [];
		vi.spyOn(service, 'syncFeed').mockImplementation(async (feedId) => {
			started.push(feedId);
			return { newArticles: 1, total: 1 };
		});
		const progress: Array<{
			totalFeeds: number;
			completedFeeds: number;
			newArticles: number;
		}> = [];

		await service.syncAllFeeds(
			'user-1',
			{ feedId: 'selected', categoryId: 'category-1' },
			(update) => {
				progress.push(update);
			},
		);

		expect(started).toEqual(['selected']);
		expect(progress).toEqual([
			expect.objectContaining({
				totalFeeds: 1,
				completedFeeds: 1,
				newArticles: 1,
			}),
		]);
	});

	it('limits an interactive category refresh to feeds in that category', async () => {
		const feedRepo = {
			findAllByUser: vi.fn(async () => [
				{ id: 'other', syncStatus: 'idle' },
				{ id: 'category-1', syncStatus: 'idle' },
				{ id: 'category-2', syncStatus: 'idle' },
			]),
			findByCategory: vi.fn(async () => [{ id: 'category-1' }, { id: 'category-2' }]),
		};
		const service = new FeedSyncService(
			feedRepo as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{
				timeoutMs: 30_000,
				maxContentLength: 1_000_000,
				concurrency: 8,
				allowPrivateHosts: false,
			},
		);
		const started: string[] = [];
		const syncFeedSpy = vi.spyOn(service, 'syncFeed').mockImplementation(async (feedId) => {
			started.push(feedId);
			return { newArticles: 0, total: 1 };
		});

		const result = await service.syncAllFeeds('user-1', {
			categoryId: 'category',
		});

		expect(started).toEqual(['category-1', 'category-2']);
		expect(result.totalFeeds).toBe(2);
		for (const call of syncFeedSpy.mock.calls) {
			expect(call[2]).toMatchObject({
				warmArticleCache: false,
				fetchTimeoutMs: 10_000,
				fetchMaxRetries: 1,
				deferScopedCacheCleanup: true,
			});
		}
	});

	it('warms the article list cache after bulk refresh without blocking completion', async () => {
		let finishCacheWarm: () => void = () => undefined;
		const feedRepo = {
			findAllByUser: vi.fn(async () => [{ id: 'feed-1', syncStatus: 'idle' }]),
		};
		const articleCache = {
			invalidateCache: vi.fn(async () => undefined),
			populateCache: vi.fn(
				() =>
					new Promise<void>((resolve) => {
						finishCacheWarm = resolve;
					}),
			),
		};

		const service = new FeedSyncService(
			feedRepo as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
			articleCache as never,
		);

		vi.spyOn(service, 'syncFeed').mockResolvedValue({
			newArticles: 2,
			total: 2,
		});

		const result = await service.syncAllFeeds('user-1');

		expect(result.newArticles).toBe(2);
		expect(articleCache.invalidateCache).toHaveBeenCalledTimes(1);
		expect(articleCache.populateCache).toHaveBeenCalledWith('user-1');
		finishCacheWarm();
	});

	it('returns syncDueFeeds summary counts without retaining all results', async () => {
		const feedRepo = {
			resetStaleSyncing: vi.fn(async () => []),
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
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 2,
				allowPrivateHosts: false,
			},
		);

		const syncFeedSpy = vi.spyOn(service, 'syncFeed');
		syncFeedSpy.mockImplementation(async (feedId) => {
			if (feedId === 'feed-2') {
				throw new Error('sync failed');
			}
			return { newArticles: 1, total: 1 };
		});

		const result = await service.syncDueFeeds();

		expect(feedRepo.resetStaleSyncing).toHaveBeenCalledWith(expect.any(Date));
		expect(feedRepo.findDueForSync).toHaveBeenCalledWith(50);
		for (const call of syncFeedSpy.mock.calls) {
			expect(call[2]).toEqual({
				warmArticleCache: false,
				fetchTimeoutMs: 5_000,
				fetchMaxRetries: 0,
			});
		}
		expect(result).toEqual({ total: 3, succeeded: 2, failed: 1 });
	});

	it('does not let a slow scheduled feed block later healthy feeds', async () => {
		const feedRepo = {
			resetStaleSyncing: vi.fn(async () => []),
			findDueForSync: vi.fn(async () => [
				{ id: 'slow', userId: 'user-1' },
				{ id: 'fast-1', userId: 'user-1' },
				{ id: 'fast-2', userId: 'user-1' },
			]),
		};
		const service = new FeedSyncService(
			feedRepo as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{
				timeoutMs: 30_000,
				maxContentLength: 1_000_000,
				concurrency: 5,
				allowPrivateHosts: false,
			},
		);
		let releaseSlow: (() => void) | undefined;
		const started: string[] = [];
		vi.spyOn(service, 'syncFeed').mockImplementation(async (feedId) => {
			started.push(feedId);
			if (feedId === 'slow') {
				await new Promise<void>((resolve) => {
					releaseSlow = resolve;
				});
			}
			return { newArticles: 0, total: 0 };
		});

		const syncPromise = service.syncDueFeeds();
		await vi.waitFor(() => expect(started).toEqual(['slow', 'fast-1', 'fast-2']));
		releaseSlow?.();

		await expect(syncPromise).resolves.toEqual({
			total: 3,
			succeeded: 3,
			failed: 0,
		});
	});

	it('expires publisher validators quickly so stale ETags cannot hide articles for days', async () => {
		const redis = {
			get: vi.fn(async () => null),
			set: vi.fn(async () => 'OK'),
		};
		const service = new FeedSyncService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			redis as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: true,
			},
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_input: string, init?: RequestInit) => {
				const headers = new Headers(init?.headers);
				expect(headers.get('user-agent')).toBe(FEED_FETCH_USER_AGENT);
				expect(headers.get('accept')).toContain('application/rss+xml');
				expect(headers.get('cache-control')).toBe('no-cache');
				return new Response(
					'<?xml version="1.0"?><rss version="2.0"><channel><title>Fresh feed</title></channel></rss>',
					{
						status: 200,
						headers: {
							etag: '"stale-prone-etag"',
							'last-modified': 'Tue, 14 Jul 2026 12:00:00 GMT',
						},
					},
				);
			}),
		);

		await (
			service as unknown as {
				fetchAndParse: (url: string, ignoreCache: boolean) => Promise<unknown>;
			}
		).fetchAndParse('https://example.com/feed.xml', true);

		expect(redis.set).toHaveBeenCalledWith(
			'feed:etag:https://example.com/feed.xml',
			'"stale-prone-etag"',
			'EX',
			15 * 60,
		);
		expect(redis.set).toHaveBeenCalledWith(
			'feed:lastmod:https://example.com/feed.xml',
			'Tue, 14 Jul 2026 12:00:00 GMT',
			'EX',
			15 * 60,
		);
	});

	it('does not burst-retry a transient feed interruption inside the one-minute window', async () => {
		const redis = {
			get: vi.fn(async () => null),
			set: vi.fn(async () => 'OK'),
		};
		const service = new FeedSyncService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			redis as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: true,
			},
		);
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new TypeError('fetch connection reset'))
			.mockResolvedValueOnce(
				new Response(
					'<?xml version="1.0"?><rss version="2.0"><channel><title>Recovered</title></channel></rss>',
					{ status: 200 },
				),
			);
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			(
				service as unknown as {
					fetchAndParse: (
						url: string,
						ignoreCache: boolean,
						options: { maxRetries: number },
					) => Promise<{ title?: string }>;
				}
			).fetchAndParse('https://example.com/feed.xml', true, { maxRetries: 1 }),
		).rejects.toThrow('fetch connection reset');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('recovers stale syncing feeds before scheduled sync selection', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:30:00.000Z'));
		const feedRepo = {
			resetStaleSyncing: vi.fn(async () => [
				{ id: 'feed-stale', userId: 'user-1', title: 'Interrupted Feed' },
			]),
			findDueForSync: vi.fn(async () => []),
		};

		const service = new FeedSyncService(
			feedRepo as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 3,
				allowPrivateHosts: false,
			},
		);

		const result = await service.syncDueFeeds();

		expect(feedRepo.resetStaleSyncing).toHaveBeenCalledWith(new Date('2026-01-01T00:24:00.000Z'));
		expect(feedRepo.findDueForSync).toHaveBeenCalledWith(50);
		expect(result).toEqual({ total: 0, succeeded: 0, failed: 0 });
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
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
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
			expect(call[2]).toEqual({
				enrichArticles: true,
				warmArticleCache: false,
				forceFetch: true,
				fetchTimeoutMs: 5_000,
				fetchMaxRetries: 1,
				deferScopedCacheCleanup: true,
			});
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
			get: vi.fn(async (key: string) => {
				if (key.includes(':queued:')) return queuedMarker;
				if (key.includes(':progress:')) {
					return '{"totalFeeds":0,"completedFeeds":0,"syncedFeeds":0,"failedFeeds":0,"skippedFeeds":0,"newArticles":0}';
				}
				return null;
			}),
		};
		const realtimeService = {
			publishEvent: vi.fn(async (_userId: string, _event: unknown) => undefined),
		};
		const service = new FeedSyncService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			redis as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 2,
				allowPrivateHosts: false,
			},
			undefined,
			realtimeService as never,
		);

		const result = await service.queueSyncAllFeeds('user-1');

		expect(redis.eval).toHaveBeenCalledWith(
			expect.stringContaining('RPUSH'),
			5,
			'feed:sync-all:queued:user-1',
			'feed:sync-all:queue',
			'feed:sync-all:lock:user-1',
			'feed:sync-all:request:user-1',
			'feed:sync-all:progress:user-1',
			queuedMarker,
			'1800',
			'user-1',
			expect.stringContaining('"jobId"'),
			'{"totalFeeds":0,"completedFeeds":0,"syncedFeeds":0,"failedFeeds":0,"skippedFeeds":0,"newArticles":0}',
		);
		expect(result).toMatchObject({
			accepted: true,
			alreadyQueued: false,
			jobId: expect.any(String),
			status: { active: true, queued: true },
		});
		expect(realtimeService.publishEvent).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({ type: 'feed.sync.progress', phase: 'queued' }),
		);
	});

	it('deduplicates already queued bulk refreshes', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-21T12:00:00.000Z'));
		const redis = {
			eval: vi.fn(async () => 0),
			get: vi.fn(async (key: string) => {
				if (key.includes(':request:')) {
					return JSON.stringify({
						jobId: 'existing-job',
						queuedAt: noonTimestamp,
					});
				}
				if (key.includes(':queued:')) return queuedMarker;
				if (key.includes(':progress:')) return '{}';
				return null;
			}),
		};
		const realtimeService = {
			publishEvent: vi.fn(async (_userId: string, _event: unknown) => undefined),
		};
		const service = new FeedSyncService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			redis as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 2,
				allowPrivateHosts: false,
			},
			undefined,
			realtimeService as never,
		);

		const result = await service.queueSyncAllFeeds('user-1');

		expect(redis.eval).toHaveBeenCalledWith(
			expect.stringContaining('LPOS'),
			5,
			'feed:sync-all:queued:user-1',
			'feed:sync-all:queue',
			'feed:sync-all:lock:user-1',
			'feed:sync-all:request:user-1',
			'feed:sync-all:progress:user-1',
			queuedMarker,
			'1800',
			'user-1',
			expect.stringContaining('"jobId"'),
			'{"totalFeeds":0,"completedFeeds":0,"syncedFeeds":0,"failedFeeds":0,"skippedFeeds":0,"newArticles":0}',
		);
		expect(result).toMatchObject({
			accepted: true,
			alreadyQueued: true,
			jobId: 'existing-job',
			status: { active: true, queued: true },
		});
		expect(realtimeService.publishEvent).not.toHaveBeenCalled();
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
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 2,
				allowPrivateHosts: false,
			},
		);

		const result = await service.getSyncAllFeedsStatus('user-1');

		expect(redis.get).toHaveBeenCalledWith('feed:sync-all:queued:user-1');
		expect(redis.get).toHaveBeenCalledWith('feed:sync-all:lock:user-1');
		expect(result).toMatchObject({
			queued: true,
			running: false,
			active: true,
			stale: false,
			queuedAt: expect.any(String),
			startedAt: null,
			heartbeatAt: null,
			...emptySyncProgress,
		});
	});

	it('reports queued bulk refresh status from Redis queue membership after the visual marker expires', async () => {
		const redis = {
			get: vi.fn(async () => null),
			call: vi.fn(async () => 0),
		};
		const service = new FeedSyncService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			redis as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 2,
				allowPrivateHosts: false,
			},
		);

		const result = await service.getSyncAllFeedsStatus('user-1');

		expect(redis.call).toHaveBeenCalledWith('LPOS', 'feed:sync-all:queue', 'user-1');
		expect(result).toMatchObject({
			queued: true,
			running: false,
			active: true,
			stale: false,
			queuedAt: null,
			startedAt: null,
			heartbeatAt: null,
			...emptySyncProgress,
		});
	});

	it('keeps stale queued bulk refresh markers active while the user remains in the Redis queue', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-21T12:00:00.000Z'));
		const redis = {
			get: vi.fn(async (key: string) =>
				key.includes(':queued:') ? String(new Date('2026-06-21T11:58:00.000Z').getTime()) : null,
			),
			call: vi.fn(async () => 0),
			del: vi.fn(async () => 1),
		};
		const service = new FeedSyncService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			redis as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 2,
				allowPrivateHosts: false,
			},
		);

		const result = await service.getSyncAllFeedsStatus('user-1');

		expect(redis.call).toHaveBeenCalledWith('LPOS', 'feed:sync-all:queue', 'user-1');
		expect(redis.del).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			queued: true,
			running: false,
			active: true,
			stale: false,
			queuedAt: '2026-06-21T11:58:00.000Z',
			startedAt: null,
			heartbeatAt: null,
			...emptySyncProgress,
		});
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
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 2,
				allowPrivateHosts: false,
			},
		);

		const result = await service.getSyncAllFeedsStatus('user-1');

		expect(redis.del).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			queued: false,
			running: true,
			active: true,
			stale: false,
			queuedAt: null,
			startedAt: '2026-06-21T12:00:00.000Z',
			heartbeatAt: '2026-06-21T12:00:00.000Z',
			...emptySyncProgress,
		});
	});

	it('reports persisted progress and the article cache revision', async () => {
		const redis = {
			get: vi.fn(async (key: string) => {
				if (key.includes(':lock:')) return String(Date.now());
				if (key.includes(':progress:')) {
					return JSON.stringify({
						totalFeeds: 8,
						completedFeeds: 3,
						newArticles: 5,
					});
				}
				if (key === 'articles:gen:user-1') return '42';
				return null;
			}),
			del: vi.fn(async () => 0),
		};
		const service = new FeedSyncService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			redis as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 2,
				allowPrivateHosts: false,
			},
		);

		const result = await service.getSyncAllFeedsStatus('user-1');

		expect(result).toMatchObject({
			active: true,
			totalFeeds: 8,
			completedFeeds: 3,
			newArticles: 5,
			articleRevision: 42,
		});
	});

	it('clears a stale worker lock while keeping its durable refresh queued', async () => {
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
			call: vi.fn(async () => 0),
			del: vi.fn(async () => 2),
			eval: vi.fn(async () => 1),
		};
		const service = new FeedSyncService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			redis as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 2,
				allowPrivateHosts: false,
			},
		);

		const result = await service.getSyncAllFeedsStatus('user-1');

		expect(redis.eval).toHaveBeenCalledWith(
			expect.stringContaining('ARGV[1]'),
			1,
			'feed:sync-all:lock:user-1',
			expect.any(String),
		);
		expect(result).toMatchObject({
			queued: true,
			running: false,
			active: true,
			stale: true,
			queuedAt: new Date('2026-06-21T11:57:30.000Z').toISOString(),
			startedAt: null,
			heartbeatAt: null,
			...emptySyncProgress,
		});
	});

	it('clears legacy running bulk refresh locks that have no heartbeat timestamp', async () => {
		const redis = {
			get: vi.fn(async (key: string) => (key.includes(':lock:') ? '1' : null)),
			call: vi.fn(async () => null),
			del: vi.fn(async () => 2),
			eval: vi.fn(async () => 1),
		};
		const service = new FeedSyncService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			redis as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 2,
				allowPrivateHosts: false,
			},
		);

		const result = await service.getSyncAllFeedsStatus('user-1');

		expect(redis.eval).toHaveBeenCalledWith(
			expect.stringContaining('ARGV[1]'),
			1,
			'feed:sync-all:lock:user-1',
			'1',
		);
		expect(result).toMatchObject({
			queued: false,
			running: false,
			active: false,
			stale: true,
			queuedAt: null,
			startedAt: null,
			heartbeatAt: null,
			...emptySyncProgress,
		});
	});

	it('clears stale queued bulk refresh markers and releases active status', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-21T12:00:00.000Z'));
		const redis = {
			get: vi.fn(async (key: string) =>
				key.includes(':queued:') ? String(new Date('2026-06-21T11:58:00.000Z').getTime()) : null,
			),
			call: vi.fn(async () => null),
			del: vi.fn(async () => 1),
		};
		const service = new FeedSyncService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			redis as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 2,
				allowPrivateHosts: false,
			},
		);

		const result = await service.getSyncAllFeedsStatus('user-1');

		expect(redis.call).toHaveBeenCalledWith('LPOS', 'feed:sync-all:queue', 'user-1');
		expect(redis.del).toHaveBeenCalledWith('feed:sync-all:queued:user-1');
		expect(result).toMatchObject({
			queued: false,
			running: false,
			active: false,
			stale: true,
			queuedAt: null,
			startedAt: null,
			heartbeatAt: null,
			...emptySyncProgress,
		});
	});

	it('processes the next queued bulk refresh and clears queue state', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-21T12:00:00.000Z'));
		const redis = {
			lindex: vi.fn(async () => 'user-1'),
			get: vi.fn(async () => null),
			set: vi.fn(async () => 'OK'),
			del: vi.fn(async () => 2),
			eval: vi.fn(async () => 1),
		};
		const realtimeService = {
			publishEvent: vi.fn(async (_userId: string, _event: unknown) => undefined),
		};
		const service = new FeedSyncService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			redis as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 2,
				allowPrivateHosts: false,
			},
			undefined,
			realtimeService as never,
		);
		const syncAllSpy = vi.spyOn(service, 'syncAllFeeds').mockResolvedValue({
			totalFeeds: 2,
			syncedFeeds: 2,
			failedFeeds: 0,
			skippedFeeds: 0,
			newArticles: 3,
		});

		const result = await service.processNextQueuedSyncAllFeeds();

		expect(redis.lindex).toHaveBeenCalledWith('feed:sync-all:queue', 0);
		expect(redis.set).toHaveBeenCalledWith(
			'feed:sync-all:lock:user-1',
			expect.stringContaining('"ownerToken"'),
			'EX',
			1800,
			'NX',
		);
		expect(syncAllSpy).toHaveBeenCalledWith('user-1', {}, expect.any(Function));
		expect(redis.eval).toHaveBeenCalledWith(
			expect.stringContaining('decoded.ownerToken'),
			4,
			'feed:sync-all:lock:user-1',
			'feed:sync-all:queued:user-1',
			'feed:sync-all:request:user-1',
			'feed:sync-all:queue',
			expect.any(String),
			'user-1',
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
		expect(
			realtimeService.publishEvent.mock.calls.map(
				([, event]) => (event as { phase?: string }).phase,
			),
		).toEqual(['running', 'completed']);
	});

	it('processes queued bulk refreshes after clearing a stale worker lock', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-21T12:00:00.000Z'));
		const redis = {
			lindex: vi.fn(async () => 'user-1'),
			set: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('OK').mockResolvedValue('OK'),
			get: vi.fn(async () => String(new Date('2026-06-21T11:58:00.000Z').getTime())),
			del: vi.fn(async () => 1),
			eval: vi.fn(async () => 1),
		};
		const service = new FeedSyncService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			redis as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 2,
				allowPrivateHosts: false,
			},
		);
		const syncAllSpy = vi.spyOn(service, 'syncAllFeeds').mockResolvedValue({
			totalFeeds: 1,
			syncedFeeds: 1,
			failedFeeds: 0,
			skippedFeeds: 0,
			newArticles: 2,
		});

		const result = await service.processNextQueuedSyncAllFeeds();

		expect(redis.eval).toHaveBeenCalledWith(
			expect.stringContaining('redis.call("GET", KEYS[1])'),
			1,
			'feed:sync-all:lock:user-1',
			expect.any(String),
			expect.stringContaining('"ownerToken"'),
			'1800',
		);
		expect(syncAllSpy).toHaveBeenCalledWith(
			'user-1',
			{ feedId: undefined, categoryId: undefined },
			expect.any(Function),
		);
		expect(result).toEqual({
			userId: 'user-1',
			skipped: false,
			result: {
				totalFeeds: 1,
				syncedFeeds: 1,
				failedFeeds: 0,
				skippedFeeds: 0,
				newArticles: 2,
			},
		});
	});

	it('leaves a queued refresh in place while another worker owns it', async () => {
		const freshLock = JSON.stringify({
			startedAt: Date.now(),
			heartbeatAt: Date.now(),
			ownerToken: 'active-owner',
		});
		const redis = {
			lindex: vi.fn(async () => 'user-1'),
			set: vi.fn(async () => null),
			get: vi.fn(async () => freshLock),
			eval: vi.fn(async () => 0),
		};
		const service = new FeedSyncService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			redis as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 2,
				allowPrivateHosts: false,
			},
		);
		const syncAllSpy = vi.spyOn(service, 'syncAllFeeds');

		const result = await service.processNextQueuedSyncAllFeeds();

		expect(result).toEqual({ userId: 'user-1', skipped: true });
		expect(syncAllSpy).not.toHaveBeenCalled();
		expect(redis.lindex).toHaveBeenCalledTimes(1);
		expect(redis.eval).not.toHaveBeenCalled();
	});

	it('force-fetches feed content even when existing articles have cached validators', async () => {
		const feedRepo = {
			findById: vi.fn(async () => ({
				id: 'feed-1',
				title: 'Force Feed',
				feedUrl: 'https://example.com/feed.xml',
				userId: 'user-1',
				pollingIntervalMinutes: 60,
			})),
			update: vi.fn(async () => undefined),
		};

		const articleRepo = {
			countByFeeds: vi.fn(async () => 10),
			findExistingGuids: vi.fn(async () => []),
			persistSyncResults: vi.fn(async () => []),
		};

		const service = new FeedSyncService(
			feedRepo as never,
			articleRepo as never,
			{
				create: vi.fn(async () => ({ id: 'run-1' })),
				complete: vi.fn(async () => undefined),
			} as never,
			{ incrementSyncCount: vi.fn(async () => undefined) } as never,
			{ del: vi.fn(async () => 0) } as never,
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
		);

		const fetchAndParseSpy = vi
			.spyOn(
				service as unknown as {
					fetchAndParse: (feedUrl: string, ignoreCache: boolean) => Promise<unknown>;
				},
				'fetchAndParse',
			)
			.mockResolvedValue({ title: 'Force Feed', items: [] });

		await service.syncFeed('feed-1', 'user-1', {
			enrichArticles: false,
			warmArticleCache: false,
			forceFetch: true,
		});

		expect(fetchAndParseSpy).toHaveBeenCalledWith('https://example.com/feed.xml', true);
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
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 2,
				allowPrivateHosts: false,
			},
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
				service as unknown as {
					enrichArticlesInBackground: () => Promise<void>;
				},
				'enrichArticlesInBackground',
			)
			.mockResolvedValue(undefined);

		const result = await service.syncFeed('feed-1', 'user-1', {
			enrichArticles: false,
		});

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
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
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
				service as unknown as {
					enrichArticlesInBackground: () => Promise<void>;
				},
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
					articlesToInsert.map((item, index) => ({
						id: `article-${index + 1}`,
						...item,
					})),
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
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
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
					articlesToInsert.map((item, index) => ({
						id: `article-${index + 1}`,
						...item,
					})),
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
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
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
				service as unknown as {
					enrichArticlesInBackground: () => Promise<void>;
				},
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
					articlesToInsert.map((item, index) => ({
						id: `article-${index + 1}`,
						...item,
					})),
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
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
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
				service as unknown as {
					enrichArticlesInBackground: () => Promise<void>;
				},
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
					articlesToInsert.map((item, index) => ({
						id: `article-${index + 1}`,
						...item,
					})),
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
			{
				timeoutMs: 5_000,
				maxContentLength: 1_000_000,
				concurrency: 1,
				allowPrivateHosts: false,
			},
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
				siteUrl: 'https://example.com/',
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
			const content = await fetchArticlePageContent(
				'https://www.naointendo.com.br/posts/12345-test-post',
				{
					timeoutMs: 5_000,
					maxContentLength: 1_000_000,
					allowPrivateHosts: true,
				},
			);

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
				{
					timeoutMs: 5_000,
					maxContentLength: 1_000_000,
					concurrency: 2,
					allowPrivateHosts: false,
				},
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
				{
					timeoutMs: 5_000,
					maxContentLength: 1_000_000,
					concurrency: 1,
					allowPrivateHosts: false,
				},
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
				{
					timeoutMs: 5_000,
					maxContentLength: 1_000_000,
					concurrency: 1,
					allowPrivateHosts: false,
				},
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
				{
					timeoutMs: 5_000,
					maxContentLength: 1_000_000,
					concurrency: 1,
					allowPrivateHosts: false,
				},
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
