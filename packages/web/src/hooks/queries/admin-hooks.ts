import type { AdminUsersResponse, ApiResponse, AppSettingsResponse, User } from '@self-feed/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export function useAdminSettings(enabled = true) {
	return useQuery({
		queryKey: ['admin', 'settings'],
		enabled,
		queryFn: ({ signal }) =>
			apiFetch<ApiResponse<AppSettingsResponse>>('/admin/settings', { signal }).then(
				(response) => response.data,
			),
	});
}

export function useAdminUsers(enabled = true) {
	return useInfiniteQuery({
		queryKey: ['admin', 'users'],
		enabled,
		queryFn: ({ pageParam, signal }) => {
			const params = new URLSearchParams({ limit: '25' });
			if (pageParam) params.set('cursor', pageParam);
			return apiFetch<ApiResponse<AdminUsersResponse>>(`/admin/users?${params}`, { signal }).then(
				(response) => response.data,
			);
		},
		initialPageParam: null as string | null,
		getNextPageParam: (page) => (page.hasMore ? page.cursor : undefined),
	});
}

function useInvalidateAdmin() {
	const queryClient = useQueryClient();
	return () => {
		void queryClient.invalidateQueries({ queryKey: ['admin'] });
	};
}

export function useUpdateAdminSettings() {
	const invalidate = useInvalidateAdmin();
	return useMutation({
		mutationFn: (registrationLocked: boolean) =>
			apiFetch<ApiResponse<AppSettingsResponse>>('/admin/settings', {
				method: 'PATCH',
				body: JSON.stringify({ registrationLocked }),
			}).then((response) => response.data),
		onSuccess: invalidate,
	});
}

export function useCreateAdminUser() {
	const invalidate = useInvalidateAdmin();
	return useMutation({
		mutationFn: (input: { email: string; password: string; role: 'admin' | 'user' }) =>
			apiFetch<ApiResponse<User>>('/admin/users', {
				method: 'POST',
				body: JSON.stringify(input),
			}).then((response) => response.data),
		onSuccess: invalidate,
	});
}

export function useUpdateAdminUser() {
	const invalidate = useInvalidateAdmin();
	return useMutation({
		mutationFn: ({ id, ...input }: { id: string; role?: 'admin' | 'user'; isActive?: boolean }) =>
			apiFetch<ApiResponse<User>>(`/admin/users/${id}`, {
				method: 'PATCH',
				body: JSON.stringify(input),
			}).then((response) => response.data),
		onSuccess: invalidate,
	});
}

export function useResetAdminPassword() {
	const invalidate = useInvalidateAdmin();
	return useMutation({
		mutationFn: ({ id, password }: { id: string; password: string }) =>
			apiFetch<ApiResponse<User>>(`/admin/users/${id}/reset-password`, {
				method: 'POST',
				body: JSON.stringify({ password }),
			}).then((response) => response.data),
		onSuccess: invalidate,
	});
}
