import { dehydrate, QueryClient } from '@tanstack/react-query';

export function parseLegacyQueryCache(value: unknown, persistedQueryRoots: ReadonlySet<string>) {
	if (
		!value ||
		typeof value !== 'object' ||
		!('persistedAt' in value) ||
		typeof value.persistedAt !== 'number' ||
		!Number.isFinite(value.persistedAt) ||
		!('state' in value) ||
		!value.state ||
		typeof value.state !== 'object' ||
		!('queries' in value.state) ||
		!Array.isArray(value.state.queries)
	)
		return null;
	const client = new QueryClient();
	try {
		const queries: unknown[] = value.state.queries;
		for (const query of queries) {
			if (
				!query ||
				typeof query !== 'object' ||
				!('queryKey' in query) ||
				!Array.isArray(query.queryKey) ||
				!(typeof query.queryKey[0] === 'string' && persistedQueryRoots.has(query.queryKey[0])) ||
				!('state' in query) ||
				!query.state ||
				typeof query.state !== 'object' ||
				!('status' in query.state) ||
				query.state.status !== 'success' ||
				!('data' in query.state) ||
				query.state.data === undefined ||
				!('dataUpdatedAt' in query.state) ||
				typeof query.state.dataUpdatedAt !== 'number' ||
				!Number.isFinite(query.state.dataUpdatedAt)
			)
				continue;
			client.setQueryData(query.queryKey, query.state.data, {
				updatedAt: query.state.dataUpdatedAt,
			});
		}
		return { persistedAt: value.persistedAt, state: dehydrate(client) };
	} finally {
		client.clear();
	}
}
