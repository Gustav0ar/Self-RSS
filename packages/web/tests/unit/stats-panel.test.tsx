import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatsPanel } from '../../src/components/stats/stats-panel';

const { refetchStats, statsData, statsResult } = vi.hoisted(() => {
	const data = {
		totalUnread: 4,
		totalRead: 12,
		totalFeeds: 3,
		totalCategories: 2,
		recentSyncRuns: [
			{
				id: 'sync-1',
				feedId: 'feed-1',
				startedAt: '2026-01-01T00:00:00.000Z',
				finishedAt: '2026-01-01T00:00:01.000Z',
				status: 'failed',
				httpStatus: 500,
				itemCount: 0,
				errorMessage: 'upstream failed',
			},
		],
		dailyMetrics: [
			{
				userId: 'user-1',
				date: '2026-01-01',
				articlesReadCount: 2,
				feedsSyncedCount: 1,
				searchCount: 1,
			},
			{
				userId: 'user-1',
				date: '2026-01-02',
				articlesReadCount: 4,
				feedsSyncedCount: 2,
				searchCount: 2,
			},
		],
	};

	return {
		refetchStats: vi.fn(),
		statsData: data,
		statsResult: {
			current: {
				data: data as typeof data | undefined,
				error: null as Error | null,
				isError: false,
				isFetching: false,
				isLoading: false,
				refetch: vi.fn(),
			},
		},
	};
});

vi.mock('../../src/hooks/queries', () => ({
	useStats: () => statsResult.current,
}));

describe('StatsPanel', () => {
	beforeEach(() => {
		refetchStats.mockReset();
		statsResult.current = {
			data: statsData,
			error: null,
			isError: false,
			isFetching: false,
			isLoading: false,
			refetch: refetchStats,
		};
	});

	it('renders sync health and an accessible activity chart', () => {
		render(<StatsPanel />);

		expect(screen.getByText('1 recent sync issues')).toBeTruthy();
		expect(screen.getByText('12 total actions')).toBeTruthy();
		expect(screen.getByRole('img', { name: 'Daily activity chart' })).toBeTruthy();
		expect(screen.getByText('2026-01-02')).toBeTruthy();
	});

	it('shows an actionable failure instead of loading forever when no stats are available', () => {
		statsResult.current = {
			...statsResult.current,
			data: undefined,
			error: new Error('request failed'),
			isError: true,
		};

		render(<StatsPanel />);

		expect(screen.getByRole('alert')).toBeTruthy();
		expect(screen.getByText('Could not load stats')).toBeTruthy();
		expect(screen.queryByText('Loading stats...')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		expect(refetchStats).toHaveBeenCalledTimes(1);
	});

	it('keeps stale stats visible when a background refresh fails', () => {
		statsResult.current = {
			...statsResult.current,
			error: new Error('refresh failed'),
			isError: true,
		};

		render(<StatsPanel />);

		expect(screen.getByText('Stats could not be refreshed')).toBeTruthy();
		expect(screen.getByText('12 total actions')).toBeTruthy();
	});
});
