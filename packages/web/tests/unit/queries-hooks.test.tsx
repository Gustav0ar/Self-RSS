import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn();

vi.mock('../../src/lib/api', () => ({
	apiFetch: (...args: unknown[]) => apiFetchMock(...args),
	apiDownload: vi.fn(),
}));

import {
	applyReadStateSyncEvent,
	invalidateReaderQueries,
	buildArticleSearchParams,
} from '../../src/hooks/queries';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('applyReadStateSyncEvent', () => {
	it('skips events emitted by this client', () => {
		const qc = {
			getQueryData: () => undefined,
			getQueriesData: () => [],
			setQueryData: vi.fn(),
			setQueriesData: vi.fn(),
			invalidateQueries: vi.fn(),
		} as never;

		applyReadStateSyncEvent(
			qc,
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
				if (
					Array.isArray(key) &&
					key[0] === 'article' &&
					key[1] === 'a-1'
				) {
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
		} as never;

		applyReadStateSyncEvent(
			qc,
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
		expect(qc.setQueryData).toHaveBeenCalledWith(
			['article', 'a-1'],
			expect.any(Function),
		);
		const setDetailCall = qc.setQueryData.mock.calls.find(
			(c) => Array.isArray(c[0]) && c[0][0] === 'article' && c[0][1] === 'a-1',
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
		} as never;

		applyReadStateSyncEvent(
			qc,
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
			(c) => Array.isArray(c[0]) && c[0][0] === 'stats',
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
		} as never;

		applyReadStateSyncEvent(
			qc,
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
			(c) => (c[0] as { queryKey: unknown[] }).queryKey,
		);
		expect(invalidatedKeys).toEqual(expect.arrayContaining([['articles']]));
	});
});

describe('invalidateReaderQueries', () => {
	it('invalidates the reader query family', () => {
		const invalidateQueries = vi.fn();
		const qc = { invalidateQueries } as never;

		invalidateReaderQueries(qc);

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
