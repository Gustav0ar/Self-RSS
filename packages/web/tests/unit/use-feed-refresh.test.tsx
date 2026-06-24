import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFeedRefresh } from '../../src/hooks/use-feed-refresh';
import { REFRESH_INTERVALS } from '../../src/lib/constants';
import { AppStateProvider } from '../../src/providers/app-state';

const invalidateReaderQueriesMock = vi.fn();
const refetchAllFeedsSyncStatusMock = vi.fn();
const syncAllFeedsMutateAsyncMock = vi.fn();
const syncFeedMutateAsyncMock = vi.fn();

let allFeedsSyncStatus:
	| {
			queued: boolean;
			running: boolean;
			active: boolean;
			stale?: boolean;
			queuedAt?: string | null;
			startedAt?: string | null;
			heartbeatAt?: string | null;
	  }
	| undefined;
let allFeedsSyncStatusUpdatedAt = 0;
let nowMs = new Date('2026-06-21T12:00:00.000Z').getTime();

vi.mock('../../src/hooks/queries', () => ({
	invalidateReaderQueries: (...args: unknown[]) => invalidateReaderQueriesMock(...args),
	useFeeds: () => ({ data: [] }),
	useSyncAllFeeds: () => ({
		isPending: false,
		mutateAsync: syncAllFeedsMutateAsyncMock,
	}),
	useSyncAllFeedsStatus: () => ({
		data: allFeedsSyncStatus,
		dataUpdatedAt: allFeedsSyncStatusUpdatedAt,
		refetch: refetchAllFeedsSyncStatusMock,
	}),
	useSyncFeed: () => ({
		mutateAsync: syncFeedMutateAsyncMock,
	}),
}));

function makeQueryClient() {
	return new QueryClient({
		defaultOptions: {
			mutations: { retry: false },
			queries: { retry: false },
		},
	});
}

function wrapperFor(queryClient: QueryClient) {
	return function Wrapper({ children }: { children: ReactNode }) {
		return (
			<QueryClientProvider client={queryClient}>
				<AppStateProvider>{children}</AppStateProvider>
			</QueryClientProvider>
		);
	};
}

describe('useFeedRefresh', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		nowMs = new Date('2026-06-21T12:00:00.000Z').getTime();
		vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
		allFeedsSyncStatus = { queued: false, running: false, active: false };
		allFeedsSyncStatusUpdatedAt = 0;
		syncAllFeedsMutateAsyncMock.mockResolvedValue({ data: { accepted: true } });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('releases all-feeds refresh state when server status settles inactive', async () => {
		const queryClient = makeQueryClient();
		const { result, rerender } = renderHook(() => useFeedRefresh(), {
			wrapper: wrapperFor(queryClient),
		});

		await act(async () => {
			await result.current.refreshFeed(undefined, { force: true });
		});

		expect(result.current.isRefreshingAllFeeds).toBe(true);
		expect(refetchAllFeedsSyncStatusMock).toHaveBeenCalledTimes(1);

		allFeedsSyncStatus = { queued: false, running: false, active: false };
		allFeedsSyncStatusUpdatedAt = nowMs + 1;
		rerender();

		await waitFor(() => {
			expect(result.current.isRefreshingAllFeeds).toBe(false);
		});
		expect(invalidateReaderQueriesMock).toHaveBeenCalledWith(queryClient);
	});

	it('keeps all-feeds refresh state while server status is still active', async () => {
		const queryClient = makeQueryClient();
		const { result, rerender } = renderHook(() => useFeedRefresh(), {
			wrapper: wrapperFor(queryClient),
		});

		await act(async () => {
			await result.current.refreshFeed(undefined, { force: true });
		});

		allFeedsSyncStatus = { queued: false, running: true, active: true };
		allFeedsSyncStatusUpdatedAt = nowMs + 1;
		rerender();

		expect(result.current.isRefreshingAllFeeds).toBe(true);
		expect(invalidateReaderQueriesMock).not.toHaveBeenCalled();
	});

	it('releases the foreground loader when server status stays active too long', async () => {
		const queryClient = makeQueryClient();
		const { result, rerender } = renderHook(() => useFeedRefresh(), {
			wrapper: wrapperFor(queryClient),
		});

		await act(async () => {
			await result.current.refreshFeed(undefined, { force: true });
		});

		allFeedsSyncStatus = {
			queued: false,
			running: true,
			active: true,
			startedAt: new Date(nowMs).toISOString(),
			heartbeatAt: new Date(nowMs + 30_000).toISOString(),
		};
		allFeedsSyncStatusUpdatedAt = nowMs + 30_000;
		rerender();

		expect(result.current.isRefreshingAllFeeds).toBe(true);

		nowMs += REFRESH_INTERVALS.SYNC_STATUS_FOREGROUND_TIMEOUT_MS + 1;
		rerender();

		await waitFor(() => {
			expect(result.current.isRefreshingAllFeeds).toBe(false);
		});
		expect(result.current.allFeedsRefreshActivity).toMatchObject({
			phase: 'background',
			isTakingLonger: true,
			shouldShowStatus: true,
		});
		expect(invalidateReaderQueriesMock).toHaveBeenCalledWith(queryClient);
	});

	it('clears local refresh state on queue request failure', async () => {
		syncAllFeedsMutateAsyncMock.mockRejectedValue(new Error('Worker unavailable'));
		const queryClient = makeQueryClient();
		const { result } = renderHook(() => useFeedRefresh(), {
			wrapper: wrapperFor(queryClient),
		});

		let accepted = true;
		await act(async () => {
			accepted = await result.current.refreshFeed(undefined, { force: true });
		});

		expect(accepted).toBe(false);
		expect(result.current.isRefreshingAllFeeds).toBe(false);
		expect(result.current.feedSyncError).toBe('Worker unavailable');
	});
});
