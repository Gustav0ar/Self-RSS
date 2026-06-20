import type { ApiListResponse, ArticleListItem } from '@self-feed/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export function useSearch(q: string, categoryId?: string) {
	const normalizedQuery = q.trim();
	return useInfiniteQuery({
		queryKey: ['search', normalizedQuery, categoryId],
		queryFn: ({ pageParam, signal }) => {
			const params = new URLSearchParams({ q: normalizedQuery, limit: '20' });
			if (categoryId) params.set('categoryId', categoryId);
			if (pageParam) params.set('cursor', pageParam);
			return apiFetch<ApiListResponse<ArticleListItem>>(`/search?${params.toString()}`, {
				signal,
			});
		},
		initialPageParam: null as string | null,
		getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.cursor : undefined),
		enabled: normalizedQuery.length >= 2,
		staleTime: 5_000,
	});
}
