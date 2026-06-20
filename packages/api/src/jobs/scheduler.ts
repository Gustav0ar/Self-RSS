import type Redis from 'ioredis';
import { CacheKeys, CacheTTL } from '../db/redis.js';
import type { ArticleRepository } from '../repositories/article.repository.js';
import type { ArticleCacheService } from '../services/article-cache.service.js';
import type { FeedSyncService } from '../services/feed-sync.service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger();

interface SyncCoordinator {
	isRunning: boolean;
}

export function startSyncScheduler(
	syncService: FeedSyncService,
	intervalMs: number = 60 * 1000,
	coordinator: SyncCoordinator = { isRunning: false },
) {
	logger.info('Feed sync scheduler started', { intervalMs });

	const interval = setInterval(async () => {
		if (coordinator.isRunning) {
			logger.warn('Skipping sync cycle because the previous one is still running');
			return;
		}
		coordinator.isRunning = true;
		try {
			const result = await syncService.syncDueFeeds();
			if (result.total > 0) {
				logger.info('Sync cycle complete', result);
			}
		} catch (err) {
			logger.error('Sync scheduler error', {
				error: err instanceof Error ? err.message : String(err),
			});
		} finally {
			coordinator.isRunning = false;
		}
	}, intervalMs);

	return () => clearInterval(interval);
}

export function startQueuedSyncWorker(
	syncService: FeedSyncService,
	intervalMs: number = 1000,
	coordinator: SyncCoordinator = { isRunning: false },
) {
	logger.info('Queued feed sync worker started', { intervalMs });

	const drainOnce = async () => {
		if (coordinator.isRunning) {
			return;
		}

		coordinator.isRunning = true;
		try {
			await syncService.processNextQueuedSyncAllFeeds();
		} catch (err) {
			logger.error('Queued feed sync worker error', {
				error: err instanceof Error ? err.message : String(err),
			});
		} finally {
			coordinator.isRunning = false;
		}
	};

	void drainOnce();
	const interval = setInterval(() => {
		void drainOnce();
	}, intervalMs);

	return () => clearInterval(interval);
}

export function startRetentionCleanup(
	articleRepo: ArticleRepository,
	retentionDays = 90,
	intervalMs: number = 24 * 60 * 60 * 1000,
) {
	logger.info('Retention cleanup scheduled', { retentionDays, intervalMs });
	let isRunning = false;

	const interval = setInterval(async () => {
		if (isRunning) {
			logger.warn('Skipping retention cleanup because the previous run is still active');
			return;
		}
		isRunning = true;
		try {
			const deleted = await articleRepo.deleteOlderThan(retentionDays);
			if (deleted > 0) {
				logger.info('Retention cleanup', { deleted, retentionDays });
			}
		} catch (err) {
			logger.error('Retention cleanup error', {
				error: err instanceof Error ? err.message : String(err),
			});
		} finally {
			isRunning = false;
		}
	}, intervalMs);

	return () => clearInterval(interval);
}

interface CacheWarmerOptions {
	intervalMs?: number;
	recentWindowMinutes?: number;
	recentUsersLimit?: number;
	concurrency?: number;
	includeIdleUsers?: boolean;
	idleUsersLimit?: number;
	runOnStart?: boolean;
}

/**
 * Periodically warms the article cache for recently active users.
 * Idle users can be enabled explicitly, but are capped so background work
 * stays bounded as the user table grows.
 */
export function startCacheWarmer(
	articleCache: ArticleCacheService,
	userRepo: { findActiveUserIds(): Promise<string[]> },
	optionsOrIntervalMs: CacheWarmerOptions | number = {},
) {
	const options =
		typeof optionsOrIntervalMs === 'number'
			? { intervalMs: optionsOrIntervalMs }
			: optionsOrIntervalMs;
	const intervalMs = options.intervalMs ?? 60 * 1000;
	const recentWindowMinutes = options.recentWindowMinutes ?? 10;
	const recentUsersLimit = options.recentUsersLimit ?? 25;
	const concurrency = options.concurrency ?? 5;
	const includeIdleUsers = options.includeIdleUsers ?? false;
	const idleUsersLimit = options.idleUsersLimit ?? 25;
	const runOnStart = options.runOnStart ?? true;

	logger.info('Article cache warmer started', {
		intervalMs,
		recentWindowMinutes,
		recentUsersLimit,
		concurrency,
		includeIdleUsers,
		idleUsersLimit,
	});
	let isRunning = false;

	const warmOnce = async () => {
		if (isRunning) return;
		isRunning = true;
		try {
			const recentUserIds = await articleCache.getRecentlyActiveUserIds(
				recentWindowMinutes,
				recentUsersLimit,
			);
			let idleUsers: string[] = [];

			if (includeIdleUsers) {
				const recentSet = new Set(recentUserIds);
				const allUserIds = await userRepo.findActiveUserIds();
				idleUsers = allUserIds.filter((id) => !recentSet.has(id)).slice(0, idleUsersLimit);
			}

			const warmUsers = async (users: string[], label: string) => {
				if (users.length === 0) return;
				for (let i = 0; i < users.length; i += concurrency) {
					const batch = users.slice(i, i + concurrency);
					await Promise.allSettled(batch.map((userId) => articleCache.populateCache(userId)));
				}
				logger.debug(`Cache warming ${label}`, { userCount: users.length });
			};

			await warmUsers(recentUserIds, 'recent');
			await warmUsers(idleUsers, 'idle');
		} catch (err) {
			logger.error('Cache warmer error', {
				error: err instanceof Error ? err.message : String(err),
			});
		} finally {
			isRunning = false;
		}
	};

	if (runOnStart) {
		void warmOnce();
	}
	const interval = setInterval(() => {
		void warmOnce();
	}, intervalMs);

	return () => clearInterval(interval);
}

export function startWorkerHeartbeat(
	redis: Redis,
	name = 'feed-worker',
	intervalMs: number = 15 * 1000,
) {
	logger.info('Worker heartbeat started', { name, intervalMs });

	const writeHeartbeat = async () => {
		try {
			await redis.setex(
				CacheKeys.workerHeartbeat(name),
				CacheTTL.workerHeartbeat,
				JSON.stringify({ timestamp: new Date().toISOString() }),
			);
		} catch (err) {
			logger.warn('Failed to write worker heartbeat', {
				name,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	};

	void writeHeartbeat();
	const interval = setInterval(() => {
		void writeHeartbeat();
	}, intervalMs);

	return () => clearInterval(interval);
}
