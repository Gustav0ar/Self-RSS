import { describe, expect, it, vi } from 'vitest';
import { FeedService } from '../../src/services/feed.service.js';

describe('FeedService - normalizeFeedUrl', () => {
	it('rejects localhost when private hosts are not allowed', async () => {
		const service = new FeedService(
			{} as never,
			{} as never,
			{} as never,
			{ maxContentLength: 1024, allowPrivateHosts: false },
		);
		await expect(service.normalizeFeedUrl('http://127.0.0.1/feed.xml')).rejects.toMatchObject({
			code: 'BAD_REQUEST',
		});
	});

	it('accepts https URLs when private hosts are not allowed', async () => {
		const service = new FeedService(
			{} as never,
			{} as never,
			{} as never,
			{ maxContentLength: 1024, allowPrivateHosts: false },
		);
		const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
		const url = await service.normalizeFeedUrl('https://example.com/feed.xml', lookup as never);
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
				syncStatus: 'idle',
				createdAt: new Date('2026-01-01T00:00:00.000Z'),
				updatedAt: new Date('2026-01-01T00:00:00.000Z'),
			},
		];
		const feedRepo = { findAllByUser: vi.fn(async () => feeds) };
		const articleRepo = {
			unreadCountByFeed: vi.fn(async () => new Map([['feed-1', 4]])),
		};
		const service = new FeedService(
			feedRepo as never,
			{} as never,
			articleRepo as never,
			{ maxContentLength: 1024, allowPrivateHosts: true },
		);

		const result = await service.getAll('user-1');

		expect(result).toHaveLength(2);
		expect(result.find((f) => f.id === 'feed-1')?.unreadCount).toBe(4);
		expect(result.find((f) => f.id === 'feed-2')?.unreadCount).toBe(0);
		expect(result[0]?.createdAt).toBe('2026-01-01T00:00:00.000Z');
	});
});

describe('FeedService - create', () => {
	it('returns 404 when the target category does not exist', async () => {
		const categoryRepo = { findById: vi.fn().mockResolvedValue(null) };
		const service = new FeedService(
			{} as never,
			categoryRepo as never,
			{} as never,
			{ maxContentLength: 1024, allowPrivateHosts: true },
		);

		await expect(
			service.create('user-1', {
				categoryId: 'cat-1',
				feedUrl: 'https://example.com/feed.xml',
			}),
		).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
	});
});

describe('FeedService - update / delete', () => {
	it('updates the feed metadata when present', async () => {
		const feedRepo = {
			findById: vi.fn(async () => ({ id: 'feed-1' })),
			update: vi.fn(async () => ({ id: 'feed-1', title: 'New' })),
		};
		const service = new FeedService(
			feedRepo as never,
			{} as never,
			{} as never,
			{ maxContentLength: 1024, allowPrivateHosts: true },
		);

		await service.update('user-1', 'feed-1', { title: 'New' });
		expect(feedRepo.update).toHaveBeenCalledWith('feed-1', 'user-1', { title: 'New' });
	});

	it('returns 404 when updating a missing feed', async () => {
		const feedRepo = { findById: vi.fn().mockResolvedValue(null) };
		const service = new FeedService(
			feedRepo as never,
			{} as never,
			{} as never,
			{ maxContentLength: 1024, allowPrivateHosts: true },
		);

		await expect(service.update('user-1', 'missing', { title: 'X' })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
	});

	it('validates the new category exists when moving a feed', async () => {
		const feedRepo = { findById: vi.fn(async () => ({ id: 'feed-1' })) };
		const categoryRepo = { findById: vi.fn().mockResolvedValue(null) };
		const service = new FeedService(
			feedRepo as never,
			categoryRepo as never,
			{} as never,
			{ maxContentLength: 1024, allowPrivateHosts: true },
		);

		await expect(
			service.update('user-1', 'feed-1', { categoryId: 'cat-missing' }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' });
	});

	it('rejects deletion of a missing feed', async () => {
		const feedRepo = {
			findById: vi.fn().mockResolvedValue(null),
			delete: vi.fn(),
		};
		const service = new FeedService(
			feedRepo as never,
			{} as never,
			{} as never,
			{ maxContentLength: 1024, allowPrivateHosts: true },
		);

		await expect(service.delete('user-1', 'missing')).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
		expect(feedRepo.delete).not.toHaveBeenCalled();
	});
});
