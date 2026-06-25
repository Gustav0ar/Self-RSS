import { describe, expect, it } from 'vitest';
import {
	buildAllFeedsRefreshActivity,
	type FeedSyncAllStatus,
	hasFreshInactiveFeedSyncStatus,
} from '../../src/lib/feed-sync-status';

const inactiveStatus: FeedSyncAllStatus = {
	queued: false,
	running: false,
	active: false,
	stale: false,
	queuedAt: null,
	startedAt: null,
	heartbeatAt: null,
};

describe('feed sync status reconciliation', () => {
	it('treats a fresh inactive server status as authoritative over stale local refresh state', () => {
		const localQueuedAt = Date.parse('2026-06-21T12:00:00.000Z');
		const statusUpdatedAt = localQueuedAt + 1;

		expect(
			hasFreshInactiveFeedSyncStatus({
				status: inactiveStatus,
				statusUpdatedAt,
				localQueuedAt,
				isMutationPending: false,
			}),
		).toBe(true);

		expect(
			buildAllFeedsRefreshActivity({
				status: inactiveStatus,
				statusUpdatedAt,
				localQueuedAt,
				isMutationPending: false,
				isLocalRefreshSelected: true,
				now: localQueuedAt + 90_000,
				foregroundTimeoutMs: 75_000,
			}),
		).toMatchObject({
			phase: 'idle',
			isActive: false,
			isBlocking: false,
			isTakingLonger: false,
			shouldShowStatus: false,
		});
	});

	it('keeps local refresh state active while waiting for a post-refresh status response', () => {
		const localQueuedAt = Date.parse('2026-06-21T12:00:00.000Z');
		const statusUpdatedAt = localQueuedAt - 5_000;

		expect(
			hasFreshInactiveFeedSyncStatus({
				status: inactiveStatus,
				statusUpdatedAt,
				localQueuedAt,
				isMutationPending: false,
			}),
		).toBe(false);

		expect(
			buildAllFeedsRefreshActivity({
				status: inactiveStatus,
				statusUpdatedAt,
				localQueuedAt,
				isMutationPending: false,
				isLocalRefreshSelected: true,
				now: localQueuedAt + 1_000,
				foregroundTimeoutMs: 75_000,
			}),
		).toMatchObject({
			phase: 'starting',
			isActive: true,
			isBlocking: true,
			isTakingLonger: false,
			shouldShowStatus: true,
		});
	});

	it('ignores a stale local all-feeds selection when the server status is inactive', () => {
		const statusUpdatedAt = Date.parse('2026-06-21T12:00:00.000Z');

		expect(
			buildAllFeedsRefreshActivity({
				status: inactiveStatus,
				statusUpdatedAt,
				localQueuedAt: 0,
				isMutationPending: false,
				isLocalRefreshSelected: true,
				now: statusUpdatedAt + 90_000,
				foregroundTimeoutMs: 75_000,
			}),
		).toMatchObject({
			phase: 'idle',
			isActive: false,
			isBlocking: false,
			isTakingLonger: false,
			shouldShowStatus: false,
		});
	});
});
