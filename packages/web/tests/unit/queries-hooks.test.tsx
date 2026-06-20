import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider, QueryClient as RealQueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn();

vi.mock('../../src/lib/api', () => ({
	apiFetch: (...args: unknown[]) => apiFetchMock(...args),
	apiDownload: vi.fn(),
}));

import {
	applyReadStateSyncEvent,
	buildArticleSearchParams,
	invalidateReaderQueries,
	useArticle,
	useArticles,
	useCategories,
	useFeeds,
	useInfiniteArticles,
	usePreferences,
	useSearch,
	useStats,
	useSyncAllFeeds,
	useSyncAllFeedsStatus,
} from '../../src/hooks/queries';

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('applyReadStateSyncEvent', () => {
	it('skips events emitted by this client', () => {
		const qc = {
			getQueryData: () => undefined,
			getQueriesData: () => [],
			setQueryData: vi.fn(),
			setQueriesData: vi.fn(),
			invalidateQueries: vi.fn(),
		};

		applyReadStateSyncEvent(
			qc as unknown as QueryClient,
			{
				type: 'article.read_state_changed',
				eventId: 'e1',
				articleId: 'a-1',
				feedId: 'f-1',
				isRead: true,
				source: 'manual',
				clientId: 'local-client',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
			{ clientId: 'local-client' },
		);

		expect(qc.setQueryData).not.toHaveBeenCalled();
		expect(qc.setQueriesData).not.toHaveBeenCalled();
		expect(qc.invalidateQueries).not.toHaveBeenCalled();
	});

	it('updates cached article detail and bumps feed unread count for foreign events', () => {
		const qc = {
			getQueryData: (key: unknown) => {
				if (Array.isArray(key) && key[0] === 'article' && key[1] === 'a-1') {
					return { id: 'a-1', feedId: 'f-1', isRead: false };
				}
				return undefined;
			},
			getQueriesData: (opts: { queryKey: unknown[] }) => {
				if (opts.queryKey[0] === 'articles') return [];
				if (opts.queryKey[0] === 'feeds') {
					return [['feeds', [{ id: 'f-1', unreadCount: 5 }]]];
				}
				if (opts.queryKey[0] === 'search') return [];
				return [];
			},
			setQueryData: vi.fn(),
			setQueriesData: vi.fn(),
			invalidateQueries: vi.fn(),
		};

		applyReadStateSyncEvent(
			qc as unknown as QueryClient,
			{
				type: 'article.read_state_changed',
				eventId: 'e1',
				articleId: 'a-1',
				feedId: 'f-1',
				isRead: true,
				source: 'manual',
				clientId: 'other-client',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
			{ clientId: 'local-client' },
		);

		// Article detail is updated through an updater function. Invoke the
		// updater with the cached snapshot to confirm it produces the right
		// new value.
		expect(qc.setQueryData).toHaveBeenCalledWith(['article', 'a-1'], expect.any(Function));
		const setDetailCall = qc.setQueryData.mock.calls.find(
			(c: unknown[]) => Array.isArray(c[0]) && c[0][0] === 'article' && c[0][1] === 'a-1',
		);
		const updater = setDetailCall?.[1] as (s: { isRead: boolean }) => { isRead: boolean };
		expect(updater({ isRead: false })).toEqual({ isRead: true });
		// Feed unread count was decremented
		expect(qc.setQueriesData).toHaveBeenCalledWith(
			expect.objectContaining({ queryKey: ['feeds'] }),
			expect.any(Function),
		);
		expect(qc.invalidateQueries).toHaveBeenCalled();
	});

	it('marks every article in the listed feeds as read on a bulk mark_all event', () => {
		const articles = [['articles', { data: [{ id: 'a-1', feedId: 'f-1', isRead: false }] }]];
		const qc = {
			getQueryData: (key: unknown) => {
				if (Array.isArray(key) && key[0] === 'stats') {
					return { totalUnread: 3, totalRead: 7 };
				}
				return undefined;
			},
			getQueriesData: (opts: { queryKey: unknown[] }) => {
				if (opts.queryKey[0] === 'articles') return [articles];
				if (opts.queryKey[0] === 'feeds') {
					return [['feeds', [{ id: 'f-1', unreadCount: 3 }]]];
				}
				if (opts.queryKey[0] === 'search') return [];
				return [];
			},
			setQueryData: vi.fn(),
			setQueriesData: vi.fn(),
			invalidateQueries: vi.fn(),
		};

		applyReadStateSyncEvent(
			qc as unknown as QueryClient,
			{
				type: 'articles.marked_read',
				eventId: 'e2',
				feedIds: ['f-1'],
				scope: {},
				markedCount: 3,
				clientId: 'other-client',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
			{ clientId: 'local-client' },
		);

		// Stats should be updated to drop unread by 3 and add 3 read. The
		// updater is a function, so we call it with the cached value.
		const setStatsCall = qc.setQueryData.mock.calls.find(
			(c: unknown[]) => Array.isArray(c[0]) && c[0][0] === 'stats',
		);
		expect(setStatsCall).toBeDefined();
		const statsUpdater = setStatsCall?.[1] as (s: { totalUnread: number; totalRead: number }) => {
			totalUnread: number;
			totalRead: number;
		};
		expect(statsUpdater({ totalUnread: 3, totalRead: 7 })).toEqual({
			totalUnread: 0,
			totalRead: 10,
		});
		// Feed unread count is reset to 0.
		expect(qc.setQueriesData).toHaveBeenCalledWith(
			expect.objectContaining({ queryKey: ['feeds'] }),
			expect.any(Function),
		);
	});

	it('invalidates article lists when an article transitions back to unread', () => {
		const qc = {
			getQueryData: () => undefined,
			getQueriesData: () => [],
			setQueryData: vi.fn(),
			setQueriesData: vi.fn(),
			invalidateQueries: vi.fn(),
		};

		applyReadStateSyncEvent(
			qc as unknown as QueryClient,
			{
				type: 'article.read_state_changed',
				eventId: 'e3',
				articleId: 'a-1',
				feedId: 'f-1',
				isRead: false,
				source: 'manual',
				clientId: 'other-client',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
			{ clientId: 'local-client' },
		);

		const invalidatedKeys = qc.invalidateQueries.mock.calls.map(
			(c: unknown[]) => (c[0] as { queryKey: unknown[] }).queryKey,
		);
		expect(invalidatedKeys).toEqual(expect.arrayContaining([['articles']]));
	});
});

describe('invalidateReaderQueries', () => {
	it('invalidates the reader query family', () => {
		const invalidateQueries = vi.fn();
		const qc = { invalidateQueries };

		invalidateReaderQueries(qc as unknown as QueryClient);

		const calledKeys = invalidateQueries.mock.calls.map((c) => c[0].queryKey);
		expect(calledKeys).toEqual(
			expect.arrayContaining([
				['articles'],
				['article'],
				['feeds'],
				['categories'],
				['stats'],
				['search'],
			]),
		);
	});
});

describe('buildArticleSearchParams', () => {
	it('emits only the params that were provided', () => {
		expect(buildArticleSearchParams({})).toBe('');
		expect(buildArticleSearchParams({ unreadOnly: true, sort: 'oldest' })).toBe(
			'unreadOnly=true&sort=oldest',
		);
	});

	it('URL-encodes the cursor value', () => {
		const params = buildArticleSearchParams({ feedId: 'f-1' }, 'cursor:123:d');
		expect(params).toBe('feedId=f-1&cursor=cursor%3A123%3Ad');
	});

	it('respects the explicit limit when given', () => {
		const params = buildArticleSearchParams({ limit: 50 });
		expect(params).toBe('limit=50');
	});
});

describe('read query cancellation', () => {
	it('passes React Query abort signals to API reads', async () => {
		apiFetchMock.mockImplementation(async (path: string) => {
			if (path === '/articles/article-1') {
				return { data: { id: 'article-1' } };
			}
			if (path.startsWith('/articles') || path.startsWith('/search')) {
				return { data: [], cursor: null, hasMore: false };
			}
			if (path.startsWith('/feeds/sync/status')) {
				return { data: { queued: false, running: false, active: false } };
			}
			if (path.startsWith('/feeds')) {
				return { data: [] };
			}
			if (path.startsWith('/categories')) {
				return { data: { categories: [], totalUnread: 0 } };
			}
			if (path.startsWith('/preferences')) {
				return {
					data: {
						theme: 'system',
						fontFamily: 'Inter',
						textSize: 16,
						density: 'comfortable',
						defaultSort: 'latest',
						hideRead: false,
						keyboardShortcutsEnabled: true,
						autoMarkReadMode: 'on_navigate',
						accentColor: 'indigo',
					},
				};
			}
			if (path.startsWith('/stats')) {
				return {
					data: {
						totalUnread: 0,
						totalRead: 0,
						totalFeeds: 0,
						totalCategories: 0,
						recentSyncRuns: [],
						dailyMetrics: [],
					},
				};
			}
			throw new Error(`Unexpected path ${path}`);
		});
		const queryClient = new RealQueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		);

		renderHook(
			() => {
				useArticles({ limit: 20 });
				useInfiniteArticles({ limit: 20 });
				useArticle('article-1');
				useFeeds();
				useCategories();
				usePreferences();
				useStats();
				useSyncAllFeedsStatus();
				useSearch('query');
			},
			{ wrapper },
		);

		await waitFor(() => {
			expect(apiFetchMock).toHaveBeenCalledTimes(9);
		});
		for (const [, options] of apiFetchMock.mock.calls) {
			expect((options as RequestInit | undefined)?.signal).toBeInstanceOf(AbortSignal);
		}
	});
});

describe('useSyncAllFeeds', () => {
	it('clears delayed refresh timers on unmount', async () => {
		vi.useFakeTimers();
		apiFetchMock.mockResolvedValue({ data: { queued: true } });
		const queryClient = new RealQueryClient({
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		});
		const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		);

		const { result, unmount } = renderHook(() => useSyncAllFeeds(), { wrapper });

		await act(async () => {
			await result.current.mutateAsync();
		});
		const invalidationsBeforeUnmount = invalidateSpy.mock.calls.length;

		unmount();
		act(() => {
			vi.advanceTimersByTime(15_000);
		});

		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['feeds', 'sync', 'status'] });
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['articles'] });
		expect(invalidateSpy).toHaveBeenCalledTimes(invalidationsBeforeUnmount);
	});
});
