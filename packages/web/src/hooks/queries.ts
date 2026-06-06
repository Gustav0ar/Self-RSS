import type {
	ApiListResponse,
	ApiResponse,
	ArticleDetail,
	ArticleListItem,
	CategoryWithCounts,
	FeedWithCounts,
	OpmlImportSummary,
	SortOrder,
} from '@self-feed/shared';
import type { QueryClient } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiDownload, apiFetch } from '../lib/api';

function invalidateReaderQueries(qc: ReturnType<typeof useQueryClient>) {
	qc.invalidateQueries({ queryKey: ['articles'] });
	qc.invalidateQueries({ queryKey: ['article'] });
	qc.invalidateQueries({ queryKey: ['feeds'] });
	qc.invalidateQueries({ queryKey: ['categories'] });
	qc.invalidateQueries({ queryKey: ['stats'] });
	qc.invalidateQueries({ queryKey: ['search'] });
}

function buildArticleSearchParams(params: ArticleQueryParams, cursor?: string | null) {
	const searchParams = new URLSearchParams();
	if (params.feedId) searchParams.set('feedId', params.feedId);
	if (params.categoryId) searchParams.set('categoryId', params.categoryId);
	if (params.unreadOnly) searchParams.set('unreadOnly', 'true');
	if (params.sort) searchParams.set('sort', params.sort);
	if (params.limit) searchParams.set('limit', String(params.limit));
	if (cursor) searchParams.set('cursor', cursor);
	return searchParams.toString();
}

const articleQueryKey = (articleId: string) => ['article', articleId] as const;

function fetchArticle(articleId: string) {
	return apiFetch<ApiResponse<ArticleDetail>>(`/articles/${articleId}`).then((r) => r.data);
}

function updateArticleListResponseReadState(
	response: ApiListResponse<ArticleListItem>,
	articleId: string,
	read: boolean,
): ApiListResponse<ArticleListItem> {
	let changed = false;
	const data = response.data.map((article) => {
		if (article.id !== articleId || article.isRead === read) {
			return article;
		}
		changed = true;
		return { ...article, isRead: read };
	});

	return changed ? { ...response, data } : response;
}

function updateArticleReadStateInCachedQuery(
	value: unknown,
	articleId: string,
	read: boolean,
): unknown {
	if (!value || typeof value !== 'object') {
		return value;
	}

	if ('pages' in value && Array.isArray(value.pages)) {
		return {
			...value,
			pages: value.pages.map((page) => {
				if (page && typeof page === 'object' && 'data' in page && Array.isArray(page.data)) {
					return updateArticleListResponseReadState(
						page as ApiListResponse<ArticleListItem>,
						articleId,
						read,
					);
				}
				return page;
			}),
		};
	}

	if ('data' in value && Array.isArray(value.data)) {
		return updateArticleListResponseReadState(
			value as ApiListResponse<ArticleListItem>,
			articleId,
			read,
		);
	}

	return value;
}

function applyArticleReadState(qc: QueryClient, articleId: string, read: boolean) {
	qc.setQueryData<ArticleDetail>(articleQueryKey(articleId), (article) =>
		article ? { ...article, isRead: read } : article,
	);
	qc.setQueriesData({ queryKey: ['articles'] }, (value) =>
		updateArticleReadStateInCachedQuery(value, articleId, read),
	);
	qc.setQueriesData({ queryKey: ['search'] }, (value) =>
		updateArticleReadStateInCachedQuery(value, articleId, read),
	);
}

// --- Categories ---

export function useCategories() {
	return useQuery({
		queryKey: ['categories'],
		queryFn: () =>
			apiFetch<ApiResponse<{ categories: CategoryWithCounts[]; totalUnread: number }>>(
				'/categories',
			).then((r) => r.data.categories),
	});
}

export function useCreateCategory() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (data: { name: string; parentCategoryId?: string | null }) =>
			apiFetch<ApiResponse<CategoryWithCounts>>('/categories', {
				method: 'POST',
				body: JSON.stringify(data),
			}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['categories'] });
			qc.invalidateQueries({ queryKey: ['stats'] });
		},
	});
}

export function useUpdateCategory() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			id,
			...data
		}: {
			id: string;
			name?: string;
			parentCategoryId?: string | null;
		}) =>
			apiFetch<ApiResponse<CategoryWithCounts>>(`/categories/${id}`, {
				method: 'PATCH',
				body: JSON.stringify(data),
			}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['categories'] });
			qc.invalidateQueries({ queryKey: ['stats'] });
		},
	});
}

export function useDeleteCategory() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => apiFetch(`/categories/${id}`, { method: 'DELETE' }),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['categories'] });
			qc.invalidateQueries({ queryKey: ['feeds'] });
			qc.invalidateQueries({ queryKey: ['articles'] });
			qc.invalidateQueries({ queryKey: ['stats'] });
		},
	});
}

// --- Feeds ---

export function useFeeds(categoryId?: string) {
	return useQuery({
		queryKey: ['feeds', categoryId],
		queryFn: () => {
			const params = categoryId ? `?categoryId=${categoryId}` : '';
			return apiFetch<ApiResponse<FeedWithCounts[]>>(`/feeds${params}`).then((r) => r.data);
		},
	});
}

export function useCreateFeed() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (data: { feedUrl: string; categoryId: string; title?: string }) =>
			apiFetch<ApiResponse<FeedWithCounts>>('/feeds', {
				method: 'POST',
				body: JSON.stringify(data),
			}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['feeds'] });
			qc.invalidateQueries({ queryKey: ['categories'] });
			qc.invalidateQueries({ queryKey: ['stats'] });
		},
	});
}

export function useUpdateFeed() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			id,
			...data
		}: {
			id: string;
			categoryId?: string;
			title?: string;
			pollingIntervalMinutes?: number;
		}) =>
			apiFetch<ApiResponse<FeedWithCounts>>(`/feeds/${id}`, {
				method: 'PATCH',
				body: JSON.stringify(data),
			}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['feeds'] });
			qc.invalidateQueries({ queryKey: ['categories'] });
			invalidateReaderQueries(qc);
		},
	});
}

export function useDeleteFeed() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => apiFetch(`/feeds/${id}`, { method: 'DELETE' }),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['feeds'] });
			invalidateReaderQueries(qc);
		},
	});
}

export function useImportOpml() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (file: File) => {
			const formData = new FormData();
			formData.append('file', file);
			return apiFetch<ApiResponse<OpmlImportSummary>>('/feeds/import/opml', {
				method: 'POST',
				body: formData,
			}).then((response) => response.data);
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['feeds'] });
			qc.invalidateQueries({ queryKey: ['categories'] });
			invalidateReaderQueries(qc);
		},
	});
}

export function useExportOpml() {
	return useMutation({
		mutationFn: () => apiDownload('/feeds/export/opml'),
	});
}

export function useSyncFeed() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (feedId: string) => apiFetch(`/feeds/${feedId}/sync`, { method: 'POST' }),
		onSuccess: () => {
			invalidateReaderQueries(qc);
		},
	});
}

export function useSyncAllFeeds() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: () => apiFetch('/feeds/sync', { method: 'POST' }),
		onSuccess: () => {
			invalidateReaderQueries(qc);
		},
	});
}

// --- Articles ---

interface ArticleQueryParams {
	feedId?: string;
	categoryId?: string;
	unreadOnly?: boolean;
	sort?: SortOrder;
	limit?: number;
	cursor?: string;
}

export function useArticles(params: ArticleQueryParams = {}) {
	const qs = buildArticleSearchParams(params, params.cursor);
	return useQuery({
		queryKey: ['articles', params],
		queryFn: () => apiFetch<ApiListResponse<ArticleListItem>>(`/articles${qs ? `?${qs}` : ''}`),
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
		queryFn: ({ pageParam }) => {
			const qs = buildArticleSearchParams(
				{
					...params,
					limit,
				},
				pageParam,
			);
			return apiFetch<ApiListResponse<ArticleListItem>>(`/articles${qs ? `?${qs}` : ''}`);
		},
		getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.cursor : undefined),
	});
}

export function useArticle(articleId: string | null) {
	return useQuery({
		queryKey: articleId ? articleQueryKey(articleId) : ['article', null],
		queryFn: () => fetchArticle(articleId!),
		enabled: !!articleId,
	});
}

export function usePrefetchArticle() {
	const qc = useQueryClient();
	return useCallback(
		(articleId: string) =>
			qc.prefetchQuery({
				queryKey: articleQueryKey(articleId),
				queryFn: () => fetchArticle(articleId),
				staleTime: 1000 * 60,
			}),
		[qc],
	);
}

export function useEnrichArticle() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (articleId: string) =>
			apiFetch<ApiResponse<{ success: boolean; reason?: string }>>(
				`/articles/${articleId}/enrich`,
				{
					method: 'POST',
				},
			).then((r) => r.data),
		onSuccess: (_result, articleId) => {
			qc.invalidateQueries({ queryKey: ['article', articleId] });
		},
	});
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
			await Promise.all([
				qc.cancelQueries({ queryKey: articleQueryKey(articleId) }),
				qc.cancelQueries({ queryKey: ['articles'] }),
				qc.cancelQueries({ queryKey: ['search'] }),
			]);

			const previousArticle = qc.getQueryData<ArticleDetail>(articleQueryKey(articleId));
			const previousArticles = qc.getQueriesData({ queryKey: ['articles'] });
			const previousSearch = qc.getQueriesData({ queryKey: ['search'] });

			applyArticleReadState(qc, articleId, read);

			return { previousArticle, previousArticles, previousSearch };
		},
		onError: (_error, { articleId }, context) => {
			qc.setQueryData(articleQueryKey(articleId), context?.previousArticle);
			for (const [queryKey, data] of context?.previousArticles ?? []) {
				qc.setQueryData(queryKey, data);
			}
			for (const [queryKey, data] of context?.previousSearch ?? []) {
				qc.setQueryData(queryKey, data);
			}
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

export function useSearch(q: string, categoryId?: string) {
	const normalizedQuery = q.trim();
	const params = new URLSearchParams({ q: normalizedQuery });
	if (categoryId) params.set('categoryId', categoryId);
	return useQuery({
		queryKey: ['search', normalizedQuery, categoryId],
		queryFn: () => apiFetch<ApiListResponse<ArticleListItem>>(`/search?${params.toString()}`),
		enabled: normalizedQuery.length >= 2,
		staleTime: 5_000,
	});
}

// --- Preferences ---

export interface Preferences {
	theme: string;
	fontFamily: string;
	textSize: number;
	density: string;
	defaultSort: string;
	hideRead: boolean;
	keyboardShortcutsEnabled: boolean;
	autoMarkReadMode: string;
}

export function usePreferences() {
	return useQuery({
		queryKey: ['preferences'],
		queryFn: () => apiFetch<ApiResponse<Preferences>>('/preferences').then((r) => r.data),
	});
}

export function useUpdatePreferences() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (data: Partial<Preferences>) =>
			apiFetch<ApiResponse<Preferences>>('/preferences', {
				method: 'PATCH',
				body: JSON.stringify(data),
			}),
		onSuccess: () => qc.invalidateQueries({ queryKey: ['preferences'] }),
	});
}

// --- Stats ---

export interface Stats {
	totalUnread: number;
	totalRead: number;
	totalFeeds: number;
	totalCategories: number;
	recentSyncRuns: unknown[];
	dailyMetrics: Array<{
		date: string;
		articlesReadCount: number;
		feedsSyncedCount: number;
		searchCount: number;
	}>;
}

export function useStats() {
	return useQuery({
		queryKey: ['stats'],
		queryFn: () => apiFetch<ApiResponse<Stats>>('/stats').then((r) => r.data),
	});
}
