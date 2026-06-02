import { Hono } from 'hono';
import type { StatsService } from '../services/stats.service.js';

export function createStatsRoutes(statsService: StatsService) {
	const routes = new Hono();

	routes.get('/', async (c) => {
		const userId = c.get('userId');
		const stats = await statsService.getStats(userId);
		return c.json({ data: stats });
	});

	return routes;
}
