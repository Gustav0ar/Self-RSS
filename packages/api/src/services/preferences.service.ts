import type { PreferencesRepository } from '../repositories/preferences.repository.js';

const DEFAULTS = {
	theme: 'system',
	fontFamily: 'Inter',
	textSize: 16,
	density: 'comfortable',
	defaultSort: 'latest',
	hideRead: false,
	keyboardShortcutsEnabled: true,
	autoMarkReadMode: 'on_navigate',
	accentColor: 'indigo',
};

export type PreferenceValues = typeof DEFAULTS;

export function resolvePreferences(
	stored: Record<string, unknown> | null | undefined,
): PreferenceValues {
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
		accentColor: typeof stored.accentColor === 'string' ? stored.accentColor : DEFAULTS.accentColor,
	};
}

export class PreferencesService {
	constructor(private prefsRepo: PreferencesRepository) {}

	async getPreferences(userId: string) {
		const stored = await this.prefsRepo.findByUserId(userId);
		return resolvePreferences(stored as Record<string, unknown> | null);
	}

	async updatePreferences(userId: string, data: Partial<PreferenceValues>) {
		const stored = await this.prefsRepo.findByUserId(userId);
		const input = stored ? data : { ...DEFAULTS, ...data };
		const prefs = await this.prefsRepo.upsert(userId, input);
		return resolvePreferences(prefs as unknown as Record<string, unknown>);
	}
}
