import { defineConfig, devices } from '@playwright/test';

const boundedBrowserMatrix = /browser-matrix\.e2e\.spec\.ts/;

export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: false,
	workers: 1,
	timeout: 30_000,
	retries: process.env.CI ? 1 : 0,
	use: {
		baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		headless: true,
	},
	projects: [
		{
			name: 'desktop-chromium',
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'mobile-chrome',
			testMatch: boundedBrowserMatrix,
			use: { ...devices['Pixel 7'] },
		},
		{
			name: 'firefox',
			testMatch: boundedBrowserMatrix,
			use: { ...devices['Desktop Firefox'] },
		},
		{
			name: 'webkit',
			testMatch: boundedBrowserMatrix,
			use: { ...devices['Desktop Safari'] },
		},
	],
});
