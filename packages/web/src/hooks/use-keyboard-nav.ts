import { useCallback, useEffect } from 'react';

export interface KeyboardNavOptions {
	articleIds: string[];
	selectedId: string | null;
	onSelect: (id: string) => void;
	onToggleRead?: (id: string) => void;
	onOpenExternal?: (id: string) => void;
	onRefresh?: () => void;
	enabled?: boolean;
}

export function useKeyboardNav({
	articleIds,
	selectedId,
	onSelect,
	onToggleRead,
	onOpenExternal,
	onRefresh,
	enabled = true,
}: KeyboardNavOptions) {
	const currentIndex = selectedId ? articleIds.indexOf(selectedId) : -1;

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (!enabled || articleIds.length === 0) return;

			const target = e.target as HTMLElement;
			if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
				return;
			}

			switch (e.key) {
				case 'j':
				case 'ArrowDown': {
					e.preventDefault();
					const nextIdx = Math.min(currentIndex + 1, articleIds.length - 1);
					const nextId = articleIds[nextIdx];
					if (nextId) onSelect(nextId);
					break;
				}
				case 'k':
				case 'ArrowUp': {
					e.preventDefault();
					const prevIdx = Math.max(currentIndex - 1, 0);
					const prevId = articleIds[prevIdx];
					if (prevId) onSelect(prevId);
					break;
				}
				case 'm': {
					if (selectedId && onToggleRead) {
						e.preventDefault();
						onToggleRead(selectedId);
					}
					break;
				}
				case 'v': {
					if (selectedId && onOpenExternal) {
						e.preventDefault();
						onOpenExternal(selectedId);
					}
					break;
				}
				case 'r': {
					if (onRefresh) {
						e.preventDefault();
						onRefresh();
					}
					break;
				}
				case 'Enter': {
					if (selectedId) {
						e.preventDefault();
						onSelect(selectedId);
					}
					break;
				}
			}
		},
		[
			enabled,
			articleIds,
			currentIndex,
			selectedId,
			onSelect,
			onToggleRead,
			onOpenExternal,
			onRefresh,
		],
	);

	useEffect(() => {
		if (!enabled) return;
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [enabled, handleKeyDown]);

	return { currentIndex };
}

export function getNextArticleId(articleIds: string[], currentId: string | null): string | null {
	if (!currentId || articleIds.length === 0) return articleIds[0] ?? null;
	const idx = articleIds.indexOf(currentId);
	if (idx === -1) return articleIds[0] ?? null;
	return articleIds[Math.min(idx + 1, articleIds.length - 1)] ?? null;
}

export function getPrevArticleId(articleIds: string[], currentId: string | null): string | null {
	if (!currentId || articleIds.length === 0) return articleIds[0] ?? null;
	const idx = articleIds.indexOf(currentId);
	if (idx === -1) return articleIds[0] ?? null;
	return articleIds[Math.max(idx - 1, 0)] ?? null;
}
