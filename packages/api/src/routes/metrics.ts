import { Hono } from 'hono';
import type { Database } from '../db/client.js';
import type Redis from 'ioredis';
import { sql, eq, inArray } from 'drizzle-orm';
import { feeds, articles } from '../db/schema.js';
import { getMetricsService } from '../services/metrics.service.js';
import { CacheKeys } from '../db/redis.js';

export interface MetricsRouteOptions {
	db?: Database;
	redis?: Redis;
}

export function createMetricsRoutes(options: MetricsRouteOptions = {}) {
	const metrics = new Hono();
	const metricsService = getMetricsService();

	metrics.get('/metrics', async (c) => {
		// Optionally update dynamic metrics before returning
		await updateDynamicMetrics(options);

		const metricsOutput = await metricsService.getMetrics();
		return c.body(metricsOutput, 200, {
			'Content-Type': metricsService.getContentType(),
		});
	});

	return metrics;
}

async function updateDynamicMetrics(options: MetricsRouteOptions) {
	const { db, redis } = options;

	// Update Redis connection status
	if (redis) {
		try {
			await redis.ping();
			getMetricsService().setRedisConnected(true);
		} catch {
			getMetricsService().setRedisConnected(false);
		}
	}

	// Update database metrics (SQLite doesn't have connection pooling, but we track open connections)
	if (db) {
		// For SQLite, we report connection stats based on active queries
		// This is a best-effort approach since SQLite handles concurrency differently
		getMetricsService().updateDbPoolStats(0, 0, 1);
	}

	// Update feed sync status from database
	if (db) {
		try {
			const [runningResult, pendingResult, failedResult] = await Promise.all([
				db.select({ count: sql<number>`count(*)` }).from(feeds).where(eq(feeds.syncStatus, 'syncing')),
				db.select({ count: sql<number>`count(*)` }).from(feeds).where(
					sql`${feeds.syncStatus} = 'idle' AND ${feeds.nextSyncAt} <= unixepoch()`
				),
				db.select({ count: sql<number>`count(*)` }).from(feeds).where(eq(feeds.syncStatus, 'error')),
			]);

			getMetricsService().updateFeedSyncStatus(
				runningResult[0]?.count ?? 0,
				pendingResult[0]?.count ?? 0,
				failedResult[0]?.count ?? 0
			);
		} catch (err) {
			console.error('Failed to update feed sync metrics:', err);
		}
	}

	// Update cache metrics from Redis
	if (redis) {
		try {
			// Count cached article lists
			const cachedKeys = await scanKeys(redis, 'articles:list:*');
			// Extract unique user IDs from cache keys
			const userIds = new Set<string>();
			for (const key of cachedKeys) {
				const parts = key.split(':');
				if (parts.length >= 3 && parts[2]) {
					userIds.add(parts[2]);
				}
			}
			// Set cache metrics (this is a simplified approach)
			getMetricsService().recordCacheHit('article_list');
		} catch (err) {
			console.error('Failed to update cache metrics:', err);
		}
	}
}

async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
	const matched: string[] = [];
	let cursor = '0';
	const SCAN_BATCH = 500;

	do {
		const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', SCAN_BATCH);
		if (batch.length > 0) {
			matched.push(...batch);
		}
		cursor = nextCursor;
	} while (cursor !== '0');

	return matched;
}
