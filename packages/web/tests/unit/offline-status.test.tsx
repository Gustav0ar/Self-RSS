import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
	act,
	cleanup,
	fireEvent,
	render,
	renderHook,
	screen,
	waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineTextStatus } from '../../src/components/articles/offline-text-status';
import { SyncStatusLine } from '../../src/components/layout/sync-status-line';
import { useArticle } from '../../src/hooks/queries/article-hooks';
import { clearTokens } from '../../src/lib/api';
import {
	clearOfflineState,
	flushOfflineArticleMutations,
	persistQueryClient,
	queueArticleStateMutation,
	readOfflineSnapshot,
	setOfflineSessionUser,
} from '../../src/lib/offline-store';
import { OfflineStatusProvider } from '../../src/providers/offline-status';

function showStatus(userId = 'user-1', client = new QueryClient(), sessionOffline = false) {
	return render(
		<QueryClientProvider client={client}>
			<OfflineStatusProvider key={userId} userId={userId} sessionOffline={sessionOffline}>
				<OfflineTextStatus articleId="article-1" />
				<SyncStatusLine />
			</OfflineStatusProvider>
		</QueryClientProvider>,
	);
}

beforeEach(async () => {
	clearTokens();
	setOfflineSessionUser('user-1');
	await clearOfflineState('user-1');
	await clearOfflineState('user-2');
	vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});

afterEach(() => {
	cleanup();
	setOfflineSessionUser(null);
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('offline status', () => {
	it('respects the authenticated offline fallback even when the browser reports connectivity', async () => {
		showStatus('user-1', new QueryClient(), true);
		await screen.findByText('Offline');
		expect(screen.queryByText('Up to date')).toBeNull();
	});

	it('opens text downloaded by another tab from disk while offline', async () => {
		const downloadingTab = new QueryClient();
		downloadingTab.setQueryData(['article', 'article-1'], {
			id: 'article-1',
			contentHtml: '<p>Body</p>',
		});
		await persistQueryClient(downloadingTab, 'user-1');
		const readingTab = new QueryClient();
		showStatus('user-1', readingTab);
		await screen.findByText('Text available offline');
		expect(readingTab.getQueryData(['article', 'article-1'])).toBeUndefined();
		vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
		const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
		const { result } = renderHook(() => useArticle('article-1'), {
			wrapper: ({ children }) => (
				<QueryClientProvider client={readingTab}>{children}</QueryClientProvider>
			),
		});
		await waitFor(() => expect(result.current.data?.contentHtml).toBe('<p>Body</p>'));
		expect(fetch).not.toHaveBeenCalled();
	});

	it('shows rejected changes until dismissed instead of reporting them as synced', async () => {
		await queueArticleStateMutation('saved', 'article-1', true);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ error: { message: 'Forbidden' } }), { status: 403 }),
		);
		showStatus();
		await screen.findByText('1 change waiting');
		fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await screen.findByText('1 change rejected');
		expect(screen.queryByText('Up to date')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
		await screen.findByText('Up to date');
	});

	it('reports unknown until storage resolves and counts durable, coalesced changes after reload', async () => {
		await queueArticleStateMutation('read', 'article-1', true);
		await queueArticleStateMutation('read', 'article-1', false);
		await queueArticleStateMutation('saved', 'article-1', true);
		vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
		const view = showStatus();
		expect(screen.getByText('Checking sync status')).toBeTruthy();
		await screen.findByText('2 changes waiting');
		expect(screen.getByText('Syncs when online')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
		view.unmount();
		showStatus();
		await screen.findByText('2 changes waiting');
	});

	it('never calls an offline device up to date or exposes another account’s cache and queue', async () => {
		const client = new QueryClient();
		client.setQueryData(['article', 'article-1'], { id: 'article-1', contentHtml: '<p>Body</p>' });
		await persistQueryClient(client, 'user-1');
		await queueArticleStateMutation('saved', 'article-1', true);
		setOfflineSessionUser('user-2');
		vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
		showStatus('user-2');
		await screen.findByText('Offline');
		expect(screen.getByText('Text not downloaded')).toBeTruthy();
		expect(screen.queryByText('1 change waiting')).toBeNull();
	});

	it('marks text available only after persistence, and removes expired text', async () => {
		const client = new QueryClient();
		client.setQueryData(['article', 'article-1'], { id: 'article-1', contentHtml: '<p>Body</p>' });
		const view = showStatus('user-1', client);
		await screen.findByText('Text not downloaded');
		await act(() => persistQueryClient(client, 'user-1'));
		await screen.findByText('Text available offline');
		view.unmount();
		showStatus();
		await screen.findByText('Text available offline');
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(Date.now() + 8 * 24 * 60 * 60 * 1000);
		fireEvent.focus(window);
		await screen.findByText('Text not downloaded');
	});

	it('does not label saved list entries, excerpts, or aborted writes as downloaded text', async () => {
		const client = new QueryClient();
		client.setQueryData(['articles'], [{ id: 'article-1', isSaved: true }]);
		client.setQueryData(['article', 'article-1'], {
			id: 'article-1',
			excerpt: 'Summary',
			contentHtml: '',
		});
		await persistQueryClient(client, 'user-1');
		expect((await readOfflineSnapshot('user-1')).articleIds.size).toBe(0);
		client.setQueryData(['article', 'article-1'], {
			id: 'article-1',
			contentHtml:
				'<img src="https://example.com/image.jpg"><iframe src="https://example.com/embed"></iframe>',
			contentText: null,
		});
		await persistQueryClient(client, 'user-1');
		expect((await readOfflineSnapshot('user-1')).articleIds.size).toBe(0);
		client.setQueryData(['article', 'article-1'], { id: 'article-1', contentHtml: '<p>Body</p>' });
		const put = IDBObjectStore.prototype.put;
		vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
			this: IDBObjectStore,
			value,
			key,
		) {
			const request = put.call(this, value, key);
			this.transaction.abort();
			return request;
		});
		await persistQueryClient(client, 'user-1');
		expect((await readOfflineSnapshot('user-1')).articleIds.size).toBe(0);
	});

	it('does not promise persistence when IndexedDB is unavailable', async () => {
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
		if (!descriptor) throw new Error('IndexedDB fixture missing');
		Reflect.deleteProperty(globalThis, 'indexedDB');
		try {
			const client = new QueryClient();
			client.setQueryData(['article', 'article-1'], {
				id: 'article-1',
				contentHtml: '<p>Body</p>',
			});
			await persistQueryClient(client, 'user-1');
			showStatus();
			await screen.findByText('Offline storage unavailable');
			expect(screen.getByText('Text not downloaded')).toBeTruthy();
		} finally {
			cleanup();
			await clearOfflineState('user-1');
			Object.defineProperty(globalThis, 'indexedDB', descriptor);
		}
	});

	it('keeps Retry after a failed delivery and clears the count after acknowledgement', async () => {
		const mutation = await queueArticleStateMutation('saved', 'article-1', true);
		const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('unreachable'));
		await flushOfflineArticleMutations();
		showStatus();
		await screen.findByText('1 change waiting');
		fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
		await screen.findByRole('button', { name: 'Retry' });
		fetch.mockResolvedValue(
			new Response(
				JSON.stringify({
					data: {
						success: true,
						applied: true,
						conflict: false,
						duplicate: false,
						saved: true,
						revision: 1,
					},
				}),
				{ status: 200 },
			),
		);
		fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await screen.findByText('Up to date');
		expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
		expect(fetch.mock.calls[2]?.[1]?.body).toContain(mutation.mutationId);
	});
});
