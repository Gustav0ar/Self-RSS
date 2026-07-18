import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedRefreshStatusBanner } from '../../src/components/articles/feed-refresh-status-banner';
import { REFRESH_INTERVALS } from '../../src/lib/constants';
import type { AllFeedsRefreshActivity, FeedSyncAllStatus } from '../../src/lib/feed-sync-status';

const idleActivity: AllFeedsRefreshActivity = {
	phase: 'idle',
	isActive: false,
	isBlocking: false,
	isTakingLonger: false,
	shouldShowStatus: false,
	activeSinceMs: null,
	elapsedMs: null,
};

function terminalStatus(heartbeatAt: string): FeedSyncAllStatus {
	return {
		requestId: 'request-1',
		status: 'completed',
		queued: false,
		running: false,
		active: false,
		heartbeatAt,
		totalFeeds: 1,
		completedFeeds: 1,
		newArticles: 2,
		scope: {},
	};
}

describe('FeedRefreshStatusBanner terminal status', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('does not show a terminal result whose server heartbeat is stale', () => {
		const now = Date.parse('2026-07-18T12:00:00.000Z');
		vi.useFakeTimers();
		vi.setSystemTime(now);

		render(
			<FeedRefreshStatusBanner
				allFeedsRefreshActivity={idleActivity}
				allFeedsSyncStatus={terminalStatus(
					new Date(now - REFRESH_INTERVALS.SYNC_STATUS_TERMINAL_VISIBLE_MS - 1).toISOString(),
				)}
				isRefreshingCurrentSelection={false}
			/>,
		);

		expect(screen.queryByText('Refresh complete')).toBeNull();
	});

	it('expires a fresh terminal result without requiring another server response', () => {
		const now = Date.parse('2026-07-18T12:00:00.000Z');
		vi.useFakeTimers();
		vi.setSystemTime(now);

		render(
			<FeedRefreshStatusBanner
				allFeedsRefreshActivity={idleActivity}
				allFeedsSyncStatus={terminalStatus(new Date(now).toISOString())}
				isRefreshingCurrentSelection={false}
			/>,
		);

		expect(screen.getByText('Refresh complete')).toBeTruthy();
		act(() => {
			vi.advanceTimersByTime(REFRESH_INTERVALS.SYNC_STATUS_TERMINAL_VISIBLE_MS + 25);
		});
		expect(screen.queryByText('Refresh complete')).toBeNull();
	});
});
