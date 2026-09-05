// @vitest-environment-options {"url":"https://reader.example"}
import 'fake-indexeddb/auto';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	flushOfflineArticleMutations,
	hasPendingArticleStateMutation,
	loadOfflineUser,
	queueArticleStateMutation,
	restoreQueryClient,
	setOfflineSessionUser,
} from '../../src/lib/offline-store';
import legacyV1 from '../fixtures/offline-cache-v1.json';
import legacyV2 from '../fixtures/offline-cache-v2.json';

const databaseName = 'self-feed-offline';
const ownerId = 'legacy-reader';
const prefix = 'https://reader.example';

async function deleteDatabase() {
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.deleteDatabase(databaseName);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}

async function seedDatabase(version: number, records: Record<string, unknown>) {
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.open(databaseName, version);
		request.onupgradeneeded = () => {
			request.result.createObjectStore('state');
		};
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const database = request.result;
			const transaction = database.transaction('state', 'readwrite');
			for (const [key, value] of Object.entries(records))
				transaction.objectStore('state').put(value, key);
			transaction.oncomplete = () => {
				database.close();
				resolve();
			};
			transaction.onerror = () => {
				database.close();
				reject(transaction.error);
			};
		};
	});
}

async function snapshotDatabase() {
	return new Promise<{ version: number; records: Map<IDBValidKey, unknown> }>((resolve, reject) => {
		const request = indexedDB.open(databaseName);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const database = request.result;
			const transaction = database.transaction('state', 'readonly');
			const records = new Map<IDBValidKey, unknown>();
			const cursor = transaction.objectStore('state').openCursor();
			cursor.onsuccess = () => {
				if (!cursor.result) return;
				records.set(cursor.result.key, cursor.result.value);
				cursor.result.continue();
			};
			transaction.oncomplete = () => {
				database.close();
				resolve({ version: database.version, records });
			};
			transaction.onerror = () => {
				database.close();
				reject(transaction.error);
			};
		};
	});
}

beforeEach(async () => {
	await deleteDatabase();
	vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-04T00:00:00.000Z'));
	setOfflineSessionUser(ownerId);
});

afterEach(async () => {
	setOfflineSessionUser(null);
	vi.restoreAllMocks();
	await deleteDatabase();
});

describe('offline cache forward migrations', () => {
	it('creates a clean version 3 database with a usable durable outbox', async () => {
		await queueArticleStateMutation('read', 'new-article', true);
		expect(await hasPendingArticleStateMutation('new-article', 'read')).toBe(true);
		expect((await snapshotDatabase()).version).toBe(3);
		expect(await loadOfflineUser()).toBeNull();
	});

	it('recovers the v1 cache for its recorded owner without creating an offline lease', async () => {
		await seedDatabase(1, legacyV1);
		const client = new QueryClient();
		expect(await restoreQueryClient(client, ownerId)).toBe(true);
		expect(client.getQueryData(['article', 'legacy-article'])).toEqual(
			legacyV1['query-cache-v1'].state.queries[0]?.state.data,
		);
		expect(await loadOfflineUser()).toBeNull();
		const otherClient = new QueryClient();
		expect(await restoreQueryClient(otherClient, 'other-reader')).toBe(false);
		const snapshot = await snapshotDatabase();
		expect(snapshot.version).toBe(3);
		for (const [key, value] of Object.entries(legacyV1))
			expect(snapshot.records.get(key)).toEqual(value);
		client.clear();
		otherClient.clear();
	});

	it('recovers stranded legacy records while preserving v2 state and queued mutations', async () => {
		await seedDatabase(2, legacyV2);
		const client = new QueryClient();
		expect(await restoreQueryClient(client, ownerId)).toBe(true);
		expect(client.getQueryData(['article', 'legacy-article'])).toMatchObject({
			title: 'Legacy article',
		});
		expect(client.getQueryData(['article', 'shared-article'])).toMatchObject({
			title: 'Current title',
		});
		expect(await loadOfflineUser()).toEqual(legacyV1['last-user-v1']);
		const snapshot = await snapshotDatabase();
		expect(snapshot.version).toBe(3);
		for (const [key, value] of Object.entries(legacyV2)) {
			if (key !== `${prefix}:query-cache:${ownerId}:v2`)
				expect(snapshot.records.get(key)).toEqual(value);
		}
		expect(await hasPendingArticleStateMutation('shared-article', 'saved')).toBe(true);
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					data: {
						success: true,
						applied: true,
						conflict: false,
						duplicate: false,
						saved: true,
						revision: 5,
					},
				}),
				{ status: 200 },
			),
		);
		await flushOfflineArticleMutations();
		expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
			mutationId: 'persisted-mutation',
			saved: true,
			baseRevision: 4,
		});
		expect(await hasPendingArticleStateMutation('shared-article', 'saved')).toBe(false);
		client.clear();
	});

	it('preserves a v2 sign-out tombstone instead of reviving the legacy identity', async () => {
		const key = `${prefix}:signed-out:v2`;
		await seedDatabase(2, { ...legacyV2, [key]: { at: Date.now() } });
		expect(await loadOfflineUser()).toBeNull();
		expect((await snapshotDatabase()).records.get(key)).toEqual({ at: Date.now() });
	});

	it('leaves unowned legacy data untouched and inaccessible', async () => {
		await seedDatabase(1, { 'query-cache-v1': legacyV1['query-cache-v1'] });
		const client = new QueryClient();
		expect(await restoreQueryClient(client, ownerId)).toBe(false);
		expect((await snapshotDatabase()).records.get('query-cache-v1')).toEqual(
			legacyV1['query-cache-v1'],
		);
		client.clear();
	});
});
