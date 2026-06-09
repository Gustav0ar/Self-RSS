export const FONT_FAMILY_OPTIONS = [
	{ label: 'Inter', value: 'Inter' },
	{ label: 'System UI', value: 'system-ui' },
	{ label: 'Arial', value: 'Arial' },
	{ label: 'Verdana', value: 'Verdana' },
	{ label: 'Georgia', value: 'Georgia' },
	{ label: 'Times New Roman', value: 'Times New Roman' },
	{ label: 'Courier New', value: 'Courier New' },
] as const;

const GENERIC_FONT_FAMILIES = new Set([
	'serif',
	'sans-serif',
	'monospace',
	'cursive',
	'fantasy',
	'system-ui',
]);

export type DisplayDensityPreference = 'comfortable' | 'compact';
export type SortPreference = 'latest' | 'oldest';
export type AutoMarkReadPreference = 'disabled' | 'on_navigate' | 'on_open';

export function normalizeDensityPreference(value?: string | null): DisplayDensityPreference {
	return value === 'compact' ? 'compact' : 'comfortable';
}

export function normalizeSortPreference(value?: string | null): SortPreference {
	return value === 'oldest' ? 'oldest' : 'latest';
}

export function normalizeAutoMarkReadPreference(value?: string | null): AutoMarkReadPreference {
	if (value === 'disabled' || value === 'on_open') {
		return value;
	}
	return 'on_navigate';
}

export function fontFamilyCss(value?: string | null) {
	const family = value?.trim() || 'Inter';
	if (family.includes(',')) {
		return family;
	}
	if (GENERIC_FONT_FAMILIES.has(family)) {
		return `${family}, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
	}
	const escaped = family.replaceAll('"', '\\"');
	return `"${escaped}", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
}
