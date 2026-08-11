import type { User } from '@self-feed/shared';
import { type DehydratedState, dehydrate, hydrate, type QueryClient } from '@tanstack/react-query';

const DATABASE_NAME = 'self-feed-offline';
const STORE_NAME = 'state';
const DATABASE_VERSION = 1;
const QUERY_CACHE_KEY = 'query-cache-v1';
const USER_KEY = 'last-user-v1';
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PERSISTED_QUERY_ROOTS = new Set([
	'article',
	'articles',
	'categories',
	'feeds',
	'preferences',
	'search',
	'stats',
]);

interface PersistedQueryCache {
	persistedAt: number;
	state: DehydratedState;
}

function openDatabase(): Promise<IDBDatabase | null> {
	if (!('indexedDB' in globalThis)) return Promise.resolve(null);
	return new Promise((resolve) => {
		const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(STORE_NAME)) {
				request.result.createObjectStore(STORE_NAME);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => resolve(null);
	});
}

async function readValue<T>(key: string): Promise<T | null> {
	const database = await openDatabase();
	if (!database) return null;
	return new Promise((resolve) => {
		const transaction = database.transaction(STORE_NAME, 'readonly');
		const request = transaction.objectStore(STORE_NAME).get(key);
		request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
		request.onerror = () => resolve(null);
		transaction.oncomplete = () => database.close();
		transaction.onerror = () => database.close();
	});
}

async function writeValue(key: string, value: unknown): Promise<void> {
	const database = await openDatabase();
	if (!database) return;
	await new Promise<void>((resolve) => {
		const transaction = database.transaction(STORE_NAME, 'readwrite');
		transaction.objectStore(STORE_NAME).put(value, key);
		transaction.oncomplete = () => {
			database.close();
			resolve();
		};
		transaction.onerror = () => {
			database.close();
			resolve();
		};
	});
}

async function deleteValue(key: string): Promise<void> {
	const database = await openDatabase();
	if (!database) return;
	await new Promise<void>((resolve) => {
		const transaction = database.transaction(STORE_NAME, 'readwrite');
		transaction.objectStore(STORE_NAME).delete(key);
		transaction.oncomplete = () => {
			database.close();
			resolve();
		};
		transaction.onerror = () => {
			database.close();
			resolve();
		};
	});
}

function shouldPersistQuery(queryKey: readonly unknown[]) {
	return typeof queryKey[0] === 'string' && PERSISTED_QUERY_ROOTS.has(queryKey[0]);
}

export async function persistQueryClient(queryClient: QueryClient): Promise<void> {
	const state = dehydrate(queryClient, {
		shouldDehydrateQuery: (query) =>
			query.state.status === 'success' && shouldPersistQuery(query.queryKey),
	});
	await writeValue(QUERY_CACHE_KEY, {
		persistedAt: Date.now(),
		state,
	} satisfies PersistedQueryCache);
}

export async function restoreQueryClient(queryClient: QueryClient): Promise<void> {
	const cached = await readValue<PersistedQueryCache>(QUERY_CACHE_KEY);
	if (!cached) return;
	if (Date.now() - cached.persistedAt > MAX_CACHE_AGE_MS) {
		await clearOfflineQueryCache();
		return;
	}
	hydrate(queryClient, cached.state);
}

export async function saveOfflineUser(user: User): Promise<void> {
	await writeValue(USER_KEY, user);
}

export async function loadOfflineUser(): Promise<User | null> {
	return readValue<User>(USER_KEY);
}

export async function clearOfflineQueryCache(): Promise<void> {
	await deleteValue(QUERY_CACHE_KEY);
}

export async function clearOfflineState(): Promise<void> {
	await Promise.all([deleteValue(QUERY_CACHE_KEY), deleteValue(USER_KEY)]);
}
