import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	startCacheWarmer,
	startQueuedSyncWorker,
	startRetentionCleanup,
	startSyncScheduler,
} from '../../src/jobs/scheduler.js';

const ORIGINAL_CONSOLE_ERROR = console.error;
const ORIGINAL_CONSOLE_WARN = console.warn;

describe('scheduler error handling', () => {
	let errorLogs: Array<{ msg: string; extra: Record<string, unknown> }>;
	let warnLogs: Array<{ msg: string; extra: Record<string, unknown> }>;

	beforeEach(() => {
		errorLogs = [];
		warnLogs = [];
		console.error = vi.fn((output: string) => {
			const parsed = JSON.parse(output);
			errorLogs.push({ msg: parsed.msg, extra: parsed });
		});
		console.warn = vi.fn((output: string) => {
			const parsed = JSON.parse(output);
			warnLogs.push({ msg: parsed.msg, extra: parsed });
		});
	});

	afterEach(() => {
		console.error = ORIGINAL_CONSOLE_ERROR;
		console.warn = ORIGINAL_CONSOLE_WARN;
	});

	describe('startSyncScheduler', () => {
		it('logs errors when syncDueFeeds throws', async () => {
			const syncService = {
				syncDueFeeds: vi.fn().mockRejectedValue(new Error('Database connection failed')),
			};

			const stop = startSyncScheduler(syncService as never, 100);

			// Wait for the first interval execution
			await vi.waitFor(
				() => {
					expect(errorLogs.some((l) => l.msg === 'Sync scheduler error')).toBe(true);
				},
				{ timeout: 500 },
			);

			stop();

			const errorLog = errorLogs.find((l) => l.msg === 'Sync scheduler error');
			expect(errorLog).toBeDefined();
			expect(errorLog!.extra.operation).toBe('syncScheduler');
			expect(errorLog!.extra.error).toBe('Database connection failed');
			expect(errorLog!.extra.timestamp).toBeDefined();
			expect(errorLog!.extra.stack).toBeDefined();
		});

		it('logs errors with non-Error thrown values', async () => {
			const syncService = {
				syncDueFeeds: vi.fn().mockRejectedValue('String error'),
			};

			const stop = startSyncScheduler(syncService as never, 100);

			await vi.waitFor(
				() => {
					expect(errorLogs.some((l) => l.msg === 'Sync scheduler error')).toBe(true);
				},
				{ timeout: 500 },
			);

			stop();

			const errorLog = errorLogs.find((l) => l.msg === 'Sync scheduler error');
			expect(errorLog!.extra.error).toBe('String error');
		});
	});

	describe('startQueuedSyncWorker', () => {
		it('logs errors when processNextQueuedSyncAllFeeds throws', async () => {
			const syncService = {
				processNextQueuedSyncAllFeeds: vi
					.fn()
					.mockRejectedValue(new Error('Queue processing error')),
			};

			const stop = startQueuedSyncWorker(syncService as never, 100);

			// Wait for initial call plus interval
			await vi.waitFor(
				() => {
					expect(errorLogs.some((l) => l.msg === 'Queued feed sync worker error')).toBe(true);
				},
				{ timeout: 500 },
			);

			stop();

			const errorLog = errorLogs.find((l) => l.msg === 'Queued feed sync worker error');
			expect(errorLog).toBeDefined();
			expect(errorLog!.extra.operation).toBe('queuedSyncWorker');
			expect(errorLog!.extra.error).toBe('Queue processing error');
			expect(errorLog!.extra.stack).toBeDefined();
		});

		it('drains manual refresh work with an independent coordinator while scheduled sync is busy', async () => {
			const scheduledCoordinator = { isRunning: true };
			const queuedCoordinator = { isRunning: false };
			const syncService = {
				processNextQueuedSyncAllFeeds: vi.fn().mockResolvedValue(null),
			};

			const stop = startQueuedSyncWorker(syncService as never, 1000, queuedCoordinator);

			await vi.waitFor(() => {
				expect(syncService.processNextQueuedSyncAllFeeds).toHaveBeenCalledTimes(1);
			});
			stop();

			expect(scheduledCoordinator.isRunning).toBe(true);
			expect(queuedCoordinator.isRunning).toBe(false);
		});
	});

	describe('startRetentionCleanup', () => {
		it('logs errors when deleteOlderThan throws', async () => {
			const articleRepo = {
				deleteOlderThan: vi.fn().mockRejectedValue(new Error('Cleanup failed')),
			};

			const stop = startRetentionCleanup(articleRepo as never, {
				retentionDays: 30,
				enabled: true,
				dryRun: false,
				intervalMs: 100,
			});

			await vi.waitFor(
				() => {
					expect(errorLogs.some((l) => l.msg === 'Retention cleanup error')).toBe(true);
				},
				{ timeout: 500 },
			);

			stop();

			const errorLog = errorLogs.find((l) => l.msg === 'Retention cleanup error');
			expect(errorLog).toBeDefined();
			expect(errorLog!.extra.operation).toBe('retentionCleanup');
			expect(errorLog!.extra.retentionDays).toBe(30);
			expect(errorLog!.extra.dryRun).toBe(false);
			expect(errorLog!.extra.error).toBe('Cleanup failed');
			expect(errorLog!.extra.stack).toBeDefined();
		});

		it('includes correct metadata for dry-run mode', async () => {
			const articleRepo = {
				deleteOlderThan: vi.fn().mockRejectedValue(new Error('Dry-run error')),
			};

			const stop = startRetentionCleanup(articleRepo as never, {
				retentionDays: 60,
				enabled: true,
				dryRun: true,
				intervalMs: 100,
			});

			await vi.waitFor(
				() => {
					expect(errorLogs.some((l) => l.msg === 'Retention cleanup error')).toBe(true);
				},
				{ timeout: 500 },
			);

			stop();

			const errorLog = errorLogs.find((l) => l.msg === 'Retention cleanup error');
			expect(errorLog!.extra.dryRun).toBe(true);
			expect(errorLog!.extra.retentionDays).toBe(60);
		});
	});

	describe('startCacheWarmer', () => {
		it('logs errors when getRecentlyActiveUserIds throws', async () => {
			const articleCache = {
				getRecentlyActiveUserIds: vi.fn().mockRejectedValue(new Error('Cache service error')),
				populateCache: vi.fn().mockResolvedValue(undefined),
			};
			const userRepo = {
				findActiveUserIds: vi.fn().mockResolvedValue([]),
			};

			const stop = startCacheWarmer(articleCache as never, userRepo, {
				intervalMs: 100,
				recentWindowMinutes: 15,
				recentUsersLimit: 10,
				includeIdleUsers: false,
				runOnStart: true,
			});

			await vi.waitFor(
				() => {
					expect(errorLogs.some((l) => l.msg === 'Cache warmer error')).toBe(true);
				},
				{ timeout: 500 },
			);

			stop();

			const errorLog = errorLogs.find((l) => l.msg === 'Cache warmer error');
			expect(errorLog).toBeDefined();
			expect(errorLog!.extra.operation).toBe('cacheWarmer');
			expect(errorLog!.extra.recentWindowMinutes).toBe(15);
			expect(errorLog!.extra.recentUsersLimit).toBe(10);
			expect(errorLog!.extra.includeIdleUsers).toBe(false);
			expect(errorLog!.extra.error).toBe('Cache service error');
			expect(errorLog!.extra.stack).toBeDefined();
		});
	});

	describe('startCacheWarmer - existing tests', () => {
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
});
