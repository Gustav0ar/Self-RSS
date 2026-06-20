import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMetricsRoutes } from '../../src/routes/metrics.js';
import { getMetricsService, resetMetricsService } from '../../src/services/metrics.service.js';

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
});
