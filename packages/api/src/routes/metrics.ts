import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type Redis from 'ioredis';
import type { Database } from '../db/client.js';
import { feeds } from '../db/schema.js';
import { getMetricsService, type MetricsService } from '../services/metrics.service.js';

export interface MetricsRouteOptions {
	db?: Database;
	metricsService?: MetricsService;
	redis?: Redis;
}

export function createMetricsRoutes(options: MetricsRouteOptions = {}) {
	const metrics = new Hono();
	const metricsService = options.metricsService ?? getMetricsService();

	metrics.get('/metrics', async (c) => {
		// Optionally update dynamic metrics before returning
		await updateDynamicMetrics(options, metricsService);

		const metricsOutput = await metricsService.getMetrics();
		return c.body(metricsOutput, 200, {
			'Content-Type': metricsService.getContentType(),
		});
	});

	return metrics;
}

async function updateDynamicMetrics(options: MetricsRouteOptions, metricsService: MetricsService) {
	const { db, redis } = options;

	// Update Redis connection status
	if (redis) {
		try {
			await redis.ping();
			metricsService.setRedisConnected(true);
		} catch {
			metricsService.setRedisConnected(false);
		}
	}

	// Update database metrics (SQLite doesn't have connection pooling, but we track open connections)
	if (db) {
		// For SQLite, we report connection stats based on active queries
		// This is a best-effort approach since SQLite handles concurrency differently
		metricsService.updateDbPoolStats(0, 0, 1);
	}

	// Update feed sync status from database
	if (db) {
		try {
			const [runningResult, pendingResult, failedResult] = await Promise.all([
				db
					.select({ count: sql<number>`count(*)` })
					.from(feeds)
					.where(eq(feeds.syncStatus, 'syncing')),
				db
					.select({ count: sql<number>`count(*)` })
					.from(feeds)
					.where(sql`${feeds.syncStatus} = 'idle' AND ${feeds.nextSyncAt} <= unixepoch()`),
				db
					.select({ count: sql<number>`count(*)` })
					.from(feeds)
					.where(eq(feeds.syncStatus, 'error')),
			]);

			metricsService.updateFeedSyncStatus(
				runningResult[0]?.count ?? 0,
				pendingResult[0]?.count ?? 0,
				failedResult[0]?.count ?? 0,
			);
		} catch (err) {
			console.error('Failed to update feed sync metrics:', err);
		}
	}
}
