import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { createApp } from './app.js';
import { createDeps } from './config/deps.js';
import { getEnv } from './config/index.js';
import { closeDb, getDb } from './db/client.js';
import { closeRedis, getRedis } from './db/redis.js';
import { createLogger } from './utils/logger.js';
import { createTokenUtils } from './utils/tokens.js';

const logger = createLogger();
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');

try {
	const env = getEnv();
	const db = getDb(env.DATABASE_URL);
	await migrate(db, { migrationsFolder });
	logger.info('Database migrations applied', { migrationsFolder });
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
	const app = createApp(deps, tokenUtils);

	const server = Bun.serve({
		fetch: app.fetch,
		port: env.API_PORT,
		hostname: env.API_HOST,
		idleTimeout: env.API_IDLE_TIMEOUT_SECONDS,
	});

	let shuttingDown = false;
	const shutdown = async (signal: string) => {
		if (shuttingDown) return;
		shuttingDown = true;
		logger.info('Shutting down API server', { signal });
		server.stop();
		await Promise.allSettled([closeRedis(), closeDb()]);
		process.exit(0);
	};

	process.on('SIGINT', () => void shutdown('SIGINT'));
	process.on('SIGTERM', () => void shutdown('SIGTERM'));

	logger.info(`API server started on ${env.API_HOST}:${env.API_PORT}`, {
		env: env.NODE_ENV,
	});
} catch (err) {
	logger.error('Failed to start server', {
		message: err instanceof Error ? err.message : String(err),
	});
	process.exit(1);
}
