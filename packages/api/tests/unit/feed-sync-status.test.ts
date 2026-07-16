import { describe, expect, it, vi } from 'vitest';
import { CacheKeys } from '../../src/db/redis.js';
import { getManualSyncAllFeedsStatus } from '../../src/services/feed-sync-status.js';

describe('getManualSyncAllFeedsStatus ownership races', () => {
	it('reports a fresh replacement owner as running when stale cleanup loses its compare-and-delete', async () => {
		const userId = 'user-race';
		const stale = JSON.stringify({
			startedAt: Date.now() - 180_000,
			heartbeatAt: Date.now() - 180_000,
			ownerToken: 'owner-a',
		});
		const replacementStartedAt = Date.now();
		const replacement = JSON.stringify({
			startedAt: replacementStartedAt,
			heartbeatAt: replacementStartedAt,
			ownerToken: 'owner-b',
		});
		let lockReads = 0;
		const redis = {
			get: vi.fn(async (key: string) => {
				if (key === CacheKeys.feedSyncAllLock(userId)) {
					lockReads++;
					return lockReads === 1 ? stale : replacement;
				}
				return null;
			}),
			eval: vi.fn(async () => 0),
		};

		const status = await getManualSyncAllFeedsStatus(redis as never, userId);

		expect(redis.eval).toHaveBeenCalledWith(
			expect.stringContaining('ARGV[1]'),
			1,
			CacheKeys.feedSyncAllLock(userId),
			stale,
		);
		expect(status).toMatchObject({
			running: true,
			active: true,
			stale: false,
			startedAt: new Date(replacementStartedAt).toISOString(),
		});
	});
});
