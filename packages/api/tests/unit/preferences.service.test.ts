import { describe, expect, it, vi } from 'vitest';
import { PreferencesService, resolvePreferences } from '../../src/services/preferences.service.js';

describe('resolvePreferences', () => {
	it('returns defaults when the stored payload is null or undefined', () => {
		expect(resolvePreferences(null)).toEqual({
			theme: 'system',
			fontFamily: 'Inter',
			textSize: 16,
			density: 'comfortable',
			defaultSort: 'latest',
			hideRead: false,
			keyboardShortcutsEnabled: true,
			autoMarkReadMode: 'on_navigate',
			accentColor: 'indigo',
		});
	});

	it('falls back to defaults for fields with the wrong type', () => {
		const result = resolvePreferences({
			theme: 123,
			textSize: 'oops',
			hideRead: 'yes',
		});
		expect(result.theme).toBe('system');
		expect(result.textSize).toBe(16);
		expect(result.hideRead).toBe(false);
	});

	it('keeps valid stored values intact', () => {
		const result = resolvePreferences({
			theme: 'dark',
			fontFamily: 'Georgia',
			textSize: 18,
			density: 'compact',
			defaultSort: 'oldest',
			hideRead: true,
			keyboardShortcutsEnabled: false,
			autoMarkReadMode: 'on_open',
			accentColor: 'rose',
		});
		expect(result).toEqual({
			theme: 'dark',
			fontFamily: 'Georgia',
			textSize: 18,
			density: 'compact',
			defaultSort: 'oldest',
			hideRead: true,
			keyboardShortcutsEnabled: false,
			autoMarkReadMode: 'on_open',
			accentColor: 'rose',
		});
	});
});

describe('PreferencesService', () => {
	it('writes the partial update directly when stored already exists', async () => {
		const stored = {
			theme: 'dark',
			fontFamily: 'Inter',
			textSize: 16,
			density: 'comfortable',
			defaultSort: 'latest',
			hideRead: false,
			keyboardShortcutsEnabled: true,
			autoMarkReadMode: 'on_navigate',
			accentColor: 'indigo',
		};
		const prefsRepo = {
			findByUserId: vi.fn().mockResolvedValue(stored),
			upsert: vi.fn(async (_userId, data) => data),
		};
		const service = new PreferencesService(prefsRepo as never);

		await service.updatePreferences('user-1', { fontFamily: 'Georgia', hideRead: true });

		expect(prefsRepo.upsert).toHaveBeenCalledWith('user-1', {
			fontFamily: 'Georgia',
			hideRead: true,
		});
	});

	it('applies the default set when no prior row exists', async () => {
		const prefsRepo = {
			findByUserId: vi.fn().mockResolvedValue(null),
			upsert: vi.fn(async (_userId, data) => data),
		};
		const service = new PreferencesService(prefsRepo as never);

		await service.updatePreferences('user-1', { theme: 'light' });

		const call = prefsRepo.upsert.mock.calls[0]?.[1] as Record<string, unknown>;
		expect(call.theme).toBe('light');
		expect(call.fontFamily).toBe('Inter');
		expect(call.accentColor).toBe('indigo');
	});

	it('normalizes the response back to the typed preference shape', async () => {
		const prefsRepo = {
			findByUserId: vi.fn().mockResolvedValue({ theme: 'dark' }),
			upsert: vi.fn(async () => ({ theme: 'dark' })),
		};
		const service = new PreferencesService(prefsRepo as never);

		const result = await service.updatePreferences('user-1', { theme: 'dark' });
		expect(result.theme).toBe('dark');
		expect(result.accentColor).toBe('indigo');
	});
});
