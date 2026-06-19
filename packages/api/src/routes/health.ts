import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type Redis from 'ioredis';
import type { Database } from '../db/client.js';
import { CacheKeys, CacheTTL } from '../db/redis.js';

export function createHealthRoutes(db?: Database, redis?: Redis) {
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

		try {
			await Promise.all([db.run(sql`select 1`), redis.ping()]);
			const workerHeartbeat = await readWorkerHeartbeat(redis);
			return c.json({
				status: 'ok',
				timestamp,
				checks: { database: 'ok', redis: 'ok', worker: workerHeartbeat.status },
				worker: workerHeartbeat,
			});
		} catch (error) {
			return c.json(
				{
					status: 'error',
					timestamp,
					error: error instanceof Error ? error.message : String(error),
				},
				503,
			);
		}
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
