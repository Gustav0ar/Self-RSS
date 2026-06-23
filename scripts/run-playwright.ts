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
const apiPort = await getFreePort();
const webPort = await getFreePort();
let apiProcess: ChildProcess | undefined;
let workerProcess: ChildProcess | undefined;
let webProcess: ChildProcess | undefined;

try {
	const env = {
		...services.env,
		API_PORT: String(apiPort),
		API_HOST: '127.0.0.1',
		VITE_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
		PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${webPort}`,
		PLAYWRIGHT_API_BASE_URL: `http://127.0.0.1:${apiPort}/api/v1`,
		FEED_ALLOW_PRIVATE_HOSTS: 'true',
	};

	runBun(['run', '--filter', '@self-feed/api', 'db:migrate'], { env });
	runBun(['scripts/seed-e2e.ts'], { env });

	apiProcess = spawnBackground('bun', ['run', '--filter', '@self-feed/api', 'start'], {
		cwd: rootDir,
		env,
	});
	await waitForHttp(`http://127.0.0.1:${apiPort}/health`);

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
	await services.stop();
}
