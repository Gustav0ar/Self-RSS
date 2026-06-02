import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';

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
});
