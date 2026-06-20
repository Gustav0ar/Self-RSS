import type { ApiResponse, FeedWithCounts, OpmlImportSummary } from '@self-feed/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { apiDownload, apiFetch } from '@/lib/api';
import { REFRESH_INTERVALS } from '@/lib/constants';
import type { FeedSyncAllStatus } from './cache-utils';
import { invalidateReaderQueries } from './cache-utils';

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
	const delayedRefreshTimers = useRef<ReturnType<typeof globalThis.setTimeout>[]>([]);
	const clearDelayedRefreshTimers = useCallback(() => {
		for (const timer of delayedRefreshTimers.current) {
			globalThis.clearTimeout(timer);
		}
		delayedRefreshTimers.current = [];
	}, []);
	useEffect(() => clearDelayedRefreshTimers, [clearDelayedRefreshTimers]);

	return useMutation({
		mutationFn: () => apiFetch('/feeds/sync', { method: 'POST' }),
		onSuccess: () => {
			clearDelayedRefreshTimers();
			qc.invalidateQueries({ queryKey: ['feeds', 'sync', 'status'] });
			// Immediate optimistic refresh of articles for fast UI update
			qc.invalidateQueries({ queryKey: ['articles'] });
			// Additional refreshes at staggered intervals for background sync
			for (const delayMs of [2_000, 5_000, 15_000]) {
				const timer = globalThis.setTimeout(() => invalidateReaderQueries(qc), delayMs);
				delayedRefreshTimers.current.push(timer);
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
		refetchInterval: (query) =>
			query.state.data?.active ? REFRESH_INTERVALS.SYNC_STATUS_POLL_MS : false,
		staleTime: 1_000,
	});
}

// Re-export useQueryClient for components that need it
export { useQueryClient };
