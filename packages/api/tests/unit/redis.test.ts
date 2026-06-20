import { describe, expect, it } from 'vitest';
import { normalizeRedisUrl } from '../../src/db/redis.js';

describe('normalizeRedisUrl', () => {
	it('only rewrites localhost hostnames', () => {
		expect(normalizeRedisUrl('redis://localhost:6379/0')).toBe('redis://127.0.0.1:6379/0');
		expect(normalizeRedisUrl('redis://user:localhost-secret@redis.localhost.test:6379/0')).toBe(
			'redis://user:localhost-secret@redis.localhost.test:6379/0',
		);
	});
});
