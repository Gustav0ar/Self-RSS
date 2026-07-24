import Redis from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CacheKeys, normalizeRedisUrl } from '../../src/db/redis.js';
import { RateLimiter } from '../../src/utils/rate-limiter.js';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error('Integration tests require REDIS_URL');

const redis = new Redis(normalizeRedisUrl(redisUrl), {
	maxRetriesPerRequest: 3,
});
const limiter = new RateLimiter(redis);
const windowKey = 'integration:rate-limit:window';
const concurrentKey = 'integration:rate-limit:concurrent';
const dailyBaseKey = 'integration:rate-limit:daily';
const dailyKey = `${dailyBaseKey}:${new Date().toISOString().slice(0, 10)}`;
const redisKeys = [
	CacheKeys.rateLimit(windowKey),
	CacheKeys.rateLimit(concurrentKey),
	CacheKeys.rateLimit(dailyKey),
];

beforeEach(async () => {
	await redis.del(...redisKeys);
});

afterAll(async () => {
	await redis.del(...redisKeys);
	await redis.quit();
});

describe('RateLimiter Redis atomicity', () => {
	it('sets a bounded positive PTTL on first increment and preserves it on later increments', async () => {
		const windowMs = 5_000;

		expect(await limiter.check(windowKey, { windowMs, maxRequests: 5 })).toEqual({
			allowed: true,
			remaining: 4,
		});
		const firstPttl = await redis.pttl(CacheKeys.rateLimit(windowKey));
		expect(firstPttl).toBeGreaterThan(0);
		expect(firstPttl).toBeLessThanOrEqual(windowMs);

		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(await limiter.check(windowKey, { windowMs, maxRequests: 5 })).toEqual({
			allowed: true,
			remaining: 3,
		});
		const secondPttl = await redis.pttl(CacheKeys.rateLimit(windowKey));
		expect(secondPttl).toBeGreaterThan(0);
		expect(secondPttl).toBeLessThan(firstPttl);
	});

	it('records the exact number of concurrent calls under one bounded PTTL', async () => {
		const callCount = 64;
		const windowMs = 10_000;

		const results = await Promise.all(
			Array.from({ length: callCount }, () =>
				limiter.check(concurrentKey, { windowMs, maxRequests: callCount }),
			),
		);

		expect(await redis.get(CacheKeys.rateLimit(concurrentKey))).toBe(String(callCount));
		expect(results.map((result) => result.remaining).sort((a, b) => b - a)).toEqual(
			Array.from({ length: callCount }, (_, index) => callCount - index - 1),
		);
		expect(results.every((result) => result.allowed)).toBe(true);
		const pttl = await redis.pttl(CacheKeys.rateLimit(concurrentKey));
		expect(pttl).toBeGreaterThan(0);
		expect(pttl).toBeLessThanOrEqual(windowMs);
	});

	it('sets the daily counter to an explicit bounded 48-hour PTTL', async () => {
		const ttlMs = 48 * 60 * 60 * 1_000;

		expect(await limiter.incrementDailyCount(dailyBaseKey)).toBe(1);

		const pttl = await redis.pttl(CacheKeys.rateLimit(dailyKey));
		expect(pttl).toBeGreaterThan(ttlMs - 1_000);
		expect(pttl).toBeLessThanOrEqual(ttlMs);
	});
});
