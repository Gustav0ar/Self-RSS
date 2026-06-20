import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMetricsRoutes } from '../../src/routes/metrics.js';
import { getMetricsService, resetMetricsService } from '../../src/services/metrics.service.js';

function readMetricValue(metrics: string, name: string): number {
	const metricLine = metrics.split('\n').find((line) => line.startsWith(`${name} `));

	expect(metricLine).toBeDefined();
	return Number(metricLine?.split(/\s+/)[1]);
}

describe('Metrics routes', () => {
	// Create a shared app instance for all tests
	let app: Hono;

	beforeAll(() => {
		// Reset to ensure clean state
		resetMetricsService();
		// Initialize the singleton
		getMetricsService();

		// Create app with metrics routes
		app = new Hono();
		const routes = createMetricsRoutes();
		app.route('/api/v1', routes);
	});

	afterAll(() => {
		// Don't reset here as other tests might need the singleton
	});

	it('GET /api/v1/metrics returns prometheus metrics format', async () => {
		const res = await app.request('/api/v1/metrics');
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toContain('text/plain');

		const body = await res.text();
		// Prometheus format should contain HELP and TYPE comments
		expect(body).toContain('# HELP');
		expect(body).toContain('# TYPE');
	});

	it('GET /api/v1/metrics includes http_request_duration_seconds metric', async () => {
		const res = await app.request('/api/v1/metrics');
		const body = await res.text();

		expect(body).toContain('http_request_duration_seconds');
	});

	it('GET /api/v1/metrics includes http_requests_total metric', async () => {
		const res = await app.request('/api/v1/metrics');
		const body = await res.text();

		expect(body).toContain('http_requests_total');
	});

	it('GET /api/v1/metrics includes sse_connections_active metric', async () => {
		const res = await app.request('/api/v1/metrics');
		const body = await res.text();

		expect(body).toContain('sse_connections_active');
	});

	it('GET /api/v1/metrics includes feed_sync metrics', async () => {
		const res = await app.request('/api/v1/metrics');
		const body = await res.text();

		expect(body).toContain('feed_sync_running');
		expect(body).toContain('feed_sync_pending');
		expect(body).toContain('feed_sync_failed');
	});

	it('GET /api/v1/metrics includes cache metrics', async () => {
		const res = await app.request('/api/v1/metrics');
		const body = await res.text();

		expect(body).toContain('cache_hits_total');
		expect(body).toContain('cache_misses_total');
	});

	it('GET /api/v1/metrics includes redis_connected metric', async () => {
		const res = await app.request('/api/v1/metrics');
		const body = await res.text();

		expect(body).toContain('redis_connected');
	});

	it('returns prometheus content type', async () => {
		const res = await app.request('/api/v1/metrics');
		const contentType = res.headers.get('Content-Type');

		expect(contentType).toContain('text/plain');
		expect(contentType).toContain('version=');
	});

	it('does not mutate cache hit counters while scraping Redis-backed metrics', async () => {
		const redis = {
			ping: vi.fn().mockResolvedValue('PONG'),
			scan: vi.fn().mockResolvedValue(['0', ['articles:list:user-1']]),
		};
		const redisBackedApp = new Hono();
		redisBackedApp.route('/api/v1', createMetricsRoutes({ redis: redis as never }));

		getMetricsService().recordCacheHit('article_list');

		const firstRes = await redisBackedApp.request('/api/v1/metrics');
		const firstBody = await firstRes.text();
		const firstCacheHits = readMetricValue(firstBody, 'cache_hits_total');

		const secondRes = await redisBackedApp.request('/api/v1/metrics');
		const secondBody = await secondRes.text();

		expect(readMetricValue(secondBody, 'cache_hits_total')).toBe(firstCacheHits);
		expect(redis.ping).toHaveBeenCalledTimes(2);
		expect(redis.scan).not.toHaveBeenCalled();
	});
});
