import type {
	ApiListResponse,
	ApiResponse,
	ArticleDetail,
	ArticleListItem,
} from '@self-feed/shared';
import {
	type InfiniteData,
	type QueryClient,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import { ARTICLE_LIMITS, REFRESH_INTERVALS } from '@/lib/constants';
import {
	flushOfflineArticleMutations,
	hasPendingArticleStateMutation,
	queueArticleStateMutation,
} from '@/lib/offline-store';
import {
	beginArticleMutation,
	finishArticleMutation,
	getSavedMutationSnapshot,
	settledArticleState,
	updateSavedMutationReadState,
} from './article-mutation-rollback';
import { findCachedArticleListItem } from './article-saved-cache-updates';
import {
	type ArticleQueryParams,
	applyArticleReadState,
	applyArticleSavedState,
	applyStatsDelta,
	applyUnreadCountDelta,
	articleQueryKey,
	buildArticleSearchParams,
	findActiveQueryKey,
	findCachedArticleSnapshot,
	invalidateReaderQueries,
} from './cache-utils';

function fetchArticle(articleId: string, signal?: AbortSignal) {
	return apiFetch<ApiResponse<ArticleDetail>>(
		`/articles/detail?id=${encodeURIComponent(articleId)}`,
		{ signal },
	).then((r) => r.data);
}

function enrichArticle(articleId: string) {
	return apiFetch<ApiResponse<{ success: boolean; reason?: string }>>(
		`/articles/${articleId}/enrich`,
		{
			method: 'POST',
		},
	).then((r) => r.data);
}

function preloadImages(urls: readonly (string | null | undefined)[]) {
	if (typeof Image === 'undefined') return;
	for (const url of new Set(urls.filter((value): value is string => !!value))) {
		const image = new Image();
		image.decoding = 'async';
		image.src = url;
	}
}

// --- Articles ---

export type { ArticleQueryParams };

function articleItemsFromCachedValue(value: unknown): ArticleListItem[] {
	if (!value || typeof value !== 'object') return [];
	if ('pages' in value && Array.isArray(value.pages)) {
		return value.pages.flatMap(articleItemsFromCachedValue);
	}
	if ('data' in value && Array.isArray(value.data)) {
		return value.data.filter(
			(item): item is ArticleListItem =>
				!!item &&
				typeof item === 'object' &&
				'id' in item &&
				typeof item.id === 'string' &&
				'isSaved' in item &&
				item.isSaved === true,
		);
	}
	return [];
}

export function buildSavedArticlesFallback(
	qc: QueryClient,
	params: ArticleQueryParams,
	limit: number,
): InfiniteData<ApiListResponse<ArticleListItem>, string | null> | undefined {
	if (!params.savedOnly || params.categoryId) return undefined;
	const byId = new Map<string, ArticleListItem>();
	for (const [, value] of qc.getQueriesData({ queryKey: ['articles'] })) {
		for (const article of articleItemsFromCachedValue(value)) byId.set(article.id, article);
	}
	for (const [, value] of qc.getQueriesData<ArticleDetail>({ queryKey: ['article'] })) {
		if (!value?.isSaved) continue;
		byId.set(value.id, {
			id: value.id,
			feedId: value.feedId,
			feedTitle: value.feedTitle,
			feedFaviconUrl: value.feedFaviconUrl,
			canonicalUrl: value.canonicalUrl,
			title: value.title,
			author: value.author,
			excerpt: value.excerpt,
			heroImageUrl: value.heroImageUrl,
			publishedAt: value.publishedAt,
			displayedAt: value.publishedAt ?? value.fetchedAt,
			isRead: value.isRead,
			isSaved: true,
			contentStatus: value.contentStatus,
			contentVersion: value.contentVersion,
		});
	}
	const direction = params.sort === 'oldest' ? 1 : -1;
	const data = [...byId.values()]
		.filter((article) => !params.feedId || article.feedId === params.feedId)
		.sort(
			(left, right) =>
				direction *
				(left.displayedAt ?? left.publishedAt ?? '').localeCompare(
					right.displayedAt ?? right.publishedAt ?? '',
				),
		)
		.slice(0, limit);
	if (data.length === 0) return undefined;
	return {
		pages: [{ data, cursor: null, hasMore: false }],
		pageParams: [null],
	};
}

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

export function useInfiniteArticles(
	params: ArticleQueryParams = {},
	options: { enabled?: boolean } = {},
) {
	const qc = useQueryClient();
	const handledCursorError = useRef<unknown>(null);
	const limit = params.limit ?? 30;
	const queryKey = useMemo(
		() =>
			[
				'articles',
				params.feedId ?? null,
				params.categoryId ?? null,
				params.unreadOnly ?? false,
				params.savedOnly ?? false,
				params.sort ?? 'latest',
				limit,
			] as const,
		[params.feedId, params.categoryId, params.unreadOnly, params.savedOnly, params.sort, limit],
	);
	const savedFallback = buildSavedArticlesFallback(qc, params, limit);
	const query = useInfiniteQuery({
		queryKey,
		initialPageParam: null as string | null,
		enabled: options.enabled ?? true,
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
		initialData: savedFallback,
		initialDataUpdatedAt: savedFallback ? 0 : undefined,
	});
	useEffect(() => {
		const error = query.error;
		if (
			error &&
			error !== handledCursorError.current &&
			typeof error === 'object' &&
			'code' in error &&
			error.code === 'CURSOR_RESET_REQUIRED'
		) {
			handledCursorError.current = error;
			void qc.resetQueries({ queryKey, exact: true });
		}
	}, [qc, query.error, queryKey]);
	return query;
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
						const detail = await qc.fetchQuery({
							queryKey,
							queryFn: ({ signal }) => fetchArticle(articleId, signal),
							staleTime: ARTICLE_LIMITS.DETAIL_WARM_STALE_MS,
						});
						preloadImages([
							detail.heroImageUrl,
							...detail.media.filter((item) => item.type === 'image').map((item) => item.url),
						]);
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

export function useWarmVisibleArticles() {
	const qc = useQueryClient();
	const lastCandidateKey = useRef('');
	const enrichmentRequestedArticleIds = useRef(new Set<string>());

	return useCallback(
		(candidates: readonly { id: string; heroImageUrl: string | null }[]) => {
			const unique = Array.from(
				new Map(candidates.map((article) => [article.id, article])).values(),
			)
				.filter((article) => article.id)
				.slice(0, 4);
			const candidateKey = unique.map((article) => article.id).join('|');
			if (!candidateKey || candidateKey === lastCandidateKey.current) return;
			lastCandidateKey.current = candidateKey;
			preloadImages(unique.map((article) => article.heroImageUrl));

			void Promise.all(
				unique.map((article) =>
					qc.fetchQuery({
						queryKey: articleQueryKey(article.id),
						queryFn: ({ signal }) => fetchArticle(article.id, signal),
						staleTime: ARTICLE_LIMITS.DETAIL_WARM_STALE_MS,
					}),
				),
			)
				.then((details) => {
					preloadImages(
						details.flatMap((detail) => [
							detail.heroImageUrl,
							...detail.media.filter((item) => item.type === 'image').map((item) => item.url),
						]),
					);
					for (const detail of details) {
						if (
							detail.contentStatus === 'enrichment_pending' &&
							!enrichmentRequestedArticleIds.current.has(detail.id)
						) {
							enrichmentRequestedArticleIds.current.add(detail.id);
							void enrichArticle(detail.id).catch(() => undefined);
						}
					}
				})
				.catch(() => undefined);
		},
		[qc],
	);
}

function reconcileArticleReadState(qc: QueryClient, articleId: string, read: boolean) {
	const current =
		findCachedArticleSnapshot(qc, articleId) ?? getSavedMutationSnapshot(qc, articleId);
	applyArticleReadState(qc, articleId, read);
	updateSavedMutationReadState(qc, articleId, read);
	if (current && current.isRead !== read) {
		applyUnreadCountDelta(qc, current.feedId, read ? -1 : 1);
		applyStatsDelta(qc, read ? -1 : 1, read ? 1 : -1);
	}
}

export function useMarkRead() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async ({ articleId, read }: { articleId: string; read: boolean }) => {
			await queueArticleStateMutation('read', articleId, read, 'manual');
			return flushOfflineArticleMutations();
		},
		onMutate: async ({ articleId, read }) => {
			const activeArticlesKey = findActiveQueryKey(qc, ['articles']);
			await Promise.all([
				qc.cancelQueries({ queryKey: articleQueryKey(articleId) }),
				activeArticlesKey ? qc.cancelQueries({ queryKey: activeArticlesKey }) : Promise.resolve(),
				qc.cancelQueries({ queryKey: ['search'] }),
				qc.cancelQueries({ queryKey: ['feeds'] }),
				qc.cancelQueries({ queryKey: ['categories'] }),
			]);
			const baseline = beginArticleMutation(
				qc,
				articleId,
				'read',
				(findCachedArticleSnapshot(qc, articleId) ?? getSavedMutationSnapshot(qc, articleId))
					?.isRead,
			);
			reconcileArticleReadState(qc, articleId, read);
			return baseline;
		},
		onError: async (_error, { articleId }, baseline) => {
			if (await hasPendingArticleStateMutation(articleId, 'read')) return;
			if (baseline?.state !== undefined) reconcileArticleReadState(qc, articleId, baseline.state);
		},
		onSuccess: async (results, { articleId }, baseline) => {
			const state = settledArticleState(results, articleId, 'read', baseline);
			if (await hasPendingArticleStateMutation(articleId, 'read')) return;
			if (state !== undefined) reconcileArticleReadState(qc, articleId, state);
		},
		onSettled: (_data, _error, { articleId }, baseline) => {
			finishArticleMutation(qc, articleId, 'read', baseline);
			qc.invalidateQueries({ queryKey: ['feeds'], refetchType: 'none' });
			qc.invalidateQueries({ queryKey: ['categories'], refetchType: 'none' });
			qc.invalidateQueries({ queryKey: ['stats'], refetchType: 'none' });
		},
	});
}

export function useSetArticleSaved() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async ({ articleId, saved }: { articleId: string; saved: boolean }) => {
			await queueArticleStateMutation('saved', articleId, saved);
			return flushOfflineArticleMutations();
		},
		onMutate: async ({ articleId, saved }) => {
			await Promise.all([
				qc.cancelQueries({ queryKey: articleQueryKey(articleId) }),
				qc.cancelQueries({ queryKey: ['articles'] }),
				qc.cancelQueries({ queryKey: ['search'] }),
			]);

			const previousArticle = qc.getQueryData<ArticleDetail>(articleQueryKey(articleId));
			if (saved && previousArticle) {
				preloadImages([
					previousArticle.heroImageUrl,
					...previousArticle.media.filter((item) => item.type === 'image').map((item) => item.url),
				]);
			}
			const snapshot = findCachedArticleListItem(qc, articleId);
			const baseline = beginArticleMutation(qc, articleId, 'saved', snapshot?.isSaved, snapshot);
			applyArticleSavedState(qc, articleId, saved);
			return baseline;
		},
		onError: async (_error, { articleId }, baseline) => {
			if (await hasPendingArticleStateMutation(articleId, 'saved')) return;
			if (baseline?.state !== undefined)
				applyArticleSavedState(qc, articleId, baseline.state, baseline.snapshot);
		},
		onSuccess: async (results, { articleId }, baseline) => {
			const state = settledArticleState(results, articleId, 'saved', baseline);
			if (await hasPendingArticleStateMutation(articleId, 'saved')) return;
			if (state !== undefined) applyArticleSavedState(qc, articleId, state, baseline?.snapshot);
		},
		onSettled: (_data, _error, { articleId }, baseline) => {
			finishArticleMutation(qc, articleId, 'saved', baseline);
			qc.invalidateQueries({ queryKey: ['articles'], refetchType: 'none' });
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
