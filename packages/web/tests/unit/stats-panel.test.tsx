import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatsPanel } from '../../src/components/stats/stats-panel';

vi.mock('../../src/hooks/queries', () => ({
	useStats: () => ({
		isLoading: false,
		data: {
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
		},
	}),
}));

describe('StatsPanel', () => {
	it('renders sync health and an accessible activity chart', () => {
		render(<StatsPanel />);

		expect(screen.getByText('1 recent sync issues')).toBeTruthy();
		expect(screen.getByText('12 total actions')).toBeTruthy();
		expect(screen.getByRole('img', { name: 'Daily activity chart' })).toBeTruthy();
		expect(screen.getByText('2026-01-02')).toBeTruthy();
	});
});
