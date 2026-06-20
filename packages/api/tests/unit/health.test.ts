import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { createHealthRoutes } from '../../src/routes/health.js';

describe('Health routes', () => {
	const app = createApp();

	it('GET /health returns ok', async () => {
		const res = await app.request('/health');
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('ok');
		expect(body.timestamp).toBeDefined();
	});

	it('GET /ready returns ok', async () => {
		const res = await app.request('/ready');
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('ok');
	});

	it('GET /ready returns unavailable when strict worker heartbeat is required and missing', async () => {
		const health = createHealthRoutes(
			{ run: async () => undefined, all: async () => null } as never,
			{
				ping: async () => 'PONG',
				get: async () => null,
			} as never,
			{ requireWorkerHeartbeat: true },
		);

		const res = await health.request('/ready');
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.status).toBe('error');
		expect(body.checks.worker.status).toBe('missing');
	});

	it('GET /ready keeps non-strict worker heartbeat as an informational check', async () => {
		const health = createHealthRoutes(
			{ run: async () => undefined, all: async () => null } as never,
			{
				ping: async () => 'PONG',
				get: async () => null,
			} as never,
			{ requireWorkerHeartbeat: false },
		);

		const res = await health.request('/ready');
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('ok');
		expect(body.checks.worker.status).toBe('missing');
	});

	it('returns 404 for unknown routes', async () => {
		const res = await app.request('/nonexistent');
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe('NOT_FOUND');
	});

	it('includes security headers', async () => {
		const res = await app.request('/health');
		expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(res.headers.get('X-Frame-Options')).toBe('DENY');
		expect(res.headers.get('X-Request-Id')).toBeTruthy();
	});

	it('returns degraded status when database check times out', async () => {
		const slowDb = {
			run: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 10_000))),
			all: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 10_000))),
		};
		const health = createHealthRoutes(
			slowDb as never,
			{ ping: async () => 'PONG', get: async () => null } as never,
		);

		const start = Date.now();
		const res = await health.request('/ready');
		const elapsed = Date.now() - start;

		expect(elapsed).toBeLessThan(7000);
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.status).toBe('error');
		expect(body.checks.database).toBe('timeout');
		expect(body.checks.redis).toBe('ok');
	}, 10000);

	it('returns degraded status when redis check times out', async () => {
		const slowRedis = {
			ping: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 10_000))),
			get: async () => null,
		};
		const health = createHealthRoutes(
			{ run: async () => undefined, all: async () => null } as never,
			slowRedis as never,
		);

		const start = Date.now();
		const res = await health.request('/ready');
		const elapsed = Date.now() - start;

		expect(elapsed).toBeLessThan(7000);
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.status).toBe('error');
		expect(body.checks.database).toBe('ok');
		expect(body.checks.redis).toBe('timeout');
	}, 10000);

	it('returns error status when both database and redis timeout', async () => {
		const slowDb = {
			run: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 10_000))),
			all: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 10_000))),
		};
		const slowRedis = {
			ping: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 10_000))),
			get: async () => null,
		};
		const health = createHealthRoutes(slowDb as never, slowRedis as never);

		const start = Date.now();
		const res = await health.request('/ready');
		const elapsed = Date.now() - start;

		expect(elapsed).toBeLessThan(7000);
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.status).toBe('error');
		expect(body.checks.database).toBe('timeout');
		expect(body.checks.redis).toBe('timeout');
	}, 10000);
});
