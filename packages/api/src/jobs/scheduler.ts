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

/**
 * Periodically warms the article cache for all active users.
 * Prioritizes recently active users for faster perceived performance.
 * Runs every minute to ensure fresh cached data is available on user refresh.
 */
export function startCacheWarmer(
	articleCache: ArticleCacheService,
	userRepo: { findActiveUserIds(): Promise<string[]> },
	intervalMs: number = 60 * 1000, // 1 minute
) {
	logger.info('Article cache warmer started', { intervalMs });
	let isRunning = false;

	const warmOnce = async () => {
		if (isRunning) return;
		isRunning = true;
		try {
			// Get recently active users first (priority)
			const recentUserIds = await articleCache.getRecentlyActiveUserIds(10);
			const allUserIds = await userRepo.findActiveUserIds();

			// Use Set for O(1) lookup instead of O(N) includes()
			const recentSet = new Set(recentUserIds);
			const priorityUsers = recentUserIds;
			const idleUsers = allUserIds.filter((id) => !recentSet.has(id));

			// Warm priority users first (they're more likely to refresh soon)
			const warmUsers = async (users: string[], label: string) => {
				if (users.length === 0) return;
				const concurrency = 5;
				for (let i = 0; i < users.length; i += concurrency) {
					const batch = users.slice(i, i + concurrency);
					await Promise.allSettled(batch.map((userId) => articleCache.populateCache(userId)));
				}
				logger.debug(`Cache warming ${label}`, { userCount: users.length });
			};

			// Warm recently active users first
			await warmUsers(priorityUsers, 'priority');

			// Then warm idle users (lower priority)
			await warmUsers(idleUsers, 'idle');
		} catch (err) {
			logger.error('Cache warmer error', {
				error: err instanceof Error ? err.message : String(err),
			});
		} finally {
			isRunning = false;
		}
	};

	// Run immediately on startup, then on interval
	void warmOnce();
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
