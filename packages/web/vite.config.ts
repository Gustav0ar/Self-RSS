import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const apiProxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:3000';

/** Serve E2E feed fixtures only during dev/test runs, keeping them out of production dist/. */
function e2eTestFeedsPlugin(): Plugin {
	const fixturesDir = resolve(import.meta.dirname, 'tests/e2e/fixtures/test-feeds');
	const allowedFiles = new Set(
		readdirSync(fixturesDir, { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith('.xml'))
			.map((entry) => entry.name),
	);
	return {
		name: 'self-feed-e2e-test-feeds',
		apply: 'serve',
		configureServer(server) {
			server.middlewares.use('/test-feeds', (req, res, next) => {
				const requestPath = (req.url ?? '').split('?')[0] ?? '';
				const fileName = requestPath.replace(/^\/+/, '');
				if (!allowedFiles.has(fileName)) {
					next();
					return;
				}
				res.setHeader('Content-Type', 'application/xml; charset=utf-8');
				res.end(readFileSync(resolve(fixturesDir, fileName)));
			});
		},
	};
}

function publicFiles(directory: string, prefix = ''): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		return entry.isDirectory() ? publicFiles(resolve(directory, entry.name), relative) : [relative];
	});
}

function offlineShellPlugin(): Plugin {
	return {
		name: 'self-feed-offline-shell',
		apply: 'build',
		generateBundle(_options, bundle) {
			const digest = createHash('sha256');
			for (const output of Object.values(bundle).sort((left, right) =>
				left.fileName.localeCompare(right.fileName),
			)) {
				digest.update(output.fileName);
				digest.update(output.type === 'asset' ? output.source : output.code);
			}
			const publicDirectory = resolve(import.meta.dirname, 'public');
			for (const fileName of publicFiles(publicDirectory).sort()) {
				digest.update(fileName);
				digest.update(readFileSync(resolve(publicDirectory, fileName)));
			}
			const version = digest.digest('hex').slice(0, 16);
			const shellUrls = Array.from(
				new Set([
					'/',
					'/index.html',
					'/site.webmanifest',
					'/favicon.svg',
					'/icon-192.png',
					'/icon-512.png',
					'/theme-init.js',
					...Object.values(bundle).map((output) => `/${output.fileName}`),
				]),
			);
			this.emitFile({
				type: 'asset',
				fileName: 'sw.js',
				source: createServiceWorkerSource(version, shellUrls),
			});
		},
	};
}

export function createServiceWorkerSource(version: string, shellUrls: string[]) {
	return `const CACHE_NAME = 'self-feed-shell-${version}';
const MEDIA_CACHE_NAME = 'self-feed-article-media-v2';
const OPAQUE_MEDIA_CACHE_NAME = 'self-feed-article-media-opaque-v2';
const MAX_MEDIA_ENTRIES = 120;
const MAX_OPAQUE_MEDIA_ENTRIES = 30;
const MAX_MEDIA_BYTES = 2 * 1024 * 1024;
const SHELL_URLS = ${JSON.stringify(shellUrls)};

async function pruneCache(cache, maxEntries) {
	const keys = await cache.keys();
	if (keys.length <= maxEntries) return;
	await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
}

async function touchMediaCache(cache, request, response) {
	try {
		await cache.delete(request);
		await cache.put(request, response);
	} catch {
		// Best-effort LRU bump; never disturb reads.
	}
}

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)));
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		Promise.all([
			caches.keys().then((keys) => Promise.all(
				keys.filter((key) =>
					(key.startsWith('self-feed-shell-') && key !== CACHE_NAME) ||
					key === 'self-feed-article-media-v1'
				).map((key) => caches.delete(key)),
			)),
			'navigationPreload' in self.registration
				? self.registration.navigationPreload.enable().catch(() => undefined)
				: Promise.resolve(),
			self.clients.claim(),
		]),
	);
});

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (request.destination === 'image' && url.origin !== self.location.origin) {
		event.respondWith(
			(async () => {
				const [mediaCache, opaqueCache] = await Promise.all([
					caches.open(MEDIA_CACHE_NAME),
					caches.open(OPAQUE_MEDIA_CACHE_NAME),
				]);
				const cachedCors = await mediaCache.match(request);
				if (cachedCors) {
					event.waitUntil(touchMediaCache(mediaCache, request, cachedCors.clone()));
					return cachedCors;
				}
				const cachedOpaque = await opaqueCache.match(request);
				if (cachedOpaque) {
					event.waitUntil(touchMediaCache(opaqueCache, request, cachedOpaque.clone()));
					return cachedOpaque;
				}
				const response = await fetch(request);
				if (response.type === 'opaque') {
					try {
						await opaqueCache.put(request, response.clone());
						await pruneCache(opaqueCache, MAX_OPAQUE_MEDIA_ENTRIES);
					} catch {
						// Storage pressure must never turn a successful image response into a failure.
					}
				} else if (response.ok) {
					const contentLength = Number(response.headers.get('content-length') ?? '0');
					if (!Number.isFinite(contentLength) || contentLength <= MAX_MEDIA_BYTES) {
						try {
							await mediaCache.put(request, response.clone());
							await pruneCache(mediaCache, MAX_MEDIA_ENTRIES);
						} catch {
							// Storage pressure must never turn a successful image response into a failure.
						}
					}
				}
				return response;
			})(),
		);
		return;
	}
	if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

	if (request.mode === 'navigate') {
		event.respondWith(
			(async () => {
				const controller = new AbortController();
				let timeout;
				const timeoutResponse = new Promise((resolve) => {
					timeout = setTimeout(() => {
						controller.abort();
						resolve(undefined);
					}, 5000);
				});
				try {
					const preloaded = await Promise.race([
						Promise.resolve(event.preloadResponse).catch(() => undefined),
						timeoutResponse,
					]);
					const response = preloaded ?? await fetch(request, { signal: controller.signal });
					if (!response.ok && response.status >= 500) {
						return (await caches.match('/index.html')) ?? response;
					}
					if (response.ok) {
						try {
							await (await caches.open(CACHE_NAME)).put('/index.html', response.clone());
						} catch {
							// The network response remains usable when storage quota is exhausted.
						}
					}
					return response;
				} catch {
					return (await caches.match('/index.html')) ?? Response.error();
				} finally {
					clearTimeout(timeout);
				}
			})(),
		);
		return;
	}

	event.respondWith(
		(async () => {
			const cached = await caches.match(request);
			if (cached) return cached;
			const response = await fetch(request);
			if (response.ok) {
				try {
					await (await caches.open(CACHE_NAME)).put(request, response.clone());
				} catch {
					// The network response remains usable when storage quota is exhausted.
				}
			}
			return response;
		})(),
	);
});
`;
}

export default defineConfig({
	plugins: [react(), tailwindcss(), e2eTestFeedsPlugin(), offlineShellPlugin()],
	resolve: {
		alias: {
			'@': resolve(import.meta.dirname, './src'),
		},
	},
	server: {
		port: 5173,
		proxy: {
			'/api': {
				target: apiProxyTarget,
				changeOrigin: true,
			},
		},
	},
	build: {
		sourcemap: process.env.VITE_ENABLE_SOURCEMAPS === 'true',
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (!id.includes('node_modules')) return;
					if (/node_modules[\\/]@tanstack[\\/]/.test(id)) {
						return 'tanstack';
					}
					if (/node_modules[\\/]lucide-react[\\/]/.test(id)) {
						return 'icons';
					}
					if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
						return 'react';
					}
				},
			},
		},
	},
});
