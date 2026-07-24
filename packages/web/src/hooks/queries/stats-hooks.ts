import type { ApiResponse, StatsResponse } from '@self-feed/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

// --- Stats ---

export type Stats = StatsResponse;

export function useStats() {
	return useQuery({
		queryKey: ['stats'],
		queryFn: ({ signal }) => apiFetch<ApiResponse<Stats>>('/stats', { signal }).then((r) => r.data),
	});
}
