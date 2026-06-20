import type { ApiResponse } from '@self-feed/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

// --- Preferences ---

export interface Preferences {
	theme: string;
	fontFamily: string;
	textSize: number;
	density: string;
	defaultSort: string;
	hideRead: boolean;
	keyboardShortcutsEnabled: boolean;
	autoMarkReadMode: string;
	accentColor: string;
}

export function usePreferences() {
	return useQuery({
		queryKey: ['preferences'],
		queryFn: () => apiFetch<ApiResponse<Preferences>>('/preferences').then((r) => r.data),
	});
}

export function useUpdatePreferences() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (data: Partial<Preferences>) =>
			apiFetch<ApiResponse<Preferences>>('/preferences', {
				method: 'PATCH',
				body: JSON.stringify(data),
			}),
		onMutate: async (data) => {
			await qc.cancelQueries({ queryKey: ['preferences'] });
			const previous = qc.getQueryData<Preferences>(['preferences']);
			if (previous) {
				qc.setQueryData<Preferences>(['preferences'], { ...previous, ...data });
			}
			return { previous };
		},
		onError: (_error, _data, context) => {
			if (context?.previous) {
				qc.setQueryData(['preferences'], context.previous);
			}
		},
		onSuccess: (response) => {
			qc.setQueryData(['preferences'], response.data);
			qc.invalidateQueries({ queryKey: ['preferences'] });
		},
	});
}
