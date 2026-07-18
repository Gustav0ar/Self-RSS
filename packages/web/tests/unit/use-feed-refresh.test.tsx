import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFeedRefresh } from '../../src/hooks/use-feed-refresh';
import { clearTokens, setTokens } from '../../src/lib/api';
import { REFRESH_INTERVALS } from '../../src/lib/constants';
import {
	type FeedSyncAllStatus,
	readLastFeedRefreshRequestId,
} from '../../src/lib/feed-sync-status';
import { AppStateProvider } from '../../src/providers/app-state';

const invalidateReaderQueriesMock = vi.fn();
const refetchAllFeedsSyncStatusMock = vi.fn();
const syncAllFeedsMutateAsyncMock = vi.fn();
let feeds: Array<{
	id: string;
	lastSyncedAt: string | null;
	syncStatus: 'idle' | 'syncing' | 'error';
	unreadCount: number;
}> = [];

let allFeedsSyncStatus: FeedSyncAllStatus | undefined;
let allFeedsSyncStatusUpdatedAt = 0;
let nowMs = new Date('2026-06-21T12:00:00.000Z').getTime();
let requestedStatusRequestIds: Array<string | null> = [];

vi.mock('../../src/hooks/queries', () => ({
	invalidateReaderQueries: (...args: unknown[]) => invalidateReaderQueriesMock(...args),
	useFeeds: () => ({ data: feeds }),
	useSyncAllFeeds: () => ({
		isPending: false,
		mutateAsync: syncAllFeedsMutateAsyncMock,
	}),
	useSyncAllFeedsStatus: (requestId?: string | null) => {
		requestedStatusRequestIds.push(requestId ?? null);
		return {
			data:
				requestId && allFeedsSyncStatus?.requestId !== requestId ? undefined : allFeedsSyncStatus,
			dataUpdatedAt: allFeedsSyncStatusUpdatedAt,
			refetch: refetchAllFeedsSyncStatusMock,
		};
	},
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
		requestedStatusRequestIds = [];
		feeds = [];
		syncAllFeedsMutateAsyncMock.mockResolvedValue({ data: { accepted: true } });
		refetchAllFeedsSyncStatusMock.mockResolvedValue({
			data: { queued: false, running: false, active: false },
		});
	});

	afterEach(() => {
		clearTokens();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('releases a completed tracked request and resumes latest-status tracking', async () => {
		const storage = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
			removeItem: (key: string) => storage.delete(key),
		});
		const payload = globalThis
			.btoa(JSON.stringify({ sub: 'account-a' }))
			.replaceAll('+', '-')
			.replaceAll('/', '_')
			.replace(/=+$/, '');
		setTokens(`header.${payload}.signature`);
		syncAllFeedsMutateAsyncMock.mockResolvedValue({
			data: { accepted: true, requestId: 'request-a' },
		});
		const queryClient = makeQueryClient();
		const { result, rerender } = renderHook(() => useFeedRefresh(), {
			wrapper: wrapperFor(queryClient),
		});

		await act(async () => {
			await result.current.refreshFeed(undefined, { force: true });
		});
		await waitFor(() => {
			expect(requestedStatusRequestIds.at(-1)).toBe('request-a');
		});
		expect(readLastFeedRefreshRequestId('account-a')).toBe('request-a');

		allFeedsSyncStatus = {
			queued: false,
			running: false,
			active: false,
			requestId: 'request-a',
			status: 'completed',
			heartbeatAt: new Date(nowMs).toISOString(),
		};
		allFeedsSyncStatusUpdatedAt = nowMs + 1;
		rerender();

		await waitFor(() => {
			expect(requestedStatusRequestIds.at(-1)).toBeNull();
			expect(readLastFeedRefreshRequestId('account-a')).toBeNull();
		});
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
		expect(refetchAllFeedsSyncStatusMock).not.toHaveBeenCalled();

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

	it('restores the loading animation when an active refresh is discovered from the backend', () => {
		allFeedsSyncStatus = {
			queued: true,
			running: false,
			active: true,
			queuedAt: new Date(nowMs).toISOString(),
		};
		allFeedsSyncStatusUpdatedAt = nowMs + 1;
		const queryClient = makeQueryClient();
		const { result } = renderHook(() => useFeedRefresh(), {
			wrapper: wrapperFor(queryClient),
		});

		expect(result.current.isRefreshingAllFeeds).toBe(true);
		expect(result.current.allFeedsRefreshActivity).toMatchObject({
			phase: 'queued',
			shouldShowStatus: true,
		});
	});

	it('prioritizes the selected category and lets SSE completion reconcile readers', async () => {
		const queryClient = makeQueryClient();
		const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
		allFeedsSyncStatus = {
			queued: false,
			running: false,
			active: false,
			articleRevision: 12,
		};
		const { result, rerender } = renderHook(() => useFeedRefresh(), {
			wrapper: wrapperFor(queryClient),
		});

		await act(async () => {
			await result.current.refreshFeed(undefined, { force: true, categoryId: 'category-1' });
		});
		expect(syncAllFeedsMutateAsyncMock).toHaveBeenCalledWith({ categoryId: 'category-1' });

		allFeedsSyncStatus = { queued: false, running: true, active: true, articleRevision: 13 };
		allFeedsSyncStatusUpdatedAt = nowMs + 1;
		rerender();

		expect(invalidateSpy).not.toHaveBeenCalled();

		allFeedsSyncStatus = { queued: false, running: false, active: false, articleRevision: 14 };
		allFeedsSyncStatusUpdatedAt = nowMs + 2;
		rerender();
		await waitFor(() => {
			expect(invalidateReaderQueriesMock).toHaveBeenCalledWith(queryClient);
		});
	});

	it('does not retry a failed publisher merely because the feed was selected', async () => {
		feeds = [
			{
				id: 'failed-feed',
				// A first sync that was rejected has no successful timestamp. This
				// exact state previously retriggered forever after every completion.
				lastSyncedAt: null,
				syncStatus: 'error',
				unreadCount: 0,
			},
		];
		const queryClient = makeQueryClient();
		const { result } = renderHook(() => useFeedRefresh(), {
			wrapper: wrapperFor(queryClient),
		});

		let accepted = true;
		await act(async () => {
			accepted = await result.current.refreshFeed('failed-feed');
		});

		expect(accepted).toBe(false);
		expect(syncAllFeedsMutateAsyncMock).not.toHaveBeenCalled();
	});

	it('automatically queues a never-synced healthy feed so new subscriptions load promptly', async () => {
		feeds = [
			{
				id: 'new-feed',
				lastSyncedAt: null,
				syncStatus: 'idle',
				unreadCount: 0,
			},
		];
		const queryClient = makeQueryClient();
		const { result } = renderHook(() => useFeedRefresh(), {
			wrapper: wrapperFor(queryClient),
		});

		await act(async () => {
			await result.current.refreshFeed('new-feed');
		});

		expect(syncAllFeedsMutateAsyncMock).toHaveBeenCalledOnce();
		expect(syncAllFeedsMutateAsyncMock).toHaveBeenCalledWith({ feedId: 'new-feed' });
	});

	it('queues an explicit single-feed refresh instead of calling the synchronous endpoint', async () => {
		feeds = [
			{
				id: 'failed-feed',
				lastSyncedAt: '2026-06-20T12:00:00.000Z',
				syncStatus: 'error',
				unreadCount: 0,
			},
		];
		const queryClient = makeQueryClient();
		const { result } = renderHook(() => useFeedRefresh(), {
			wrapper: wrapperFor(queryClient),
		});

		await act(async () => {
			await result.current.refreshFeed('failed-feed', { force: true });
		});

		expect(syncAllFeedsMutateAsyncMock).toHaveBeenCalledWith({ feedId: 'failed-feed' });
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

	it('keeps loading when the queue response fails after the backend accepted the refresh', async () => {
		syncAllFeedsMutateAsyncMock.mockRejectedValue(new Error('Response interrupted'));
		refetchAllFeedsSyncStatusMock.mockResolvedValue({
			data: { queued: true, running: false, active: true },
		});
		const queryClient = makeQueryClient();
		const { result } = renderHook(() => useFeedRefresh(), {
			wrapper: wrapperFor(queryClient),
		});

		let accepted = false;
		await act(async () => {
			accepted = await result.current.refreshFeed(undefined, { force: true });
		});

		expect(accepted).toBe(true);
		expect(result.current.isRefreshingAllFeeds).toBe(true);
		expect(result.current.feedSyncError).toBeNull();
	});
});
