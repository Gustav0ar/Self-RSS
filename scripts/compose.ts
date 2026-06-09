import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function commandExists(command: string): boolean {
	const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
	return result.status === 0;
}

function parseEnvFile(path: string): Record<string, string> {
	try {
		const env: Record<string, string> = {};
		for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
			const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
			if (!match) continue;

			const [, key, rawValue = ''] = match;
			let value = rawValue.trim();
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			env[key] = value;
		}
		return env;
	} catch {
		return {};
	}
}

function buildComposeEnv(): NodeJS.ProcessEnv {
	const rootEnv = parseEnvFile('.env');
	const apiEnv = parseEnvFile('packages/api/.env');
	const exampleEnv = parseEnvFile('.env.example');
	const env = { ...process.env };

	for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
		env[key] ??= rootEnv[key] ?? apiEnv[key] ?? exampleEnv[key];
	}

	return env;
}

function getComposeCommand(): string[] {
	if (commandExists('podman')) {
		return ['podman', 'compose', '-f', 'compose.yaml'];
	}
	if (commandExists('docker')) {
		return ['docker', 'compose', '-f', 'compose.yaml'];
	}
	if (commandExists('docker-compose')) {
		return ['docker-compose', '-f', 'compose.yaml'];
	}
	throw new Error('Error: Neither podman nor docker/docker-compose is available on this system.');
}

try {
	const args = process.argv.slice(2);
	const composeCmd = getComposeCommand();
	const binary = composeCmd[0];
	const fullArgs = [...composeCmd.slice(1), ...args];

	const result = spawnSync(binary, fullArgs, { env: buildComposeEnv(), stdio: 'inherit' });
	process.exit(result.status ?? 0);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
