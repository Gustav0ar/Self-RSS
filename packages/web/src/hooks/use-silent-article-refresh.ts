import type { ApiListResponse, ArticleListItem } from '@self-feed/shared';
import { type InfiniteData, type QueryClient, QueryClientContext } from '@tanstack/react-query';
import { useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import { REFRESH_INTERVALS } from '@/lib/constants';
import { type ArticleQueryParams, buildArticleSearchParams } from './queries';
import { infiniteArticleQueryKey } from './queries/cache-query-helpers';

type Page = ApiListResponse<ArticleListItem>;
type ArticleList = InfiniteData<Page, string | null>;

function articleListItemsEqual(a: ArticleListItem, b: ArticleListItem) {
	return (
		a.id === b.id &&
		a.feedId === b.feedId &&
		a.feedTitle === b.feedTitle &&
		a.feedFaviconUrl === b.feedFaviconUrl &&
		a.canonicalUrl === b.canonicalUrl &&
		a.title === b.title &&
		a.author === b.author &&
		a.excerpt === b.excerpt &&
		a.heroImageUrl === b.heroImageUrl &&
		a.publishedAt === b.publishedAt &&
		a.displayedAt === b.displayedAt &&
		a.isRead === b.isRead &&
		a.isSaved === b.isSaved &&
		a.contentStatus === b.contentStatus &&
		a.contentVersion === b.contentVersion
	);
}

function firstPageHasChanged(cached: Page, fresh: Page) {
	if (cached.cursor !== fresh.cursor || cached.hasMore !== fresh.hasMore) {
		return true;
	}

	if (cached.data.length !== fresh.data.length) {
		return true;
	}

	return cached.data.some((article, index) => {
		const freshArticle = fresh.data[index];
		return !freshArticle || !articleListItemsEqual(article, freshArticle);
	});
}

/**
 * Returns the active QueryClient, or null when no QueryClientProvider is
 * mounted above (e.g. in isolated unit tests). When null, callers should
 * treat the hook as a no-op.
 */
function useOptionalQueryClient(): QueryClient | null {
	return useContext(QueryClientContext) ?? null;
}

/**
 * Periodically re-fetches the first page of the article list and invalidates
 * the exact active article query when the first-page shape or visible article
 * metadata changes. Query refetching keeps all pages and cursors aligned with
 * the API.
 *
 * Triggers: window focus, tab becoming visible, and a 5-minute interval
 * (only while the tab is visible). Skipped if the cached data is fresher
 * than MIN_FRESH_MS or if a fetch is already in flight.
 */
export function useSilentArticleRefresh(
	params: ArticleQueryParams,
	options: { enabled?: boolean } = {},
) {
	const qc = useOptionalQueryClient();
	const feedId = params.feedId;
	const categoryId = params.categoryId;
	const unreadOnly = params.unreadOnly;
	const savedOnly = params.savedOnly;
	const sort = params.sort;
	const limit = params.limit ?? 30;
	const queryKey = useMemo(
		() => infiniteArticleQueryKey({ feedId, categoryId, unreadOnly, savedOnly, sort, limit }),
		[feedId, categoryId, unreadOnly, savedOnly, sort, limit],
	);
	const inFlightRef = useRef(false);
	const inFlightControllerRef = useRef<AbortController | null>(null);
	const lastFetchedAtRef = useRef(0);
	const enabled = options.enabled ?? true;

	const abortInFlight = useCallback(() => {
		inFlightControllerRef.current?.abort();
		inFlightControllerRef.current = null;
		inFlightRef.current = false;
	}, []);

	const refresh = useCallback(async () => {
		if (!enabled) return;
		if (!qc) return;
		if (document.visibilityState !== 'visible') return;
		if (inFlightRef.current) return;
		if (Date.now() - lastFetchedAtRef.current < REFRESH_INTERVALS.ARTICLE_STALE_MS) return;

		const cached = qc.getQueryData<ArticleList>(queryKey);
		if (!cached?.pages[0]) return;

		const controller = new AbortController();
		inFlightRef.current = true;
		inFlightControllerRef.current = controller;
		try {
			const qs = buildArticleSearchParams(
				{ feedId, categoryId, unreadOnly, savedOnly, sort, limit },
				null,
			);
			const fresh = await apiFetch<Page>(`/articles${qs ? `?${qs}` : ''}`, {
				signal: controller.signal,
			});

			if (!firstPageHasChanged(cached.pages[0], fresh)) return;

			await qc.invalidateQueries({ queryKey, exact: true });
		} catch {
			// Network errors are expected; the next tick will retry.
		} finally {
			if (inFlightControllerRef.current === controller) {
				inFlightControllerRef.current = null;
				inFlightRef.current = false;
				lastFetchedAtRef.current = Date.now();
			}
		}
	}, [enabled, qc, queryKey, feedId, categoryId, unreadOnly, savedOnly, sort, limit]);

	useEffect(() => {
		if (!qc || !enabled) return;

		const onFocus = () => {
			void refresh();
		};
		const onVisibility = () => {
			if (document.visibilityState === 'visible') void refresh();
		};

		window.addEventListener('focus', onFocus);
		document.addEventListener('visibilitychange', onVisibility);
		const interval = window.setInterval(refresh, REFRESH_INTERVALS.SILENT_REFRESH_MS);

		return () => {
			abortInFlight();
			window.removeEventListener('focus', onFocus);
			document.removeEventListener('visibilitychange', onVisibility);
			window.clearInterval(interval);
		};
	}, [enabled, qc, refresh, abortInFlight]);
}
