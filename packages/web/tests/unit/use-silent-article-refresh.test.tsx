import type { ApiListResponse, ArticleListItem } from '@self-feed/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSilentArticleRefresh } from '../../src/hooks/use-silent-article-refresh';

const apiFetchMock = vi.fn();

vi.mock('../../src/lib/api', () => ({
	apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

const queryKey = ['articles', null, null, false, 'latest', 30] as const;

function article(id: string, overrides: Partial<ArticleListItem> = {}): ArticleListItem {
	return {
		id,
		feedId: 'feed-1',
		feedTitle: 'Feed',
		feedFaviconUrl: null,
		title: id,
		author: null,
		excerpt: null,
		heroImageUrl: null,
		publishedAt: null,
		displayedAt: '2026-01-01T00:00:00.000Z',
		isRead: false,
		...overrides,
	};
}

function page(items: ArticleListItem[]): ApiListResponse<ArticleListItem> {
	return { data: items, cursor: null, hasMore: false };
}

function makeQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false },
		},
	});
}

function wrapperFor(queryClient: QueryClient) {
	return function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
}

describe('useSilentArticleRefresh', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			value: 'visible',
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('is a no-op without a QueryClientProvider', () => {
		renderHook(() => useSilentArticleRefresh({ limit: 30 }));

		act(() => {
			window.dispatchEvent(new Event('focus'));
		});

		expect(apiFetchMock).not.toHaveBeenCalled();
	});

	it('leaves cached pages untouched when the first page has no new articles', async () => {
		const queryClient = makeQueryClient();
		const cached = {
			pages: [page([article('a-2'), article('a-1')])],
			pageParams: [null],
		};
		queryClient.setQueryData(queryKey, cached);
		const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
		apiFetchMock.mockResolvedValue(page([article('a-2'), article('a-1')]));

		renderHook(() => useSilentArticleRefresh({ limit: 30 }), {
			wrapper: wrapperFor(queryClient),
		});
		act(() => {
			window.dispatchEvent(new Event('focus'));
		});

		await waitFor(() => {
			expect(apiFetchMock).toHaveBeenCalledWith('/articles?limit=30', {
				signal: expect.any(AbortSignal),
			});
		});
		expect(invalidateSpy).not.toHaveBeenCalled();
		expect(queryClient.getQueryData(queryKey)).toEqual(cached);
	});

	it('invalidates the exact query without manually rewriting cached pages when the first page changes', async () => {
		const queryClient = makeQueryClient();
		const cached = {
			pages: [page([article('a-2'), article('a-1')]), page([article('older')])],
			pageParams: [null, 'a-1:1767225600:d'],
		};
		queryClient.setQueryData(queryKey, cached);
		const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
		apiFetchMock.mockResolvedValue(page([article('a-3'), article('a-2')]));

		renderHook(() => useSilentArticleRefresh({ limit: 30 }), {
			wrapper: wrapperFor(queryClient),
		});
		act(() => {
			window.dispatchEvent(new Event('focus'));
		});

		await waitFor(() => {
			expect(invalidateSpy).toHaveBeenCalledWith({ queryKey, exact: true });
		});
		expect(queryClient.getQueryData(queryKey)).toEqual(cached);
	});

	it('invalidates when an existing first-page article changes metadata', async () => {
		const queryClient = makeQueryClient();
		const cached = {
			pages: [page([article('a-2', { title: 'Original title' }), article('a-1')])],
			pageParams: [null],
		};
		queryClient.setQueryData(queryKey, cached);
		const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
		apiFetchMock.mockResolvedValue(
			page([article('a-2', { title: 'Updated title' }), article('a-1')]),
		);

		renderHook(() => useSilentArticleRefresh({ limit: 30 }), {
			wrapper: wrapperFor(queryClient),
		});
		act(() => {
			window.dispatchEvent(new Event('focus'));
		});

		await waitFor(() => {
			expect(invalidateSpy).toHaveBeenCalledWith({ queryKey, exact: true });
		});
		expect(queryClient.getQueryData(queryKey)).toEqual(cached);
	});

	it('invalidates when the fresh first page removes cached articles', async () => {
		const queryClient = makeQueryClient();
		const cached = {
			pages: [page([article('a-2'), article('a-1')])],
			pageParams: [null],
		};
		queryClient.setQueryData(queryKey, cached);
		const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
		apiFetchMock.mockResolvedValue(page([article('a-2')]));

		renderHook(() => useSilentArticleRefresh({ limit: 30 }), {
			wrapper: wrapperFor(queryClient),
		});
		act(() => {
			window.dispatchEvent(new Event('focus'));
		});

		await waitFor(() => {
			expect(invalidateSpy).toHaveBeenCalledWith({ queryKey, exact: true });
		});
		expect(queryClient.getQueryData(queryKey)).toEqual(cached);
	});
});
