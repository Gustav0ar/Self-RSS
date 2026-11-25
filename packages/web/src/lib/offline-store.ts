import type { ApiResponse, User } from '@self-feed/shared';
import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query';
import { ApiClientError, apiFetch } from './api';
import { parseLegacyQueryCache } from './legacy-query-cache';
import {
	dismissOfflineRejections,
	notifyOfflineChange,
	offlineRejectionCount,
	reportOfflineRejection,
} from './offline-changes';
import {
	isUser,
	leasedUser,
	OFFLINE_ACCESS_LEASE_MS,
	type PersistedOfflineUser,
} from './offline-identity';
import {
	boundedState,
	cachedArticleIds,
	isPersistedQueryCache,
	mergeQuerySnapshots,
	PERSISTED_QUERY_ROOTS,
	type PersistedQueryCache,
	selectableQueries,
	shouldPersistQuery,
} from './offline-query-cache';
import { type OfflineSnapshot, readOfflineRecords } from './offline-snapshot';

const DATABASE_NAME = 'self-feed-offline';
const STORE_NAME = 'state';
const DATABASE_VERSION = 3;
// Version 3 migrates legacy records into the existing v2 record format.
const SCHEMA_VERSION = 2;
const MAX_OUTBOX_ENTRIES = 1_000;

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
	conflict: boolean;
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
let activeSession = new AbortController();
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
	return new Promise<IDBDatabase | null>((resolve) => {
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
	}).catch(() => null);
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
				if (value != null && !isPersistedQueryCache(value, user.id, namespace(), SCHEMA_VERSION))
					return;
				const current = isPersistedQueryCache(value, user.id, namespace(), SCHEMA_VERSION)
					? value
					: null;
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
						bounded: true,
						state: boundedState({ mutations: [], queries: [...queries.values()] }),
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

/**
 * Atomically reads and updates one record. IndexedDB read/write transactions are
 * serialized across tabs, covering browsers that do not implement Web Locks.
 */
async function updateValue<T>(
	key: string,
	update: (current: T | null) => T | null,
	durability: WriteDurability = 'relaxed',
	signal?: AbortSignal,
): Promise<boolean> {
	const database = await openDatabase();
	if (!database) {
		if (signal?.aborted || 'indexedDB' in globalThis) return false;
		const value = update((memoryFallbackStore.get(key) as T | undefined) ?? null);
		if (value === null) memoryFallbackStore.delete(key);
		else memoryFallbackStore.set(key, value);
		notifyOfflineChange(key.includes(':query-cache:'));
		return true;
	}
	return new Promise((resolve, reject) => {
		const transaction = writeTransaction(database, durability);
		const store = transaction.objectStore(STORE_NAME);
		const request = store.get(key);
		request.onsuccess = () => {
			if (signal?.aborted) {
				transaction.abort();
				return;
			}
			try {
				const value = update((request.result as T | undefined) ?? null);
				if (value === null) store.delete(key);
				else store.put(value, key);
			} catch (error) {
				transaction.abort();
				database.close();
				reject(error);
			}
		};
		transaction.oncomplete = () => {
			database.close();
			notifyOfflineChange(key.includes(':query-cache:'));
			resolve(true);
		};
		transaction.onerror = () => {
			database.close();
			resolve(false);
		};
		transaction.onabort = transaction.onerror;
	});
}

async function deleteValue(key: string, durability: WriteDurability = 'relaxed'): Promise<void> {
	const database = await openDatabase();
	if (!database) {
		memoryFallbackStore.delete(key);
		notifyOfflineChange(key.includes(':query-cache:'));
		return;
	}
	await new Promise<void>((resolve) => {
		const transaction = writeTransaction(database, durability);
		transaction.objectStore(STORE_NAME).delete(key);
		transaction.oncomplete = () => {
			database.close();
			notifyOfflineChange(key.includes(':query-cache:'));
			resolve();
		};
		transaction.onerror = () => {
			database.close();
			resolve();
		};
		transaction.onabort = transaction.onerror;
	}).catch(() => database.close());
}

async function withStoreLock<T>(name: string, operation: () => Promise<T>): Promise<T> {
	if (typeof navigator !== 'undefined' && 'locks' in navigator) {
		return navigator.locks.request(`self-feed:${namespace()}:${name}`, operation);
	}
	return operation();
}

export function setOfflineSessionUser(userId: string | null) {
	if (userId !== activeUserId) {
		activeSession.abort();
		if (activeUserId) flushPromises.delete(activeUserId);
		activeSession = new AbortController();
		activeUserId = userId;
	}
	notifyOfflineChange();
	return activeSession.signal;
}

export async function readOfflineSnapshot(
	userId: string,
	cachedArticles?: ReadonlySet<string>,
): Promise<OfflineSnapshot> {
	const database = await openDatabase().catch(() => null);
	const records = database
		? await readOfflineRecords(
				database,
				cachedArticles ? null : cacheKey(userId),
				outboxKey(userId),
			)
		: null;
	const cache = records?.cache;
	const outbox = records?.outbox ?? memoryFallbackStore.get(outboxKey(userId));
	return {
		pendingCount: Array.isArray(outbox) ? outbox.length : 0,
		storageAvailable: records !== null,
		syncing: flushPromises.has(userId),
		rejectedCount: offlineRejectionCount(userId),
		articleIds:
			records && cachedArticles
				? cachedArticles
				: cachedArticleIds(
						isPersistedQueryCache(cache, userId, namespace(), SCHEMA_VERSION)
							? selectableQueries(cache)
							: [],
					),
	};
}

export async function persistQueryClient(queryClient: QueryClient, userId: string): Promise<void> {
	if (activeUserId !== userId) return;
	const { signal } = activeSession;
	const current = boundedState(
		dehydrate(queryClient, {
			shouldDehydrateMutation: () => false,
			shouldDehydrateQuery: (query) =>
				query.state.status === 'success' && shouldPersistQuery(query.queryKey),
		}),
	);
	await withStoreLock(`cache:${userId}`, () =>
		updateValue<PersistedQueryCache>(
			cacheKey(userId),
			(cached) => ({
				schemaVersion: SCHEMA_VERSION,
				ownerId: userId,
				namespace: namespace(),
				persistedAt: Date.now(),
				bounded: true,
				state: mergeQuerySnapshots(
					isPersistedQueryCache(cached, userId, namespace(), SCHEMA_VERSION) ? cached : null,
					current,
				),
			}),
			'relaxed',
			signal,
		),
	);
}

export async function restoreQueryClient(
	queryClient: QueryClient,
	userId: string,
): Promise<boolean> {
	if (activeUserId !== userId) return false;
	const { signal } = activeSession;
	const cached = await readValue<unknown>(cacheKey(userId));
	if (signal.aborted || !isPersistedQueryCache(cached, userId, namespace(), SCHEMA_VERSION))
		return false;
	const state = { mutations: [], queries: selectableQueries(cached) };
	if (state.queries.length === 0) {
		await updateValue(
			cacheKey(userId),
			(current) =>
				isPersistedQueryCache(current, userId, namespace(), SCHEMA_VERSION) &&
				selectableQueries(current).length === 0
					? null
					: current,
			'relaxed',
			signal,
		);
		return false;
	}
	hydrate(queryClient, state);
	return true;
}

/** A detail downloaded in another tab must also open without a network request. */
export async function restoreOfflineArticle(queryClient: QueryClient, articleId: string) {
	const userId = activeUserId;
	if (!userId) return;
	const { signal } = activeSession;
	const cached = await readValue<unknown>(cacheKey(userId));
	if (signal.aborted || !isPersistedQueryCache(cached, userId, namespace(), SCHEMA_VERSION)) return;
	const queries = selectableQueries(cached).filter(
		(query) => query.queryKey[0] === 'article' && query.queryKey[1] === articleId,
	);
	hydrate(queryClient, { mutations: [], queries });
}

export async function saveOfflineUser(user: User): Promise<void> {
	const cachedAt = Date.now();
	await updateValue(
		userKey(),
		() =>
			({
				schemaVersion: SCHEMA_VERSION,
				namespace: namespace(),
				cachedAt,
				offlineAccessUntil: cachedAt + OFFLINE_ACCESS_LEASE_MS,
				user,
			}) satisfies PersistedOfflineUser,
		'strict',
		activeSession.signal,
	);
}

export async function loadOfflineUser(): Promise<User | null> {
	if (await isSignedOutLocally()) return null;
	const cached = await readValue<unknown>(userKey());
	const reader = leasedUser(cached, namespace(), SCHEMA_VERSION);
	if (cached && !reader) {
		await updateValue(
			userKey(),
			(current) => (leasedUser(current, namespace(), SCHEMA_VERSION) ? current : null),
			'strict',
		);
	}
	return reader;
}

export async function setSignedOutLocally(value: boolean): Promise<boolean> {
	if (!('indexedDB' in globalThis)) return false;
	return updateValue(signedOutKey(), () => (value ? { at: Date.now() } : null), 'strict').catch(
		() => false,
	);
}

export async function isSignedOutLocally(): Promise<boolean> {
	return Boolean(await readValue(signedOutKey()));
}

export async function clearOfflineQueryCache(userId = activeUserId): Promise<void> {
	if (userId) await deleteValue(cacheKey(userId));
}

export async function clearOfflineState(
	userId = activeUserId,
	{ keepPendingChanges = false } = {},
): Promise<void> {
	// A different tab may already have verified and cached the next account.
	const clearIdentity = updateValue<PersistedOfflineUser>(
		userKey(),
		(current) => (current?.user?.id === userId ? null : current),
		'strict',
	).catch(() => false);
	const keys: Promise<unknown>[] = [clearIdentity];
	if (userId) {
		dismissOfflineRejections(userId);
		keys.push(deleteValue(cacheKey(userId)));
		if (!keepPendingChanges) {
			keys.push(deleteValue(outboxKey(userId), 'strict'));
			keys.push(deleteValue(revisionsKey(userId), 'strict'));
		}
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
	const { signal } = activeSession;
	return withStoreLock(`outbox:${userId}`, async () => {
		const revisions =
			(await readValue<Record<string, ArticleRevisionState>>(revisionsKey(userId))) ?? {};
		let mutation: OfflineArticleMutation | null = null;
		const persisted = await updateValue<OfflineArticleMutation[]>(
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
			signal,
		);
		signal.throwIfAborted();
		if (!persisted) {
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
	const { signal } = activeSession;
	const existingFlush = flushPromises.get(userId);
	if (existingFlush) return existingFlush;
	const flush = withStoreLock(`flush:${userId}`, async () => {
		const results: OfflineMutationFlushResult[] = [];
		let attempts = 0;
		while (!signal.aborted && attempts < MAX_OUTBOX_ENTRIES) {
			attempts += 1;
			const entries = ((await readValue<OfflineArticleMutation[]>(outboxKey(userId))) ?? []).sort(
				(left, right) => left.createdAt - right.createdAt,
			);
			const mutation = entries[0];
			if (!mutation || signal.aborted) break;
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
					signal,
					body: JSON.stringify(body),
				});
				if (signal.aborted) break;
				const authoritativeState =
					mutation.kind === 'read' ? response.data.read : response.data.saved;
				const recorded = await updateValue<Record<string, ArticleRevisionState>>(
					revisionsKey(userId),
					(revisions) => ({
						...(revisions ?? {}),
						[mutation.articleId]: {
							...revisions?.[mutation.articleId],
							[mutation.kind]: response.data.revision,
						},
					}),
					'strict',
					signal,
				);
				const acknowledged =
					recorded &&
					(await acknowledgeMutation(
						userId,
						mutation,
						signal,
						response.data.conflict ? response.data.revision : undefined,
					));
				if (!acknowledged) {
					results.push({ mutation, status: 'queued' });
					break;
				}
				results.push({
					mutation,
					status: response.data.conflict ? 'reconciled' : 'applied',
					authoritativeState,
					revision: response.data.revision,
				});
			} catch (error) {
				if (signal.aborted) break;
				if (
					isTransientMutationError(error) ||
					!(await acknowledgeMutation(userId, mutation, signal))
				) {
					results.push({ mutation, status: 'queued' });
					break;
				}
				if (signal.aborted) break;
				reportOfflineRejection(userId);
				results.push({ mutation, status: 'discarded' });
			}
		}
		return signal.aborted ? [] : results;
	}).finally(() => {
		if (flushPromises.get(userId) === flush) flushPromises.delete(userId);
		notifyOfflineChange(false);
	});
	flushPromises.set(userId, flush);
	notifyOfflineChange(false);
	return flush;
}

async function acknowledgeMutation(
	userId: string,
	mutation: OfflineArticleMutation,
	signal: AbortSignal,
	conflictRevision?: number,
) {
	return withStoreLock(`outbox:${userId}`, () =>
		updateValue<OfflineArticleMutation[]>(
			outboxKey(userId),
			(entries) => {
				const pending = entries ?? [];
				if (conflictRevision === undefined) {
					return pending.filter((entry) => entry.mutationId !== mutation.mutationId);
				}
				return pending.map((entry) =>
					entry.articleId === mutation.articleId && entry.kind === mutation.kind
						? { ...entry, mutationId: crypto.randomUUID(), baseRevision: conflictRevision }
						: entry,
				);
			},
			'strict',
			signal,
		),
	);
}
