import { describe, expect, it, vi } from 'vitest';
import { startCacheWarmer } from '../../src/jobs/scheduler.js';

describe('startCacheWarmer', () => {
	it('warms only recently active users by default', async () => {
		const articleCache = {
			getRecentlyActiveUserIds: vi.fn().mockResolvedValue(['recent-1']),
			populateCache: vi.fn().mockResolvedValue(undefined),
		};
		const userRepo = {
			findActiveUserIds: vi.fn().mockResolvedValue(['recent-1', 'idle-1']),
		};

		const stop = startCacheWarmer(articleCache as never, userRepo, {
			intervalMs: 60_000,
			recentWindowMinutes: 15,
			recentUsersLimit: 3,
		});

		await vi.waitFor(() => {
			expect(articleCache.populateCache).toHaveBeenCalledWith('recent-1');
		});
		stop();

		expect(articleCache.getRecentlyActiveUserIds).toHaveBeenCalledWith(15, 3);
		expect(userRepo.findActiveUserIds).not.toHaveBeenCalled();
		expect(articleCache.populateCache).toHaveBeenCalledTimes(1);
	});

	it('warms capped idle users only when enabled', async () => {
		const articleCache = {
			getRecentlyActiveUserIds: vi.fn().mockResolvedValue(['recent-1']),
			populateCache: vi.fn().mockResolvedValue(undefined),
		};
		const userRepo = {
			findActiveUserIds: vi.fn().mockResolvedValue(['recent-1', 'idle-1', 'idle-2']),
		};

		const stop = startCacheWarmer(articleCache as never, userRepo, {
			intervalMs: 60_000,
			includeIdleUsers: true,
			idleUsersLimit: 1,
		});

		await vi.waitFor(() => {
			expect(articleCache.populateCache).toHaveBeenCalledWith('idle-1');
		});
		stop();

		expect(userRepo.findActiveUserIds).toHaveBeenCalled();
		expect(articleCache.populateCache).toHaveBeenCalledTimes(2);
		expect(articleCache.populateCache).not.toHaveBeenCalledWith('idle-2');
	});
});
