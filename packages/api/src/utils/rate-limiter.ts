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
	get search() {
		return { windowMs: 60_000, maxRequests: getEnv().RATE_LIMIT_SEARCH_MAX };
	},
} as const;
