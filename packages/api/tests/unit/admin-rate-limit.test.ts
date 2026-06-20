import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/middleware/errors.js';
import { enforceRateLimit } from '../../src/utils/rate-limit.js';
import type { RateLimiter } from '../../src/utils/rate-limiter.js';

function createMockContext(overrides: { userId?: string } = {}) {
	const headers = new Map<string, string>();

	return {
		get: (key: string) => {
			if (key === 'userId') return overrides.userId ?? 'admin-1';
			return undefined;
		},
		set: vi.fn(),
		header: (name: string, value: string) => {
			headers.set(name, value);
		},
		req: {
			header: () => undefined,
			raw: { signal: new AbortController().signal },
		},
		headers,
	};
}

describe('admin rate limit configuration', () => {
	it('defines admin rate limit with 10 requests per minute', async () => {
		const { RATE_LIMITS } = await import('../../src/utils/rate-limiter.js');
		expect(RATE_LIMITS.admin.windowMs).toBe(60_000);
		expect(RATE_LIMITS.admin.maxRequests).toBe(10);
		expect(RATE_LIMITS.admin.failureMode).toBe('closed');
	});

	it('admin rate limit is stricter than standard endpoint limits', async () => {
		const { RATE_LIMITS } = await import('../../src/utils/rate-limiter.js');
		expect(RATE_LIMITS.admin.maxRequests).toBeLessThan(RATE_LIMITS.categoriesRead.maxRequests);
		expect(RATE_LIMITS.admin.maxRequests).toBeLessThan(RATE_LIMITS.articlesRead.maxRequests);
	});
});

describe('enforceRateLimit middleware', () => {
	it('allows requests within rate limit', async () => {
		const mockRateLimiter = {
			check: vi.fn().mockResolvedValue({ allowed: true, remaining: 9 }),
		} as unknown as RateLimiter;

		const c = createMockContext({ userId: 'admin-1' });

		// Should not throw when within limit
		await expect(
			enforceRateLimit(c as never, mockRateLimiter, 'admin', {
				windowMs: 60_000,
				maxRequests: 10,
			}),
		).resolves.toBeUndefined();

		expect(mockRateLimiter.check).toHaveBeenCalledWith('admin:admin-1', {
			windowMs: 60_000,
			maxRequests: 10,
		});
	});

	it('blocks requests exceeding rate limit with 429 error', async () => {
		const mockRateLimiter = {
			check: vi.fn().mockResolvedValue({ allowed: false, remaining: 0 }),
		} as unknown as RateLimiter;

		const c = createMockContext({ userId: 'admin-1' });

		await expect(
			enforceRateLimit(c as never, mockRateLimiter, 'admin', {
				windowMs: 60_000,
				maxRequests: 10,
			}),
		).rejects.toBeInstanceOf(AppError);
		await expect(
			enforceRateLimit(c as never, mockRateLimiter, 'admin', {
				windowMs: 60_000,
				maxRequests: 10,
			}),
		).rejects.toMatchObject({ statusCode: 429, code: 'TOO_MANY_REQUESTS' });
	});

	it('sets X-RateLimit-Remaining header on context', async () => {
		const mockRateLimiter = {
			check: vi.fn().mockResolvedValue({ allowed: true, remaining: 7 }),
		} as unknown as RateLimiter;

		const c = createMockContext({ userId: 'admin-1' });

		await enforceRateLimit(c as never, mockRateLimiter, 'admin', {
			windowMs: 60_000,
			maxRequests: 10,
		});

		expect(c.headers.get('X-RateLimit-Remaining')).toBe('7');
	});

	it('uses userId as rate limit key when authenticated', async () => {
		const mockRateLimiter = {
			check: vi.fn().mockResolvedValue({ allowed: true, remaining: 9 }),
		} as unknown as RateLimiter;

		const c = createMockContext({ userId: 'admin-user-123' });

		await enforceRateLimit(c as never, mockRateLimiter, 'admin', {
			windowMs: 60_000,
			maxRequests: 10,
		});

		expect(mockRateLimiter.check).toHaveBeenCalledWith('admin:admin-user-123', expect.any(Object));
	});

	it('tracks remaining count correctly across multiple requests', async () => {
		const remainingValues = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
		let callIndex = 0;

		const mockRateLimiter = {
			check: vi.fn().mockImplementation(() => {
				const remaining = remainingValues[callIndex++];
				if (remaining === undefined) {
					return Promise.resolve({ allowed: true, remaining: 0 });
				}
				return Promise.resolve({ allowed: remaining >= 0, remaining });
			}),
		} as unknown as RateLimiter;

		const c = createMockContext({ userId: 'admin-1' });

		for (let i = 0; i < 10; i++) {
			const headers = new Map<string, string>();
			const mockC = {
				...c,
				header: (name: string, value: string) => headers.set(name, value),
				headers,
			};
			await enforceRateLimit(mockC as never, mockRateLimiter, 'admin', {
				windowMs: 60_000,
				maxRequests: 10,
			});
		}

		expect(mockRateLimiter.check).toHaveBeenCalledTimes(10);
	});
});
