import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearEnvCache } from '../../src/config/env.js';
import { AppError } from '../../src/middleware/errors.js';
import { enforceRateLimit } from '../../src/utils/rate-limit.js';
import { RATE_LIMITS, RateLimiter } from '../../src/utils/rate-limiter.js';

const originalEnv = { ...process.env };

beforeEach(() => {
	process.env = {
		...originalEnv,
		DATABASE_URL: 'data/rss.db',
		REDIS_URL: 'redis://localhost:6379',
		JWT_SECRET: 'test-secret-1234567890-32-chars-long-secret',
		JWT_REFRESH_SECRET: 'test-refresh-secret-1234567890-32-chars-long-secret',
	};
	clearEnvCache();
});

afterEach(() => {
	process.env = { ...originalEnv };
	clearEnvCache();
});

function makeContext({
	userId,
	forwardedFor,
	realIp,
}: {
	userId?: string;
	forwardedFor?: string;
	realIp?: string;
}) {
	const headers = new Headers();
	if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);
	if (realIp) headers.set('x-real-ip', realIp);
	const store = new Map<string, unknown>();
	store.set('userId', userId);
	return {
		req: { header: (name: string) => headers.get(name) ?? undefined },
		get: (key: string) => store.get(key),
		set: (key: string, value: unknown) => store.set(key, value),
		header: vi.fn(),
	};
}

describe('RateLimiter', () => {
	it('counts calls in the window and reports remaining', async () => {
		const redis = {
			incr: vi.fn().mockResolvedValue(1),
			pexpire: vi.fn().mockResolvedValue(1),
		};
		const limiter = new RateLimiter(redis as never);

		const result = await limiter.check('auth', { windowMs: 60_000, maxRequests: 5 });
		expect(result).toEqual({ allowed: true, remaining: 4 });
		expect(redis.pexpire).toHaveBeenCalledWith('rl:auth', 60_000);
	});

	it('only sets the TTL on the first request in the window', async () => {
		const redis = {
			incr: vi.fn().mockResolvedValue(2),
			pexpire: vi.fn().mockResolvedValue(0),
		};
		const limiter = new RateLimiter(redis as never);

		const result = await limiter.check('auth', { windowMs: 60_000, maxRequests: 5 });
		expect(result.allowed).toBe(true);
		expect(redis.pexpire).not.toHaveBeenCalled();
	});

	it('returns allowed=false once the cap is exceeded', async () => {
		const redis = {
			incr: vi.fn().mockResolvedValue(6),
			pexpire: vi.fn().mockResolvedValue(1),
		};
		const limiter = new RateLimiter(redis as never);

		const result = await limiter.check('auth', { windowMs: 60_000, maxRequests: 5 });
		expect(result).toEqual({ allowed: false, remaining: 0 });
	});

	it('fails open when Redis incr throws during check', async () => {
		const redis = {
			incr: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
			pexpire: vi.fn().mockResolvedValue(1),
		};
		const limiter = new RateLimiter(redis as never);

		const result = await limiter.check('auth', { windowMs: 60_000, maxRequests: 5 });

		expect(result).toEqual({ allowed: true, remaining: Infinity });
		expect(redis.pexpire).not.toHaveBeenCalled();
	});

	it('fails open when Redis pexpire throws during check', async () => {
		const redis = {
			incr: vi.fn().mockResolvedValue(1),
			pexpire: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
		};
		const limiter = new RateLimiter(redis as never);

		const result = await limiter.check('auth', { windowMs: 60_000, maxRequests: 5 });

		// First request succeeded (incr returned 1), but pexpire failed
		// The operation still allowed the request since the core incr worked
		expect(result).toEqual({ allowed: true, remaining: Infinity });
	});

	it('fails closed when the bucket is configured for closed Redis failure mode', async () => {
		const redis = {
			incr: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
			pexpire: vi.fn().mockResolvedValue(1),
		};
		const limiter = new RateLimiter(redis as never);

		const result = await limiter.check('auth', {
			windowMs: 60_000,
			maxRequests: 5,
			failureMode: 'closed',
		});

		expect(result).toEqual({ allowed: false, remaining: 0 });
		expect(redis.pexpire).not.toHaveBeenCalled();
	});

	it('fails closed when Redis incr throws during incrementDailyCount', async () => {
		const redis = {
			incr: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
		};
		const limiter = new RateLimiter(redis as never);

		await expect(limiter.incrementDailyCount('opml-import:user-1')).rejects.toThrow(
			'Rate limit service unavailable',
		);
	});

	it('fails closed when Redis expire throws during incrementDailyCount', async () => {
		const redis = {
			incr: vi.fn().mockResolvedValue(1),
			expire: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
		};
		const limiter = new RateLimiter(redis as never);

		await expect(limiter.incrementDailyCount('opml-import:user-1')).rejects.toThrow(
			'Rate limit service unavailable',
		);
	});

	it('fails closed when Redis decr throws during releaseDailyCount', async () => {
		const redis = {
			decr: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
		};
		const limiter = new RateLimiter(redis as never);

		await expect(limiter.releaseDailyCount('opml-import:user-1')).rejects.toThrow(
			'Rate limit service unavailable',
		);
	});

	it('increments a daily counter with a 48h TTL only on the first hit of the day', async () => {
		const redis = {
			incr: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2),
			expire: vi.fn().mockResolvedValue(1),
		};
		const limiter = new RateLimiter(redis as never);

		expect(await limiter.incrementDailyCount('opml-import:user-1')).toBe(1);
		expect(await limiter.incrementDailyCount('opml-import:user-1')).toBe(2);

		const today = new Date().toISOString().slice(0, 10);
		expect(redis.incr).toHaveBeenNthCalledWith(1, `rl:opml-import:user-1:${today}`);
		expect(redis.expire).toHaveBeenCalledTimes(1);
		expect(redis.expire).toHaveBeenCalledWith(`rl:opml-import:user-1:${today}`, 60 * 60 * 48);
	});

	it('releases a reserved daily counter slot', async () => {
		const redis = {
			decr: vi.fn().mockResolvedValue(0),
			del: vi.fn().mockResolvedValue(1),
		};
		const limiter = new RateLimiter(redis as never);

		await limiter.releaseDailyCount('opml-import:user-1');

		const today = new Date().toISOString().slice(0, 10);
		expect(redis.decr).toHaveBeenCalledWith(`rl:opml-import:user-1:${today}`);
		expect(redis.del).toHaveBeenCalledWith(`rl:opml-import:user-1:${today}`);
	});
});

describe('RATE_LIMITS', () => {
	it('caps the auth limit at 100 in the test environment', () => {
		process.env.NODE_ENV = 'test';
		expect(RATE_LIMITS.auth).toEqual({
			windowMs: 60_000,
			maxRequests: 100,
			failureMode: 'closed',
		});
	});

	it('exposes the named buckets used by routes', () => {
		expect(RATE_LIMITS.feedExport).toEqual({ windowMs: 60_000, maxRequests: 30 });
		expect(RATE_LIMITS.feedImport).toEqual({
			windowMs: 60_000,
			maxRequests: 20,
			failureMode: 'closed',
		});
		expect(RATE_LIMITS.feedSync).toEqual({
			windowMs: 60_000,
			maxRequests: 60,
			failureMode: 'closed',
		});
		expect(RATE_LIMITS.articleEnrich).toEqual({
			windowMs: 60_000,
			maxRequests: 120,
			failureMode: 'closed',
		});
	});

	it('exposes read-heavy endpoint limits at 100/min', () => {
		expect(RATE_LIMITS.articlesRead).toEqual({ windowMs: 60_000, maxRequests: 100 });
		expect(RATE_LIMITS.categoriesRead).toEqual({ windowMs: 60_000, maxRequests: 100 });
		expect(RATE_LIMITS.preferencesRead).toEqual({ windowMs: 60_000, maxRequests: 100 });
		expect(RATE_LIMITS.statsRead).toEqual({ windowMs: 60_000, maxRequests: 100 });
		expect(RATE_LIMITS.feedsRead).toEqual({ windowMs: 60_000, maxRequests: 100 });
	});

	it('exposes mutation endpoint limits at 30/min', () => {
		expect(RATE_LIMITS.articlesMutate).toEqual({
			windowMs: 60_000,
			maxRequests: 30,
			failureMode: 'closed',
		});
		expect(RATE_LIMITS.categoriesMutate).toEqual({
			windowMs: 60_000,
			maxRequests: 30,
			failureMode: 'closed',
		});
		expect(RATE_LIMITS.preferencesMutate).toEqual({
			windowMs: 60_000,
			maxRequests: 30,
			failureMode: 'closed',
		});
		expect(RATE_LIMITS.feedsMutate).toEqual({
			windowMs: 60_000,
			maxRequests: 30,
			failureMode: 'closed',
		});
	});
});

describe('enforceRateLimit', () => {
	it('sets the X-RateLimit-Remaining header on the response', async () => {
		const c = makeContext({ userId: 'user-1' });
		const limiter = { check: vi.fn().mockResolvedValue({ allowed: true, remaining: 7 }) };

		await enforceRateLimit(c as never, limiter as never, 'feed-create', {
			windowMs: 60_000,
			maxRequests: 10,
		});

		expect(limiter.check).toHaveBeenCalledWith('feed-create:user-1', {
			windowMs: 60_000,
			maxRequests: 10,
		});
		expect(c.header).toHaveBeenCalledWith('X-RateLimit-Remaining', '7');
	});

	it('keeps authenticated user identity ahead of proxy headers', async () => {
		process.env.TRUST_PROXY = 'true';
		process.env.TRUSTED_PROXY_HOPS = '0';
		clearEnvCache();
		const c = makeContext({ userId: 'user-1', forwardedFor: '203.0.113.10' });
		const limiter = { check: vi.fn().mockResolvedValue({ allowed: true, remaining: 5 }) };

		await enforceRateLimit(c as never, limiter as never, 'search', {
			windowMs: 60_000,
			maxRequests: 60,
		});
		expect(limiter.check).toHaveBeenCalledWith('search:user-1', {
			windowMs: 60_000,
			maxRequests: 60,
		});
	});

	it('uses the anonymous identity when not authenticated and proxy is not trusted', async () => {
		process.env.TRUST_PROXY = 'false';
		clearEnvCache();
		const c = makeContext({ userId: undefined, forwardedFor: '203.0.113.10' });
		const limiter = { check: vi.fn().mockResolvedValue({ allowed: true, remaining: 5 }) };

		await enforceRateLimit(c as never, limiter as never, 'search', {
			windowMs: 60_000,
			maxRequests: 60,
		});
		expect(limiter.check).toHaveBeenCalledWith('search:anonymous', {
			windowMs: 60_000,
			maxRequests: 60,
		});
	});

	it('uses a single x-forwarded-for identity when no trusted proxy hop follows it', async () => {
		process.env.TRUST_PROXY = 'true';
		process.env.TRUSTED_PROXY_HOPS = '0';
		clearEnvCache();
		const c = makeContext({ userId: undefined, forwardedFor: '203.0.113.10' });
		const limiter = { check: vi.fn().mockResolvedValue({ allowed: true, remaining: 5 }) };

		await enforceRateLimit(c as never, limiter as never, 'search', {
			windowMs: 60_000,
			maxRequests: 60,
		});
		expect(limiter.check).toHaveBeenCalledWith('search:203.0.113.10', {
			windowMs: 60_000,
			maxRequests: 60,
		});
	});

	it('uses the address before the configured trusted proxy hops', async () => {
		process.env.TRUST_PROXY = 'true';
		process.env.TRUSTED_PROXY_HOPS = '1';
		clearEnvCache();
		const c = makeContext({
			userId: undefined,
			forwardedFor: '203.0.113.10, 198.51.100.20',
		});
		const limiter = { check: vi.fn().mockResolvedValue({ allowed: true, remaining: 5 }) };

		await enforceRateLimit(c as never, limiter as never, 'search', {
			windowMs: 60_000,
			maxRequests: 60,
		});
		expect(limiter.check).toHaveBeenCalledWith('search:203.0.113.10', {
			windowMs: 60_000,
			maxRequests: 60,
		});
	});

	it('falls back safely when forwarded headers are invalid or too short', async () => {
		process.env.TRUST_PROXY = 'true';
		process.env.TRUSTED_PROXY_HOPS = '2';
		clearEnvCache();
		const c = makeContext({
			userId: undefined,
			forwardedFor: 'not-an-ip, 203.0.113.10',
			realIp: '198.51.100.20',
		});
		const limiter = { check: vi.fn().mockResolvedValue({ allowed: true, remaining: 5 }) };

		await enforceRateLimit(c as never, limiter as never, 'search', {
			windowMs: 60_000,
			maxRequests: 60,
		});
		expect(limiter.check).toHaveBeenCalledWith('search:198.51.100.20', {
			windowMs: 60_000,
			maxRequests: 60,
		});
	});

	it('throws a 429 once the limit is exceeded', async () => {
		const c = makeContext({ userId: 'user-1' });
		const limiter = {
			check: vi.fn().mockResolvedValue({ allowed: false, remaining: 0 }),
		};

		await expect(
			enforceRateLimit(c as never, limiter as never, 'feed-create', {
				windowMs: 60_000,
				maxRequests: 10,
			}),
		).rejects.toBeInstanceOf(AppError);
	});
});
