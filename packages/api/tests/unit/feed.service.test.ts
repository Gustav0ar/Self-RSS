import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedService } from '../../src/services/feed.service.js';
import { FEED_FETCH_USER_AGENT } from '../../src/utils/feed-fetch-headers.js';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('FeedService - normalizeFeedUrl', () => {
	it('rejects localhost when private hosts are not allowed', async () => {
		const service = new FeedService({} as never, {} as never, {} as never, {
			maxContentLength: 1024,
			allowPrivateHosts: false,
		});
		await expect(service.normalizeFeedUrl('http://127.0.0.1/feed.xml')).rejects.toMatchObject({
			code: 'BAD_REQUEST',
		});
	});

	it('accepts https URLs when private hosts are not allowed', async () => {
		const service = new FeedService({} as never, {} as never, {} as never, {
			maxContentLength: 1024,
			allowPrivateHosts: false,
		});
		const url = await service.normalizeFeedUrl('https://example.com/feed.xml');
		expect(url).toBe('https://example.com/feed.xml');
	});
});

describe('FeedService - getAll', () => {
	it('attaches unread counts from the article repository', async () => {
		const feeds = [
			{
				id: 'feed-1',
				userId: 'user-1',
				categoryId: 'cat-1',
				title: 'A',
				feedUrl: 'https://a.example/feed.xml',
				siteUrl: null,
				faviconUrl: null,
				description: null,
				pollingIntervalMinutes: 60,
				lastSyncedAt: null,
				syncStatus: 'idle',
				lastSyncError: null,
				lastSyncErrorAt: null,
				createdAt: new Date('2026-01-01T00:00:00.000Z'),
				updatedAt: new Date('2026-01-01T00:00:00.000Z'),
			},
			{
				id: 'feed-2',
				userId: 'user-1',
				categoryId: 'cat-1',
				title: 'B',
				feedUrl: 'https://b.example/feed.xml',
				siteUrl: null,
				faviconUrl: null,
				description: null,
				pollingIntervalMinutes: 60,
				lastSyncedAt: null,
				syncStatus: 'error',
				lastSyncError: 'HTTP 500: Internal Server Error',
				lastSyncErrorAt: new Date('2026-01-01T00:05:00.000Z'),
				createdAt: new Date('2026-01-01T00:00:00.000Z'),
				updatedAt: new Date('2026-01-01T00:00:00.000Z'),
			},
		];
		const feedRepo = { findAllByUser: vi.fn(async () => feeds) };
		const articleRepo = {
			unreadCountByFeed: vi.fn(async () => new Map([['feed-1', 4]])),
		};
		const service = new FeedService(feedRepo as never, {} as never, articleRepo as never, {
			maxContentLength: 1024,
			allowPrivateHosts: true,
		});

		const result = await service.getAll('user-1');

		expect(result).toHaveLength(2);
		expect(result.find((f) => f.id === 'feed-1')?.unreadCount).toBe(4);
		expect(result.find((f) => f.id === 'feed-2')?.unreadCount).toBe(0);
		expect(result[0]?.createdAt).toBe('2026-01-01T00:00:00.000Z');
		expect(result.find((f) => f.id === 'feed-2')).toMatchObject({
			syncStatus: 'error',
			lastSyncError: 'HTTP 500: Internal Server Error',
			lastSyncErrorAt: '2026-01-01T00:05:00.000Z',
		});
	});
});

describe('FeedService - getByCategory', () => {
	it('returns 404 when the category does not exist', async () => {
		const feedRepo = {
			findByCategory: vi.fn(),
		};
		const categoryRepo = {
			findById: vi.fn(async () => null),
		};
		const service = new FeedService(feedRepo as never, categoryRepo as never, {} as never, {
			maxContentLength: 1024,
			allowPrivateHosts: true,
		});

		await expect(service.getByCategory('user-1', 'missing-category')).rejects.toMatchObject({
			code: 'NOT_FOUND',
			statusCode: 404,
		});
		expect(feedRepo.findByCategory).not.toHaveBeenCalled();
	});
});

describe('FeedService - create', () => {
	it('returns 404 when the target category does not exist', async () => {
		const categoryRepo = { findById: vi.fn().mockResolvedValue(null) };
		const service = new FeedService({} as never, categoryRepo as never, {} as never, {
			maxContentLength: 1024,
			allowPrivateHosts: true,
		});

		await expect(
			service.create('user-1', {
				categoryId: 'cat-1',
				feedUrl: 'https://example.com/feed.xml',
			}),
		).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
	});

	it('uses browser-compatible headers when fetching feed metadata', async () => {
		const feedRepo = {
			findByUrl: vi.fn().mockResolvedValue(null),
			create: vi.fn(async (data) => ({ id: 'feed-1', ...data })),
		};
		const categoryRepo = { findById: vi.fn(async () => ({ id: 'cat-1' })) };
		const service = new FeedService(feedRepo as never, categoryRepo as never, {} as never, {
			maxContentLength: 10_000,
			allowPrivateHosts: true,
		});
		vi.spyOn(service, 'normalizeFeedUrl').mockResolvedValue('http://127.0.0.1/feed.xml');
		const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			expect(headers.get('user-agent')).toBe(FEED_FETCH_USER_AGENT);
			expect(headers.get('accept')).toContain('application/rss+xml');
			return new Response(
				'<?xml version="1.0"?><rss version="2.0"><channel><title>Compatible feed</title><link>https://example.com</link></channel></rss>',
				{ status: 200, headers: { 'content-type': 'application/rss+xml' } },
			);
		});
		vi.stubGlobal('fetch', fetchMock);

		await service.create('user-1', {
			categoryId: 'cat-1',
			feedUrl: 'https://example.com/feed.xml',
		});

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(feedRepo.create).toHaveBeenCalledWith(
			expect.objectContaining({
				feedUrl: 'http://127.0.0.1/feed.xml',
				title: 'Compatible feed',
			}),
		);
	});

	it('reports when the feed publisher denies access from the API server', async () => {
		const feedRepo = {
			findByUrl: vi.fn().mockResolvedValue(null),
			create: vi.fn(),
		};
		const categoryRepo = { findById: vi.fn(async () => ({ id: 'cat-1' })) };
		const service = new FeedService(feedRepo as never, categoryRepo as never, {} as never, {
			maxContentLength: 10_000,
			allowPrivateHosts: true,
		});
		vi.spyOn(service, 'normalizeFeedUrl').mockResolvedValue('http://127.0.0.1/feed.xml');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('Blocked', { status: 403, statusText: 'Forbidden' })),
		);

		await expect(
			service.create('user-1', {
				categoryId: 'cat-1',
				feedUrl: 'https://example.com/feed.xml',
			}),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			details: "The feed publisher rejected this server's fetch request (HTTP 403: Forbidden)",
			message: 'Could not fetch or parse the feed URL',
			statusCode: 400,
		});
		expect(feedRepo.create).not.toHaveBeenCalled();
	});
});

describe('FeedService - update / delete', () => {
	it('updates the feed metadata when present', async () => {
		const feedRepo = {
			findById: vi.fn(async () => ({ id: 'feed-1', feedUrl: 'https://old.example/feed.xml' })),
			update: vi.fn(async () => ({ id: 'feed-1', title: 'New' })),
		};
		const service = new FeedService(feedRepo as never, {} as never, {} as never, {
			maxContentLength: 1024,
			allowPrivateHosts: true,
		});

		await service.update('user-1', 'feed-1', { title: 'New' });
		expect(feedRepo.update).toHaveBeenCalledWith('feed-1', 'user-1', { title: 'New' });
	});

	it('normalizes a changed URL and clears stale sync failures', async () => {
		const feedRepo = {
			findById: vi.fn(async () => ({ id: 'feed-1', feedUrl: 'https://old.example/feed.xml' })),
			findByUrl: vi.fn().mockResolvedValue(null),
			update: vi.fn(async (_id, _userId, data) => ({ id: 'feed-1', ...data })),
		};
		const service = new FeedService(feedRepo as never, {} as never, {} as never, {
			maxContentLength: 1024,
			allowPrivateHosts: true,
		});
		vi.spyOn(service, 'normalizeFeedUrl').mockResolvedValue('https://new.example/feed.xml');

		await service.update('user-1', 'feed-1', { feedUrl: 'https://new.example/feed.xml' });

		expect(feedRepo.findByUrl).toHaveBeenCalledWith('user-1', 'https://new.example/feed.xml');
		expect(feedRepo.update).toHaveBeenCalledWith(
			'feed-1',
			'user-1',
			expect.objectContaining({
				feedUrl: 'https://new.example/feed.xml',
				syncStatus: 'idle',
				lastSyncError: null,
				lastSyncErrorAt: null,
				nextSyncAt: expect.any(Date),
			}),
		);
	});

	it('rejects changing a feed to another subscription URL', async () => {
		const feedRepo = {
			findById: vi.fn(async () => ({ id: 'feed-1', feedUrl: 'https://old.example/feed.xml' })),
			findByUrl: vi.fn(async () => ({ id: 'feed-2' })),
			update: vi.fn(),
		};
		const service = new FeedService(feedRepo as never, {} as never, {} as never, {
			maxContentLength: 1024,
			allowPrivateHosts: true,
		});
		vi.spyOn(service, 'normalizeFeedUrl').mockResolvedValue('https://duplicate.example/feed.xml');

		await expect(
			service.update('user-1', 'feed-1', { feedUrl: 'https://duplicate.example/feed.xml' }),
		).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
		expect(feedRepo.update).not.toHaveBeenCalled();
	});

	it('returns 404 when updating a missing feed', async () => {
		const feedRepo = { findById: vi.fn().mockResolvedValue(null) };
		const service = new FeedService(feedRepo as never, {} as never, {} as never, {
			maxContentLength: 1024,
			allowPrivateHosts: true,
		});

		await expect(service.update('user-1', 'missing', { title: 'X' })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
	});

	it('validates the new category exists when moving a feed', async () => {
		const feedRepo = { findById: vi.fn(async () => ({ id: 'feed-1' })) };
		const categoryRepo = { findById: vi.fn().mockResolvedValue(null) };
		const service = new FeedService(feedRepo as never, categoryRepo as never, {} as never, {
			maxContentLength: 1024,
			allowPrivateHosts: true,
		});

		await expect(
			service.update('user-1', 'feed-1', { categoryId: 'cat-missing' }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
	});

	it('rejects deletion of a missing feed', async () => {
		const feedRepo = {
			findById: vi.fn().mockResolvedValue(null),
			delete: vi.fn(),
		};
		const service = new FeedService(feedRepo as never, {} as never, {} as never, {
			maxContentLength: 1024,
			allowPrivateHosts: true,
		});

		await expect(service.delete('user-1', 'missing')).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
		expect(feedRepo.delete).not.toHaveBeenCalled();
	});
});
