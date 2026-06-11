import type { ApiListResponse, ArticleListItem } from '@self-feed/shared';
import { type InfiniteData, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import { type ArticleQueryParams, buildArticleSearchParams } from './queries';

const REFRESH_INTERVAL_MS = 5 * 60_000;
const MIN_FRESH_MS = 30_000;

function buildInfiniteKey(params: ArticleQueryParams) {
	const limit = params.limit ?? 30;
	return [
		'articles',
		params.feedId ?? null,
		params.categoryId ?? null,
		params.unreadOnly ?? false,
		params.sort ?? 'latest',
		limit,
	] as const;
}

type Page = ApiListResponse<ArticleListItem>;
type ArticleList = InfiniteData<Page, string | null>;

/**
 * Periodically re-fetches the first page of the article list and merges
 * any new items in front of the existing entries. Pages 2+ are never
 * touched, the cursor stays valid, and the active article / scroll
 * position are preserved.
 *
 * Triggers: window focus, tab becoming visible, and a 5-minute interval
 * (only while the tab is visible). Skipped if the cached data is fresher
 * than MIN_FRESH_MS or if a fetch is already in flight.
 */
export function useSilentArticleRefresh(params: ArticleQueryParams) {
	const qc = useQueryClient();
	const queryKey = buildInfiniteKey(params);
	const inFlightRef = useRef(false);
	const lastFetchedAtRef = useRef(0);

	const refresh = useCallback(async () => {
		if (document.visibilityState !== 'visible') return;
		if (inFlightRef.current) return;
		if (Date.now() - lastFetchedAtRef.current < MIN_FRESH_MS) return;

		const cached = qc.getQueryData<ArticleList>(queryKey);
		if (!cached || !cached.pages[0]) return;

		inFlightRef.current = true;
		try {
			const qs = buildArticleSearchParams({ ...params, limit: params.limit ?? 30 }, null);
			const fresh = await apiFetch<Page>(`/articles${qs ? `?${qs}` : ''}`);

			const existing = cached.pages[0].data;
			const existingIds = new Set(existing.map((a) => a.id));
			const newOnes = fresh.data.filter((a) => !existingIds.has(a.id));

			if (newOnes.length === 0) return;

			const limit = params.limit ?? 30;
			const merged = [...newOnes, ...existing].slice(0, limit);
			const firstPage: Page = {
				...cached.pages[0],
				data: merged,
				hasMore: cached.pages[0].hasMore || fresh.hasMore,
			};
			const next: ArticleList = {
				pages: [firstPage, ...cached.pages.slice(1)],
				pageParams: cached.pageParams,
			};
			qc.setQueryData(queryKey, next);
		} catch {
			// Network errors are expected; the next tick will retry.
		} finally {
			inFlightRef.current = false;
			lastFetchedAtRef.current = Date.now();
		}
	}, [qc, queryKey, params]);

	useEffect(() => {
		const onFocus = () => {
			void refresh();
		};
		const onVisibility = () => {
			if (document.visibilityState === 'visible') void refresh();
		};

		window.addEventListener('focus', onFocus);
		document.addEventListener('visibilitychange', onVisibility);
		const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);

		return () => {
			window.removeEventListener('focus', onFocus);
			document.removeEventListener('visibilitychange', onVisibility);
			window.clearInterval(interval);
		};
	}, [refresh]);
}
