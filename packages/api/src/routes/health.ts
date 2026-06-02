import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type Redis from 'ioredis';
import type { Database } from '../db/client.js';

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
			return c.json({
				status: 'ok',
				timestamp,
				checks: { database: 'ok', redis: 'ok' },
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
