import 'fake-indexeddb/auto';
import type { ApiListResponse, ArticleListItem } from '@self-feed/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMarkRead, useSetArticleSaved } from '../../src/hooks/queries';
import * as offlineStore from '../../src/lib/offline-store';
import {
	clearOfflineState,
	hasPendingArticleStateMutation,
	queueArticleStateMutation,
	setOfflineSessionUser,
} from '../../src/lib/offline-store';

const listKey = ['articles', { feedId: 'feed-1' }] as const;
function article(isRead: boolean, isSaved: boolean): ArticleListItem {
	return {
		id: 'article-1',
		feedId: 'feed-1',
		feedTitle: 'Feed',
		feedFaviconUrl: null,
		canonicalUrl: null,
		title: 'Article',
		author: null,
		excerpt: null,
		heroImageUrl: null,
		publishedAt: null,
		displayedAt: '2026-09-01T00:00:00.000Z',
		isRead,
		isSaved,
		contentStatus: 'feed_ready',
		contentVersion: 1,
	};
}

afterEach(async () => {
	await clearOfflineState('reconciliation-reader');
	setOfflineSessionUser(null);
	vi.restoreAllMocks();
});

describe('article mutation reconciliation', () => {
	it.each([
		'server',
		'storage',
	] as const)('restores a Saved-only row with its acknowledged read state after %s rejection', async (rejection) => {
		setOfflineSessionUser('reconciliation-reader');
		const client = new QueryClient();
		const savedKey = ['articles', { savedOnly: true }] as const;
		client.setQueryData(savedKey, { data: [article(false, true)], cursor: null, hasMore: false });
		const queue = offlineStore.queueArticleStateMutation;
		let releaseSave = () => {};
		const saveReady = new Promise<void>((resolve) => {
			releaseSave = resolve;
		});
		const queueSpy = vi
			.spyOn(offlineStore, 'queueArticleStateMutation')
			.mockImplementation(async (kind, ...args) => {
				if (kind === 'saved') {
					await saveReady;
					if (rejection === 'storage') throw new Error('Storage full');
				}
				return queue(kind, ...args);
			});
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
			String(input).endsWith('/read')
				? new Response(
						JSON.stringify({ data: { success: true, applied: true, read: true, revision: 1 } }),
						{ status: 200 },
					)
				: new Response('{}', { status: 403 }),
		);
		const { result, unmount } = renderHook(
			() => ({ read: useMarkRead(), saved: useSetArticleSaved() }),
			{
				wrapper: ({ children }) => (
					<QueryClientProvider client={client}>{children}</QueryClientProvider>
				),
			},
		);
		await act(async () => {
			const saving = result.current.saved
				.mutateAsync({ articleId: 'article-1', saved: false })
				.catch((error: unknown) => error);
			await vi.waitFor(() => expect(queueSpy).toHaveBeenCalledTimes(1));
			expect(client.getQueryData<ApiListResponse<ArticleListItem>>(savedKey)?.data).toEqual([]);
			await result.current.read.mutateAsync({ articleId: 'article-1', read: true });
			expect(client.getQueryData(['article', 'article-1'])).toBeUndefined();
			releaseSave();
			await saving;
		});
		expect(client.getQueryData<ApiListResponse<ArticleListItem>>(savedKey)?.data[0]).toMatchObject({
			isRead: true,
			isSaved: true,
		});
		unmount();
		client.clear();
	});

	it('keeps a successful read update when saving fails before it reaches the outbox', async () => {
		setOfflineSessionUser('reconciliation-reader');
		const client = new QueryClient();
		client.setQueryData(listKey, { data: [article(false, false)], cursor: null, hasMore: false });
		const queue = offlineStore.queueArticleStateMutation;
		let rejectSave = () => {};
		const failedWrite = new Promise<never>((_resolve, reject) => {
			rejectSave = () => reject(new Error('Storage full'));
		});
		const queueSpy = vi
			.spyOn(offlineStore, 'queueArticleStateMutation')
			.mockImplementation((kind, ...args) =>
				kind === 'saved' ? failedWrite : queue(kind, ...args),
			);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
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
				{ status: 200 },
			),
		);
		const { result, unmount } = renderHook(
			() => ({ read: useMarkRead(), saved: useSetArticleSaved() }),
			{
				wrapper: ({ children }) => (
					<QueryClientProvider client={client}>{children}</QueryClientProvider>
				),
			},
		);
		await act(async () => {
			const saving = result.current.saved
				.mutateAsync({ articleId: 'article-1', saved: true })
				.catch((error: unknown) => error);
			await vi.waitFor(() => expect(queueSpy).toHaveBeenCalledTimes(1));
			await result.current.read.mutateAsync({ articleId: 'article-1', read: true });
			rejectSave();
			expect(await saving).toBeInstanceOf(Error);
		});
		expect(client.getQueryData<ApiListResponse<ArticleListItem>>(listKey)?.data[0]).toMatchObject({
			isRead: true,
			isSaved: false,
		});
		unmount();
		client.clear();
	});

	it('rolls coalesced rejected toggles back to the state before either optimistic change', async () => {
		setOfflineSessionUser('reconciliation-reader');
		const client = new QueryClient();
		client.setQueryData(listKey, { data: [article(false, false)], cursor: null, hasMore: false });
		const queueSpy = vi.spyOn(offlineStore, 'queueArticleStateMutation');
		let releaseBlocker = () => {};
		const blockerResponse = new Promise<void>((resolve) => {
			releaseBlocker = resolve;
		});
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			if (String(input).includes('article-blocker')) {
				await blockerResponse;
				return new Response(JSON.stringify({ data: { success: true, saved: true, revision: 1 } }), {
					status: 200,
				});
			}
			return new Response('{}', { status: 403 });
		});
		await queueArticleStateMutation('saved', 'article-blocker', true);
		const flush = offlineStore.flushOfflineArticleMutations();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const { result, unmount } = renderHook(() => useMarkRead(), {
			wrapper: ({ children }) => (
				<QueryClientProvider client={client}>{children}</QueryClientProvider>
			),
		});
		await act(async () => {
			const first = result.current.mutateAsync({ articleId: 'article-1', read: true });
			await vi.waitFor(() => expect(queueSpy).toHaveBeenCalledTimes(2));
			await queueSpy.mock.results.at(-1)?.value;
			const second = result.current.mutateAsync({ articleId: 'article-1', read: false });
			await vi.waitFor(() => expect(queueSpy).toHaveBeenCalledTimes(3));
			await queueSpy.mock.results.at(-1)?.value;
			releaseBlocker();
			await Promise.all([flush, first, second]);
		});
		expect(client.getQueryData<ApiListResponse<ArticleListItem>>(listKey)?.data[0]?.isRead).toBe(
			false,
		);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		unmount();
		client.clear();
	});

	it('preserves a newer queued intent when another article stops the flush', async () => {
		setOfflineSessionUser('reconciliation-reader');
		const client = new QueryClient();
		client.setQueryData(listKey, { data: [article(false, false)], cursor: null, hasMore: false });
		let releaseRead = () => {};
		let releaseBlocker = () => {};
		const readResponse = new Promise<void>((resolve) => {
			releaseRead = resolve;
		});
		const blockerResponse = new Promise<void>((resolve) => {
			releaseBlocker = resolve;
		});
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			if (String(input).includes('article-blocker')) {
				await blockerResponse;
				return new Response(null, { status: 503 });
			}
			await readResponse;
			return new Response(
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
			);
		});
		const { result, unmount } = renderHook(() => useMarkRead(), {
			wrapper: ({ children }) => (
				<QueryClientProvider client={client}>{children}</QueryClientProvider>
			),
		});
		await act(async () => {
			const first = result.current.mutateAsync({ articleId: 'article-1', read: true });
			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
			await queueArticleStateMutation('saved', 'article-blocker', true);
			releaseRead();
			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
			const second = result.current.mutateAsync({ articleId: 'article-1', read: false });
			await vi.waitFor(async () =>
				expect(await hasPendingArticleStateMutation('article-1', 'read')).toBe(true),
			);
			releaseBlocker();
			await Promise.all([first, second]);
		});
		expect(client.getQueryData<ApiListResponse<ArticleListItem>>(listKey)?.data[0]?.isRead).toBe(
			false,
		);
		expect(await hasPendingArticleStateMutation('article-1', 'read')).toBe(true);
		unmount();
		client.clear();
	});

	it.each([
		{ firstKind: 'read', rejectedKind: null },
		{ firstKind: 'saved', rejectedKind: null },
		{ firstKind: 'read', rejectedKind: 'saved' },
		{ firstKind: 'saved', rejectedKind: 'read' },
	] as const)('reconciles independent fields: %j', async ({ firstKind, rejectedKind }) => {
		setOfflineSessionUser('reconciliation-reader');
		const client = new QueryClient();
		client.setQueryData(listKey, { data: [article(false, true)], cursor: null, hasMore: false });
		let releaseFirst = () => {};
		const firstResponse = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const kind = String(input).endsWith('/read') ? 'read' : 'saved';
			if (kind === firstKind) await firstResponse;
			if (kind === rejectedKind) return new Response('{}', { status: 403 });
			return new Response(
				JSON.stringify({
					data: {
						success: true,
						applied: true,
						conflict: false,
						duplicate: false,
						[kind]: kind === 'read',
						revision: 1,
					},
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			);
		});
		const { result, unmount } = renderHook(
			() => ({ read: useMarkRead(), saved: useSetArticleSaved() }),
			{
				wrapper: ({ children }) => (
					<QueryClientProvider client={client}>{children}</QueryClientProvider>
				),
			},
		);
		await act(async () => {
			const first =
				firstKind === 'read'
					? result.current.read.mutateAsync({ articleId: 'article-1', read: true })
					: result.current.saved.mutateAsync({ articleId: 'article-1', saved: false });
			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
			const second =
				firstKind === 'read'
					? result.current.saved.mutateAsync({ articleId: 'article-1', saved: false })
					: result.current.read.mutateAsync({ articleId: 'article-1', read: true });
			await vi.waitFor(async () =>
				expect(
					await hasPendingArticleStateMutation(
						'article-1',
						firstKind === 'read' ? 'saved' : 'read',
					),
				).toBe(true),
			);
			releaseFirst();
			await Promise.all([first, second]);
		});
		expect(client.getQueryData<ApiListResponse<ArticleListItem>>(listKey)?.data[0]).toMatchObject({
			isRead: rejectedKind !== 'read',
			isSaved: rejectedKind === 'saved',
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		unmount();
		client.clear();
	});
});
