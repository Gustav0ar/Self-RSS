import { describe, expect, it } from 'vitest';
import { createServiceWorkerSource } from '../../vite.config';

describe('production service worker source', () => {
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
