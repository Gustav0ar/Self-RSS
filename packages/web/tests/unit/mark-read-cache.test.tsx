import type { ApiListResponse, ArticleListItem } from '@self-feed/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMarkRead } from '../../src/hooks/queries';

function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
}

function article(id: string, feedId: string, isRead: boolean): ArticleListItem {
	return {
		id,
		feedId,
		feedTitle: `Feed ${feedId}`,
		feedFaviconUrl: null,
		title: `Article ${id}`,
		author: null,
		excerpt: null,
		heroImageUrl: null,
		publishedAt: null,
		displayedAt: '2026-06-01T00:00:00.000Z',
		isRead,
	};
}

function listResponse(items: ArticleListItem[]): ApiListResponse<ArticleListItem> {
	return { data: items, cursor: null, hasMore: false };
}

describe('useMarkRead cache updates', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('keeps read articles in unread-only lists until the list is refreshed', async () => {
		const qc = createQueryClient();
		let markRead: ReturnType<typeof useMarkRead> | null = null;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 200 })),
		);

		qc.setQueryData(['feeds'], [{ id: 'feed-1', categoryId: 'category-1', unreadCount: 1 }]);
		qc.setQueryData(['categories'], [{ id: 'category-1', unreadCount: 1 }]);
		qc.setQueryData(['articles', 'feed-1', null, true, 'latest', 30], {
			pages: [listResponse([article('article-1', 'feed-1', false)])],
			pageParams: [null],
		});

		function Harness() {
			markRead = useMarkRead();
			return null;
		}

		render(
			<QueryClientProvider client={qc}>
				<Harness />
			</QueryClientProvider>,
		);

		act(() => {
			markRead?.mutate({ articleId: 'article-1', read: true });
		});

		await waitFor(() => {
			expect(
				qc.getQueryData<{ pages: ApiListResponse<ArticleListItem>[] }>([
					'articles',
					'feed-1',
					null,
					true,
					'latest',
					30,
				])?.pages[0]?.data,
			).toEqual([article('article-1', 'feed-1', true)]);
		});
		expect(qc.getQueryData<Array<{ unreadCount: number }>>(['feeds'])?.[0]?.unreadCount).toBe(0);
		expect(qc.getQueryData<Array<{ unreadCount: number }>>(['categories'])?.[0]?.unreadCount).toBe(
			0,
		);
	});
});
