import type {
	ApiListResponse,
	ApiResponse,
	ArticleDetail,
	ArticleListItem,
} from '@self-feed/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import { ARTICLE_LIMITS, REFRESH_INTERVALS } from '@/lib/constants';
import {
	type ArticleQueryParams,
	applyArticleReadState,
	applyStatsDelta,
	applyUnreadCountDelta,
	articleQueryKey,
	buildArticleSearchParams,
	findActiveQueryKey,
	findCachedArticleSnapshot,
	invalidateReaderQueries,
} from './cache-utils';

function fetchArticle(articleId: string, signal?: AbortSignal) {
	return apiFetch<ApiResponse<ArticleDetail>>(`/articles/${articleId}`, { signal }).then(
		(r) => r.data,
	);
}

function enrichArticle(articleId: string) {
	return apiFetch<ApiResponse<{ success: boolean; reason?: string }>>(
		`/articles/${articleId}/enrich`,
		{
			method: 'POST',
		},
	).then((r) => r.data);
}

// --- Articles ---

export type { ArticleQueryParams };

export function useArticles(params: ArticleQueryParams = {}) {
	const qs = buildArticleSearchParams(params, params.cursor);
	return useQuery({
		queryKey: ['articles', params],
		queryFn: ({ signal }) =>
			apiFetch<ApiListResponse<ArticleListItem>>(`/articles${qs ? `?${qs}` : ''}`, {
				signal,
			}),
		// Optimistic UI: show cached data immediately, refresh in background
		placeholderData: (prev) => prev,
		staleTime: REFRESH_INTERVALS.ARTICLE_STALE_MS, // Consider data fresh for 30s to avoid unnecessary refetches
		gcTime: REFRESH_INTERVALS.CACHE_GC_MS, // Keep in cache for 5 minutes
	});
}

export function useInfiniteArticles(params: ArticleQueryParams = {}) {
	const limit = params.limit ?? 30;
	return useInfiniteQuery({
		queryKey: [
			'articles',
			params.feedId ?? null,
			params.categoryId ?? null,
			params.unreadOnly ?? false,
			params.sort ?? 'latest',
			limit,
		],
		initialPageParam: null as string | null,
		queryFn: ({ pageParam, signal }) => {
			const qs = buildArticleSearchParams(
				{
					...params,
					limit,
				},
				pageParam,
			);
			return apiFetch<ApiListResponse<ArticleListItem>>(`/articles${qs ? `?${qs}` : ''}`, {
				signal,
			});
		},
		getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.cursor : undefined),
	});
}

export function useArticle(articleId: string | null) {
	return useQuery({
		queryKey: articleId ? articleQueryKey(articleId) : ['article', null],
		queryFn: ({ signal }) => fetchArticle(articleId!, signal),
		enabled: !!articleId,
	});
}

export function usePrefetchArticle() {
	const qc = useQueryClient();
	return useCallback(
		(articleId: string) =>
			qc.prefetchQuery({
				queryKey: articleQueryKey(articleId),
				queryFn: ({ signal }) => fetchArticle(articleId, signal),
				staleTime: 1000 * 60,
			}),
		[qc],
	);
}

export function useEnrichArticle() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: enrichArticle,
		onSuccess: (_result, articleId) => {
			qc.invalidateQueries({ queryKey: ['article', articleId] });
		},
	});
}

export function useWarmNextArticles() {
	const qc = useQueryClient();
	const warmingArticleIds = useRef(new Set<string>());

	return useCallback(
		(articleIds: readonly string[]) => {
			const idsToWarm = Array.from(new Set(articleIds.filter(Boolean))).slice(
				0,
				ARTICLE_LIMITS.WARM_LIMIT,
			);

			for (const articleId of idsToWarm) {
				if (warmingArticleIds.current.has(articleId)) {
					continue;
				}

				warmingArticleIds.current.add(articleId);
				void (async () => {
					const queryKey = articleQueryKey(articleId);
					try {
						await qc.fetchQuery({
							queryKey,
							queryFn: ({ signal }) => fetchArticle(articleId, signal),
							staleTime: ARTICLE_LIMITS.DETAIL_WARM_STALE_MS,
						});
					} catch {
						// Background warming should never surface as reader UI noise.
					} finally {
						warmingArticleIds.current.delete(articleId);
					}
				})();
			}
		},
		[qc],
	);
}

export function useMarkRead() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ articleId, read }: { articleId: string; read: boolean }) =>
			apiFetch(`/articles/${articleId}/read`, {
				method: 'PATCH',
				body: JSON.stringify({ read }),
			}),
		onMutate: async ({ articleId, read }) => {
			// Capture the active article-list query key (if any) so we only
			// cancel in-flight fetches that would race with this optimistic
			// update. Cancelling every `articles`/`feeds`/etc. query would also
			// cancel fetches for *other* scopes the user is not currently
			// viewing; if one of those refetches and then the optimistic
			// snapshot is rolled back, the wrong scope's slot gets clobbered.
			const activeArticlesKey = findActiveQueryKey(qc, ['articles']);

			await Promise.all([
				qc.cancelQueries({ queryKey: articleQueryKey(articleId) }),
				activeArticlesKey ? qc.cancelQueries({ queryKey: activeArticlesKey }) : Promise.resolve(),
				qc.cancelQueries({ queryKey: ['search'] }),
				qc.cancelQueries({ queryKey: ['feeds'] }),
				qc.cancelQueries({ queryKey: ['categories'] }),
			]);

			const previousSnapshot = findCachedArticleSnapshot(qc, articleId);
			const previousArticle = qc.getQueryData<ArticleDetail>(articleQueryKey(articleId));
			// Snapshot every matching cache entry keyed by its full query key
			// tuple. The optimistic update may run while the user has multiple
			// scopes cached (different feeds, categories, sorts), and the
			// rollback must restore each one to its pre-mutation state without
			// ever writing into a different scope's slot.
			const previousArticles = qc.getQueriesData({ queryKey: ['articles'] });
			const previousSearch = qc.getQueriesData({ queryKey: ['search'] });
			const previousFeeds = qc.getQueriesData({ queryKey: ['feeds'] });
			const previousCategories = qc.getQueriesData({ queryKey: ['categories'] });
			const previousStats = qc.getQueryData(['stats']);

			applyArticleReadState(qc, articleId, read);
			if (previousSnapshot && previousSnapshot.isRead !== read) {
				applyUnreadCountDelta(qc, previousSnapshot.feedId, read ? -1 : 1);
				applyStatsDelta(qc, read ? -1 : 1, read ? 1 : -1);
			}

			return {
				previousArticle,
				previousArticles,
				previousSearch,
				previousFeeds,
				previousCategories,
				previousStats,
			};
		},
		onError: (_error, { articleId }, context) => {
			// Restore the article detail first; it is keyed by the article id
			// only and is unambiguous.
			qc.setQueryData(articleQueryKey(articleId), context?.previousArticle);
			// Restore list queries by their captured key tuples. Iterating the
			// snapshot pairs (rather than re-running the filter) makes the
			// rollback atomic with respect to the optimistic update: only the
			// slots that existed at snapshot time are touched, and each one is
			// restored to the exact pre-mutation value.
			for (const [queryKey, data] of context?.previousArticles ?? []) {
				qc.setQueryData(queryKey, data);
			}
			for (const [queryKey, data] of context?.previousSearch ?? []) {
				qc.setQueryData(queryKey, data);
			}
			for (const [queryKey, data] of context?.previousFeeds ?? []) {
				qc.setQueryData(queryKey, data);
			}
			for (const [queryKey, data] of context?.previousCategories ?? []) {
				qc.setQueryData(queryKey, data);
			}
			qc.setQueryData(['stats'], context?.previousStats);
		},
		onSettled: () => {
			qc.invalidateQueries({ queryKey: ['feeds'], refetchType: 'none' });
			qc.invalidateQueries({ queryKey: ['categories'], refetchType: 'none' });
			qc.invalidateQueries({ queryKey: ['stats'], refetchType: 'none' });
		},
	});
}

export function useMarkAllRead() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (data: { feedId?: string; categoryId?: string }) =>
			apiFetch('/articles/mark-all-read', {
				method: 'PATCH',
				body: JSON.stringify(data),
			}),
		onSuccess: () => {
			invalidateReaderQueries(qc);
		},
	});
}
