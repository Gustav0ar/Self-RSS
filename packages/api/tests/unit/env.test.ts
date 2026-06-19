import { afterEach, describe, expect, it } from 'vitest';
import { clearEnvCache, getEnv } from '../../src/config/env.js';

const originalEnv = { ...process.env };

function applyEnv(overrides: Record<string, string | undefined>) {
	process.env = {
		...originalEnv,
		DATABASE_URL: 'data/rss.db',
		REDIS_URL: 'redis://localhost:6379',
		JWT_SECRET: 'test-secret-1234567890-32-chars-long-secret',
		JWT_REFRESH_SECRET: 'test-refresh-secret-1234567890-32-chars-long-secret',
		...overrides,
	};
	clearEnvCache();
}

afterEach(() => {
	process.env = { ...originalEnv };
	clearEnvCache();
});

describe('getEnv', () => {
	it('defaults ALLOW_REGISTRATION to true and allows overrides', () => {
		applyEnv({});
		expect(getEnv().ALLOW_REGISTRATION).toBe(true);
	});

	it('correctly parses false string values for booleans', () => {
		applyEnv({
			TRUST_PROXY: 'false',
			FEED_ALLOW_PRIVATE_HOSTS: 'false',
			ALLOW_REGISTRATION: 'false',
		});
		const env = getEnv();
		expect(env.TRUST_PROXY).toBe(false);
		expect(env.FEED_ALLOW_PRIVATE_HOSTS).toBe(false);
		expect(env.ALLOW_REGISTRATION).toBe(false);
	});

	it('parses trusted proxy hop configuration', () => {
		applyEnv({
			TRUSTED_PROXY_HOPS: '2',
		});

		expect(getEnv().TRUSTED_PROXY_HOPS).toBe(2);
	});

	it('accepts development placeholder values', () => {
		applyEnv({
			NODE_ENV: 'development',
			JWT_SECRET: 'dev-only-change-me-before-production-32chars',
			JWT_REFRESH_SECRET: 'dev-only-change-me-refresh-before-production-32chars',
			ADMIN_EMAIL: 'admin@local.test',
			ADMIN_PASSWORD: 'dev-only-admin-password',
		});

		expect(getEnv().NODE_ENV).toBe('development');
	});

	it('rejects matching JWT secrets', () => {
		applyEnv({
			JWT_SECRET: 'same-secret-1234567890-32-chars-long',
			JWT_REFRESH_SECRET: 'same-secret-1234567890-32-chars-long',
		});

		expect(() => getEnv()).toThrowError(/JWT refresh secret must differ from JWT secret/);
	});

	it('rejects placeholder production secrets', () => {
		applyEnv({
			NODE_ENV: 'production',
			JWT_SECRET: 'dev-only-change-me-before-production-32chars',
			JWT_REFRESH_SECRET: 'dev-only-change-me-refresh-before-production-32chars',
		});

		expect(() => getEnv()).toThrowError(/must not use a placeholder value in production/);
	});

	it('rejects private-host feed fetching in production', () => {
		applyEnv({
			NODE_ENV: 'production',
			FEED_ALLOW_PRIVATE_HOSTS: 'true',
		});

		expect(() => getEnv()).toThrowError(/Private feed hosts must stay disabled in production/);
	});

	it('rejects default admin bootstrap credentials in production', () => {
		applyEnv({
			NODE_ENV: 'production',
			ADMIN_EMAIL: 'admin@example.com',
			ADMIN_PASSWORD: 'dev-only-admin-password',
		});

		expect(() => getEnv()).toThrowError(
			/Admin email must not use the default example value in production/,
		);
	});
});
