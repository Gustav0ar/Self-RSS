import type { Context, Next } from 'hono';
import { getMetricsService } from '../services/metrics.service.js';

const knownPaths = [
	'/health',
	'/ready',
	'/api/v1/auth',
	'/api/v1/categories',
	'/api/v1/feeds',
	'/api/v1/articles',
	'/api/v1/search',
	'/api/v1/preferences',
	'/api/v1/stats',
	'/api/v1/events',
	'/api/v1/admin',
	'/api/v1/metrics',
];

/**
 * Normalize path to a known route pattern for metrics labeling.
 * This prevents high-cardinality labels from unique IDs in paths.
 */
function normalizePath(path: string): string {
	// Direct match
	if (knownPaths.includes(path)) {
		return path;
	}

	// Pattern matches
	if (path.startsWith('/api/v1/auth')) return '/api/v1/auth';
	if (path.startsWith('/api/v1/categories')) return '/api/v1/categories';
	if (path.startsWith('/api/v1/feeds')) return '/api/v1/feeds';
	if (path.startsWith('/api/v1/articles')) return '/api/v1/articles';
	if (path.startsWith('/api/v1/search')) return '/api/v1/search';
	if (path.startsWith('/api/v1/preferences')) return '/api/v1/preferences';
	if (path.startsWith('/api/v1/stats')) return '/api/v1/stats';
	if (path.startsWith('/api/v1/events')) return '/api/v1/events';
	if (path.startsWith('/api/v1/admin')) return '/api/v1/admin';
	if (path.startsWith('/api/v1/metrics')) return '/api/v1/metrics';

	// Health endpoints
	if (path === '/health') return '/health';
	if (path === '/ready') return '/ready';

	// Unknown paths - return a hashed version to prevent explosion
	return '/unknown';
}

/**
 * Middleware that records HTTP request metrics (duration and count).
 * Should be applied early in the middleware chain.
 */
export function httpMetricsMiddleware() {
	return async function httpMetrics(c: Context, next: Next) {
		const metrics = getMetricsService();
		const start = process.hrtime.bigint();

		await next();

		const end = process.hrtime.bigint();
		const durationSeconds = Number(end - start) / 1e9;

		const method = c.req.method;
		const path = normalizePath(c.req.path);
		const statusCode = c.res.status;

		metrics.recordHttpRequest(method, path, statusCode, durationSeconds);
	};
}
