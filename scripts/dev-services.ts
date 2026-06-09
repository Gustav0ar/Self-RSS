import { type ChildProcess, spawn } from 'node:child_process';

const children = new Set<ChildProcess>();
let shuttingDown = false;

function run(name: string, args: string[]) {
	console.log(`[dev] starting ${name}: bun ${args.join(' ')}`);
	const child = spawn('bun', args, {
		env: process.env,
		stdio: 'inherit',
	});
	children.add(child);
	child.once('exit', () => children.delete(child));
	return child;
}

function stopAll(signal: NodeJS.Signals = 'SIGTERM') {
	if (shuttingDown) return;
	shuttingDown = true;
	for (const child of children) {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill(signal);
		}
	}
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url: string, child: ChildProcess, timeoutMs = 60_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (child.exitCode !== null || child.signalCode !== null) {
			throw new Error(`API exited before becoming healthy (${url})`);
		}

		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			// The server is still starting.
		}

		await sleep(500);
	}

	throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
	process.on('SIGINT', () => stopAll('SIGINT'));
	process.on('SIGTERM', () => stopAll('SIGTERM'));

	const api = run('api', ['run', 'dev:api']);
	console.log('[dev] waiting for API health before starting worker');
	await waitForHttp('http://127.0.0.1:3000/health', api);

	const worker = run('worker', ['run', 'dev:worker']);
	const web = run('web', ['run', 'dev:web']);
	const services = [api, worker, web];

	await new Promise<void>((resolve) => {
		for (const child of services) {
			child.once('exit', (code, signal) => {
				if (!shuttingDown) {
					console.log(
						`[dev] service exited; stopping remaining services (${signal ?? `code ${code ?? 0}`})`,
					);
					stopAll();
				}
				resolve();
			});
		}
	});

	const failed = services.find((child) => child.exitCode && child.exitCode !== 0);
	process.exit(failed?.exitCode ?? 0);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	stopAll();
	process.exit(1);
});
