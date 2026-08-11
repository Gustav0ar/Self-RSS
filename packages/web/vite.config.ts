import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const apiProxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:3000';

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
				digest.update(output.type === 'asset' ? String(output.source) : output.code);
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

function createServiceWorkerSource(version: string, shellUrls: string[]) {
	return `const CACHE_NAME = 'self-feed-shell-${version}';
const SHELL_URLS = ${JSON.stringify(shellUrls)};

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)));
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((keys) => Promise.all(
			keys.filter((key) => key.startsWith('self-feed-shell-') && key !== CACHE_NAME)
				.map((key) => caches.delete(key)),
		)),
	);
	self.clients.claim();
});

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

	if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request)
				.then((response) => {
					if (response.ok) {
						const copy = response.clone();
						void caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
					}
					return response;
				})
				.catch(async () => (await caches.match('/index.html')) ?? Response.error()),
		);
		return;
	}

	event.respondWith(
		caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
			if (response.ok) {
				const copy = response.clone();
				void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
			}
			return response;
		})),
	);
});
`;
}

export default defineConfig({
	plugins: [react(), tailwindcss(), offlineShellPlugin()],
	resolve: {
		alias: {
			'@': resolve(__dirname, './src'),
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
					if (id.includes('node_modules')) {
						if (id.includes('react') || id.includes('react-dom')) {
							return 'react';
						}
						if (id.includes('@tanstack/react-query') || id.includes('@tanstack/react-router')) {
							return 'tanstack';
						}
						if (id.includes('lucide-react')) {
							return 'icons';
						}
					}
				},
			},
		},
	},
});
