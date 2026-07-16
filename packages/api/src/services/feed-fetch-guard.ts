import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import { CacheKeys } from '../db/redis.js';
import { acquireOwnedRedisLock } from './redis-owned-lock.js';

export const FEED_FETCH_COOLDOWN_SECONDS = 60;

export interface PrefetchedFeed {
	text: string;
	etag: string | null;
	lastModified: string | null;
}

export function feedUrlFingerprint(feedUrl: string) {
	return createHash('sha256').update(feedUrl).digest('hex');
}

export function feedFetchLockKey(feedUrl: string) {
	return CacheKeys.feedFetchLock(feedUrlFingerprint(feedUrl));
}

export function prefetchedFeedKey(feedUrl: string) {
	return CacheKeys.prefetchedFeed(feedUrlFingerprint(feedUrl));
}

export async function readPrefetchedFeed(redis: Redis, feedUrl: string) {
	if (typeof redis.get !== 'function') return null;
	const value = await redis.get(prefetchedFeedKey(feedUrl));
	if (!value) return null;
	try {
		const parsed = JSON.parse(value) as Partial<PrefetchedFeed>;
		if (typeof parsed.text !== 'string') return null;
		return {
			text: parsed.text,
			etag: typeof parsed.etag === 'string' ? parsed.etag : null,
			lastModified: typeof parsed.lastModified === 'string' ? parsed.lastModified : null,
		} satisfies PrefetchedFeed;
	} catch {
		return null;
	}
}

export async function cachePrefetchedFeed(redis: Redis, feedUrl: string, feed: PrefetchedFeed) {
	if (typeof redis.set !== 'function') return;
	await redis.set(
		prefetchedFeedKey(feedUrl),
		JSON.stringify(feed),
		'EX',
		FEED_FETCH_COOLDOWN_SECONDS,
	);
}

export async function consumePrefetchedFeed(redis: Redis, feedUrl: string, validatorTtl: number) {
	const feed = await readPrefetchedFeed(redis, feedUrl);
	if (!feed) return null;
	await Promise.all([
		redis.del(prefetchedFeedKey(feedUrl)),
		feed.etag
			? redis.set(CacheKeys.feedEtag(feedUrl), feed.etag, 'EX', validatorTtl)
			: Promise.resolve(null),
		feed.lastModified
			? redis.set(CacheKeys.feedLastModified(feedUrl), feed.lastModified, 'EX', validatorTtl)
			: Promise.resolve(null),
	]);
	return feed.text;
}

export async function acquireFeedFetchGuard(
	redis: Redis,
	feedUrl: string,
	callbacks: {
		onRenewError?: (error: unknown) => void;
		onReleaseError?: (error: unknown) => void;
	} = {},
) {
	return acquireOwnedRedisLock({
		redis: redis as unknown as {
			set?: (...args: unknown[]) => Promise<unknown>;
			eval?: (...args: unknown[]) => Promise<unknown>;
		},
		key: feedFetchLockKey(feedUrl),
		ttlSeconds: FEED_FETCH_COOLDOWN_SECONDS,
		releaseCooldownSeconds: FEED_FETCH_COOLDOWN_SECONDS,
		...callbacks,
	});
}

export async function acquireFeedSyncGuards(redis: Redis, feedId: string, feedUrl: string) {
	const feedSyncLock = await acquireOwnedRedisLock({
		redis: redis as never,
		key: CacheKeys.feedSyncLock(feedId),
		ttlSeconds: FEED_FETCH_COOLDOWN_SECONDS,
	});
	if (!feedSyncLock) return null;

	let feedFetchLock: (() => Promise<void>) | null;
	try {
		feedFetchLock = (await readPrefetchedFeed(redis, feedUrl))
			? async () => undefined
			: await acquireFeedFetchGuard(redis, feedUrl);
	} catch (error) {
		await feedSyncLock();
		throw error;
	}
	if (!feedFetchLock) {
		await feedSyncLock();
		return null;
	}

	return async () => {
		await feedFetchLock();
		await feedSyncLock();
	};
}
