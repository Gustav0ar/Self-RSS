import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiProxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig({
	plugins: [react(), tailwindcss()],
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
