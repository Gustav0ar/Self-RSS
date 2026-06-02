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
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
		queryKey: ['article', articleId],
		queryFn: () =>
			apiFetch<ApiResponse<ArticleDetail>>(`/articles/${articleId}`).then((r) => r.data),
		enabled: !!articleId,
	});
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
		onSuccess: () => {
			invalidateReaderQueries(qc);
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
