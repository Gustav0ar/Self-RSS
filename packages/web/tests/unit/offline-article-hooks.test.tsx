import 'fake-indexeddb/auto';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMarkRead, useSetArticleSaved } from '../../src/hooks/queries';
import {
	clearOfflineState,
	flushOfflineArticleMutations,
	hasPendingArticleStateMutation,
	persistQueryClient,
	restoreQueryClient,
	setOfflineSessionUser,
} from '../../src/lib/offline-store';

afterEach(async () => {
	onlineManager.setOnline(true);
	await clearOfflineState('offline-reader');
	setOfflineSessionUser(null);
	vi.restoreAllMocks();
});

describe('durable article mutations while the browser is offline', () => {
	it.each([
		'read',
		'saved',
	] as const)('replays %s intent after replacing the query client', async (kind) => {
		vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
		onlineManager.setOnline(false);
		setOfflineSessionUser('offline-reader');
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					data: {
						success: true,
						applied: true,
						conflict: false,
						duplicate: false,
						[kind]: true,
						revision: 1,
					},
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			),
		);
		const client = new QueryClient();
		client.setQueryData(['articles', 'cached'], {
			data: [{ id: 'article-1', isRead: false, isSaved: false }],
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
			if (kind === 'read')
				await result.current.read.mutateAsync({ articleId: 'article-1', read: true });
			else await result.current.saved.mutateAsync({ articleId: 'article-1', saved: true });
			expect(await hasPendingArticleStateMutation('article-1', kind)).toBe(true);
			await persistQueryClient(client, 'offline-reader');
		});
		expect(fetchMock).not.toHaveBeenCalled();
		unmount();
		client.clear();
		setOfflineSessionUser(null);

		const restored = new QueryClient();
		setOfflineSessionUser('offline-reader');
		expect(await restoreQueryClient(restored, 'offline-reader')).toBe(true);
		expect(restored.getMutationCache().getAll()).toHaveLength(0);
		vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
		onlineManager.setOnline(true);
		const delivered = await flushOfflineArticleMutations();
		expect(delivered).toMatchObject([
			{ status: 'applied', mutation: { kind, desiredState: true } },
		]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(await hasPendingArticleStateMutation('article-1', kind)).toBe(false);
		restored.clear();
	});
});
