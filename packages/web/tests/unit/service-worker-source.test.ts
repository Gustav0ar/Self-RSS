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
});
