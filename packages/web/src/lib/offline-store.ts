import type { ApiResponse, User } from '@self-feed/shared';
import { type DehydratedState, dehydrate, hydrate, type QueryClient } from '@tanstack/react-query';
import { ApiClientError, apiFetch } from './api';
import { parseLegacyQueryCache } from './legacy-query-cache';
import {
	dismissOfflineRejections,
	notifyOfflineChange,
	offlineRejectionCount,
	reportOfflineRejection,
} from './offline-changes';
import { cachedArticleIds, type OfflineSnapshot, readOfflineRecords } from './offline-snapshot';

const DATABASE_NAME = 'self-feed-offline';
const STORE_NAME = 'state';
const DATABASE_VERSION = 3;
// Version 3 migrates legacy records into the existing v2 record format.
const SCHEMA_VERSION = 2;
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const OFFLINE_ACCESS_LEASE_MS = 7 * 24 * 60 * 60 * 1000;
const OFFLINE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_PERSISTED_QUERIES = 600;
const MAX_PERSISTED_BYTES = 10 * 1024 * 1024;
const MAX_OUTBOX_ENTRIES = 1_000;
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
	schemaVersion: number;
	ownerId: string;
	namespace: string;
	persistedAt: number;
	state: DehydratedState;
}

interface PersistedOfflineUser {
	schemaVersion: number;
	namespace: string;
	cachedAt: number;
	offlineAccessUntil: number;
	user: User;
}

export type OfflineArticleMutationKind = 'read' | 'saved';

export interface OfflineArticleMutation {
	mutationId: string;
	articleId: string;
	kind: OfflineArticleMutationKind;
	desiredState: boolean;
	baseRevision?: number;
	source?: 'manual' | 'auto_navigate' | 'auto_open';
	createdAt: number;
}

interface ArticleRevisionState {
	read?: number;
	saved?: number;
}

interface ArticleStateMutationResponse {
	success: true;
	applied: boolean;
	conflict: boolean;
	duplicate: boolean;
	read?: boolean;
	saved?: boolean;
	revision: number;
}

export interface OfflineMutationFlushResult {
	mutation: OfflineArticleMutation;
	status: 'applied' | 'reconciled' | 'queued' | 'discarded';
	authoritativeState?: boolean;
	revision?: number;
}

let activeUserId: string | null = null;
const flushPromises = new Map<string, Promise<OfflineMutationFlushResult[]>>();
const memoryFallbackStore = new Map<string, unknown>();
type WriteDurability = 'relaxed' | 'strict';

function namespace() {
	return globalThis.location?.origin ?? 'self-feed';
}

function cacheKey(userId: string) {
	return `${namespace()}:query-cache:${userId}:v${SCHEMA_VERSION}`;
}

function userKey() {
	return `${namespace()}:last-user:v${SCHEMA_VERSION}`;
}

function signedOutKey() {
	return `${namespace()}:signed-out:v${SCHEMA_VERSION}`;
}

function outboxKey(userId: string) {
	return `${namespace()}:outbox:${userId}:v${SCHEMA_VERSION}`;
}

function revisionsKey(userId: string) {
	return `${namespace()}:article-revisions:${userId}:v${SCHEMA_VERSION}`;
}

function openDatabase(): Promise<IDBDatabase | null> {
	if (!('indexedDB' in globalThis)) return Promise.resolve(null);
	return new Promise((resolve) => {
		const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
		request.onupgradeneeded = (event) => {
			if (!request.result.objectStoreNames.contains(STORE_NAME)) {
				request.result.createObjectStore(STORE_NAME);
			}
			if (event.oldVersion > 0 && event.oldVersion < 3 && request.transaction) {
				migrateLegacyQueryCache(request.transaction.objectStore(STORE_NAME));
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => resolve(null);
	});
}

/** Recover v1 records, including those stranded by the old v2 upgrade. */
function migrateLegacyQueryCache(store: IDBObjectStore) {
	const userRequest = store.get('last-user-v1');
	userRequest.onsuccess = () => {
		const user: unknown = userRequest.result;
		if (!isUser(user)) return;
		const legacyRequest = store.get('query-cache-v1');
		legacyRequest.onsuccess = () => {
			const legacy = parseLegacyQueryCache(legacyRequest.result, PERSISTED_QUERY_ROOTS);
			if (!legacy) return;
			const currentRequest = store.get(cacheKey(user.id));
			currentRequest.onsuccess = () => {
				const value: unknown = currentRequest.result;
				if (value != null && !isPersistedQueryCache(value, user.id)) return;
				const current = isPersistedQueryCache(value, user.id) ? value : null;
				const queries = new Map(legacy.state.queries.map((query) => [query.queryHash, query]));
				// v2 may contain optimistic state backed by its durable outbox.
				for (const query of current?.state.queries ?? []) {
					queries.set(query.queryHash, query);
				}
				store.put(
					{
						schemaVersion: SCHEMA_VERSION,
						ownerId: user.id,
						namespace: namespace(),
						persistedAt: Math.max(legacy.persistedAt, current?.persistedAt ?? 0),
						state: { mutations: [], queries: [...queries.values()] },
					} satisfies PersistedQueryCache,
					cacheKey(user.id),
				);
				// Retain the original records. A legacy identity cannot establish a
				// new offline lease; session activation still requires verification.
			};
		};
	};
}

async function readValue<T>(key: string): Promise<T | null> {
	const database = await openDatabase();
	if (!database) return (memoryFallbackStore.get(key) as T | undefined) ?? null;
	return new Promise((resolve) => {
		const transaction = database.transaction(STORE_NAME, 'readonly');
		const request = transaction.objectStore(STORE_NAME).get(key);
		request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
		request.onerror = () => resolve(null);
		transaction.oncomplete = () => database.close();
		transaction.onerror = () => database.close();
	});
}

function writeTransaction(database: IDBDatabase, durability: WriteDurability) {
	try {
		return database.transaction(STORE_NAME, 'readwrite', { durability });
	} catch {
		// Older engines ignore or reject transaction options. The atomic
		// read/write transaction remains the compatibility fallback.
		return database.transaction(STORE_NAME, 'readwrite');
	}
}

async function writeValue(
	key: string,
	value: unknown,
	durability: WriteDurability = 'relaxed',
): Promise<boolean> {
	const database = await openDatabase();
	if (!database) {
		memoryFallbackStore.set(key, value);
		return true;
	}
	return new Promise((resolve) => {
		const transaction = writeTransaction(database, durability);
		transaction.objectStore(STORE_NAME).put(value, key);
		transaction.oncomplete = () => {
			database.close();
			resolve(true);
		};
		transaction.onerror = () => {
			database.close();
			resolve(false);
		};
		transaction.onabort = () => {
			database.close();
			resolve(false);
		};
	});
}

/**
 * Atomically reads and updates one record. IndexedDB read/write transactions are
 * serialized across tabs, covering browsers that do not implement Web Locks.
 */
async function updateValue<T>(
	key: string,
	update: (current: T | null) => T | null,
	durability: WriteDurability = 'relaxed',
): Promise<{ persisted: boolean; value: T | null }> {
	const database = await openDatabase();
	if (!database) {
		const value = update((memoryFallbackStore.get(key) as T | undefined) ?? null);
		if (value === null) memoryFallbackStore.delete(key);
		else memoryFallbackStore.set(key, value);
		notifyOfflineChange();
		return { persisted: true, value };
	}
	return new Promise((resolve, reject) => {
		const transaction = writeTransaction(database, durability);
		const store = transaction.objectStore(STORE_NAME);
		const request = store.get(key);
		let value: T | null = null;
		let updaterFailed = false;
		request.onsuccess = () => {
			try {
				value = update((request.result as T | undefined) ?? null);
				if (value === null) store.delete(key);
				else store.put(value, key);
			} catch (error) {
				updaterFailed = true;
				transaction.abort();
				database.close();
				reject(error);
			}
		};
		transaction.oncomplete = () => {
			database.close();
			notifyOfflineChange();
			resolve({ persisted: true, value });
		};
		transaction.onerror = () => {
			database.close();
			resolve({ persisted: false, value: null });
		};
		transaction.onabort = () => {
			database.close();
			if (!updaterFailed) resolve({ persisted: false, value: null });
		};
	});
}

async function deleteValue(key: string, durability: WriteDurability = 'relaxed'): Promise<void> {
	const database = await openDatabase();
	if (!database) {
		memoryFallbackStore.delete(key);
		notifyOfflineChange();
		return;
	}
	await new Promise<void>((resolve) => {
		const transaction = writeTransaction(database, durability);
		transaction.objectStore(STORE_NAME).delete(key);
		transaction.oncomplete = () => {
			database.close();
			notifyOfflineChange();
			resolve();
		};
		transaction.onerror = () => {
			database.close();
			resolve();
		};
	});
}

async function withStoreLock<T>(name: string, operation: () => Promise<T>): Promise<T> {
	if (typeof navigator !== 'undefined' && 'locks' in navigator) {
		return navigator.locks.request(`self-feed:${namespace()}:${name}`, operation);
	}
	return operation();
}

function shouldPersistQuery(queryKey: readonly unknown[]) {
	return typeof queryKey[0] === 'string' && PERSISTED_QUERY_ROOTS.has(queryKey[0]);
}

function isPersistedQueryCache(value: unknown, ownerId: string): value is PersistedQueryCache {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<PersistedQueryCache>;
	return (
		candidate.schemaVersion === SCHEMA_VERSION &&
		candidate.ownerId === ownerId &&
		candidate.namespace === namespace() &&
		typeof candidate.persistedAt === 'number' &&
		!!candidate.state &&
		Array.isArray(candidate.state.queries)
	);
}

function isUser(value: unknown): value is User {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<User>;
	return (
		typeof candidate.id === 'string' &&
		typeof candidate.email === 'string' &&
		typeof candidate.role === 'string' &&
		typeof candidate.isActive === 'boolean'
	);
}

function byteSize(value: unknown) {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function boundedState(state: DehydratedState): DehydratedState {
	const cutoff = Date.now() - MAX_CACHE_AGE_MS;
	const candidates = state.queries
		.filter((query) => query.state.dataUpdatedAt >= cutoff)
		.sort((left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt)
		.slice(0, MAX_PERSISTED_QUERIES);
	const queries: DehydratedState['queries'] = [];
	let bytes = 0;
	for (const query of candidates) {
		const queryBytes = byteSize(query);
		if (queryBytes > MAX_PERSISTED_BYTES || bytes + queryBytes > MAX_PERSISTED_BYTES) continue;
		queries.push(query);
		bytes += queryBytes;
	}
	return { mutations: [], queries };
}

export function setOfflineSessionUser(userId: string | null) {
	activeUserId = userId;
	notifyOfflineChange();
}

export async function readOfflineSnapshot(userId: string): Promise<OfflineSnapshot> {
	const database = await openDatabase().catch(() => null);
	const records = database
		? await readOfflineRecords(database, cacheKey(userId), outboxKey(userId))
		: null;
	const cache = records?.cache;
	const outbox = records?.outbox ?? memoryFallbackStore.get(outboxKey(userId));
	return {
		pendingCount: Array.isArray(outbox) ? outbox.length : 0,
		storageAvailable: records !== null,
		syncing: flushPromises.has(userId),
		rejectedCount: offlineRejectionCount(userId),
		articleIds: cachedArticleIds(
			isPersistedQueryCache(cache, userId) ? boundedState(cache.state).queries : [],
		),
	};
}

export async function persistQueryClient(queryClient: QueryClient, userId: string): Promise<void> {
	const current = boundedState(
		dehydrate(queryClient, {
			shouldDehydrateMutation: () => false,
			shouldDehydrateQuery: (query) =>
				query.state.status === 'success' && shouldPersistQuery(query.queryKey),
		}),
	);
	await withStoreLock(`cache:${userId}`, async () => {
		await updateValue<PersistedQueryCache>(cacheKey(userId), (cached) => {
			const newestByHash = new Map(
				isPersistedQueryCache(cached, userId)
					? cached.state.queries.map((query) => [query.queryHash, query])
					: [],
			);
			for (const query of current.queries) {
				const existing = newestByHash.get(query.queryHash);
				if (!existing || query.state.dataUpdatedAt >= existing.state.dataUpdatedAt) {
					newestByHash.set(query.queryHash, query);
				}
			}
			const state = boundedState({ mutations: [], queries: [...newestByHash.values()] });
			return {
				schemaVersion: SCHEMA_VERSION,
				ownerId: userId,
				namespace: namespace(),
				persistedAt: Date.now(),
				state,
			};
		});
	});
}

export async function restoreQueryClient(
	queryClient: QueryClient,
	userId: string,
): Promise<boolean> {
	const cached = await readValue<unknown>(cacheKey(userId));
	if (!isPersistedQueryCache(cached, userId)) return false;
	const state = boundedState(cached.state);
	if (state.queries.length === 0) {
		await clearOfflineQueryCache(userId);
		return false;
	}
	hydrate(queryClient, state);
	return true;
}

/** A detail downloaded in another tab must also open without a network request. */
export async function restoreOfflineArticle(queryClient: QueryClient, articleId: string) {
	const userId = activeUserId;
	if (!userId) return;
	const cached = await readValue<unknown>(cacheKey(userId));
	if (activeUserId !== userId || !isPersistedQueryCache(cached, userId)) return;
	const queries = boundedState(cached.state).queries.filter(
		(query) => query.queryKey[0] === 'article' && query.queryKey[1] === articleId,
	);
	hydrate(queryClient, { mutations: [], queries });
}

export async function saveOfflineUser(user: User): Promise<void> {
	const cachedAt = Date.now();
	await writeValue(
		userKey(),
		{
			schemaVersion: SCHEMA_VERSION,
			namespace: namespace(),
			cachedAt,
			offlineAccessUntil: cachedAt + OFFLINE_ACCESS_LEASE_MS,
			user,
		} satisfies PersistedOfflineUser,
		'strict',
	);
}

export async function loadOfflineUser(): Promise<User | null> {
	if (await isSignedOutLocally()) return null;
	const cached = await readValue<unknown>(userKey());
	if (!cached || typeof cached !== 'object') return null;
	const candidate = cached as Partial<PersistedOfflineUser>;
	const now = Date.now();
	if (
		candidate.schemaVersion !== SCHEMA_VERSION ||
		candidate.namespace !== namespace() ||
		typeof candidate.cachedAt !== 'number' ||
		typeof candidate.offlineAccessUntil !== 'number' ||
		candidate.cachedAt > now + OFFLINE_CLOCK_SKEW_MS ||
		now - candidate.cachedAt > OFFLINE_ACCESS_LEASE_MS ||
		candidate.offlineAccessUntil < now ||
		candidate.offlineAccessUntil - candidate.cachedAt >
			OFFLINE_ACCESS_LEASE_MS + OFFLINE_CLOCK_SKEW_MS ||
		!isUser(candidate.user)
	) {
		await deleteValue(userKey(), 'strict');
		return null;
	}
	return candidate.user;
}

export async function setSignedOutLocally(value: boolean): Promise<void> {
	if (value) await writeValue(signedOutKey(), { at: Date.now() }, 'strict');
	else await deleteValue(signedOutKey(), 'strict');
}

export async function isSignedOutLocally(): Promise<boolean> {
	return Boolean(await readValue(signedOutKey()));
}

export async function clearOfflineQueryCache(userId = activeUserId): Promise<void> {
	if (userId) await deleteValue(cacheKey(userId));
}

export async function clearOfflineState(userId = activeUserId): Promise<void> {
	const keys = [deleteValue(userKey(), 'strict')];
	if (userId) {
		dismissOfflineRejections(userId);
		keys.push(deleteValue(cacheKey(userId)));
		keys.push(deleteValue(outboxKey(userId), 'strict'));
		keys.push(deleteValue(revisionsKey(userId), 'strict'));
	}
	await Promise.all(keys);
}

export async function queueArticleStateMutation(
	kind: OfflineArticleMutationKind,
	articleId: string,
	desiredState: boolean,
	source?: OfflineArticleMutation['source'],
): Promise<OfflineArticleMutation> {
	const userId = activeUserId;
	if (!userId) throw new Error('Cannot queue an offline mutation without an authenticated user');
	return withStoreLock(`outbox:${userId}`, async () => {
		const revisions =
			(await readValue<Record<string, ArticleRevisionState>>(revisionsKey(userId))) ?? {};
		let mutation: OfflineArticleMutation | null = null;
		const result = await updateValue<OfflineArticleMutation[]>(
			outboxKey(userId),
			(entries) => {
				const current = entries ?? [];
				const previous = current.find(
					(entry) => entry.articleId === articleId && entry.kind === kind,
				);
				mutation = {
					mutationId: crypto.randomUUID(),
					articleId,
					kind,
					desiredState,
					baseRevision: previous?.baseRevision ?? revisions[articleId]?.[kind],
					...(source ? { source } : {}),
					createdAt: Date.now(),
				};
				const next = current
					.filter((entry) => !(entry.articleId === articleId && entry.kind === kind))
					.concat(mutation)
					.sort((left, right) => left.createdAt - right.createdAt);
				if (next.length > MAX_OUTBOX_ENTRIES) {
					throw new Error(
						'Offline mutation storage is full. Reconnect before making more changes.',
					);
				}
				return next;
			},
			'strict',
		);
		if (!result.persisted && 'indexedDB' in globalThis) {
			throw new Error('Offline storage is unavailable or full');
		}
		if (!mutation) throw new Error('Offline mutation could not be queued');
		return mutation;
	});
}

export async function hasPendingArticleStateMutation(
	articleId: string,
	kind: OfflineArticleMutationKind,
): Promise<boolean> {
	return (await getPendingArticleStateMutation(articleId, kind)) !== null;
}

export async function getPendingArticleStateMutation(
	articleId: string,
	kind: OfflineArticleMutationKind,
): Promise<OfflineArticleMutation | null> {
	const userId = activeUserId;
	if (!userId) return null;
	const entries = (await readValue<OfflineArticleMutation[]>(outboxKey(userId))) ?? [];
	return entries.find((entry) => entry.articleId === articleId && entry.kind === kind) ?? null;
}

function isTransientMutationError(error: unknown) {
	if (!(error instanceof ApiClientError)) return true;
	return (
		error.status === 401 ||
		error.status === 408 ||
		error.status === 425 ||
		error.status === 429 ||
		error.status >= 500
	);
}

export async function flushOfflineArticleMutations(): Promise<OfflineMutationFlushResult[]> {
	const userId = activeUserId;
	if (!userId) return [];
	if (typeof navigator !== 'undefined' && !navigator.onLine) return [];
	const existingFlush = flushPromises.get(userId);
	if (existingFlush) return existingFlush;
	const flush = withStoreLock(`flush:${userId}`, async () => {
		const results: OfflineMutationFlushResult[] = [];
		let attempts = 0;
		while (activeUserId === userId && attempts < MAX_OUTBOX_ENTRIES) {
			attempts += 1;
			const entries = ((await readValue<OfflineArticleMutation[]>(outboxKey(userId))) ?? []).sort(
				(left, right) => left.createdAt - right.createdAt,
			);
			const mutation = entries[0];
			if (!mutation) break;
			try {
				const path = `/articles/${encodeURIComponent(mutation.articleId)}/${mutation.kind === 'read' ? 'read' : 'saved'}`;
				const body =
					mutation.kind === 'read'
						? {
								read: mutation.desiredState,
								source: mutation.source ?? 'manual',
								mutationId: mutation.mutationId,
								baseRevision: mutation.baseRevision,
							}
						: {
								saved: mutation.desiredState,
								mutationId: mutation.mutationId,
								baseRevision: mutation.baseRevision,
							};
				const response = await apiFetch<ApiResponse<ArticleStateMutationResponse>>(path, {
					method: 'PATCH',
					body: JSON.stringify(body),
				});
				const authoritativeState =
					mutation.kind === 'read' ? response.data.read : response.data.saved;
				await updateValue<Record<string, ArticleRevisionState>>(
					revisionsKey(userId),
					(revisions) => ({
						...(revisions ?? {}),
						[mutation.articleId]: {
							...revisions?.[mutation.articleId],
							[mutation.kind]: response.data.revision,
						},
					}),
					'strict',
				);
				if (response.data.conflict) {
					await rebaseMutation(userId, mutation, response.data.revision);
				} else {
					await removeMutationIfCurrent(userId, mutation);
				}
				results.push({
					mutation,
					status: response.data.conflict ? 'reconciled' : 'applied',
					authoritativeState,
					revision: response.data.revision,
				});
			} catch (error) {
				if (isTransientMutationError(error)) {
					results.push({ mutation, status: 'queued' });
					break;
				}
				await removeMutationIfCurrent(userId, mutation);
				reportOfflineRejection(userId);
				results.push({ mutation, status: 'discarded' });
			}
		}
		return results;
	}).finally(() => {
		if (flushPromises.get(userId) === flush) flushPromises.delete(userId);
		notifyOfflineChange();
	});
	flushPromises.set(userId, flush);
	notifyOfflineChange();
	return flush;
}

async function removeMutationIfCurrent(userId: string, mutation: OfflineArticleMutation) {
	await withStoreLock(`outbox:${userId}`, async () => {
		await updateValue<OfflineArticleMutation[]>(
			outboxKey(userId),
			(entries) => (entries ?? []).filter((entry) => entry.mutationId !== mutation.mutationId),
			'strict',
		);
	});
}

async function rebaseMutation(userId: string, mutation: OfflineArticleMutation, revision: number) {
	await withStoreLock(`outbox:${userId}`, async () => {
		await updateValue<OfflineArticleMutation[]>(
			outboxKey(userId),
			(entries) => {
				const current = (entries ?? []).find(
					(entry) => entry.articleId === mutation.articleId && entry.kind === mutation.kind,
				);
				if (!current) return entries ?? [];
				const rebased: OfflineArticleMutation = {
					...current,
					mutationId: crypto.randomUUID(),
					baseRevision: revision,
				};
				return (entries ?? []).map((entry) =>
					entry.mutationId === current.mutationId ? rebased : entry,
				);
			},
			'strict',
		);
	});
}
