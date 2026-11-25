import type { DehydratedState } from '@tanstack/react-query';

const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PERSISTED_QUERIES = 600;
const MAX_PERSISTED_BYTES = 10 * 1024 * 1024;
const textEncoder = new TextEncoder();

export const PERSISTED_QUERY_ROOTS = new Set([
	'article',
	'articles',
	'categories',
	'feeds',
	'preferences',
	'search',
	'stats',
]);

export interface PersistedQueryCache {
	schemaVersion: number;
	ownerId: string;
	namespace: string;
	persistedAt: number;
	/** Set when the stored snapshot has already passed count and byte bounds. */
	bounded?: boolean;
	state: DehydratedState;
}

export function shouldPersistQuery(queryKey: readonly unknown[]) {
	return typeof queryKey[0] === 'string' && PERSISTED_QUERY_ROOTS.has(queryKey[0]);
}

function byteSize(value: unknown) {
	return textEncoder.encode(JSON.stringify(value)).byteLength;
}

/** Return non-expired persisted queries without re-serializing payloads to measure bytes. */
export function freshQueries(state: DehydratedState): DehydratedState['queries'] {
	const cutoff = Date.now() - MAX_CACHE_AGE_MS;
	return state.queries.filter((query) => query.state.dataUpdatedAt >= cutoff);
}

/**
 * Select the exact restorable query set for both status reporting and hydration.
 * Records marked `bounded` already passed count and byte caps at write time, so
 * they only need the cheap age filter. Older/unbounded records run `boundedState`.
 */
export function selectableQueries(cache: PersistedQueryCache): DehydratedState['queries'] {
	return cache.bounded === true ? freshQueries(cache.state) : boundedState(cache.state).queries;
}

export function boundedState(state: DehydratedState): DehydratedState {
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

export function mergeQuerySnapshots(
	previous: PersistedQueryCache | null,
	current: DehydratedState,
) {
	const newestByHash = new Map(previous?.state.queries.map((query) => [query.queryHash, query]));
	for (const query of current.queries) {
		const existing = newestByHash.get(query.queryHash);
		if (!existing || query.state.dataUpdatedAt >= existing.state.dataUpdatedAt) {
			newestByHash.set(query.queryHash, query);
		}
	}
	return boundedState({ mutations: [], queries: [...newestByHash.values()] });
}

export function cachedArticleIds(queries: DehydratedState['queries']) {
	const ids = new Set<string>();
	for (const query of queries) {
		const [root, id] = query.queryKey;
		const data: unknown = query.state.data;
		if (
			root === 'article' &&
			typeof id === 'string' &&
			data &&
			typeof data === 'object' &&
			'id' in data &&
			data.id === id &&
			'contentHtml' in data &&
			typeof data.contentHtml === 'string' &&
			hasReadableHtml(data.contentHtml)
		)
			ids.add(id);
	}
	return ids;
}

function hasReadableHtml(html: string) {
	// Template contents stay inert, so checking cached text never downloads media.
	const template = document.createElement('template');
	template.innerHTML = html;
	for (const element of template.content.querySelectorAll(
		'script, style, iframe, video, audio, object',
	))
		element.remove();
	return Boolean(template.content.textContent?.trim());
}

export function isPersistedQueryCache(
	value: unknown,
	ownerId: string,
	origin: string,
	schemaVersion: number,
): value is PersistedQueryCache {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<PersistedQueryCache>;
	return (
		candidate.schemaVersion === schemaVersion &&
		candidate.ownerId === ownerId &&
		candidate.namespace === origin &&
		typeof candidate.persistedAt === 'number' &&
		!!candidate.state &&
		Array.isArray(candidate.state.queries)
	);
}
