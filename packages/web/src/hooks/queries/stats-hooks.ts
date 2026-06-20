import type { ApiResponse } from '@self-feed/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

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
