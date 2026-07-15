import Redis from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CacheKeys, normalizeRedisUrl } from '../../src/db/redis.js';
import {
	acquireManualSyncAllFeedsLock,
	releaseManualSyncAllFeedsState,
	renewManualSyncAllFeedsLock,
} from '../../src/services/feed-sync-status.js';
import { acquireOwnedRedisLock } from '../../src/services/redis-owned-lock.js';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error('Integration tests require REDIS_URL');

const redis = new Redis(normalizeRedisUrl(redisUrl), { maxRetriesPerRequest: 3 });
const userId = 'lock-ownership-integration-user';
const lockKey = CacheKeys.feedSyncAllLock(userId);
const queuedKey = CacheKeys.feedSyncAllQueued(userId);
const requestKey = CacheKeys.feedSyncAllRequest(userId);
const reusableLockKey = 'integration:owned-lock';

beforeEach(async () => {
	await redis.del(lockKey, queuedKey, requestKey, reusableLockKey);
});

afterAll(async () => {
	await redis.del(lockKey, queuedKey, requestKey, reusableLockKey);
	await redis.quit();
});

describe('manual feed sync Redis lock ownership', () => {
	it('uses the reusable lock Lua scripts to protect a replacement owner', async () => {
		const releaseA = await acquireOwnedRedisLock({
			redis: redis as never,
			key: reusableLockKey,
			ttlSeconds: 60,
			heartbeatIntervalMs: 60_000,
		});
		const ownerA = await redis.get(reusableLockKey);
		await redis.del(reusableLockKey);
		const releaseB = await acquireOwnedRedisLock({
			redis: redis as never,
			key: reusableLockKey,
			ttlSeconds: 60,
			heartbeatIntervalMs: 60_000,
		});
		const ownerB = await redis.get(reusableLockKey);

		expect(ownerA).toEqual(expect.any(String));
		expect(ownerB).toEqual(expect.any(String));
		expect(ownerB).not.toBe(ownerA);
		await releaseA?.();
		expect(await redis.get(reusableLockKey)).toBe(ownerB);
		await releaseB?.();
		expect(await redis.get(reusableLockKey)).toBeNull();
	});

	it('prevents an expired owner from renewing or releasing a replacement owner lock', async () => {
		const ownerA = await acquireManualSyncAllFeedsLock(redis, userId);
		expect(ownerA).toEqual(expect.any(String));

		await redis.del(lockKey);
		const ownerB = await acquireManualSyncAllFeedsLock(redis, userId);
		expect(ownerB).toEqual(expect.any(String));
		expect(ownerB).not.toBe(ownerA);
		await redis.set(queuedKey, 'queued');
		await redis.set(requestKey, '{}');

		expect(await renewManualSyncAllFeedsLock(redis, userId, ownerA!)).toBe(false);
		expect(Number(await releaseManualSyncAllFeedsState(redis, userId, ownerA!))).toBe(0);

		const activeLock = JSON.parse((await redis.get(lockKey))!) as { ownerToken: string };
		expect(activeLock.ownerToken).toBe(ownerB);
		expect(await redis.exists(queuedKey, requestKey)).toBe(2);

		expect(Number(await releaseManualSyncAllFeedsState(redis, userId, ownerB!))).toBe(1);
		expect(await redis.exists(lockKey, queuedKey, requestKey)).toBe(0);
	});

	it('atomically replaces only the stale lock value that was inspected', async () => {
		const staleValue = JSON.stringify({
			startedAt: Date.now() - 180_000,
			heartbeatAt: Date.now() - 180_000,
			ownerToken: 'stale-owner',
		});
		await redis.set(lockKey, staleValue, 'EX', 1_800);

		const newOwner = await acquireManualSyncAllFeedsLock(redis, userId);

		expect(newOwner).toEqual(expect.any(String));
		const activeLock = JSON.parse((await redis.get(lockKey))!) as { ownerToken: string };
		expect(activeLock.ownerToken).toBe(newOwner);
	});
});
