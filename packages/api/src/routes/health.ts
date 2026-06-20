import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type Redis from 'ioredis';
import type { Database } from '../db/client.js';
import { CacheKeys, CacheTTL } from '../db/redis.js';

interface HealthRouteOptions {
	requireWorkerHeartbeat?: boolean;
}

export function createHealthRoutes(db?: Database, redis?: Redis, options: HealthRouteOptions = {}) {
	const health = new Hono();

	health.get('/health', (c) => {
		return c.json({ status: 'ok', timestamp: new Date().toISOString() });
	});

	health.get('/ready', async (c) => {
		const timestamp = new Date().toISOString();
		if (!db || !redis) {
			return c.json({
				status: 'ok',
				timestamp,
				checks: { database: 'skipped', redis: 'skipped' },
			});
		}

		type HealthResult = {
			database: 'ok' | 'timeout' | 'error';
			redis: 'ok' | 'timeout' | 'error';
			worker: { status: string; timestamp?: string | null; ageMs?: number };
		};

		const timeoutPromise = new Promise<'timeout'>((resolve) =>
			setTimeout(() => resolve('timeout'), 5000),
		);

		const dbCheck = Promise.race([
			Promise.resolve(db.all(sql`select 1`))
				.then(() => 'ok' as const)
				.catch(() => 'error' as const),
			timeoutPromise,
		]);
		const redisCheck = Promise.race([
			redis
				.ping()
				.then(() => 'ok' as const)
				.catch(() => 'error' as const),
			timeoutPromise,
		]);

		const [dbResult, redisResult] = await Promise.all([dbCheck, redisCheck]);
		const results = { database: dbResult, redis: redisResult };
		const workerHeartbeat = await readWorkerHeartbeat(redis);

		const dbOk = results.database === 'ok';
		const redisOk = results.redis === 'ok';
		const workerReady = workerHeartbeat.status === 'ok';

		let status: 'ok' | 'degraded' | 'error' = 'ok';
		if (options.requireWorkerHeartbeat && !workerReady) {
			status = 'error';
		} else if (!dbOk || !redisOk) {
			status = 'error';
		}

		const checks: HealthResult = {
			database: results.database,
			redis: results.redis,
			worker: workerHeartbeat,
		};

		return c.json(
			{
				status,
				timestamp,
				checks,
				...(status !== 'ok' && { worker: workerHeartbeat }),
			},
			status === 'ok' ? 200 : 503,
		);
	});

	return health;
}

async function readWorkerHeartbeat(redis: Redis) {
	const rawHeartbeat = await redis.get(CacheKeys.workerHeartbeat('feed-worker'));
	if (!rawHeartbeat) {
		return { status: 'missing' as const };
	}

	try {
		const parsed = JSON.parse(rawHeartbeat) as { timestamp?: unknown };
		const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : null;
		const ageMs = timestamp ? Date.now() - new Date(timestamp).getTime() : Number.POSITIVE_INFINITY;
		const maxAgeMs = CacheTTL.workerHeartbeat * 1000;
		if (!timestamp || !Number.isFinite(ageMs) || ageMs > maxAgeMs) {
			return { status: 'stale' as const, timestamp, ageMs };
		}
		return { status: 'ok' as const, timestamp, ageMs };
	} catch {
		return { status: 'stale' as const };
	}
}
