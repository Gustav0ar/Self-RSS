import type Redis from 'ioredis';
import { getEnv } from '../config/index.js';
import { CacheKeys } from '../db/redis.js';
import { createLogger } from './logger.js';

const logger = createLogger();

export interface RateLimitConfig {
	windowMs: number;
	maxRequests: number;
}

export class RateLimiter {
	constructor(private redis: Redis) {}

	async check(
		key: string,
		config: RateLimitConfig,
	): Promise<{ allowed: boolean; remaining: number }> {
		const redisKey = CacheKeys.rateLimit(key);
		try {
			const current = await this.redis.incr(redisKey);
			if (current === 1) {
				await this.redis.pexpire(redisKey, config.windowMs);
			}
			const remaining = Math.max(0, config.maxRequests - current);
			return { allowed: current <= config.maxRequests, remaining };
		} catch (error) {
			// Redis unavailable - fail open for rate limiting (allow request)
			logger.warn('Rate limiter Redis unavailable, allowing request', {
				key,
				error: error instanceof Error ? error.message : String(error),
			});
			return { allowed: true, remaining: Infinity };
		}
	}

	/**
	 * Increment a daily counter and return the new value. The key is suffixed
	 * with the current UTC date so the counter rolls over at midnight without
	 * any cron. The key is created with a 48h TTL to bound its lifetime.
	 *
	 * Unlike `check`, this does not enforce a cap — the caller is expected
	 * to compare the returned count against its own quota and decide
	 * whether to reject. This lets the caller return a quota-specific error
	 * code or message instead of the generic 429 from the rate limiter.
	 *
	 * Fails closed (throws) when Redis is unavailable to prevent quota bypass.
	 */
	async incrementDailyCount(baseKey: string): Promise<number> {
		const today = new Date().toISOString().slice(0, 10);
		const redisKey = CacheKeys.rateLimit(`${baseKey}:${today}`);
		try {
			const current = await this.redis.incr(redisKey);
			if (current === 1) {
				// 48h covers the longest possible day boundary in any timezone.
				await this.redis.expire(redisKey, 60 * 60 * 48);
			}
			return current;
		} catch (error) {
			logger.error('Rate limiter Redis unavailable during daily count increment', {
				key: baseKey,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new Error('Rate limit service unavailable');
		}
	}

	/**
	 * Release a reserved daily counter slot. Fails closed when Redis is unavailable.
	 */
	async releaseDailyCount(baseKey: string): Promise<void> {
		const today = new Date().toISOString().slice(0, 10);
		const redisKey = CacheKeys.rateLimit(`${baseKey}:${today}`);
		try {
			const current = await this.redis.decr(redisKey);
			if (current <= 0) {
				await this.redis.del(redisKey);
			}
		} catch (error) {
			logger.error('Rate limiter Redis unavailable during daily count release', {
				key: baseKey,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new Error('Rate limit service unavailable');
		}
	}
}

export const RATE_LIMITS = {
	get auth() {
		const maxRequests = process.env.NODE_ENV === 'test' ? 100 : getEnv().RATE_LIMIT_AUTH_MAX;
		return { windowMs: 60_000, maxRequests };
	},
	get feedCreate() {
		return { windowMs: 60_000, maxRequests: getEnv().RATE_LIMIT_FEED_CREATE_MAX };
	},
	get feedExport() {
		return { windowMs: 60_000, maxRequests: 30 };
	},
	get feedImport() {
		return { windowMs: 60_000, maxRequests: 20 };
	},
	get feedSync() {
		return { windowMs: 60_000, maxRequests: 60 };
	},
	get articleEnrich() {
		return { windowMs: 60_000, maxRequests: 120 };
	},
	get search() {
		return { windowMs: 60_000, maxRequests: getEnv().RATE_LIMIT_SEARCH_MAX };
	},
	// Read-heavy endpoints - higher limits
	get articlesRead() {
		return { windowMs: 60_000, maxRequests: 100 };
	},
	get articlesMutate() {
		return { windowMs: 60_000, maxRequests: 30 };
	},
	get categoriesRead() {
		return { windowMs: 60_000, maxRequests: 100 };
	},
	get categoriesMutate() {
		return { windowMs: 60_000, maxRequests: 30 };
	},
	get preferencesRead() {
		return { windowMs: 60_000, maxRequests: 100 };
	},
	get preferencesMutate() {
		return { windowMs: 60_000, maxRequests: 30 };
	},
	get statsRead() {
		return { windowMs: 60_000, maxRequests: 100 };
	},
	get feedsRead() {
		return { windowMs: 60_000, maxRequests: 100 };
	},
	get feedsMutate() {
		return { windowMs: 60_000, maxRequests: 30 };
	},
	get admin() {
		return { windowMs: 60_000, maxRequests: 10 };
	},
} as const;

// Re-export enforceRateLimit for convenience (originally in rate-limit.ts)
export { enforceRateLimit } from './rate-limit.js';
