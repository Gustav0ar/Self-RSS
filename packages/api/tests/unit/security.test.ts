import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { clearEnvCache } from '../../src/config/index.js';

const testDir = dirname(fileURLToPath(import.meta.url));

function buildApp() {
	clearEnvCache();
	return createApp();
}

describe('Security headers', () => {
	beforeEach(() => {
		process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173';
		process.env.TRUST_PROXY = 'false';
		clearEnvCache();
	});

	it('includes X-Content-Type-Options', async () => {
		const res = await buildApp().request('/health');
		expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
	});

	it('includes X-Frame-Options', async () => {
		const res = await buildApp().request('/health');
		expect(res.headers.get('X-Frame-Options')).toBe('DENY');
	});

	it('includes X-XSS-Protection disabled', async () => {
		const res = await buildApp().request('/health');
		expect(res.headers.get('X-XSS-Protection')).toBe('0');
	});

	it('includes Referrer-Policy', async () => {
		const res = await buildApp().request('/health');
		expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
	});

	it('includes Permissions-Policy', async () => {
		const res = await buildApp().request('/health');
		expect(res.headers.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
	});

	it('includes Content-Security-Policy', async () => {
		const res = await buildApp().request('/health');
		const csp = res.headers.get('Content-Security-Policy');
		expect(csp).toBeTruthy();
		expect(csp).toContain("default-src 'self'");
		expect(csp).toContain("script-src 'self'");
		expect(csp).toContain("media-src 'self' https:");
		expect(csp).toContain('frame-src https://www.youtube.com');
		expect(csp).toContain('https://player.vimeo.com');
		expect(csp).toContain('https://streamable.com');
	});

	it('keeps nginx CSP aligned for remote RSS media playback', () => {
		const nginx = readFileSync(resolve(testDir, '../../../..', 'nginx.conf'), 'utf8');
		const cspHeaders = nginx.match(/add_header Content-Security-Policy "[^"]+"/g) ?? [];

		expect(cspHeaders).toHaveLength(2);
		for (const header of cspHeaders) {
			expect(header).toContain("media-src 'self' https:");
			expect(header).toContain('frame-src https://www.youtube.com');
			expect(header).toContain('https://platform.twitter.com');
		}
	});

	it('includes X-Request-Id header', async () => {
		const res = await buildApp().request('/health');
		const requestId = res.headers.get('X-Request-Id');
		expect(requestId).toBeTruthy();
		expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	});
});

describe('Error handling', () => {
	beforeEach(() => {
		process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173';
		clearEnvCache();
	});

	it('returns 404 JSON for unknown routes', async () => {
		const res = await buildApp().request('/unknown/path');
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe('NOT_FOUND');
	});

	it('returns 404 for unknown API routes', async () => {
		const res = await buildApp().request('/api/v1/nonexistent');
		expect(res.status).toBe(404);
	});
});

describe('CORS headers', () => {
	it('reflects allowed origins on preflight', async () => {
		process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173';
		clearEnvCache();
		const res = await buildApp().request('/health', {
			method: 'OPTIONS',
			headers: {
				Origin: 'http://localhost:5173',
				'Access-Control-Request-Method': 'GET',
			},
		});
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
	});

	it('does not reflect disallowed origins on preflight', async () => {
		process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173';
		clearEnvCache();
		const res = await buildApp().request('/health', {
			method: 'OPTIONS',
			headers: {
				Origin: 'https://evil.example',
				'Access-Control-Request-Method': 'GET',
			},
		});
		expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});
});
