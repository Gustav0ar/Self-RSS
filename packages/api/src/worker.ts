import { createDeps } from './config/deps.js';
import { getEnv } from './config/index.js';
import { closeDb, getDb } from './db/client.js';
import { closeRedis, getRedis } from './db/redis.js';
import {
	startCacheWarmer,
	startQueuedSyncWorker,
	startRetentionCleanup,
	startSyncScheduler,
} from './jobs/scheduler.js';
import { createLogger } from './utils/logger.js';
import { createTokenUtils } from './utils/tokens.js';

const logger = createLogger();

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
	const syncCoordinator = { isRunning: false };
	const stopSyncScheduler = startSyncScheduler(deps.services.feedSync, undefined, syncCoordinator);
	const stopQueuedSyncWorker = startQueuedSyncWorker(
		deps.services.feedSync,
		undefined,
		syncCoordinator,
	);
	const stopRetentionCleanup = startRetentionCleanup(deps.repos.article);
	const stopCacheWarmer = startCacheWarmer(
		deps.services.articleCache,
		deps.repos.user,
		60 * 1000, // 1 minute interval
	);

	let shuttingDown = false;
	const shutdown = async (signal: string) => {
		if (shuttingDown) return;
		shuttingDown = true;
		logger.info('Shutting down API worker', { signal });
		stopSyncScheduler();
		stopQueuedSyncWorker();
		stopRetentionCleanup();
		stopCacheWarmer();
		await Promise.allSettled([closeRedis(), closeDb()]);
		process.exit(0);
	};

	process.on('SIGINT', () => void shutdown('SIGINT'));
	process.on('SIGTERM', () => void shutdown('SIGTERM'));

	logger.info('API worker started', { env: env.NODE_ENV });
} catch (err) {
	logger.error('Failed to start worker', {
		message: err instanceof Error ? err.message : String(err),
	});
	process.exit(1);
}
