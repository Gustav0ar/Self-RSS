import 'fake-indexeddb/auto';
import type { User } from '@self-feed/shared';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearTokens, setTokens } from '../../src/lib/api';
import {
	flushOfflineArticleMutations,
	hasPendingArticleStateMutation,
	loadOfflineUser,
	persistQueryClient,
	queueArticleStateMutation,
	restoreQueryClient,
	saveOfflineUser,
	setOfflineSessionUser,
	setSignedOutLocally,
} from '../../src/lib/offline-store';

const DATABASE_NAME = 'self-feed-offline';

async function clearDatabase() {
	await new Promise<void>((resolve) => {
		const request = indexedDB.deleteDatabase(DATABASE_NAME);
		request.onsuccess = () => resolve();
		request.onerror = () => resolve();
		request.onblocked = () => resolve();
	});
}

function mutationResponse(
	overrides: Partial<{
		applied: boolean;
		conflict: boolean;
		duplicate: boolean;
		read: boolean;
		saved: boolean;
		revision: number;
	}> = {},
) {
	return new Response(
		JSON.stringify({
			data: {
				success: true,
				applied: true,
				conflict: false,
				duplicate: false,
				revision: 1,
				...overrides,
			},
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	);
}

beforeEach(async () => {
	clearTokens();
	setOfflineSessionUser(null);
	await clearDatabase();
});

afterEach(async () => {
	clearTokens();
	setOfflineSessionUser(null);
	vi.restoreAllMocks();
	await clearDatabase();
});

describe('offline article mutation outbox', () => {
	it('retains the same durable mutation after a transient delivery failure', async () => {
		setOfflineSessionUser('user-1');
		const mutation = await queueArticleStateMutation('read', 'article-1', true, 'manual');
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockRejectedValueOnce(new TypeError('offline'))
			.mockResolvedValueOnce(mutationResponse({ read: true, revision: 2 }));

		const offline = await flushOfflineArticleMutations();
		const delivered = await flushOfflineArticleMutations();
		await flushOfflineArticleMutations();

		expect(offline).toMatchObject([{ status: 'queued' }]);
		expect(delivered).toMatchObject([{ status: 'applied', authoritativeState: true }]);
		const firstBody = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
		const secondBody = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string);
		expect(firstBody.mutationId).toBe(mutation.mutationId);
		expect(secondBody.mutationId).toBe(mutation.mutationId);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('retains a mutation when token refresh is temporarily unavailable', async () => {
		setOfflineSessionUser('user-1');
		setTokens('expired-access-token');
		await queueArticleStateMutation('read', 'article-1', true, 'manual');
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'expired' } }), {
					status: 401,
					headers: { 'Content-Type': 'application/json' },
				}),
			)
			.mockResolvedValueOnce(new Response(null, { status: 503 }));

		const result = await flushOfflineArticleMutations();

		expect(result).toMatchObject([{ status: 'queued' }]);
		expect(await hasPendingArticleStateMutation('article-1', 'read')).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('coalesces rapid toggles to the newest desired state', async () => {
		setOfflineSessionUser('user-1');
		await queueArticleStateMutation('read', 'article-1', true, 'manual');
		const newest = await queueArticleStateMutation('read', 'article-1', false, 'manual');
		expect(await hasPendingArticleStateMutation('article-1', 'read')).toBe(true);
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(mutationResponse({ read: false, revision: 1 }));

		await flushOfflineArticleMutations();
		expect(await hasPendingArticleStateMutation('article-1', 'read')).toBe(false);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
		expect(body).toMatchObject({ read: false, mutationId: newest.mutationId });
	});

	it('atomically keeps concurrent mutations when Web Locks are unavailable', async () => {
		setOfflineSessionUser('user-1');
		await Promise.all([
			queueArticleStateMutation('read', 'article-1', true, 'manual'),
			queueArticleStateMutation('saved', 'article-2', true),
		]);
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(mutationResponse({ read: true, saved: true }));

		const results = await flushOfflineArticleMutations();

		expect(results).toHaveLength(2);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('rebases a conflict with a new idempotency key and retries in order', async () => {
		setOfflineSessionUser('user-1');
		const original = await queueArticleStateMutation('saved', 'article-1', true);
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(
				mutationResponse({ applied: false, conflict: true, saved: false, revision: 3 }),
			)
			.mockResolvedValueOnce(mutationResponse({ saved: true, revision: 4 }));

		const results = await flushOfflineArticleMutations();

		expect(results.map((result) => result.status)).toEqual(['reconciled', 'applied']);
		const firstBody = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
		const secondBody = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string);
		expect(firstBody.mutationId).toBe(original.mutationId);
		expect(secondBody.mutationId).not.toBe(original.mutationId);
		expect(secondBody).toMatchObject({ saved: true, baseRevision: 3 });
	});

	it('strictly isolates queued actions by account', async () => {
		setOfflineSessionUser('user-1');
		await queueArticleStateMutation('read', 'article-user-1', true);
		setOfflineSessionUser('user-2');
		await queueArticleStateMutation('read', 'article-user-2', true);
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(mutationResponse({ read: true }));

		await flushOfflineArticleMutations();
		setOfflineSessionUser('user-1');
		await flushOfflineArticleMutations();

		expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
			expect.stringContaining('/articles/article-user-2/read'),
			expect.stringContaining('/articles/article-user-1/read'),
		]);
	});

	it('flushes a newly selected account independently of an older in-flight account', async () => {
		setOfflineSessionUser('user-1');
		await queueArticleStateMutation('read', 'article-user-1', true);
		let releaseFirst: ((response: Response) => void) | undefined;
		const firstResponse = new Promise<Response>((resolve) => {
			releaseFirst = resolve;
		});
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockImplementation((request) =>
				String(request).includes('article-user-1')
					? firstResponse
					: Promise.resolve(mutationResponse({ read: true })),
			);
		const firstFlush = flushOfflineArticleMutations();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

		setOfflineSessionUser('user-2');
		await queueArticleStateMutation('read', 'article-user-2', true);
		const secondResult = await flushOfflineArticleMutations();

		expect(secondResult).toMatchObject([{ status: 'applied' }]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		releaseFirst?.(mutationResponse({ read: true }));
		await firstFlush;
	});
});

describe('offline identity and query cache', () => {
	it('a local sign-out tombstone prevents refresh-cookie resurrection', async () => {
		const user: User = {
			id: 'user-1',
			email: 'reader@example.com',
			role: 'user',
			isActive: true,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		};
		await saveOfflineUser(user);
		expect(await loadOfflineUser()).toEqual(user);

		await setSignedOutLocally(true);

		expect(await loadOfflineUser()).toBeNull();
	});

	it('rejects an offline identity lease created implausibly far in the future', async () => {
		const user: User = {
			id: 'user-1',
			email: 'reader@example.com',
			role: 'user',
			isActive: true,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		};
		const now = 1_700_000_000_000;
		vi.spyOn(Date, 'now').mockReturnValue(now + 10 * 60 * 1000);
		await saveOfflineUser(user);
		vi.mocked(Date.now).mockReturnValue(now);

		expect(await loadOfflineUser()).toBeNull();
	});

	it('merges independent tab snapshots without crossing account boundaries', async () => {
		const firstTab = new QueryClient();
		firstTab.setQueryData(['articles', 'feed-1'], [{ id: 'article-1' }]);
		await persistQueryClient(firstTab, 'user-1');
		const secondTab = new QueryClient();
		secondTab.setQueryData(['feeds'], [{ id: 'feed-1' }]);
		await persistQueryClient(secondTab, 'user-1');

		const restored = new QueryClient();
		expect(await restoreQueryClient(restored, 'user-1')).toBe(true);
		expect(restored.getQueryData(['articles', 'feed-1'])).toEqual([{ id: 'article-1' }]);
		expect(restored.getQueryData(['feeds'])).toEqual([{ id: 'feed-1' }]);
		const otherAccount = new QueryClient();
		expect(await restoreQueryClient(otherAccount, 'user-2')).toBe(false);
		expect(otherAccount.getQueryCache().getAll()).toHaveLength(0);
	});
});
