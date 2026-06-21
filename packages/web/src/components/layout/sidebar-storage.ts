const SIDEBAR_STORAGE_KEY = 'rss-sidebar-expanded';

export interface PersistedSidebarExpansion {
	categories: string[];
	uncategorized: boolean;
}

export function loadExpandedFromStorage(): PersistedSidebarExpansion | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { categories?: unknown; uncategorized?: unknown };
		if (!parsed || typeof parsed !== 'object') return null;
		const categories = Array.isArray(parsed.categories)
			? parsed.categories.filter((id): id is string => typeof id === 'string')
			: [];
		const uncategorized = Boolean(parsed.uncategorized);
		return { categories, uncategorized };
	} catch {
		return null;
	}
}

export function saveExpandedToStorage(categories: Set<string>, uncategorized: boolean) {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(
			SIDEBAR_STORAGE_KEY,
			JSON.stringify({ categories: Array.from(categories), uncategorized }),
		);
	} catch {
		// Ignore quota errors or disabled storage. Expansion is convenience state.
	}
}
