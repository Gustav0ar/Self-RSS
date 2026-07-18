import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyFeedRealtimeEvent } from '../../src/hooks/queries/feed-realtime-cache';

describe('feed realtime cache reconciliation', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('coalesces articles.new events and refreshes active feed activation metadata', async () => {
		vi.useFakeTimers();
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		let serverTitle = '127.0.0.1';
		const queryFn = vi.fn(async () => [{ id: 'feed-1', title: serverTitle }]);
		const observer = new QueryObserver(queryClient, {
			queryKey: ['feeds'],
			queryFn,
		});
		const unsubscribe = observer.subscribe(() => undefined);
		await queryClient.refetchQueries({ queryKey: ['feeds'], type: 'active' });
		expect(queryClient.getQueryData(['feeds'])).toEqual([{ id: 'feed-1', title: '127.0.0.1' }]);

		serverTitle = 'DevTools Digest';
		const event = {
			type: 'articles.new' as const,
			eventId: 'event-1',
			feedId: 'feed-1',
			articleIds: ['article-1'],
			count: 1,
			updatedAt: '2026-07-18T00:00:00.000Z',
		};
		applyFeedRealtimeEvent(queryClient, event);
		applyFeedRealtimeEvent(queryClient, { ...event, eventId: 'event-2' });
		await vi.advanceTimersByTimeAsync(250);

		expect(queryClient.getQueryData(['feeds'])).toEqual([
			{ id: 'feed-1', title: 'DevTools Digest' },
		]);
		expect(queryFn).toHaveBeenCalledTimes(2);
		unsubscribe();
	});

	it('refreshes successful empty-feed metadata without refetching articles', async () => {
		vi.useFakeTimers();
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		let serverTitle = 'empty.example';
		const feedQuery = vi.fn(async () => [{ id: 'feed-empty', title: serverTitle }]);
		const articleQuery = vi.fn(async () => []);
		const statusQuery = vi.fn(async () => ({ active: false }));
		const feedObserver = new QueryObserver(queryClient, {
			queryKey: ['feeds'],
			queryFn: feedQuery,
		});
		const articleObserver = new QueryObserver(queryClient, {
			queryKey: ['articles'],
			queryFn: articleQuery,
		});
		const statusObserver = new QueryObserver(queryClient, {
			queryKey: ['feeds', 'sync', 'status'],
			queryFn: statusQuery,
		});
		const unsubscribeFeed = feedObserver.subscribe(() => undefined);
		const unsubscribeArticles = articleObserver.subscribe(() => undefined);
		const unsubscribeStatus = statusObserver.subscribe(() => undefined);
		await Promise.all([
			queryClient.refetchQueries({ queryKey: ['feeds'], type: 'active' }),
			queryClient.refetchQueries({ queryKey: ['articles'], type: 'active' }),
		]);

		serverTitle = 'Empty Publisher';
		applyFeedRealtimeEvent(queryClient, {
			type: 'feed.health.updated',
			eventId: 'health-1',
			feedId: 'feed-empty',
			severity: 'healthy',
			syncStatus: 'idle',
			lastSyncedAt: '2026-07-18T00:00:00.000Z',
			lastSyncError: null,
			lastSyncErrorAt: null,
			updatedAt: '2026-07-18T00:00:00.000Z',
		});
		await vi.advanceTimersByTimeAsync(250);

		expect(queryClient.getQueryData(['feeds'])).toEqual([
			{ id: 'feed-empty', title: 'Empty Publisher' },
		]);
		expect(feedQuery).toHaveBeenCalledTimes(2);
		expect(articleQuery).toHaveBeenCalledOnce();
		expect(statusQuery).toHaveBeenCalledOnce();
		unsubscribeFeed();
		unsubscribeArticles();
		unsubscribeStatus();
	});
});
