import type { ApiResponse, AuthSession, AuthSessionsResponse } from '@self-feed/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
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

type WebTheme = 'light' | 'dark' | 'system';
type PreferenceSavePhase = 'clean' | 'debounced' | 'saving' | 'failed' | 'retrying';
const PREFERENCES_SAVE_DEBOUNCE_MS = 450;

export function normalizeThemePreference(theme: string): WebTheme {
	return theme === 'light' || theme === 'system' ? theme : 'dark';
}

function normalizePreferences(prefs: Preferences): Preferences {
	return { ...prefs, theme: normalizeThemePreference(prefs.theme) };
}

export function usePreferences() {
	return useQuery({
		queryKey: ['preferences'],
		queryFn: ({ signal }) =>
			apiFetch<ApiResponse<Preferences>>('/preferences', { signal }).then((r) => r.data),
	});
}

export function useUpdatePreferences() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (data: Partial<Preferences>) =>
			apiFetch<ApiResponse<Preferences>>('/preferences', {
				method: 'PATCH',
				body: JSON.stringify(data),
			}).then((response) => response.data),
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
		onSuccess: (preferences) => {
			qc.setQueryData(['preferences'], preferences);
			qc.invalidateQueries({ queryKey: ['preferences'] });
		},
	});
}

export function usePreferenceSaveQueue(
	preferences: Preferences | undefined,
	setTheme: (theme: WebTheme) => void,
	updatePreferences: Pick<ReturnType<typeof useUpdatePreferences>, 'mutateAsync' | 'reset'>,
) {
	const mutatePreferences = updatePreferences.mutateAsync;
	const resetPreferenceMutation = updatePreferences.reset;
	const [isOpen, setIsOpen] = useState(false);
	const [draftPreferences, setDraftPreferences] = useState<Preferences | null>(null);
	const [pendingPatch, setPendingPatch] = useState<Partial<Preferences> | null>(null);
	const [savePhase, setSavePhase] = useState<PreferenceSavePhase>('clean');
	const [closeRequested, setCloseRequested] = useState(false);
	const pendingPatchRef = useRef<Partial<Preferences> | null>(null);
	const saveInFlightRef = useRef(false);
	const saveFailedRef = useRef(false);
	const closeRequestedRef = useRef(false);
	const acknowledgedPreferencesRef = useRef<Preferences | null>(null);

	useEffect(() => {
		if (
			!preferences ||
			pendingPatchRef.current ||
			saveInFlightRef.current ||
			saveFailedRef.current
		) {
			return;
		}

		const normalized = normalizePreferences(preferences);
		acknowledgedPreferencesRef.current = normalized;
		setDraftPreferences(normalized);
	}, [preferences]);

	const drainSaveQueue = useCallback(
		async (isRetry = false) => {
			if (saveInFlightRef.current) return;

			if (!pendingPatchRef.current) {
				if (closeRequestedRef.current) {
					closeRequestedRef.current = false;
					setCloseRequested(false);
					setIsOpen(false);
				}
				return;
			}

			saveInFlightRef.current = true;
			saveFailedRef.current = false;
			resetPreferenceMutation();

			try {
				while (pendingPatchRef.current) {
					const patch = pendingPatchRef.current;
					pendingPatchRef.current = null;
					setPendingPatch(null);
					setSavePhase(isRetry ? 'retrying' : 'saving');

					try {
						const savedPreferences = normalizePreferences(await mutatePreferences(patch));
						acknowledgedPreferencesRef.current = savedPreferences;
						const queuedPatch = pendingPatchRef.current as Partial<Preferences> | null;
						setDraftPreferences({ ...savedPreferences, ...(queuedPatch ?? {}) });
						if (!queuedPatch?.theme) {
							setTheme(normalizeThemePreference(savedPreferences.theme));
						}
						isRetry = false;
					} catch {
						const retainedPatch = { ...patch, ...(pendingPatchRef.current ?? {}) };
						pendingPatchRef.current = retainedPatch;
						setPendingPatch(retainedPatch);
						saveFailedRef.current = true;
						closeRequestedRef.current = false;
						setCloseRequested(false);
						setSavePhase('failed');
						return;
					}
				}

				setSavePhase('clean');
				if (closeRequestedRef.current) {
					closeRequestedRef.current = false;
					setCloseRequested(false);
					setIsOpen(false);
				}
			} finally {
				saveInFlightRef.current = false;
			}
		},
		[mutatePreferences, resetPreferenceMutation, setTheme],
	);

	useEffect(() => {
		if (
			!isOpen ||
			!pendingPatch ||
			savePhase === 'failed' ||
			savePhase === 'saving' ||
			savePhase === 'retrying'
		) {
			return;
		}

		const timer = window.setTimeout(() => {
			void drainSaveQueue();
		}, PREFERENCES_SAVE_DEBOUNCE_MS);

		return () => window.clearTimeout(timer);
	}, [drainSaveQueue, isOpen, pendingPatch, savePhase]);

	function handleChange<K extends keyof Preferences>(key: K, value: Preferences[K]) {
		const nextValue =
			key === 'theme' && typeof value === 'string' ? normalizeThemePreference(value) : value;
		setDraftPreferences((current) => (current ? { ...current, [key]: nextValue } : current));
		if (key === 'theme' && typeof value === 'string') {
			setTheme(normalizeThemePreference(value));
		}

		const nextPatch = { ...(pendingPatchRef.current ?? {}), [key]: nextValue };
		pendingPatchRef.current = nextPatch;
		setPendingPatch(nextPatch);
		if (!saveInFlightRef.current && !saveFailedRef.current) {
			setSavePhase('debounced');
		}
	}

	function closePanel() {
		if (pendingPatchRef.current || saveInFlightRef.current) {
			closeRequestedRef.current = true;
			setCloseRequested(true);
			void drainSaveQueue(savePhase === 'failed');
			return;
		}
		setIsOpen(false);
	}

	function revertChanges() {
		const acknowledged = acknowledgedPreferencesRef.current;
		if (!acknowledged) return;

		pendingPatchRef.current = null;
		saveFailedRef.current = false;
		closeRequestedRef.current = false;
		setPendingPatch(null);
		setSavePhase('clean');
		setCloseRequested(false);
		setDraftPreferences(acknowledged);
		setTheme(normalizeThemePreference(acknowledged.theme));
		resetPreferenceMutation();
	}

	return {
		closePanel,
		closeRequested,
		draftPreferences,
		handleChange,
		isOpen,
		openPanel: () => setIsOpen(true),
		retrySave: () => void drainSaveQueue(true),
		revertChanges,
		savePhase,
	};
}

export function useAuthSessions() {
	return useQuery({
		queryKey: ['auth-sessions'],
		queryFn: ({ signal }) =>
			apiFetch<ApiResponse<AuthSessionsResponse>>('/auth/sessions', { signal }).then(
				(r) => r.data.sessions,
			),
	});
}

export function useRevokeAuthSession() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (sessionId: string) =>
			apiFetch<ApiResponse<{ success: boolean }>>(`/auth/sessions/${sessionId}`, {
				method: 'DELETE',
			}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['auth-sessions'] });
		},
	});
}

export type { AuthSession };
