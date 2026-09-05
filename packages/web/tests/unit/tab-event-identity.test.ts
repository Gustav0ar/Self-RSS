import 'fake-indexeddb/auto';
import type { RealtimeEvent } from '@self-feed/shared';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileRealtimeEvent } from '../../src/hooks/use-read-state-sync';
import {
	clearOfflineState,
	queueArticleStateMutation,
	setOfflineSessionUser,
} from '../../src/lib/offline-store';

function createStorage(): Storage {
	const values = new Map<string, string>();
	return {
		get length() {
			return values.size;
		},
		clear: () => values.clear(),
		getItem: (key) => values.get(key) ?? null,
		key: (index) => [...values.keys()][index] ?? null,
		removeItem: (key) => {
			values.delete(key);
		},
		setItem: (key, value) => {
			values.set(key, value);
		},
	};
}

beforeEach(() => {
	setOfflineSessionUser('tab-reader');
	vi.stubGlobal('localStorage', createStorage());
	vi.stubGlobal('sessionStorage', createStorage());
});

afterEach(async () => {
	await clearOfflineState('tab-reader');
	setOfflineSessionUser(null);
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

async function openTab() {
	vi.resetModules();
	return import('../../src/lib/api');
}

describe('event identities across tabs sharing browser storage', () => {
	it('keeps auth device identity stable while generating distinct event identities', async () => {
		localStorage.setItem('self-feed-client-id', 'shared-device');
		sessionStorage.setItem('self-feed-client-id', 'duplicated-tab-storage');
		const first = await openTab();
		const second = await openTab();
		expect(first.getClientId()).not.toBe(second.getClientId());
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
			async () =>
				new Response(JSON.stringify({ data: { tokens: { accessToken: 'test-access' } } }), {
					status: 200,
				}),
		);
		await first.apiFetch('/auth/login', { method: 'POST' });
		await second.apiFetch('/auth/change-password', { method: 'POST' });
		await second.refreshAccessToken();
		for (const [, options] of fetchMock.mock.calls) {
			expect(new Headers(options?.headers).get('X-Self-Feed-Client-Id')).toBe('shared-device');
		}
	});

	it.each([
		'read',
		'saved',
		'mark-all-read',
	] as const)('applies %s events from another tab', async (kind) => {
		const first = await openTab();
		const second = await openTab();
		const firstCache = new QueryClient();
		const secondCache = new QueryClient();
		for (const cache of [firstCache, secondCache]) {
			cache.setQueryData(['article', 'article-1'], {
				id: 'article-1',
				feedId: 'feed-1',
				isRead: false,
				isSaved: false,
			});
			cache.setQueryData(['feeds'], [{ id: 'feed-1', unreadCount: 1 }]);
			cache.setQueryData(['stats'], { totalUnread: 1, totalRead: 0 });
		}
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response('{}', { status: 200 }));
		await first.apiFetch(
			kind === 'mark-all-read' ? '/articles/mark-all-read' : `/articles/article-1/${kind}`,
			{ method: 'PATCH' },
		);
		const origin = new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('X-Self-Feed-Client-Id');
		expect(origin).toBe(first.getClientId());
		const common = { eventId: 'event-1', clientId: origin, updatedAt: '2026-09-01T00:00:00.000Z' };
		const event: RealtimeEvent =
			kind === 'read'
				? {
						...common,
						type: 'article.read_state_changed',
						articleId: 'article-1',
						feedId: 'feed-1',
						isRead: true,
						source: 'manual',
					}
				: kind === 'saved'
					? {
							...common,
							type: 'article.saved_state_changed',
							articleId: 'article-1',
							feedId: 'feed-1',
							isSaved: true,
						}
					: {
							...common,
							type: 'articles.marked_read',
							feedIds: ['feed-1'],
							scope: {},
							markedCount: 1,
						};
		if (kind !== 'mark-all-read') await queueArticleStateMutation(kind, 'article-1', true);
		await reconcileRealtimeEvent(firstCache, event, { clientId: first.getClientId() });
		await reconcileRealtimeEvent(secondCache, event, { clientId: second.getClientId() });
		expect(firstCache.getQueryData(['article', 'article-1'])).toMatchObject({
			isRead: false,
			isSaved: false,
		});
		expect(secondCache.getQueryData(['article', 'article-1'])).toMatchObject(
			kind === 'saved' ? { isSaved: true } : { isRead: true },
		);
		if (kind !== 'saved') {
			expect(secondCache.getQueryData(['feeds'])).toEqual([{ id: 'feed-1', unreadCount: 0 }]);
			expect(secondCache.getQueryData(['stats'])).toMatchObject({ totalUnread: 0, totalRead: 1 });
		}
		if (kind !== 'mark-all-read') {
			await queueArticleStateMutation(kind, 'article-1', false);
			secondCache.setQueryData(['article', 'article-1'], {
				id: 'article-1',
				feedId: 'feed-1',
				isRead: false,
				isSaved: false,
			});
			await reconcileRealtimeEvent(secondCache, event, { clientId: second.getClientId() });
			expect(secondCache.getQueryData(['article', 'article-1'])).toMatchObject({
				isRead: false,
				isSaved: false,
			});
		}
		firstCache.clear();
		secondCache.clear();
	});
});
