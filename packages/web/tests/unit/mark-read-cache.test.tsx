import type { ApiListResponse, ArticleListItem, StatsResponse } from '@self-feed/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMarkRead } from '../../src/hooks/queries';
import { setOfflineSessionUser } from '../../src/lib/offline-store';

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
		canonicalUrl: null,
		title: `Article ${id}`,
		author: null,
		excerpt: null,
		heroImageUrl: null,
		publishedAt: null,
		displayedAt: '2026-06-01T00:00:00.000Z',
		isRead,
		isSaved: false,
		contentStatus: 'feed_ready',
		contentVersion: 1,
	};
}

function listResponse(items: ArticleListItem[]): ApiListResponse<ArticleListItem> {
	return { data: items, cursor: null, hasMore: false };
}

function stats(totalUnread: number, totalRead: number): StatsResponse {
	return {
		totalUnread,
		totalRead,
		totalFeeds: 1,
		totalCategories: 1,
		recentSyncRuns: [],
		dailyMetrics: [],
	};
}

describe('useMarkRead cache updates', () => {
	afterEach(() => {
		setOfflineSessionUser(null);
		vi.unstubAllGlobals();
	});

	it('keeps read articles in unread-only lists until the list is refreshed', async () => {
		setOfflineSessionUser('user-1');
		const qc = createQueryClient();
		let markRead: ReturnType<typeof useMarkRead> | null = null;
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							data: {
								success: true,
								applied: true,
								conflict: false,
								duplicate: false,
								read: true,
								revision: 1,
							},
						}),
						{ status: 200, headers: { 'Content-Type': 'application/json' } },
					),
			),
		);

		qc.setQueryData(['feeds'], [{ id: 'feed-1', categoryId: 'category-1', unreadCount: 1 }]);
		qc.setQueryData(
			['categories'],
			[
				{
					id: 'category-1',
					unreadCount: 1,
					feeds: [{ id: 'feed-1', categoryId: 'category-1', unreadCount: 1 }],
				},
			],
		);
		qc.setQueryData(['articles', 'feed-1', null, true, 'latest', 30], {
			pages: [listResponse([article('article-1', 'feed-1', false)])],
			pageParams: [null],
		});
		qc.setQueryData(['stats'], stats(1, 4));

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
		expect(
			qc.getQueryData<Array<{ feeds: Array<{ unreadCount: number }> }>>(['categories'])?.[0]
				?.feeds[0]?.unreadCount,
		).toBe(0);
		expect(qc.getQueryData<StatsResponse>(['stats'])).toMatchObject({
			totalUnread: 0,
			totalRead: 5,
		});
	});

	it('keeps the optimistic state queued when delivery fails transiently', async () => {
		setOfflineSessionUser('user-1');
		const qc = createQueryClient();
		let markRead: ReturnType<typeof useMarkRead> | null = null;
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ error: { message: 'Unable to mark read' } }), {
						status: 500,
						headers: { 'Content-Type': 'application/json' },
					}),
			),
		);

		qc.setQueryData(['feeds'], [{ id: 'feed-1', categoryId: 'category-1', unreadCount: 1 }]);
		qc.setQueryData(
			['categories'],
			[
				{
					id: 'category-1',
					unreadCount: 1,
					feeds: [{ id: 'feed-1', categoryId: 'category-1', unreadCount: 1 }],
				},
			],
		);
		qc.setQueryData(['articles', 'feed-1', null, false, 'latest', 30], {
			pages: [listResponse([article('article-1', 'feed-1', false)])],
			pageParams: [null],
		});
		qc.setQueryData(['stats'], stats(1, 4));

		function Harness() {
			markRead = useMarkRead();
			return null;
		}

		render(
			<QueryClientProvider client={qc}>
				<Harness />
			</QueryClientProvider>,
		);

		await act(async () => {
			await markRead?.mutateAsync({ articleId: 'article-1', read: true }).catch(() => undefined);
		});

		expect(
			qc.getQueryData<{ pages: ApiListResponse<ArticleListItem>[] }>([
				'articles',
				'feed-1',
				null,
				false,
				'latest',
				30,
			])?.pages[0]?.data,
		).toEqual([article('article-1', 'feed-1', true)]);
		expect(qc.getQueryData<Array<{ unreadCount: number }>>(['feeds'])?.[0]?.unreadCount).toBe(0);
		expect(qc.getQueryData<StatsResponse>(['stats'])).toMatchObject({
			totalUnread: 0,
			totalRead: 5,
		});
	});
});
