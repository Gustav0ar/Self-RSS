import type {
	ApiListResponse,
	ArticleDetail,
	ArticleListItem,
	StatsResponse,
} from '@self-feed/shared';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { applyReadStateSyncEvent } from '../../src/hooks/queries';
import { getReadStateReconnectDelay } from '../../src/hooks/use-read-state-sync';
import { clearTokens, setTokens } from '../../src/lib/api';
import { createSseParser, streamReadStateEvents } from '../../src/lib/read-state-events';

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

function detail(id: string, feedId: string, isRead: boolean): ArticleDetail {
	return {
		id,
		feedId,
		guid: id,
		canonicalUrl: null,
		title: `Article ${id}`,
		author: null,
		excerpt: null,
		contentHtml: null,
		contentText: null,
		heroImageUrl: null,
		publishedAt: null,
		fetchedAt: '2026-06-01T00:00:00.000Z',
		hash: id,
		feedTitle: `Feed ${feedId}`,
		feedFaviconUrl: null,
		feedSiteUrl: null,
		media: [],
		isRead,
		isEnriched: false,
	};
}

function stats(totalUnread: number, totalRead: number): StatsResponse {
	return {
		totalUnread,
		totalRead,
		totalFeeds: 3,
		totalCategories: 2,
		recentSyncRuns: [],
		dailyMetrics: [],
	};
}

describe('read-state sync', () => {
	it('parses split SSE chunks, comments, CRLF, and multi-line data', () => {
		const messages: Array<{ eventName: string; data: string }> = [];
		const parser = createSseParser((eventName, data) => {
			messages.push({ eventName, data });
		});

		parser.push(': keepalive\n');
		parser.push('event: read-state\r\n');
		parser.push('data: {"articleId":');
		parser.push('"article-1"}\r\n\r\n');
		parser.push('event: read-state\n');
		parser.push('data: first\n');
		parser.push('data: second\n\n');
		parser.flush();

		expect(messages).toEqual([
			{ eventName: 'read-state', data: '{"articleId":"article-1"}' },
			{ eventName: 'read-state', data: 'first\nsecond' },
		]);
	});

	it('streams only valid read-state events and sends auth/client headers', async () => {
		setTokens('access-token');
		const body = new ReadableStream({
			start(controller) {
				const encoder = new TextEncoder();
				controller.enqueue(encoder.encode('event: read-state.connected\ndata: {}\n\n'));
				controller.enqueue(encoder.encode('event: read-state\ndata: {not-json}\n\n'));
				controller.enqueue(encoder.encode('event: read-state\ndata: {"type":"unknown.event"}\n\n'));
				controller.enqueue(
					encoder.encode(
						'event: read-state\ndata: {"type":"article.read_state_changed","articleId":"article-1","feedId":"feed-1","isRead":true}\n\n',
					),
				);
				controller.enqueue(
					encoder.encode(
						'event: read-state\ndata: {"type":"articles.marked_read","eventId":"event-invalid","feedIds":["feed-1"],"scope":{},"markedCount":-1,"clientId":null,"updatedAt":"2026-06-01T00:00:00.000Z"}\n\n',
					),
				);
				controller.enqueue(
					encoder.encode(
						[
							'event: read-state',
							'data: {"type":"article.read_state_changed","eventId":"event-1","articleId":"article-1","feedId":"feed-1","isRead":true,"source":"manual","clientId":"other-client","updatedAt":"2026-06-01T00:00:00.000Z"}',
							'',
							'',
						].join('\n'),
					),
				);
				controller.close();
			},
		});
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			return new Response(body, { status: 200 });
		});
		vi.stubGlobal('fetch', fetchMock);
		const received: unknown[] = [];

		try {
			await streamReadStateEvents({
				signal: new AbortController().signal,
				onEvent: (event) => received.push(event),
			});

			const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
			expect(headers.get('Authorization')).toBe('Bearer access-token');
			expect(headers.get('X-Self-Feed-Client-Id')).toBeTruthy();
			expect(received).toEqual([
				expect.objectContaining({
					type: 'article.read_state_changed',
					articleId: 'article-1',
					feedId: 'feed-1',
					isRead: true,
				}),
			]);
		} finally {
			clearTokens();
			vi.unstubAllGlobals();
		}
	});

	it('applies remote read events to details, lists, unread-only lists, counts, and stats', () => {
		const qc = createQueryClient();
		qc.setQueryData(['article', 'article-1'], detail('article-1', 'feed-1', false));
		qc.setQueryData(
			['feeds'],
			[
				{ id: 'feed-1', categoryId: 'category-1', unreadCount: 4 },
				{ id: 'feed-2', categoryId: 'category-1', unreadCount: 1 },
			],
		);
		qc.setQueryData(['categories'], [{ id: 'category-1', unreadCount: 5 }]);
		qc.setQueryData(['stats'], stats(9, 2));
		qc.setQueryData(['articles', 'feed-1', null, true, 'latest', 30], {
			pages: [listResponse([article('article-1', 'feed-1', false)])],
			pageParams: [null],
		});
		qc.setQueryData(['articles', 'feed-1', null, false, 'latest', 30], {
			pages: [listResponse([article('article-1', 'feed-1', false)])],
			pageParams: [null],
		});
		qc.setQueryData(
			['search', 'article', undefined],
			listResponse([article('article-1', 'feed-1', false)]),
		);

		applyReadStateSyncEvent(
			qc,
			{
				type: 'article.read_state_changed',
				eventId: 'event-1',
				articleId: 'article-1',
				feedId: 'feed-1',
				isRead: true,
				source: 'manual',
				clientId: 'other-client',
				updatedAt: '2026-06-01T00:00:00.000Z',
			},
			{ clientId: 'this-client' },
		);

		expect(qc.getQueryData<ArticleDetail>(['article', 'article-1'])?.isRead).toBe(true);
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
		expect(
			qc.getQueryData<{ pages: ApiListResponse<ArticleListItem>[] }>([
				'articles',
				'feed-1',
				null,
				false,
				'latest',
				30,
			])?.pages[0]?.data[0]?.isRead,
		).toBe(true);
		expect(qc.getQueryData<Array<{ unreadCount: number }>>(['feeds'])?.[0]?.unreadCount).toBe(3);
		expect(qc.getQueryData<Array<{ unreadCount: number }>>(['categories'])?.[0]?.unreadCount).toBe(
			4,
		);
		expect(qc.getQueryData<StatsResponse>(['stats'])).toMatchObject({
			totalUnread: 8,
			totalRead: 3,
		});
		expect(
			qc.getQueryData<ApiListResponse<ArticleListItem>>(['search', 'article', undefined])?.data[0]
				?.isRead,
		).toBe(true);
	});

	it('ignores events emitted by the same browser tab', () => {
		const qc = createQueryClient();
		qc.setQueryData(['feeds'], [{ id: 'feed-1', categoryId: 'category-1', unreadCount: 4 }]);

		applyReadStateSyncEvent(
			qc,
			{
				type: 'article.read_state_changed',
				eventId: 'event-1',
				articleId: 'article-1',
				feedId: 'feed-1',
				isRead: true,
				source: 'manual',
				clientId: 'this-client',
				updatedAt: '2026-06-01T00:00:00.000Z',
			},
			{ clientId: 'this-client' },
		);

		expect(qc.getQueryData<Array<{ unreadCount: number }>>(['feeds'])?.[0]?.unreadCount).toBe(4);
	});

	it('applies remote unread events and requests article refetches for unread-only gaps', () => {
		const qc = createQueryClient();
		const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
		qc.setQueryData(['article', 'article-1'], detail('article-1', 'feed-1', true));
		qc.setQueryData(['feeds'], [{ id: 'feed-1', categoryId: 'category-1', unreadCount: 0 }]);
		qc.setQueryData(['categories'], [{ id: 'category-1', unreadCount: 0 }]);
		qc.setQueryData(['stats'], stats(0, 8));

		applyReadStateSyncEvent(
			qc,
			{
				type: 'article.read_state_changed',
				eventId: 'event-1',
				articleId: 'article-1',
				feedId: 'feed-1',
				isRead: false,
				source: 'manual',
				clientId: 'other-client',
				updatedAt: '2026-06-01T00:00:00.000Z',
			},
			{ clientId: 'this-client' },
		);

		expect(qc.getQueryData<ArticleDetail>(['article', 'article-1'])?.isRead).toBe(false);
		expect(qc.getQueryData<Array<{ unreadCount: number }>>(['feeds'])?.[0]?.unreadCount).toBe(1);
		expect(qc.getQueryData<Array<{ unreadCount: number }>>(['categories'])?.[0]?.unreadCount).toBe(
			1,
		);
		expect(qc.getQueryData<StatsResponse>(['stats'])).toMatchObject({
			totalUnread: 1,
			totalRead: 7,
		});
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['articles'] });
	});

	it('applies mark-all events to cached feeds, categories, article collections, details, and stats', () => {
		const qc = createQueryClient();
		qc.setQueryData(['article', 'article-2'], detail('article-2', 'feed-2', false));
		qc.setQueryData(
			['feeds'],
			[
				{ id: 'feed-1', categoryId: 'category-1', unreadCount: 3 },
				{ id: 'feed-2', categoryId: 'category-1', unreadCount: 2 },
				{ id: 'feed-3', categoryId: 'category-2', unreadCount: 4 },
			],
		);
		qc.setQueryData(
			['categories'],
			[
				{ id: 'category-1', unreadCount: 5 },
				{ id: 'category-2', unreadCount: 4 },
			],
		);
		qc.setQueryData(['stats'], stats(9, 1));
		qc.setQueryData(['articles', null, null, true, 'latest', 30], {
			pages: [
				listResponse([
					article('article-1', 'feed-1', false),
					article('article-2', 'feed-2', false),
					article('article-3', 'feed-3', false),
				]),
			],
			pageParams: [null],
		});
		qc.setQueryData(['articles', null, null, false, 'latest', 30], {
			pages: [listResponse([article('article-1', 'feed-1', false)])],
			pageParams: [null],
		});
		qc.setQueryData(
			['search', 'article', undefined],
			listResponse([article('article-1', 'feed-1', false), article('article-3', 'feed-3', false)]),
		);

		applyReadStateSyncEvent(
			qc,
			{
				type: 'articles.marked_read',
				eventId: 'event-1',
				feedIds: ['feed-1', 'feed-2'],
				scope: {},
				markedCount: 5,
				clientId: 'other-client',
				updatedAt: '2026-06-01T00:00:00.000Z',
			},
			{ clientId: 'this-client' },
		);

		expect(qc.getQueryData<ArticleDetail>(['article', 'article-2'])?.isRead).toBe(true);
		expect(qc.getQueryData<Array<{ id: string; unreadCount: number }>>(['feeds'])).toEqual([
			{ id: 'feed-1', categoryId: 'category-1', unreadCount: 0 },
			{ id: 'feed-2', categoryId: 'category-1', unreadCount: 0 },
			{ id: 'feed-3', categoryId: 'category-2', unreadCount: 4 },
		]);
		expect(qc.getQueryData<Array<{ id: string; unreadCount: number }>>(['categories'])).toEqual([
			{ id: 'category-1', unreadCount: 0 },
			{ id: 'category-2', unreadCount: 4 },
		]);
		expect(
			qc
				.getQueryData<{ pages: ApiListResponse<ArticleListItem>[] }>([
					'articles',
					null,
					null,
					true,
					'latest',
					30,
				])
				?.pages[0]?.data.map((item) => item.id),
		).toEqual(['article-3']);
		expect(
			qc.getQueryData<{ pages: ApiListResponse<ArticleListItem>[] }>([
				'articles',
				null,
				null,
				false,
				'latest',
				30,
			])?.pages[0]?.data[0]?.isRead,
		).toBe(true);
		expect(
			qc.getQueryData<ApiListResponse<ArticleListItem>>(['search', 'article', undefined])?.data,
		).toEqual([article('article-1', 'feed-1', true), article('article-3', 'feed-3', false)]);
		expect(qc.getQueryData<StatsResponse>(['stats'])).toMatchObject({
			totalUnread: 4,
			totalRead: 6,
		});
	});

	it('caps reconnect backoff at thirty seconds', () => {
		expect(getReadStateReconnectDelay(0)).toBe(1000);
		expect(getReadStateReconnectDelay(1)).toBe(2000);
		expect(getReadStateReconnectDelay(10)).toBe(30000);
	});
});
