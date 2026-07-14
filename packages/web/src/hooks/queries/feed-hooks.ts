import type { ApiResponse, FeedWithCounts, OpmlImportSummary } from '@self-feed/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDownload, apiFetch } from '@/lib/api';
import { type FeedSyncAllStatus, getFeedSyncStatusPollInterval } from '@/lib/feed-sync-status';
import { invalidateReaderQueries } from './cache-utils';

// --- Feeds ---

export function useFeeds(categoryId?: string) {
	return useQuery({
		queryKey: ['feeds', categoryId],
		queryFn: ({ signal }) => {
			const params = categoryId ? `?categoryId=${categoryId}` : '';
			return apiFetch<ApiResponse<FeedWithCounts[]>>(`/feeds${params}`, { signal }).then(
				(r) => r.data,
			);
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
		mutationFn: (scope?: { feedId?: string; categoryId?: string }) => {
			const query = new URLSearchParams();
			if (scope?.feedId) query.set('feedId', scope.feedId);
			if (scope?.categoryId) query.set('categoryId', scope.categoryId);
			const suffix = query.size > 0 ? `?${query.toString()}` : '';
			return apiFetch(`/feeds/sync${suffix}`, { method: 'POST' });
		},
		onSuccess: () => {
			// The status revision and event stream drive subsequent reconciliations.
			qc.invalidateQueries({ queryKey: ['articles'] });
		},
	});
}

export function useSyncAllFeedsStatus() {
	return useQuery({
		queryKey: ['feeds', 'sync', 'status'],
		queryFn: ({ signal }) =>
			apiFetch<ApiResponse<FeedSyncAllStatus>>('/feeds/sync/status', { signal }).then(
				(response) => response.data,
			),
		refetchInterval: (query) => getFeedSyncStatusPollInterval(query.state.data),
		staleTime: 1_000,
	});
}

// Re-export useQueryClient for components that need it
export { useQueryClient };
