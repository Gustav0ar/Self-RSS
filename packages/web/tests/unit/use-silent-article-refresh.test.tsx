import type { ApiListResponse, ArticleListItem } from '@self-feed/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInfiniteArticles } from '../../src/hooks/queries/article-hooks';
import { infiniteArticleQueryKey } from '../../src/hooks/queries/cache-query-helpers';
import { useSilentArticleRefresh } from '../../src/hooks/use-silent-article-refresh';

const apiFetchMock = vi.fn();

vi.mock('../../src/lib/api', () => ({
	apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

const queryKey = infiniteArticleQueryKey({});

function article(id: string, overrides: Partial<ArticleListItem> = {}): ArticleListItem {
	return {
		id,
		feedId: 'feed-1',
		feedTitle: 'Feed',
		feedFaviconUrl: null,
		canonicalUrl: null,
		title: id,
		author: null,
		excerpt: null,
		heroImageUrl: null,
		publishedAt: null,
		displayedAt: '2026-01-01T00:00:00.000Z',
		isRead: false,
		isSaved: false,
		contentStatus: 'feed_ready',
		contentVersion: 1,
		...overrides,
	};
}

function page(items: ArticleListItem[]): ApiListResponse<ArticleListItem> {
	return { data: items, cursor: null, hasMore: false };
}

function makeQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false, refetchOnWindowFocus: false },
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

	it.each([
		{ title: 'Updated title' },
		{ canonicalUrl: 'https://example.com/updated' },
		{ isSaved: true },
		{ contentStatus: 'enrichment_pending' },
		{ contentVersion: 2 },
	] satisfies Partial<ArticleListItem>[])('invalidates when first-page metadata changes: %j', async (changed) => {
		const queryClient = makeQueryClient();
		const cached = {
			pages: [page([article('a-2'), article('a-1')])],
			pageParams: [null],
		};
		queryClient.setQueryData(queryKey, cached);
		const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
		apiFetchMock.mockResolvedValue(page([article('a-2', changed), article('a-1')]));

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

	it.each([false, true])('refreshes a real article query with savedOnly=%s', async (savedOnly) => {
		const queryClient = makeQueryClient();
		const params = { savedOnly, limit: 30 };
		const original = page([article('a-1', { isSaved: savedOnly })]);
		const updated = page([article('a-2', { isSaved: savedOnly })]);
		apiFetchMock.mockResolvedValueOnce(original).mockResolvedValue(updated);
		const { result, unmount } = renderHook(
			() => {
				const articles = useInfiniteArticles(params);
				useSilentArticleRefresh(params);
				return articles;
			},
			{ wrapper: wrapperFor(queryClient) },
		);
		await waitFor(() => expect(result.current.data?.pages[0]).toEqual(original));
		expect(apiFetchMock).toHaveBeenCalledTimes(1);

		act(() => window.dispatchEvent(new Event('focus')));

		await waitFor(() => expect(result.current.data?.pages[0]).toEqual(updated));
		expect(apiFetchMock).toHaveBeenCalledTimes(3);
		for (const [path] of apiFetchMock.mock.calls) {
			expect(new URL(String(path), 'https://example.com').searchParams.get('savedOnly')).toBe(
				savedOnly ? 'true' : null,
			);
		}
		unmount();
		queryClient.clear();
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
