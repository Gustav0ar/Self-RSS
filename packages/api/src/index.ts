import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createDeps } from './config/deps.js';
import { getEnv } from './config/index.js';
import { closeDb, getDb } from './db/client.js';
import { applyMigrations } from './db/migrations.js';
import { closeRedis, getRedis } from './db/redis.js';
import { sseRegistry } from './utils/sse-registry.js';
import { createLogger } from './utils/logger.js';
import { createTokenUtils } from './utils/tokens.js';

const logger = createLogger();
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');

// Configuration for graceful shutdown
const DRAIN_TIMEOUT_MS = 30_000; // 30 seconds - time to wait for SSE connections to drain
const FORCE_CLOSE_TIMEOUT_MS = 5_000; // 5 seconds - final force close after drain timeout

try {
	const env = getEnv();
	const db = getDb(env.DATABASE_URL);
	applyMigrations(db, { migrationsFolder });
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
	const app = createApp(deps, tokenUtils, {
		requireWorkerHeartbeat: env.REQUIRE_WORKER_HEARTBEAT,
	});

	const server = Bun.serve({
		fetch: app.fetch,
		port: env.API_PORT,
		hostname: env.API_HOST,
		idleTimeout: env.API_IDLE_TIMEOUT_SECONDS,
	});

	/**
	 * Graceful shutdown sequence:
	 * 1. Stop accepting new connections (server.stop immediately)
	 * 2. Wait for existing SSE connections to drain (with timeout)
	 * 3. Close external resources (Redis, DB)
	 * 4. Force close any remaining connections if timeout exceeded
	 * 5. Exit process
	 */
	async function gracefulShutdown(signal: string) {
		logger.info('Initiating graceful shutdown', { signal, activeSseConnections: sseRegistry.count });

		// Step 1: Stop accepting new connections immediately
		// This prevents new SSE connections while we're draining
		server.stop(true); // true = stop gracefully (wait for current requests)

		// Step 2: Mark SSE registry as shutting down to prevent new long operations
		sseRegistry.setShuttingDown();

		// Step 3: Drain existing SSE connections with timeout
		logger.info('Waiting for SSE connections to drain', { timeoutMs: DRAIN_TIMEOUT_MS });
		const remaining = await sseRegistry.drain(DRAIN_TIMEOUT_MS);

		if (remaining > 0) {
			logger.warn('SSE drain timeout exceeded, force closing connections', {
				remainingConnections: remaining,
			});
			// Give a brief moment for connections to clean up
			await new Promise((resolve) => setTimeout(resolve, FORCE_CLOSE_TIMEOUT_MS));
			sseRegistry.forceClose();
		}

		// Step 4: Close external resources
		logger.info('Closing external resources');
		await Promise.allSettled([closeRedis(), closeDb()]);

		logger.info('Graceful shutdown complete');
		process.exit(0);
	}

	// Handle shutdown signals
	// SIGINT: Ctrl+C in terminal
	// SIGTERM:kill signal (docker stop, kubernetes, systemd, etc.)
	process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
	process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));

	logger.info(`API server started on ${env.API_HOST}:${env.API_PORT}`, {
		env: env.NODE_ENV,
	});
} catch (err) {
	logger.error('Failed to start server', {
		message: err instanceof Error ? err.message : String(err),
	});
	process.exit(1);
}
