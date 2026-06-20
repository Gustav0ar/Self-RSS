import type Redis from 'ioredis';
import { getEnv } from '../config/index.js';
import { CacheKeys } from '../db/redis.js';

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
		const current = await this.redis.incr(redisKey);
		if (current === 1) {
			await this.redis.pexpire(redisKey, config.windowMs);
		}
		const remaining = Math.max(0, config.maxRequests - current);
		return { allowed: current <= config.maxRequests, remaining };
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
	 */
	async incrementDailyCount(baseKey: string): Promise<number> {
		const today = new Date().toISOString().slice(0, 10);
		const redisKey = CacheKeys.rateLimit(`${baseKey}:${today}`);
		const current = await this.redis.incr(redisKey);
		if (current === 1) {
			// 48h covers the longest possible day boundary in any timezone.
			await this.redis.expire(redisKey, 60 * 60 * 48);
		}
		return current;
	}

	async releaseDailyCount(baseKey: string): Promise<void> {
		const today = new Date().toISOString().slice(0, 10);
		const redisKey = CacheKeys.rateLimit(`${baseKey}:${today}`);
		const current = await this.redis.decr(redisKey);
		if (current <= 0) {
			await this.redis.del(redisKey);
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
