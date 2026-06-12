import { describe, expect, it } from 'vitest';
import {
	ACCENT_COLOR_OPTIONS,
	isAccentColor,
	normalizeAccentColor,
} from '../../src/lib/preferences';

describe('accent color preferences', () => {
	it('lists six options', () => {
		expect(ACCENT_COLOR_OPTIONS).toHaveLength(6);
	});

	it('exposes light and dark values for each option', () => {
		for (const option of ACCENT_COLOR_OPTIONS) {
			expect(option.light).toMatch(/^#[0-9a-f]{6}$/i);
			expect(option.dark).toMatch(/^#[0-9a-f]{6}$/i);
		}
	});

	it('isAccentColor accepts known values', () => {
		for (const option of ACCENT_COLOR_OPTIONS) {
			expect(isAccentColor(option.value)).toBe(true);
		}
	});

	it('isAccentColor rejects unknown values', () => {
		expect(isAccentColor('mauve')).toBe(false);
		expect(isAccentColor(undefined)).toBe(false);
		expect(isAccentColor(null)).toBe(false);
		expect(isAccentColor(42)).toBe(false);
	});

	it('normalizeAccentColor defaults to indigo', () => {
		expect(normalizeAccentColor(undefined)).toBe('indigo');
		expect(normalizeAccentColor(null)).toBe('indigo');
		expect(normalizeAccentColor('mauve')).toBe('indigo');
	});

	it('normalizeAccentColor passes through known values', () => {
		expect(normalizeAccentColor('rose')).toBe('rose');
		expect(normalizeAccentColor('emerald')).toBe('emerald');
	});
});
