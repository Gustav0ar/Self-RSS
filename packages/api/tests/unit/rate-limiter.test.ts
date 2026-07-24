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
	it('atomically creates the first window counter with a millisecond TTL', async () => {
		const redis = {
			eval: vi.fn().mockResolvedValue(1),
		};
		const limiter = new RateLimiter(redis as never);

		const result = await limiter.check('auth', { windowMs: 60_000, maxRequests: 5 });
		expect(result).toEqual({ allowed: true, remaining: 4 });
		expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, 'rl:auth', '60000');
		const script = redis.eval.mock.calls[0]?.[0];
		expect(script).toContain('redis.call("INCR", KEYS[1])');
		expect(script).toContain('if current == 1 then');
		expect(script).toContain('redis.call("PEXPIRE", KEYS[1], ARGV[1])');
	});

	it('uses the atomic script result for later increments without changing count semantics', async () => {
		const redis = {
			eval: vi.fn().mockResolvedValue(2),
		};
		const limiter = new RateLimiter(redis as never);

		const result = await limiter.check('auth', { windowMs: 60_000, maxRequests: 5 });
		expect(result).toEqual({ allowed: true, remaining: 3 });
		expect(redis.eval).toHaveBeenCalledTimes(1);
	});

	it('returns allowed=false once the cap is exceeded', async () => {
		const redis = {
			eval: vi.fn().mockResolvedValue(6),
		};
		const limiter = new RateLimiter(redis as never);

		const result = await limiter.check('auth', { windowMs: 60_000, maxRequests: 5 });
		expect(result).toEqual({ allowed: false, remaining: 0 });
	});

	it('fails open when Redis eval throws during check', async () => {
		const redis = {
			eval: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
		};
		const limiter = new RateLimiter(redis as never);

		const result = await limiter.check('auth', { windowMs: 60_000, maxRequests: 5 });

		expect(result).toEqual({ allowed: true, remaining: Infinity });
		expect(redis.eval).toHaveBeenCalledTimes(1);
	});

	it('fails open when Redis returns an invalid counter during check', async () => {
		const redis = {
			eval: vi.fn().mockResolvedValue('not-a-counter'),
		};
		const limiter = new RateLimiter(redis as never);

		const result = await limiter.check('auth', { windowMs: 60_000, maxRequests: 5 });

		expect(result).toEqual({ allowed: true, remaining: Infinity });
	});

	it('fails closed when the bucket is configured for closed Redis failure mode', async () => {
		const redis = {
			eval: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
		};
		const limiter = new RateLimiter(redis as never);

		const result = await limiter.check('auth', {
			windowMs: 60_000,
			maxRequests: 5,
			failureMode: 'closed',
		});

		expect(result).toEqual({ allowed: false, remaining: 0 });
		expect(redis.eval).toHaveBeenCalledTimes(1);
	});

	it('fails closed when Redis eval throws during incrementDailyCount', async () => {
		const redis = {
			eval: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
		};
		const limiter = new RateLimiter(redis as never);

		await expect(limiter.incrementDailyCount('opml-import:user-1')).rejects.toThrow(
			'Rate limit service unavailable',
		);
	});

	it('fails closed when Redis returns an invalid daily counter', async () => {
		const redis = {
			eval: vi.fn().mockResolvedValue(0),
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

	it('increments a daily counter atomically with an explicit 48h TTL', async () => {
		const redis = {
			eval: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2),
		};
		const limiter = new RateLimiter(redis as never);

		expect(await limiter.incrementDailyCount('opml-import:user-1')).toBe(1);
		expect(await limiter.incrementDailyCount('opml-import:user-1')).toBe(2);

		const today = new Date().toISOString().slice(0, 10);
		expect(redis.eval).toHaveBeenNthCalledWith(
			1,
			expect.any(String),
			1,
			`rl:opml-import:user-1:${today}`,
			String(48 * 60 * 60 * 1_000),
		);
		expect(redis.eval).toHaveBeenCalledTimes(2);
	});

	it('returns every exact increment under concurrent calls', async () => {
		let counter = 0;
		const redis = {
			eval: vi.fn(async () => {
				counter += 1;
				return counter;
			}),
		};
		const limiter = new RateLimiter(redis as never);

		const results = await Promise.all(
			Array.from({ length: 25 }, () =>
				limiter.check('concurrent', { windowMs: 60_000, maxRequests: 25 }),
			),
		);

		expect(redis.eval).toHaveBeenCalledTimes(25);
		expect(results.map((result) => result.remaining).sort((a, b) => b - a)).toEqual(
			Array.from({ length: 25 }, (_, index) => 24 - index),
		);
		expect(results.every((result) => result.allowed)).toBe(true);
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

	it('allows rapid authenticated article reading without raising unrelated read limits', () => {
		process.env.NODE_ENV = 'production';
		expect(RATE_LIMITS.articlesRead).toEqual({ windowMs: 60_000, maxRequests: 300 });
		expect(RATE_LIMITS.categoriesRead).toEqual({ windowMs: 60_000, maxRequests: 100 });
		expect(RATE_LIMITS.preferencesRead).toEqual({ windowMs: 60_000, maxRequests: 100 });
		expect(RATE_LIMITS.statsRead).toEqual({ windowMs: 60_000, maxRequests: 100 });
		expect(RATE_LIMITS.feedsRead).toEqual({ windowMs: 60_000, maxRequests: 100 });
	});

	it('raises read-heavy endpoint limits in test to avoid E2E suite self-throttling', () => {
		process.env.NODE_ENV = 'test';
		expect(RATE_LIMITS.articlesRead).toEqual({ windowMs: 60_000, maxRequests: 1_000 });
		expect(RATE_LIMITS.categoriesRead).toEqual({ windowMs: 60_000, maxRequests: 1_000 });
		expect(RATE_LIMITS.preferencesRead).toEqual({ windowMs: 60_000, maxRequests: 1_000 });
		expect(RATE_LIMITS.statsRead).toEqual({ windowMs: 60_000, maxRequests: 1_000 });
		expect(RATE_LIMITS.feedsRead).toEqual({ windowMs: 60_000, maxRequests: 1_000 });
	});

	it('allows rapid read-state writes without raising unrelated mutation limits', () => {
		expect(RATE_LIMITS.articlesMutate).toEqual({
			windowMs: 60_000,
			maxRequests: 180,
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
