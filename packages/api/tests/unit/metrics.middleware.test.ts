import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { httpMetricsMiddleware } from '../../src/middleware/metrics.js';
import { resetMetricsService, getMetricsService } from '../../src/services/metrics.service.js';

describe('HTTP Metrics Middleware', () => {
	let app: Hono;

	beforeAll(() => {
		resetMetricsService();
		getMetricsService(); // Initialize singleton

		// Create test app with metrics middleware
		app = new Hono();
		app.use(httpMetricsMiddleware());

		// Add test routes
		app.get('/api/v1/articles', (c) => c.json({ articles: [] }));
		app.get('/api/v1/feeds/:id', (c) => c.json({ id: c.req.param('id') }));
		app.post('/api/v1/feeds', (c) => c.json({ created: true }, 201));
		app.get('/health', (c) => c.json({ status: 'ok' }));
		app.get('/nonexistent', (c) => c.json({ error: 'not found' }, 404));
	});

	afterAll(() => {
		// Keep singleton for other tests
	});

	it('records metrics for GET requests', async () => {
		const res = await app.request('/api/v1/articles');

		expect(res.status).toBe(200);

		const metrics = await getMetricsService().getMetrics();
		expect(metrics).toContain('http_requests_total');
		expect(metrics).toContain('http_request_duration_seconds');
	});

	it('records metrics for POST requests', async () => {
		const res = await app.request('/api/v1/feeds', {
			method: 'POST',
		});

		expect(res.status).toBe(201);

		const metrics = await getMetricsService().getMetrics();
		expect(metrics).toContain('http_requests_total');
	});

	it('normalizes route patterns for routes with params', async () => {
		// Request a route with a path parameter
		await app.request('/api/v1/feeds/abc-123');

		const metrics = await getMetricsService().getMetrics();
		// Should normalize to /api/v1/feeds instead of /api/v1/feeds/:id
		expect(metrics).toContain('/api/v1/feeds');
	});

	it('records metrics for health endpoint', async () => {
		await app.request('/health');

		const metrics = await getMetricsService().getMetrics();
		expect(metrics).toContain('/health');
	});

	it('records metrics for 404 responses', async () => {
		const res = await app.request('/nonexistent');

		expect(res.status).toBe(404);

		const metrics = await getMetricsService().getMetrics();
		expect(metrics).toContain('404');
	});

	it('includes method and status code in metrics', async () => {
		const metrics = await getMetricsService().getMetrics();

		// Check for method labels
		expect(metrics).toContain('method="GET"');
		expect(metrics).toContain('method="POST"');

		// Check for status code labels
		expect(metrics).toContain('status_code="200"');
		expect(metrics).toContain('status_code="201"');
		expect(metrics).toContain('status_code="404"');
	});
});
