import type {
	ApiResponse,
	FeedSyncHistoryResponse,
	FeedWithCounts,
	OpmlImportSummary,
} from '@self-feed/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDownload, apiFetch } from '@/lib/api';
import {
	type FeedSyncAllStatus,
	getFeedRefreshAccountKey,
	mergeFeedSyncStatus,
	rememberFeedRefreshRequestId,
} from '@/lib/feed-sync-status';
import { invalidateReaderQueries } from './cache-utils';

// --- Feeds ---

export function useFeeds(categoryId?: string) {
	return useQuery({
		queryKey: ['feeds', categoryId],
		// Realtime feed.health.updated events patch this cache. Focus/reconnect
		// reconciliation covers events missed while the browser was offline.
		staleTime: 60_000,
		queryFn: ({ signal }) => {
			const params = categoryId ? `?categoryId=${categoryId}` : '';
			return apiFetch<ApiResponse<FeedWithCounts[]>>(`/feeds${params}`, { signal }).then(
				(r) => r.data,
			);
		},
	});
}

export function useFeedSyncHistory(feedId?: string) {
	return useInfiniteQuery({
		queryKey: ['feeds', feedId, 'sync-runs'],
		queryFn: ({ pageParam, signal }) => {
			if (!feedId) throw new Error('Feed id is required');
			const params = new URLSearchParams({ limit: '20' });
			if (pageParam) params.set('cursor', pageParam);
			return apiFetch<ApiResponse<FeedSyncHistoryResponse>>(
				`/feeds/${feedId}/sync-runs?${params}`,
				{ signal },
			).then((response) => response.data);
		},
		initialPageParam: null as string | null,
		getNextPageParam: (page) => (page.hasMore ? page.cursor : undefined),
		enabled: Boolean(feedId),
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
			feedUrl?: string;
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
		mutationFn: (feedId: string) =>
			apiFetch<ApiResponse<QueuedFeedSyncResult>>(
				`/feeds/sync?feedId=${encodeURIComponent(feedId)}`,
				{ method: 'POST' },
			),
		onSuccess: (response, feedId) => {
			qc.setQueryData<FeedSyncAllStatus | undefined>(['feeds', 'sync', 'status'], (current) =>
				mergeFeedSyncStatus(current, response.data.status),
			);
			void qc.invalidateQueries({ queryKey: ['feeds', feedId, 'sync-runs'] });
			void qc.invalidateQueries({ queryKey: ['stats'] });
		},
	});
}

export interface QueuedFeedSyncResult {
	accepted: true;
	alreadyQueued: boolean;
	requestId?: string;
	jobId: string;
	jobIds?: string[];
	status: FeedSyncAllStatus;
}

export function useSyncAllFeeds() {
	const qc = useQueryClient();

	return useMutation({
		mutationFn: (scope?: { feedId?: string; categoryId?: string }) => {
			const query = new URLSearchParams();
			if (scope?.feedId) query.set('feedId', scope.feedId);
			if (scope?.categoryId) query.set('categoryId', scope.categoryId);
			const suffix = query.size > 0 ? `?${query.toString()}` : '';
			return apiFetch<ApiResponse<QueuedFeedSyncResult>>(`/feeds/sync${suffix}`, {
				method: 'POST',
			});
		},
		onSuccess: (response) => {
			qc.setQueryData<FeedSyncAllStatus | undefined>(['feeds', 'sync', 'status'], (current) =>
				mergeFeedSyncStatus(current, response.data.status),
			);
			const requestId = response.data.requestId ?? response.data.status.requestId;
			if (requestId) qc.setQueryData(['feeds', 'sync', 'status', requestId], response.data.status);
		},
	});
}

export function useSyncAllFeedsStatus(requestId?: string | null) {
	return useQuery({
		queryKey: requestId ? ['feeds', 'sync', 'status', requestId] : ['feeds', 'sync', 'status'],
		queryFn: ({ signal }) =>
			apiFetch<ApiResponse<FeedSyncAllStatus>>(
				`/feeds/sync/status${requestId ? `?requestId=${encodeURIComponent(requestId)}` : ''}`,
				{ signal },
			).then((response) => response.data),
		// SSE is the primary progress transport. This query is only the initial
		// snapshot and reconnect/focus fallback, never a polling loop.
		staleTime: 10_000,
	});
}

export function useSelectFeedDiscoveryCandidate() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (candidateId: string) =>
			apiFetch<
				ApiResponse<{
					candidateId: string;
					feedId: string;
					requestId: string;
					jobId: string | null;
				}>
			>(`/feeds/discovery/candidates/${candidateId}/select`, { method: 'POST' }),
		onSuccess: (response) => {
			rememberFeedRefreshRequestId(getFeedRefreshAccountKey(), response.data.requestId);
			qc.invalidateQueries({ queryKey: ['feeds'] });
			qc.invalidateQueries({ queryKey: ['categories'] });
		},
	});
}

export function useCancelFeedReplacement() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (feedId: string) =>
			apiFetch<ApiResponse<FeedWithCounts>>(`/feeds/${feedId}/replacement/cancel`, {
				method: 'POST',
			}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['feeds'] });
			qc.invalidateQueries({ queryKey: ['categories'] });
			qc.invalidateQueries({ queryKey: ['feeds', 'sync', 'status'] });
		},
	});
}

// Re-export useQueryClient for components that need it
export { useQueryClient };
