import type { ApiListResponse, ArticleListItem } from '@self-feed/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSetArticleSaved } from '../../src/hooks/queries';

function article(isSaved: boolean): ArticleListItem {
	return {
		id: 'article-1',
		feedId: 'feed-1',
		feedTitle: 'Feed',
		feedFaviconUrl: null,
		canonicalUrl: null,
		title: 'Saved article',
		author: null,
		excerpt: null,
		heroImageUrl: null,
		publishedAt: null,
		displayedAt: '2026-08-11T00:00:00.000Z',
		isRead: false,
		isSaved,
		contentStatus: 'feed_ready',
		contentVersion: 1,
	};
}

function response(items: ArticleListItem[]): ApiListResponse<ArticleListItem> {
	return { data: items, cursor: null, hasMore: false };
}

function createQueryClient() {
	return new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
}

describe('useSetArticleSaved cache updates', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('updates normal lists and removes an unsaved row from the saved collection', async () => {
		const qc = createQueryClient();
		let mutation: ReturnType<typeof useSetArticleSaved> | null = null;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 200 })),
		);
		qc.setQueryData(['articles', { feedId: 'feed-1' }], response([article(true)]));
		qc.setQueryData(['articles', null, null, false, true, 'latest', 30], {
			pages: [response([article(true)])],
			pageParams: [null],
		});

		function Harness() {
			mutation = useSetArticleSaved();
			return null;
		}
		render(
			<QueryClientProvider client={qc}>
				<Harness />
			</QueryClientProvider>,
		);

		act(() => mutation?.mutate({ articleId: 'article-1', saved: false }));

		await waitFor(() => {
			expect(
				qc.getQueryData<ApiListResponse<ArticleListItem>>(['articles', { feedId: 'feed-1' }])
					?.data[0]?.isSaved,
			).toBe(false);
		});
		expect(
			qc.getQueryData<{ pages: ApiListResponse<ArticleListItem>[] }>([
				'articles',
				null,
				null,
				false,
				true,
				'latest',
				30,
			])?.pages[0]?.data,
		).toEqual([]);
	});

	it('rolls every cached list back when the server rejects the change', async () => {
		const qc = createQueryClient();
		let mutation: ReturnType<typeof useSetArticleSaved> | null = null;
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ error: { message: 'Save failed' } }), {
						status: 500,
						headers: { 'Content-Type': 'application/json' },
					}),
			),
		);
		qc.setQueryData(['articles', { feedId: 'feed-1' }], response([article(false)]));

		function Harness() {
			mutation = useSetArticleSaved();
			return null;
		}
		render(
			<QueryClientProvider client={qc}>
				<Harness />
			</QueryClientProvider>,
		);

		await act(async () => {
			await mutation?.mutateAsync({ articleId: 'article-1', saved: true }).catch(() => undefined);
		});

		expect(
			qc.getQueryData<ApiListResponse<ArticleListItem>>(['articles', { feedId: 'feed-1' }])?.data[0]
				?.isSaved,
		).toBe(false);
	});
});
