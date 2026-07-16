import { describe, expect, it, vi } from 'vitest';
import {
	popDueDelayedFeedSync,
	processDueDelayedFeedSync,
	scheduleDelayedFeedSync,
} from '../../src/services/feed-sync-delayed.js';

describe('delayed feed sync queue', () => {
	it('stores a feed once with its due timestamp', async () => {
		const redis = { zadd: vi.fn(async () => 1) };
		await scheduleDelayedFeedSync(redis as never, { feedId: 'feed-1', userId: 'user-1' }, 123_456);

		expect(redis.zadd).toHaveBeenCalledWith(
			'feed:sync:delayed',
			123_456,
			JSON.stringify({ feedId: 'feed-1', userId: 'user-1' }),
		);
	});

	it('atomically claims only a due feed', async () => {
		const redis = {
			eval: vi.fn(async () => JSON.stringify({ feedId: 'feed-1', userId: 'user-1' })),
		};
		const request = await popDueDelayedFeedSync(redis as never, 123_456);

		expect(redis.eval).toHaveBeenCalledWith(
			expect.stringContaining('ZRANGEBYSCORE'),
			1,
			'feed:sync:delayed',
			123_456,
			183_456,
		);
		expect(request).toEqual({ feedId: 'feed-1', userId: 'user-1' });
	});

	it('removes a failed recovery job so normal source backoff takes over', async () => {
		const request = { feedId: 'feed-1', userId: 'user-1' };
		const redis = {
			eval: vi.fn(async () => JSON.stringify(request)),
			zrem: vi.fn(async () => 1),
		};
		const sourceError = new Error('publisher unavailable');

		await expect(
			processDueDelayedFeedSync(redis as never, async () => {
				throw sourceError;
			}),
		).rejects.toBe(sourceError);
		expect(redis.zrem).toHaveBeenCalledWith('feed:sync:delayed', JSON.stringify(request));
	});
});
