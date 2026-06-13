import { describe, expect, it, vi } from 'vitest';
import { StatsService } from '../../src/services/stats.service.js';

describe('StatsService', () => {
	it('returns counts, run history, and 30 days of daily metrics', async () => {
		const articleRepo = {
			countByFeeds: vi.fn(async () => 10),
			countReadByFeeds: vi.fn(async () => 4),
		};
		const feedRepo = {
			findAllByUser: vi.fn(async () => [
				{ id: 'feed-1' },
				{ id: 'feed-2' },
			]),
		};
		const categoryRepo = {
			findAllByUser: vi.fn(async () => [
				{ id: 'cat-1' },
				{ id: 'cat-2' },
				{ id: 'cat-3' },
			]),
		};
		const syncRunRepo = {
			findRecentByUser: vi.fn(async () => [{ id: 'run-1' }]),
		};
		const metricsRepo = {
			getDailyMetrics: vi.fn(async () => [
				{ date: '2026-01-01', articlesReadCount: 2, feedsSyncedCount: 1, searchCount: 0 },
			]),
		};

		const service = new StatsService(
			articleRepo as never,
			feedRepo as never,
			categoryRepo as never,
			syncRunRepo as never,
			metricsRepo as never,
		);

		const stats = await service.getStats('user-1');

		expect(stats).toEqual({
			totalUnread: 6,
			totalRead: 4,
			totalFeeds: 2,
			totalCategories: 3,
			recentSyncRuns: [{ id: 'run-1' }],
			dailyMetrics: [
				{ date: '2026-01-01', articlesReadCount: 2, feedsSyncedCount: 1, searchCount: 0 },
			],
		});
		expect(syncRunRepo.findRecentByUser).toHaveBeenCalledWith('user-1', 10);
		expect(metricsRepo.getDailyMetrics).toHaveBeenCalledWith('user-1', 30);
	});

	it('clamps the unread count to zero when read exceeds total', async () => {
		const articleRepo = {
			countByFeeds: vi.fn(async () => 3),
			countReadByFeeds: vi.fn(async () => 5),
		};
		const service = new StatsService(
			articleRepo as never,
			{ findAllByUser: vi.fn(async () => []) } as never,
			{ findAllByUser: vi.fn(async () => []) } as never,
			{ findRecentByUser: vi.fn(async () => []) } as never,
			{ getDailyMetrics: vi.fn(async () => []) } as never,
		);

		const stats = await service.getStats('user-1');
		expect(stats.totalUnread).toBe(0);
		expect(stats.totalRead).toBe(5);
	});
});
