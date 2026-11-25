import { useCallback, useEffect, useRef } from 'react';
import { canUseAppShortcut } from '@/lib/keyboard-shortcuts';

export interface KeyboardNavOptions {
	articleIds: string[];
	selectedId: string | null;
	onSelect: (id: string) => void;
	onToggleRead?: (id: string) => void;
	onToggleSaved?: (id: string) => void;
	onFocusArticle?: (id: string) => void;
	onOpenExternal?: (id: string) => void;
	onRefresh?: () => void;
	enabled?: boolean;
}

export function useKeyboardNav({
	articleIds,
	selectedId,
	onSelect,
	onToggleRead,
	onToggleSaved,
	onFocusArticle,
	onOpenExternal,
	onRefresh,
	enabled = true,
}: KeyboardNavOptions) {
	const currentIndex = selectedId ? articleIds.indexOf(selectedId) : -1;
	const lastKnownSelectionRef = useRef<LastKnownSelection | null>(null);
	const stateRef = useRef({
		articleIds,
		selectedId,
		onSelect,
		onToggleRead,
		onToggleSaved,
		onFocusArticle,
		onOpenExternal,
		onRefresh,
		enabled,
	});

	stateRef.current = {
		articleIds,
		selectedId,
		onSelect,
		onToggleRead,
		onToggleSaved,
		onFocusArticle,
		onOpenExternal,
		onRefresh,
		enabled,
	};

	useEffect(() => {
		if (!selectedId) {
			lastKnownSelectionRef.current = null;
			return;
		}

		if (currentIndex >= 0) {
			lastKnownSelectionRef.current = { id: selectedId, index: currentIndex };
			return;
		}

		if (lastKnownSelectionRef.current?.id !== selectedId) {
			lastKnownSelectionRef.current = null;
		}
	}, [currentIndex, selectedId]);

	const handleKeyDown = useCallback((e: KeyboardEvent) => {
		const {
			articleIds: latestArticleIds,
			selectedId: latestSelectedId,
			onSelect: latestOnSelect,
			onToggleRead: latestOnToggleRead,
			onToggleSaved: latestOnToggleSaved,
			onFocusArticle: latestOnFocusArticle,
			onOpenExternal: latestOnOpenExternal,
			onRefresh: latestOnRefresh,
			enabled: latestEnabled,
		} = stateRef.current;

		if (!latestEnabled || e.shiftKey || !canUseAppShortcut(e)) return;

		switch (e.key) {
			case 'j':
			case 'ArrowDown': {
				if (latestArticleIds.length === 0) return;
				e.preventDefault();
				const nextId = getNextArticleId(
					latestArticleIds,
					latestSelectedId,
					lastKnownSelectionRef.current,
				);
				if (nextId) latestOnSelect(nextId);
				break;
			}
			case 'k':
			case 'ArrowUp': {
				if (latestArticleIds.length === 0) return;
				e.preventDefault();
				const prevId = getPrevArticleId(
					latestArticleIds,
					latestSelectedId,
					lastKnownSelectionRef.current,
				);
				if (prevId) latestOnSelect(prevId);
				break;
			}
			case 'm': {
				if (latestSelectedId && latestOnToggleRead) {
					e.preventDefault();
					latestOnToggleRead(latestSelectedId);
				}
				break;
			}
			case 's': {
				if (latestSelectedId && latestOnToggleSaved) {
					e.preventDefault();
					latestOnToggleSaved(latestSelectedId);
				}
				break;
			}
			case 'v': {
				if (latestSelectedId && latestOnOpenExternal) {
					e.preventDefault();
					latestOnOpenExternal(latestSelectedId);
				}
				break;
			}
			case 'r': {
				if (latestOnRefresh) {
					e.preventDefault();
					latestOnRefresh();
				}
				break;
			}
			case 'Enter': {
				if (latestSelectedId) {
					e.preventDefault();
					if (latestOnFocusArticle) {
						latestOnFocusArticle(latestSelectedId);
					} else {
						latestOnSelect(latestSelectedId);
					}
				}
				break;
			}
		}
	}, []);

	useEffect(() => {
		if (!enabled) return;
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [enabled, handleKeyDown]);

	return { currentIndex };
}

interface LastKnownSelection {
	id: string;
	index: number;
}

export function getNextArticleId(
	articleIds: string[],
	currentId: string | null,
	lastKnownSelection?: LastKnownSelection | null,
): string | null {
	if (!currentId || articleIds.length === 0) return articleIds[0] ?? null;
	const idx = articleIds.indexOf(currentId);
	if (idx === -1) {
		if (lastKnownSelection?.id === currentId) {
			return articleIds[lastKnownSelection.index] ?? currentId;
		}
		return currentId;
	}
	return articleIds[Math.min(idx + 1, articleIds.length - 1)] ?? null;
}

export function getPrevArticleId(
	articleIds: string[],
	currentId: string | null,
	lastKnownSelection?: LastKnownSelection | null,
): string | null {
	if (!currentId || articleIds.length === 0) return articleIds[0] ?? null;
	const idx = articleIds.indexOf(currentId);
	if (idx === -1) {
		if (lastKnownSelection?.id === currentId) {
			return articleIds[lastKnownSelection.index - 1] ?? currentId;
		}
		return currentId;
	}
	return articleIds[Math.max(idx - 1, 0)] ?? null;
}
