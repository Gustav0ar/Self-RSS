import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../../..');
const compose = readFileSync(resolve(repositoryRoot, 'docker-compose.yml'), 'utf8');

function serviceEnvironment(serviceName: 'api' | 'worker') {
	const lines = compose.split('\n');
	const serviceStart = lines.indexOf(`  ${serviceName}:`);
	const serviceEnd = lines.findIndex((line, index) => index > serviceStart && /^ {2}\S/.test(line));
	const service = lines.slice(serviceStart, serviceEnd === -1 ? undefined : serviceEnd);
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
});
