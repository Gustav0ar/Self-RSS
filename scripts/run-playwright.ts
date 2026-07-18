import type { ChildProcess } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	getFreePort,
	runBun,
	spawnBackground,
	startTestServices,
	stopProcess,
	waitForHttp,
} from './test-env.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const services = await startTestServices('rss-playwright');
const relayToken = 'playwright-relay-token-that-is-long-enough';
const blockedFeedPort = await getFreePort();
const relayPort = await getFreePort();
const apiPort = await getFreePort();
const webPort = await getFreePort();
let relayProcess: ChildProcess | undefined;
let apiProcess: ChildProcess | undefined;
let workerProcess: ChildProcess | undefined;
let webProcess: ChildProcess | undefined;

try {
	const env = {
		...services.env,
		E2E_BLOCKED_FEED_PORT: String(blockedFeedPort),
		E2E_FEED_RELAY_PORT: String(relayPort),
		E2E_FEED_RELAY_TOKEN: relayToken,
		API_PORT: String(apiPort),
		API_HOST: '127.0.0.1',
		VITE_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
		PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${webPort}`,
		PLAYWRIGHT_API_BASE_URL: `http://127.0.0.1:${apiPort}/api/v1`,
		PLAYWRIGHT_RELAY_BLOCKED_FEED_URL: `http://127.0.0.1:${blockedFeedPort}/feed.xml`,
		// CI and local E2E exercise the production ingestion path by default.
		// A dedicated override remains available for explicit rollback diagnostics.
		FEED_PIPELINE_MODE: process.env.PLAYWRIGHT_FEED_PIPELINE_MODE ?? 'v2',
		FEED_ALLOW_PRIVATE_HOSTS: 'true',
		FEED_FETCH_RELAY_URL: `http://127.0.0.1:${relayPort}/videocardz/rss-feed`,
		FEED_FETCH_RELAY_TOKEN: relayToken,
		FEED_FETCH_RELAY_HOSTS: '127.0.0.1',
	};
	relayProcess = spawnBackground('bun', ['scripts/e2e-feed-relay-server.ts'], {
		cwd: rootDir,
		env,
	});
	await waitForHttp(`http://127.0.0.1:${relayPort}/health`);

	runBun(['run', '--filter', '@self-feed/api', 'db:migrate'], { env });
	runBun(['scripts/seed-e2e.ts'], { env });

	apiProcess = spawnBackground('bun', ['run', '--filter', '@self-feed/api', 'start'], {
		cwd: rootDir,
		env,
	});
	await waitForHttp(`http://127.0.0.1:${apiPort}/health`);
	const readiness = await fetch(`http://127.0.0.1:${apiPort}/ready`);
	const readinessBody = (await readiness.json()) as { feedPipelineMode?: string };
	if (!readiness.ok || readinessBody.feedPipelineMode !== env.FEED_PIPELINE_MODE) {
		throw new Error(
			`E2E API did not start in the requested feed pipeline mode: ${JSON.stringify(readinessBody)}`,
		);
	}

	workerProcess = spawnBackground('bun', ['run', '--filter', '@self-feed/api', 'start:worker'], {
		cwd: rootDir,
		env,
	});

	webProcess = spawnBackground(
		'bun',
		[
			'run',
			'--filter',
			'@self-feed/web',
			'dev',
			'--',
			'--host',
			'127.0.0.1',
			'--strictPort',
			'--port',
			String(webPort),
		],
		{
			cwd: rootDir,
			env,
		},
	);
	await waitForHttp(`http://127.0.0.1:${webPort}`);

	runBun(
		[
			'run',
			'--filter',
			'@self-feed/web',
			'test:e2e:runner',
			'--',
			'--config',
			'playwright.config.ts',
		],
		{
			cwd: rootDir,
			env,
		},
	);
} finally {
	await stopProcess(webProcess);
	await stopProcess(workerProcess);
	await stopProcess(apiProcess);
	await stopProcess(relayProcess);
	await services.stop();
}
