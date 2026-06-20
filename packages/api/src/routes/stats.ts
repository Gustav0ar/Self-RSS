import { Hono } from 'hono';
import type { StatsService } from '../services/stats.service.js';
import { enforceRateLimit, RATE_LIMITS, type RateLimiter } from '../utils/index.js';

export function createStatsRoutes(statsService: StatsService, rateLimiter: RateLimiter) {
	const routes = new Hono();

	routes.get('/', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'stats-read', RATE_LIMITS.statsRead);
		const userId = c.get('userId');
		const stats = await statsService.getStats(userId);
		return c.json({ data: stats });
	});

	return routes;
}
