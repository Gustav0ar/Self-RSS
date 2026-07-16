import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireOwnedRedisLock } from '../../src/services/redis-owned-lock.js';

afterEach(() => {
	vi.useRealTimers();
});

describe('acquireOwnedRedisLock', () => {
	it('returns null without starting a heartbeat when another owner holds the lock', async () => {
		const redis = {
			set: vi.fn(async () => null),
			eval: vi.fn(async () => 0),
		};

		const release = await acquireOwnedRedisLock({
			redis,
			key: 'lock',
			ttlSeconds: 30,
		});

		expect(release).toBeNull();
		expect(redis.eval).not.toHaveBeenCalled();
	});

	it('renews and releases with the exact token that acquired the lock', async () => {
		vi.useFakeTimers();
		const redis = {
			set: vi.fn(async (..._args: unknown[]) => 'OK'),
			eval: vi.fn(async () => 1),
		};

		const release = await acquireOwnedRedisLock({
			redis,
			key: 'lock',
			ttlSeconds: 30,
			heartbeatIntervalMs: 10,
		});
		const ownerToken = redis.set.mock.calls[0]?.[1];
		await vi.advanceTimersByTimeAsync(10);

		expect(redis.eval).toHaveBeenCalledWith(
			expect.stringContaining('EXPIRE'),
			1,
			'lock',
			ownerToken,
			'30',
		);
		await release?.();
		expect(redis.eval).toHaveBeenLastCalledWith(
			expect.stringContaining('DEL'),
			1,
			'lock',
			ownerToken,
			'0',
		);
	});

	it('keeps the owned key for the requested cooldown instead of deleting it', async () => {
		const redis = {
			set: vi.fn(async (..._args: unknown[]) => 'OK'),
			eval: vi.fn(async () => 1),
		};
		const release = await acquireOwnedRedisLock({
			redis,
			key: 'feed-fetch-lock',
			ttlSeconds: 60,
			releaseCooldownSeconds: 60,
		});
		const ownerToken = redis.set.mock.calls[0]?.[1];

		await release?.();
		expect(redis.eval).toHaveBeenLastCalledWith(
			expect.stringContaining('EXPIRE'),
			1,
			'feed-fetch-lock',
			ownerToken,
			'60',
		);
	});

	it('reports renewal and release failures without leaking them to callers', async () => {
		vi.useFakeTimers();
		const onRenewError = vi.fn();
		const onReleaseError = vi.fn();
		const renewalError = new Error('renew failed');
		const releaseError = new Error('release failed');
		const redis = {
			set: vi.fn(async () => 'OK'),
			eval: vi.fn(async (...args: unknown[]) => {
				const script = args[0];
				if (typeof script !== 'string') throw new Error('Expected a Redis script');
				if (script.includes('DEL')) throw releaseError;
				throw renewalError;
			}),
		};

		const release = await acquireOwnedRedisLock({
			redis,
			key: 'lock',
			ttlSeconds: 30,
			heartbeatIntervalMs: 10,
			onRenewError,
			onReleaseError,
		});
		await vi.advanceTimersByTimeAsync(10);
		expect(onRenewError).toHaveBeenCalledWith(renewalError);

		await expect(release?.()).resolves.toBeUndefined();
		expect(onReleaseError).toHaveBeenCalledWith(releaseError);
	});
});
