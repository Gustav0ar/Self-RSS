import { isIP } from 'node:net';
import type { Context } from 'hono';
import { getEnv } from '../config/index.js';
import { AppError } from '../middleware/errors.js';
import type { RateLimitConfig, RateLimiter } from './rate-limiter.js';

function getRateLimitIdentity(c: Context): string {
	const userId = c.get('userId') as string | undefined;
	if (userId) return userId;

	if (!getEnv().TRUST_PROXY) {
		return 'anonymous';
	}

	const forwardedFor = getForwardedIdentity(
		c.req.header('x-forwarded-for'),
		getEnv().TRUSTED_PROXY_HOPS,
	);
	if (forwardedFor) return forwardedFor;

	const realIp = c.req.header('x-real-ip')?.trim();
	if (realIp && isIP(realIp)) return realIp;

	return 'anonymous';
}

function getForwardedIdentity(header: string | undefined, trustedProxyHops: number) {
	const addresses =
		header
			?.split(',')
			.map((part) => part.trim())
			.filter((part) => isIP(part)) ?? [];
	if (addresses.length === 0) return null;

	const index = addresses.length - trustedProxyHops - 1;
	return index >= 0 ? addresses[index] : null;
}

export async function enforceRateLimit(
	c: Context,
	rateLimiter: RateLimiter,
	namespace: string,
	config: RateLimitConfig,
) {
	const key = `${namespace}:${getRateLimitIdentity(c)}`;
	const result = await rateLimiter.check(key, config);
	c.header('X-RateLimit-Remaining', String(result.remaining));

	if (!result.allowed) {
		throw AppError.tooManyRequests();
	}
}
