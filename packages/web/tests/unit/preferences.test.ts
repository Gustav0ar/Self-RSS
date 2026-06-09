import { describe, expect, it } from 'vitest';

// Mirrors the resolvePreferences logic from api service for unit testing
const DEFAULTS = {
	theme: 'system',
	fontFamily: 'Inter',
	textSize: 16,
	density: 'comfortable',
	defaultSort: 'latest',
	hideRead: false,
	keyboardShortcutsEnabled: true,
	autoMarkReadMode: 'on_navigate',
};

type PreferenceValues = typeof DEFAULTS;

function resolvePreferences(stored: Record<string, unknown> | null | undefined): PreferenceValues {
	if (!stored) return { ...DEFAULTS };
	return {
		theme: typeof stored.theme === 'string' ? stored.theme : DEFAULTS.theme,
		fontFamily: typeof stored.fontFamily === 'string' ? stored.fontFamily : DEFAULTS.fontFamily,
		textSize: typeof stored.textSize === 'number' ? stored.textSize : DEFAULTS.textSize,
		density: typeof stored.density === 'string' ? stored.density : DEFAULTS.density,
		defaultSort: typeof stored.defaultSort === 'string' ? stored.defaultSort : DEFAULTS.defaultSort,
		hideRead: typeof stored.hideRead === 'boolean' ? stored.hideRead : DEFAULTS.hideRead,
		keyboardShortcutsEnabled:
			typeof stored.keyboardShortcutsEnabled === 'boolean'
				? stored.keyboardShortcutsEnabled
				: DEFAULTS.keyboardShortcutsEnabled,
		autoMarkReadMode:
			typeof stored.autoMarkReadMode === 'string'
				? stored.autoMarkReadMode
				: DEFAULTS.autoMarkReadMode,
	};
}

describe('resolvePreferences', () => {
	it('returns all defaults when stored is null', () => {
		const result = resolvePreferences(null);
		expect(result).toEqual(DEFAULTS);
	});

	it('returns all defaults when stored is undefined', () => {
		const result = resolvePreferences(undefined);
		expect(result).toEqual(DEFAULTS);
	});

	it('returns all defaults when stored is empty object', () => {
		const result = resolvePreferences({});
		expect(result).toEqual(DEFAULTS);
	});

	it('merges partial stored values with defaults', () => {
		const result = resolvePreferences({
			theme: 'dark',
			textSize: 20,
		});
		expect(result.theme).toBe('dark');
		expect(result.textSize).toBe(20);
		expect(result.fontFamily).toBe('Inter');
		expect(result.density).toBe('comfortable');
		expect(result.keyboardShortcutsEnabled).toBe(true);
	});

	it('respects false boolean values', () => {
		const result = resolvePreferences({
			hideRead: false,
			keyboardShortcutsEnabled: false,
		});
		expect(result.hideRead).toBe(false);
		expect(result.keyboardShortcutsEnabled).toBe(false);
	});

	it('respects all overridden values', () => {
		const overrides: PreferenceValues = {
			theme: 'light',
			fontFamily: 'Roboto',
			textSize: 18,
			density: 'compact',
			defaultSort: 'oldest',
			hideRead: true,
			keyboardShortcutsEnabled: false,
			autoMarkReadMode: 'on_navigate',
		};
		const result = resolvePreferences(overrides);
		expect(result).toEqual(overrides);
	});

	it('ignores non-matching types and uses defaults', () => {
		const result = resolvePreferences({
			theme: 123,
			textSize: 'bad',
			hideRead: 'yes',
		});
		expect(result.theme).toBe('system');
		expect(result.textSize).toBe(16);
		expect(result.hideRead).toBe(false);
	});
});
