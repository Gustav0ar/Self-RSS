import type Redis from 'ioredis';
import { CacheKeys } from '../db/redis.js';
import { FEED_FETCH_COOLDOWN_SECONDS, feedFetchLockKey } from './feed-fetch-guard.js';

export interface DelayedFeedSync {
	feedId: string;
	userId: string;
}

const POP_DUE_DELAYED_FEED_SYNC = `
local items = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", ARGV[1], "LIMIT", 0, 1)
if #items == 0 then
	return nil
end
redis.call("ZADD", KEYS[1], "XX", ARGV[2], items[1])
return items[1]
`;

const DELAYED_SYNC_CLAIM_SECONDS = 60;

export async function scheduleDelayedFeedSync(
	redis: Redis,
	request: DelayedFeedSync,
	dueAt: number,
) {
	await redis.zadd(CacheKeys.delayedFeedSyncs(), dueAt, JSON.stringify(request));
}

export async function deferFeedSyncUntilCooldown(
	redis: Redis,
	feedUrl: string,
	request: DelayedFeedSync,
) {
	const remainingTtl = await redis.ttl(feedFetchLockKey(feedUrl));
	const delaySeconds = remainingTtl > 0 ? remainingTtl : FEED_FETCH_COOLDOWN_SECONDS;
	await scheduleDelayedFeedSync(redis, request, Date.now() + (delaySeconds + 1) * 1000);
}

export async function popDueDelayedFeedSync(
	redis: Redis,
	now = Date.now(),
): Promise<DelayedFeedSync | null> {
	const value = await redis.eval(
		POP_DUE_DELAYED_FEED_SYNC,
		1,
		CacheKeys.delayedFeedSyncs(),
		now,
		now + DELAYED_SYNC_CLAIM_SECONDS * 1000,
	);
	if (typeof value !== 'string') return null;
	try {
		const parsed = JSON.parse(value) as Partial<DelayedFeedSync>;
		if (typeof parsed.feedId !== 'string' || typeof parsed.userId !== 'string') return null;
		return { feedId: parsed.feedId, userId: parsed.userId };
	} catch {
		return null;
	}
}

export async function removeDelayedFeedSync(redis: Redis, request: DelayedFeedSync) {
	await redis.zrem(CacheKeys.delayedFeedSyncs(), JSON.stringify(request));
}

export async function processDueDelayedFeedSync<T extends { skipped?: true }>(
	redis: Redis,
	syncFeed: (request: DelayedFeedSync) => Promise<T | null>,
) {
	const request = await popDueDelayedFeedSync(redis);
	if (!request) return null;
	try {
		const result = await syncFeed(request);
		if (!result?.skipped) await removeDelayedFeedSync(redis, request);
		return { ...request, result };
	} catch (error) {
		// syncFeed persists publisher-specific backoff. Remove this short-lived
		// recovery job so a failing source is not retried every minute forever.
		await removeDelayedFeedSync(redis, request);
		throw error;
	}
}
