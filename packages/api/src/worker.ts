import { createDeps } from './config/deps.js';
import { getEnv } from './config/index.js';
import { closeDb, getDb } from './db/client.js';
import { closeRedis, getRedis } from './db/redis.js';
import {
	startCacheWarmer,
	startQueuedSyncWorker,
	startRetentionCleanup,
	startSyncScheduler,
	startWorkerHeartbeat,
} from './jobs/scheduler.js';
import { createLogger } from './utils/logger.js';
import { createTokenUtils } from './utils/tokens.js';

const logger = createLogger();

// Configuration for graceful shutdown
const DRAIN_TIMEOUT_MS = 30_000; // 30 seconds - time to wait for in-flight syncs to complete
const POLL_INTERVAL_MS = 100; // Check every 100ms for sync completion

try {
	const env = getEnv();
	const db = getDb(env.DATABASE_URL);
	const redis = getRedis(env.REDIS_URL);
	await redis.connect();

	const tokenUtils = createTokenUtils(
		env.JWT_SECRET,
		env.JWT_REFRESH_SECRET,
		env.JWT_ACCESS_EXPIRES_IN,
		env.JWT_REFRESH_EXPIRES_IN,
	);

	const deps = createDeps(db, redis, tokenUtils, {
		timeoutMs: env.FEED_SYNC_TIMEOUT_MS,
		maxContentLength: env.FEED_MAX_CONTENT_LENGTH,
		concurrency: env.FEED_SYNC_CONCURRENCY,
		allowPrivateHosts: env.FEED_ALLOW_PRIVATE_HOSTS,
	});

	// Shared coordinator tracks sync status for shutdown coordination
	const syncCoordinator = { isRunning: false };
	const stopSyncScheduler = startSyncScheduler(deps.services.feedSync, undefined, syncCoordinator);
	const stopQueuedSyncWorker = startQueuedSyncWorker(
		deps.services.feedSync,
		undefined,
		syncCoordinator,
	);
	const stopRetentionCleanup = startRetentionCleanup(deps.repos.article, {
		retentionDays: env.RETENTION_DELETION_DAYS,
		enabled: env.RETENTION_DELETION_ENABLED,
		dryRun: env.RETENTION_DRY_RUN,
	});
	const stopCacheWarmer = startCacheWarmer(deps.services.articleCache, deps.repos.user, {
		intervalMs: env.CACHE_WARMER_INTERVAL_MS,
		recentWindowMinutes: env.CACHE_WARMER_RECENT_WINDOW_MINUTES,
		recentUsersLimit: env.CACHE_WARMER_RECENT_USERS_LIMIT,
		concurrency: env.CACHE_WARMER_CONCURRENCY,
		includeIdleUsers: env.CACHE_WARMER_IDLE_USERS_ENABLED,
		idleUsersLimit: env.CACHE_WARMER_IDLE_USERS_LIMIT,
	});
	const stopWorkerHeartbeat = startWorkerHeartbeat(redis);

	/**
	 * Wait for in-flight syncs to complete with timeout.
	 * Uses the syncCoordinator.isRunning flag which is set by the scheduler.
	 *
	 * @returns true if all syncs completed, false if timeout exceeded
	 */
	async function waitForInFlightSyncs(): Promise<boolean> {
		const startTime = Date.now();

		while (syncCoordinator.isRunning) {
			const elapsed = Date.now() - startTime;
			if (elapsed >= DRAIN_TIMEOUT_MS) {
				logger.warn('Timeout waiting for in-flight syncs to complete', {
					elapsedMs: elapsed,
				});
				return false;
			}
			logger.debug('Waiting for in-flight sync to complete', { elapsedMs: elapsed });
			await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
		}

		return true;
	}

	/**
	 * Graceful shutdown sequence for the worker:
	 * 1. Signal all schedulers to stop (prevents new work)
	 * 2. Wait for in-flight syncs to complete (with timeout)
	 * 3. Close external resources (Redis, DB)
	 * 4. Exit process
	 *
	 * This ensures that in-progress feed syncs complete before shutdown,
	 * preventing data inconsistencies and ensuring clients receive updates.
	 */
	async function gracefulShutdown(signal: string) {
		logger.info('Initiating graceful worker shutdown', { signal, syncInProgress: syncCoordinator.isRunning });

		// Step 1: Stop all schedulers to prevent new work
		logger.info('Stopping schedulers');
		stopSyncScheduler();
		stopQueuedSyncWorker();
		stopRetentionCleanup();
		stopCacheWarmer();
		stopWorkerHeartbeat();

		// Step 2: Wait for any in-flight syncs to complete
		logger.info('Waiting for in-flight syncs to complete');
		const synced = await waitForInFlightSyncs();

		if (!synced) {
			logger.warn('Shutdown continuing despite incomplete syncs');
		} else {
			logger.info('All in-flight syncs completed');
		}

		// Step 3: Close external resources
		logger.info('Closing external resources');
		await Promise.allSettled([closeRedis(), closeDb()]);

		logger.info('Graceful worker shutdown complete');
		process.exit(0);
	}

	// Handle shutdown signals
	// SIGINT: Ctrl+C in terminal
	// SIGTERM: kill signal (docker stop, kubernetes, systemd, etc.)
	process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
	process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));

	logger.info('API worker started', { env: env.NODE_ENV });
} catch (err) {
	logger.error('Failed to start worker', {
		message: err instanceof Error ? err.message : String(err),
	});
	process.exit(1);
}
