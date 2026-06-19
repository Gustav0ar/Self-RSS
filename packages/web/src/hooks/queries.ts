import type {
	ApiListResponse,
	ApiResponse,
	ArticleDetail,
	ArticleListItem,
	CategoryWithCounts,
	FeedWithCounts,
	OpmlImportSummary,
	ReadStateSyncEvent,
	SortOrder,
	StatsResponse,
} from '@self-feed/shared';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { apiDownload, apiFetch } from '../lib/api';

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
function findActiveQueryKey(qc: QueryClient, prefix: readonly unknown[]): QueryKey | null {
	const cache = qc.getQueryCache();
	const queries = cache.findAll({ queryKey: prefix });
	for (const query of queries) {
		if (query.state.fetchStatus === 'fetching') {
			return query.queryKey;
		}
	}
	return null;
}

export interface FeedSyncAllStatus {
	queued: boolean;
	running: boolean;
	active: boolean;
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

const articleQueryKey = (articleId: string) => ['article', articleId] as const;
const ARTICLE_WARM_LIMIT = 5;
const ARTICLE_DETAIL_WARM_STALE_MS = 60_000;
const ARTICLE_ENRICH_REFRESH_DELAY_MS = 800;
const ARTICLE_ENRICH_RETRY_MS = 5 * 60_000;

function fetchArticle(articleId: string) {
	return apiFetch<ApiResponse<ArticleDetail>>(`/articles/${articleId}`).then((r) => r.data);
}

function enrichArticle(articleId: string) {
	return apiFetch<ApiResponse<{ success: boolean; reason?: string }>>(
		`/articles/${articleId}/enrich`,
		{
			method: 'POST',
		},
	).then((r) => r.data);
}

function delay(ms: number) {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shouldEnrichArticle(article: ArticleDetail) {
	return !article.isEnriched && Boolean(article.canonicalUrl?.trim());
}

function isRecentlyAttempted(lastAttemptAt: number | undefined, now = Date.now()) {
	return Boolean(lastAttemptAt && now - lastAttemptAt < ARTICLE_ENRICH_RETRY_MS);
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

function updateFeedArticlesReadStateInCachedQuery(
	value: unknown,
	feedIds: Set<string>,
	removeReadArticles = false,
): unknown {
	if (!value || typeof value !== 'object') {
		return value;
	}

	if ('pages' in value && Array.isArray(value.pages)) {
		return {
			...value,
			pages: value.pages.map((page) =>
				updateFeedArticlesReadStateInCachedQuery(page, feedIds, removeReadArticles),
			),
		};
	}

	if ('data' in value && Array.isArray(value.data)) {
		let changed = false;
		const data = value.data.flatMap((article) => {
			if (
				!article ||
				typeof article !== 'object' ||
				!('feedId' in article) ||
				!feedIds.has(String(article.feedId))
			) {
				return [article];
			}

			if (removeReadArticles) {
				changed = true;
				return [];
			}

			if ('isRead' in article && article.isRead === true) {
				return [article];
			}

			changed = true;
			return [{ ...article, isRead: true }];
		});

		return changed ? { ...value, data } : value;
	}

	return value;
}

function articleSnapshotFromCachedQuery(
	value: unknown,
	articleId: string,
): { feedId: string; isRead: boolean } | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	if ('id' in value && value.id === articleId && 'feedId' in value && 'isRead' in value) {
		return { feedId: String(value.feedId), isRead: Boolean(value.isRead) };
	}

	if ('pages' in value && Array.isArray(value.pages)) {
		for (const page of value.pages) {
			const snapshot = articleSnapshotFromCachedQuery(page, articleId);
			if (snapshot) {
				return snapshot;
			}
		}
	}

	if ('data' in value && Array.isArray(value.data)) {
		const article = value.data.find(
			(item): item is ArticleListItem =>
				item && typeof item === 'object' && 'id' in item && item.id === articleId,
		);
		if (article) {
			return { feedId: article.feedId, isRead: article.isRead };
		}
	}

	return null;
}

function findCachedArticleSnapshot(
	qc: QueryClient,
	articleId: string,
): { feedId: string; isRead: boolean } | null {
	const detailSnapshot = articleSnapshotFromCachedQuery(
		qc.getQueryData(articleQueryKey(articleId)),
		articleId,
	);
	if (detailSnapshot) {
		return detailSnapshot;
	}

	for (const [, data] of qc.getQueriesData({ queryKey: ['articles'] })) {
		const snapshot = articleSnapshotFromCachedQuery(data, articleId);
		if (snapshot) {
			return snapshot;
		}
	}

	for (const [, data] of qc.getQueriesData({ queryKey: ['search'] })) {
		const snapshot = articleSnapshotFromCachedQuery(data, articleId);
		if (snapshot) {
			return snapshot;
		}
	}

	return null;
}

function updateFeedUnreadCount(value: unknown, feedId: string, delta: number): unknown {
	if (!Array.isArray(value)) {
		return value;
	}

	let changed = false;
	const feeds = value.map((feed) => {
		if (!feed || typeof feed !== 'object' || !('id' in feed) || feed.id !== feedId) {
			return feed;
		}

		changed = true;
		const unreadCount = Math.max(0, Number((feed as FeedWithCounts).unreadCount ?? 0) + delta);
		return { ...feed, unreadCount };
	});

	return changed ? feeds : value;
}

function setFeedUnreadCount(value: unknown, feedId: string, unreadCount: number): unknown {
	if (!Array.isArray(value)) {
		return value;
	}

	let changed = false;
	const feeds = value.map((feed) => {
		if (!feed || typeof feed !== 'object' || !('id' in feed) || feed.id !== feedId) {
			return feed;
		}

		changed = true;
		return { ...feed, unreadCount };
	});

	return changed ? feeds : value;
}

function findCachedFeed(qc: QueryClient, feedId: string): { categoryId: string } | null {
	for (const [, data] of qc.getQueriesData({ queryKey: ['feeds'] })) {
		if (!Array.isArray(data)) {
			continue;
		}
		const feed = data.find(
			(item): item is FeedWithCounts =>
				item && typeof item === 'object' && 'id' in item && item.id === feedId,
		);
		if (feed) {
			return { categoryId: feed.categoryId };
		}
	}
	return null;
}

function updateCategoryUnreadCount(value: unknown, categoryId: string, delta: number): unknown {
	if (!Array.isArray(value)) {
		return value;
	}

	let changed = false;
	const updateCategory = (category: unknown): unknown => {
		if (!category || typeof category !== 'object' || !('id' in category)) {
			return category;
		}

		const node = category as CategoryWithCounts;
		let childChanged = false;
		const children = Array.isArray(node.children)
			? node.children.map((child) => {
					const nextChild = updateCategory(child) as CategoryWithCounts;
					if (nextChild !== child) childChanged = true;
					return nextChild;
				})
			: node.children;
		const isTarget = node.id === categoryId;

		if (!isTarget && !childChanged) {
			return category;
		}

		changed = true;
		const unreadCount = Math.max(0, Number(node.unreadCount ?? 0) + delta);
		return { ...node, children, unreadCount };
	};

	const categories = value.map((category) => updateCategory(category));

	return changed ? categories : value;
}

function applyUnreadCountDelta(qc: QueryClient, feedId: string, delta: number) {
	const feed = findCachedFeed(qc, feedId);

	qc.setQueriesData({ queryKey: ['feeds'] }, (value) =>
		updateFeedUnreadCount(value, feedId, delta),
	);

	if (feed) {
		qc.setQueriesData({ queryKey: ['categories'] }, (value) =>
			updateCategoryUnreadCount(value, feed.categoryId, delta),
		);
	}
}

function isUnreadOnlyArticlesQuery(queryKey: QueryKey) {
	if (queryKey[0] !== 'articles') {
		return false;
	}

	const params = queryKey[1];
	if (params && typeof params === 'object' && !Array.isArray(params)) {
		return Boolean((params as ArticleQueryParams).unreadOnly);
	}

	return queryKey[3] === true;
}

function updateArticleQueries(
	qc: QueryClient,
	updater: (queryKey: QueryKey, value: unknown) => unknown,
) {
	for (const [queryKey, value] of qc.getQueriesData({ queryKey: ['articles'] })) {
		qc.setQueryData(queryKey, updater(queryKey, value));
	}
}

function applyArticleReadState(qc: QueryClient, articleId: string, read: boolean) {
	qc.setQueryData<ArticleDetail>(articleQueryKey(articleId), (article) =>
		article ? { ...article, isRead: read } : article,
	);
	updateArticleQueries(qc, (_queryKey, value) =>
		updateArticleReadStateInCachedQuery(value, articleId, read),
	);
	qc.setQueriesData({ queryKey: ['search'] }, (value) =>
		updateArticleReadStateInCachedQuery(value, articleId, read),
	);
}

function applyStatsDelta(qc: QueryClient, unreadDelta: number, readDelta: number) {
	qc.setQueryData<StatsResponse>(['stats'], (stats) =>
		stats
			? {
					...stats,
					totalUnread: Math.max(0, stats.totalUnread + unreadDelta),
					totalRead: Math.max(0, stats.totalRead + readDelta),
				}
			: stats,
	);
}

function updateOpenArticleByFeed(qc: QueryClient, feedIds: Set<string>) {
	for (const [queryKey, value] of qc.getQueriesData<ArticleDetail>({ queryKey: ['article'] })) {
		if (value?.feedId && feedIds.has(value.feedId) && !value.isRead) {
			qc.setQueryData<ArticleDetail>(queryKey, { ...value, isRead: true });
		}
	}
}

function cachedUnreadCountForFeed(qc: QueryClient, feedId: string) {
	for (const [, value] of qc.getQueriesData({ queryKey: ['feeds'] })) {
		if (!Array.isArray(value)) {
			continue;
		}
		const feed = value.find(
			(item): item is FeedWithCounts =>
				item && typeof item === 'object' && 'id' in item && item.id === feedId,
		);
		if (feed) {
			return Math.max(0, Number(feed.unreadCount ?? 0));
		}
	}
	return 0;
}

export function applyReadStateSyncEvent(
	qc: QueryClient,
	event: ReadStateSyncEvent,
	options: { clientId: string },
) {
	if (event.clientId && event.clientId === options.clientId) {
		return;
	}

	if (event.type === 'article.read_state_changed') {
		const snapshot = findCachedArticleSnapshot(qc, event.articleId);
		applyArticleReadState(qc, event.articleId, event.isRead);

		const shouldUpdateCounts = snapshot ? snapshot.isRead !== event.isRead : true;
		if (shouldUpdateCounts) {
			applyUnreadCountDelta(qc, event.feedId, event.isRead ? -1 : 1);
			applyStatsDelta(qc, event.isRead ? -1 : 1, event.isRead ? 1 : -1);
		}

		if (!event.isRead) {
			qc.invalidateQueries({ queryKey: ['articles'] });
		}
		qc.invalidateQueries({ queryKey: ['feeds'], refetchType: 'none' });
		qc.invalidateQueries({ queryKey: ['categories'], refetchType: 'none' });
		qc.invalidateQueries({ queryKey: ['stats'], refetchType: 'none' });
		return;
	}

	const feedIds = new Set(event.feedIds);
	const feedUnreadCounts = event.feedIds.map((feedId) => ({
		feedId,
		unreadCount: cachedUnreadCountForFeed(qc, feedId),
	}));

	updateOpenArticleByFeed(qc, feedIds);
	updateArticleQueries(qc, (queryKey, value) =>
		updateFeedArticlesReadStateInCachedQuery(value, feedIds, isUnreadOnlyArticlesQuery(queryKey)),
	);
	qc.setQueriesData({ queryKey: ['search'] }, (value) =>
		updateFeedArticlesReadStateInCachedQuery(value, feedIds),
	);

	for (const { feedId, unreadCount } of feedUnreadCounts) {
		if (unreadCount > 0) {
			applyUnreadCountDelta(qc, feedId, -unreadCount);
		}
		qc.setQueriesData({ queryKey: ['feeds'] }, (value) => setFeedUnreadCount(value, feedId, 0));
	}
	applyStatsDelta(qc, -event.markedCount, event.markedCount);

	qc.invalidateQueries({ queryKey: ['articles'], refetchType: 'none' });
	qc.invalidateQueries({ queryKey: ['search'], refetchType: 'none' });
	qc.invalidateQueries({ queryKey: ['feeds'], refetchType: 'none' });
	qc.invalidateQueries({ queryKey: ['categories'], refetchType: 'none' });
	qc.invalidateQueries({ queryKey: ['stats'], refetchType: 'none' });
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
			sortOrder?: number;
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
			qc.invalidateQueries({ queryKey: ['feeds', 'sync', 'status'] });
			// Immediate optimistic refresh of articles for fast UI update
			qc.invalidateQueries({ queryKey: ['articles'] });
			// Additional refreshes at staggered intervals for background sync
			for (const delayMs of [2_000, 5_000, 15_000]) {
				globalThis.setTimeout(() => invalidateReaderQueries(qc), delayMs);
			}
		},
	});
}

export function useSyncAllFeedsStatus() {
	return useQuery({
		queryKey: ['feeds', 'sync', 'status'],
		queryFn: () =>
			apiFetch<ApiResponse<FeedSyncAllStatus>>('/feeds/sync/status').then(
				(response) => response.data,
			),
		refetchInterval: (query) => (query.state.data?.active ? 2_000 : false),
		staleTime: 1_000,
	});
}

// --- Articles ---

export interface ArticleQueryParams {
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
		// Optimistic UI: show cached data immediately, refresh in background
		placeholderData: (prev) => prev,
		staleTime: 30_000, // Consider data fresh for 30s to avoid unnecessary refetches
		gcTime: 5 * 60_000, // Keep in cache for 5 minutes
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
		mutationFn: enrichArticle,
		onSuccess: (_result, articleId) => {
			qc.invalidateQueries({ queryKey: ['article', articleId] });
		},
	});
}

export function useWarmNextArticles() {
	const qc = useQueryClient();
	const warmingArticleIds = useRef(new Set<string>());
	const enrichAttemptedAt = useRef(new Map<string, number>());

	return useCallback(
		(articleIds: readonly string[]) => {
			const idsToWarm = Array.from(new Set(articleIds.filter(Boolean))).slice(
				0,
				ARTICLE_WARM_LIMIT,
			);

			for (const articleId of idsToWarm) {
				if (warmingArticleIds.current.has(articleId)) {
					continue;
				}

				warmingArticleIds.current.add(articleId);
				void (async () => {
					const queryKey = articleQueryKey(articleId);
					try {
						const article = await qc.fetchQuery({
							queryKey,
							queryFn: () => fetchArticle(articleId),
							staleTime: ARTICLE_DETAIL_WARM_STALE_MS,
						});

						if (!shouldEnrichArticle(article)) {
							return;
						}

						const now = Date.now();
						if (isRecentlyAttempted(enrichAttemptedAt.current.get(articleId), now)) {
							return;
						}

						enrichAttemptedAt.current.set(articleId, now);
						const result = await enrichArticle(articleId);
						if (!result.success && result.reason !== 'already_enriched') {
							return;
						}

						await delay(ARTICLE_ENRICH_REFRESH_DELAY_MS);
						qc.invalidateQueries({ queryKey, refetchType: 'none' });
						await qc.fetchQuery({
							queryKey,
							queryFn: () => fetchArticle(articleId),
							staleTime: ARTICLE_DETAIL_WARM_STALE_MS,
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

			applyArticleReadState(qc, articleId, read);
			if (previousSnapshot && previousSnapshot.isRead !== read) {
				applyUnreadCountDelta(qc, previousSnapshot.feedId, read ? -1 : 1);
			}

			return {
				previousArticle,
				previousArticles,
				previousSearch,
				previousFeeds,
				previousCategories,
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
export { useSearch } from './search-queries';

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
	accentColor: string;
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
		onMutate: async (data) => {
			await qc.cancelQueries({ queryKey: ['preferences'] });
			const previous = qc.getQueryData<Preferences>(['preferences']);
			if (previous) {
				qc.setQueryData<Preferences>(['preferences'], { ...previous, ...data });
			}
			return { previous };
		},
		onError: (_error, _data, context) => {
			if (context?.previous) {
				qc.setQueryData(['preferences'], context.previous);
			}
		},
		onSuccess: (response) => {
			qc.setQueryData(['preferences'], response.data);
			qc.invalidateQueries({ queryKey: ['preferences'] });
		},
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
