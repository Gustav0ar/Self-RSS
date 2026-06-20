import type { ApiResponse, CategoryWithCounts, ReorderCategoriesResponse } from '@self-feed/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

// --- Categories ---

export function useCategories() {
	return useQuery({
		queryKey: ['categories'],
		queryFn: ({ signal }) =>
			apiFetch<ApiResponse<{ categories: CategoryWithCounts[]; totalUnread: number }>>(
				'/categories',
				{ signal },
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

export function useReorderCategories() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (data: { updates: { id: string; sortOrder: number }[] }) =>
			apiFetch<ApiResponse<ReorderCategoriesResponse>>('/categories/reorder', {
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
