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
			const error = err instanceof Error ? err : new Error(String(err));
			logger.error('Sync scheduler error', {
				operation: 'syncScheduler',
				timestamp: new Date().toISOString(),
				error: error.message,
				stack: error.stack,
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
			const error = err instanceof Error ? err : new Error(String(err));
			logger.error('Queued feed sync worker error', {
				operation: 'queuedSyncWorker',
				timestamp: new Date().toISOString(),
				error: error.message,
				stack: error.stack,
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

export interface RetentionCleanupOptions {
	retentionDays: number;
	enabled: boolean;
	dryRun: boolean;
	intervalMs?: number;
}

/**
 * Start the retention cleanup scheduler.
 *
 * SAFETY: Deletion is DISABLED by default. To enable it, you MUST set
 * RETENTION_DELETION_ENABLED=true in your environment. This prevents accidental
 * data loss during deployment or configuration errors.
 *
 * @param articleRepo - The article repository instance
 * @param options - Configuration options (defaults from env if not provided)
 * @returns Cleanup function to stop the scheduler
 */
export function startRetentionCleanup(
	articleRepo: ArticleRepository,
	optionsOrIntervalMs?: RetentionCleanupOptions | number,
) {
	// Parse options (supports both object and legacy number for backward compatibility)
	const options: RetentionCleanupOptions =
		typeof optionsOrIntervalMs === 'number'
			? {
					retentionDays: optionsOrIntervalMs,
					enabled: true, // Legacy behavior assumed intentional when called with number
					dryRun: false,
					intervalMs: 24 * 60 * 60 * 1000,
				}
			: {
					retentionDays: optionsOrIntervalMs?.retentionDays ?? 90,
					enabled: optionsOrIntervalMs?.enabled ?? false,
					dryRun: optionsOrIntervalMs?.dryRun ?? false,
					intervalMs: optionsOrIntervalMs?.intervalMs ?? 24 * 60 * 60 * 1000,
				};

	const mode = options.enabled
		? options.dryRun
			? 'DRY-RUN (no deletions will occur)'
			: 'ENABLED (deletions will occur)'
		: 'DISABLED (no deletions will occur)';

	logger.info('Retention cleanup scheduled', {
		retentionDays: options.retentionDays,
		mode,
		intervalMs: options.intervalMs,
	});

	// If deletion is disabled, log a warning to make the safe default obvious
	if (!options.enabled) {
		logger.warn(
			'RETENTION CLEANUP IS DISABLED - No articles will be deleted. ' +
				'To enable, set RETENTION_DELETION_ENABLED=true',
		);
	} else if (options.dryRun) {
		logger.info('Retention cleanup running in DRY-RUN mode - no articles will be deleted');
	}

	let isRunning = false;

	const interval = setInterval(async () => {
		if (isRunning) {
			logger.warn('Skipping retention cleanup because the previous run is still active');
			return;
		}

		// Safety check: don't run if deletion is not enabled
		if (!options.enabled) {
			return;
		}

		isRunning = true;
		try {
			const deleted = await articleRepo.deleteOlderThan(options.retentionDays, options.dryRun);
			if (deleted > 0) {
				const action = options.dryRun ? 'DRY-RUN complete' : 'Retention cleanup';
				logger.info(action, { wouldDelete: deleted, retentionDays: options.retentionDays });
			} else {
				logger.debug('Retention cleanup: no articles to delete', {
					retentionDays: options.retentionDays,
					mode: options.dryRun ? 'DRY-RUN' : 'LIVE',
				});
			}
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			logger.error('Retention cleanup error', {
				operation: 'retentionCleanup',
				timestamp: new Date().toISOString(),
				retentionDays: options.retentionDays,
				dryRun: options.dryRun,
				error: error.message,
				stack: error.stack,
			});
		} finally {
			isRunning = false;
		}
	}, options.intervalMs);

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
			const error = err instanceof Error ? err : new Error(String(err));
			logger.error('Cache warmer error', {
				operation: 'cacheWarmer',
				timestamp: new Date().toISOString(),
				recentWindowMinutes,
				recentUsersLimit,
				includeIdleUsers,
				error: error.message,
				stack: error.stack,
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
