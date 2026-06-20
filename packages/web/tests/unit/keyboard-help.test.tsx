import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardHelp } from '../../src/components/help/keyboard-help';

describe('KeyboardHelp', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		document.body.style.overflow = '';
	});

	afterEach(() => {
		act(() => {
			vi.runOnlyPendingTimers();
		});
		vi.useRealTimers();
		cleanup();
		document.body.style.overflow = '';
	});

	it('opens from the shortcut key and closes with dialog focus restored', () => {
		render(
			<>
				<button type="button">Before help</button>
				<KeyboardHelp />
			</>,
		);

		const triggerContext = screen.getByRole('button', { name: 'Before help' });
		triggerContext.focus();
		fireEvent.keyDown(window, { key: '?' });

		expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
		expect(document.body.style.overflow).toBe('hidden');

		act(() => {
			vi.runOnlyPendingTimers();
		});
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));

		fireEvent.keyDown(window, { key: 'Escape' });

		expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
		expect(document.body.style.overflow).toBe('');
		expect(document.activeElement).toBe(triggerContext);
	});

	it('does not open while typing in an input', () => {
		render(
			<>
				<input aria-label="Filter" />
				<KeyboardHelp />
			</>,
		);

		const input = screen.getByRole('textbox', { name: 'Filter' });
		fireEvent.keyDown(input, { key: '?' });

		expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
	});
});
