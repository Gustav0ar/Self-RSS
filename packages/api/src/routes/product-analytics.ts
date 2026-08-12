import { recordProductAnalyticsEventsSchema } from '@self-feed/shared';
import { Hono } from 'hono';
import type { ProductAnalyticsService } from '../services/product-analytics.service.js';
import { enforceRateLimit, RATE_LIMITS, type RateLimiter } from '../utils/index.js';
import { parseBody } from '../utils/validation.js';

export function createProductAnalyticsRoutes(
	analyticsService: ProductAnalyticsService,
	rateLimiter: RateLimiter,
) {
	const routes = new Hono();

	routes.post('/events', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'analytics-events', RATE_LIMITS.analyticsEvents);
		const body = await parseBody(c, recordProductAnalyticsEventsSchema);
		return c.json({
			data: await analyticsService.recordClientEvents(c.get('userId'), body.events),
		});
	});

	return routes;
}

export function createProductAnalyticsReportRoutes(
	analyticsService: ProductAnalyticsService,
	rateLimiter: RateLimiter,
) {
	const routes = new Hono();

	routes.get('/', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'admin', RATE_LIMITS.admin);
		return c.json({ data: await analyticsService.getReport() });
	});

	return routes;
}
