import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

interface RunOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	stdio?: 'inherit' | 'pipe';
}

export interface TestServices {
	runtime: 'podman' | 'docker';
	databaseUrl: string;
	redisUrl: string;
	env: NodeJS.ProcessEnv;
	stop: () => Promise<void>;
}

const REDIS_IMAGE = 'docker.io/redis:8.8-alpine';
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function commandExists(command: string) {
	const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
	return result.status === 0;
}

function getRuntime(): 'podman' | 'docker' {
	if (commandExists('podman')) return 'podman';
	if (commandExists('docker')) return 'docker';
	throw new Error('Neither podman nor docker is available');
}

export async function getFreePort(): Promise<number> {
	return await new Promise((resolvePort, reject) => {
		const server = createServer();
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				reject(new Error('Failed to allocate free port'));
				return;
			}
			const { port } = address;
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolvePort(port);
			});
		});
		server.on('error', reject);
	});
}

function runChecked(command: string, args: string[], options: RunOptions = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? rootDir,
		env: options.env ?? process.env,
		stdio: options.stdio ?? 'inherit',
		encoding: 'utf8',
	});
	if (result.status !== 0) {
		throw new Error(`Command failed: ${command} ${args.join(' ')}`);
	}
	return result;
}

async function waitForContainerCheck(
	runtime: 'podman' | 'docker',
	containerName: string,
	args: string[],
	label: string,
) {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		const result = spawnSync(runtime, ['exec', containerName, ...args], { stdio: 'ignore' });
		if (result.status === 0) return;
		await sleep(1000);
	}
	throw new Error(`${label} did not become ready`);
}

export async function waitForHttp(url: string, timeoutMs = 60_000) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			// keep waiting
		}
		await sleep(500);
	}
	throw new Error(`Timed out waiting for ${url}`);
}

export function spawnBackground(command: string, args: string[], options: RunOptions = {}) {
	return spawn(command, args, {
		cwd: options.cwd ?? rootDir,
		env: options.env ?? process.env,
		stdio: options.stdio ?? 'inherit',
	});
}

export async function stopProcess(processHandle: ChildProcess | undefined) {
	if (!processHandle || processHandle.exitCode !== null) return;
	processHandle.kill('SIGTERM');
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (processHandle.exitCode !== null) return;
		await sleep(250);
	}
	processHandle.kill('SIGKILL');
}

export async function startTestServices(prefix: string): Promise<TestServices> {
	const runtime = getRuntime();
	const redisPort = await getFreePort();
	const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const redisName = `${prefix}-redis-${suffix}`;
	const dbFile = resolve(rootDir, `packages/api/test-${suffix}.db`);

	runChecked(runtime, [
		'run',
		'-d',
		'--rm',
		'--name',
		redisName,
		'-p',
		`127.0.0.1:${redisPort}:6379`,
		REDIS_IMAGE,
	]);

	try {
		await waitForContainerCheck(runtime, redisName, ['redis-cli', 'ping'], 'Redis');
	} catch (error) {
		spawnSync(runtime, ['rm', '-f', redisName], { stdio: 'ignore' });
		throw error;
	}

	const databaseUrl = dbFile;
	const redisUrl = `redis://127.0.0.1:${redisPort}`;
	const env = {
		...process.env,
		NODE_ENV: 'test',
		DATABASE_URL: databaseUrl,
		REDIS_URL: redisUrl,
		JWT_SECRET: 'integration-secret-12345-32-chars-long',
		JWT_REFRESH_SECRET: 'integration-refresh-secret-12345-32-chars-long',
		JWT_ACCESS_EXPIRES_IN: '15m',
		JWT_REFRESH_EXPIRES_IN: '7d',
		ADMIN_EMAIL: 'admin@example.com',
		ADMIN_PASSWORD: 'password123',
	};

	return {
		runtime,
		databaseUrl,
		redisUrl,
		env,
		stop: async () => {
			spawnSync(runtime, ['rm', '-f', redisName], { stdio: 'ignore' });
			try {
				const fs = await import('node:fs/promises');
				await fs.rm(dbFile, { force: true });
				await fs.rm(`${dbFile}-wal`, { force: true });
				await fs.rm(`${dbFile}-shm`, { force: true });
			} catch {
				// ignore
			}
		},
	};
}

export function runBun(args: string[], options: RunOptions = {}) {
	return runChecked('bun', args, options);
}
