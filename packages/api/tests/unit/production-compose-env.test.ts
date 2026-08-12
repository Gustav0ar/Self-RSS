import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../../..');
const compose = readFileSync(resolve(repositoryRoot, 'docker-compose.yml'), 'utf8');
const deployScript = readFileSync(resolve(repositoryRoot, 'scripts/deploy-vps.sh'), 'utf8');

function serviceDefinition(serviceName: 'api' | 'worker') {
	const lines = compose.split('\n');
	const serviceStart = lines.indexOf(`  ${serviceName}:`);
	const serviceEnd = lines.findIndex((line, index) => index > serviceStart && /^ {2}\S/.test(line));
	return lines.slice(serviceStart, serviceEnd === -1 ? undefined : serviceEnd);
}

function serviceEnvironment(serviceName: 'api' | 'worker') {
	const service = serviceDefinition(serviceName);
	const environmentStart = service.indexOf('    environment:');
	const environmentEnd = service.findIndex(
		(line, index) => index > environmentStart && /^ {4}\S/.test(line),
	);
	return service
		.slice(environmentStart, environmentEnd === -1 ? undefined : environmentEnd)
		.join('\n');
}

describe('production compose environment contract', () => {
	it('forwards API session and readiness policy', () => {
		const environment = serviceEnvironment('api');
		for (const name of [
			'JWT_ACCESS_EXPIRES_IN',
			'JWT_REFRESH_EXPIRES_IN',
			'AUTH_SESSION_ABSOLUTE_TTL_DAYS',
			'AUTH_SESSION_IDLE_TTL_DAYS',
			'AUTH_SESSION_CLEANUP_BATCH_SIZE',
			'REQUIRE_WORKER_HEARTBEAT',
		]) {
			expect(environment).toContain(`${name}:`);
		}
	});

	it('forwards worker session, cache-warmer, and retention policy', () => {
		const environment = serviceEnvironment('worker');
		for (const name of [
			'JWT_ACCESS_EXPIRES_IN',
			'JWT_REFRESH_EXPIRES_IN',
			'AUTH_SESSION_ABSOLUTE_TTL_DAYS',
			'AUTH_SESSION_IDLE_TTL_DAYS',
			'AUTH_SESSION_CLEANUP_BATCH_SIZE',
			'CACHE_WARMER_INTERVAL_MS',
			'CACHE_WARMER_RECENT_WINDOW_MINUTES',
			'CACHE_WARMER_RECENT_USERS_LIMIT',
			'CACHE_WARMER_CONCURRENCY',
			'CACHE_WARMER_IDLE_USERS_ENABLED',
			'CACHE_WARMER_IDLE_USERS_LIMIT',
			'RETENTION_DELETION_ENABLED',
			'RETENTION_DELETION_DAYS',
			'RETENTION_DRY_RUN',
		]) {
			expect(environment).toContain(`${name}:`);
		}
	});

	it('allows guarded production migrations to finish before API health failures count', () => {
		expect(serviceDefinition('api').join('\n')).toContain(
			`start_period: \${API_HEALTH_START_PERIOD:-5m}`,
		);
	});

	it('rolls back both application images when compose startup fails', () => {
		expect(deployScript).toContain('save_current_images');
		expect(deployScript).toContain(
			`CONTAINER_HEALTH_ATTEMPTS="\${CONTAINER_HEALTH_ATTEMPTS:-180}"`,
		);
		expect(deployScript).toContain("inspect -f '{{.Image}}' selffeed-api");
		expect(deployScript).toContain('Restoring previous API and web images');
		expect(deployScript).toContain('Failed to restore one or more previous image tags');
		expect(deployScript).toMatch(
			/up -d --remove-orphans \|\| \{\n\techo "\[DEPLOY\] Compose startup failed"\n\trollback_deploy/,
		);
		expect(deployScript).not.toMatch(/docker pull "\$\{PREVIOUS_.*_IMAGE\}"/);
	});
});
