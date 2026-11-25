import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVICE_WORKER_URL } from '../../src/lib/service-worker';
import { createServiceWorkerSource } from '../../vite.config';

describe('production service worker source', () => {
	it('versions the registration URL when its response policy changes', () => {
		expect(SERVICE_WORKER_URL).toBe('/sw.js?policy=external-media-connect-v1');
	});

	it('enables navigation preload without weakening the bounded offline fallback', () => {
		const source = createServiceWorkerSource('test-version', ['/index.html', '/assets/app.js']);

		expect(source).toContain('self.registration.navigationPreload.enable()');
		expect(source).toContain('Promise.resolve(event.preloadResponse)');
		expect(source).toContain('controller.abort()');
		expect(source).toContain('clearTimeout(timeout)');
		expect(source).toContain("caches.match('/index.html')");
		expect(source).not.toContain('skipWaiting');
	});

	it('caps opaque media entries separately, guards response byte size, and refreshes LRU order', () => {
		const source = createServiceWorkerSource('test-version', ['/index.html']);

		expect(source).toContain('MAX_OPAQUE_MEDIA_ENTRIES = 30');
		expect(source).toContain('MAX_MEDIA_BYTES = 2 * 1024 * 1024');
		expect(source).toContain('touchMediaCache(');
		expect(source).toContain('pruneCache(opaqueCache, MAX_OPAQUE_MEDIA_ENTRIES)');
	});

	it('keeps E2E feed fixtures outside public/ so they are excluded from production builds', () => {
		expect(existsSync(resolve(import.meta.dirname, '../../public/test-feeds'))).toBe(false);
	});
});
