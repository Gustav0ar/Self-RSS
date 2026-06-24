import type { QueryClient, QueryKey } from '@tanstack/react-query';

export type { FeedSyncAllStatus } from '@/lib/feed-sync-status';

export interface ArticleQueryParams {
	feedId?: string;
	categoryId?: string;
	unreadOnly?: boolean;
	sort?: 'latest' | 'oldest';
	limit?: number;
	cursor?: string;
}

export function invalidateReaderQueries(qc: QueryClient) {
	qc.invalidateQueries({ queryKey: ['articles'] });
	qc.invalidateQueries({ queryKey: ['article'] });
	qc.invalidateQueries({ queryKey: ['feeds'] });
	qc.invalidateQueries({ queryKey: ['categories'] });
	qc.invalidateQueries({ queryKey: ['stats'] });
	qc.invalidateQueries({ queryKey: ['search'] });
}

/**
 * Return the first cached query key under `prefix` that is currently in
 * flight. Used by optimistic mutations to cancel only the scope the user is
 * interacting with, instead of every query under a broad prefix.
 */
export function findActiveQueryKey(qc: QueryClient, prefix: readonly unknown[]): QueryKey | null {
	const cache = qc.getQueryCache();
	const queries = cache.findAll({ queryKey: prefix });
	for (const query of queries) {
		if (query.state.fetchStatus === 'fetching') {
			return query.queryKey;
		}
	}
	return null;
}

export function buildArticleSearchParams(params: ArticleQueryParams, cursor?: string | null) {
	const searchParams = new URLSearchParams();
	if (params.feedId) searchParams.set('feedId', params.feedId);
	if (params.categoryId) searchParams.set('categoryId', params.categoryId);
	if (params.unreadOnly) searchParams.set('unreadOnly', 'true');
	if (params.sort) searchParams.set('sort', params.sort);
	if (params.limit) searchParams.set('limit', String(params.limit));
	if (cursor) searchParams.set('cursor', cursor);
	return searchParams.toString();
}

export const articleQueryKey = (articleId: string) => ['article', articleId] as const;
