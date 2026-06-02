import { spawnSync } from 'node:child_process';

function commandExists(command: string): boolean {
	const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
	return result.status === 0;
}

function getComposeCommand(): string[] {
	if (commandExists('podman')) {
		return ['podman', 'compose'];
	}
	if (commandExists('docker')) {
		return ['docker', 'compose'];
	}
	if (commandExists('docker-compose')) {
		return ['docker-compose'];
	}
	throw new Error('Error: Neither podman nor docker/docker-compose is available on this system.');
}

try {
	const args = process.argv.slice(2);
	const composeCmd = getComposeCommand();
	const binary = composeCmd[0];
	const fullArgs = [...composeCmd.slice(1), ...args];

	const result = spawnSync(binary, fullArgs, { stdio: 'inherit' });
	process.exit(result.status ?? 0);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
