import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesPanel } from '../../src/components/preferences/preferences-panel';

const mutateMock = vi.fn();
const resetMock = vi.fn();
const setThemeMock = vi.fn();

const defaultPreferences = {
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
let preferencesMock = { ...defaultPreferences };

vi.mock('../../src/hooks/queries', () => ({
	usePreferences: () => ({ data: preferencesMock, isLoading: false }),
	useUpdatePreferences: () => ({
		mutate: mutateMock,
		isPending: false,
		isError: false,
		reset: resetMock,
	}),
}));

vi.mock('../../src/providers/theme', () => ({
	useTheme: () => ({ setTheme: setThemeMock }),
}));

describe('PreferencesPanel', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mutateMock.mockClear();
		resetMock.mockClear();
		setThemeMock.mockClear();
		preferencesMock = { ...defaultPreferences };
	});

	afterEach(() => {
		act(() => {
			vi.runOnlyPendingTimers();
		});
		vi.useRealTimers();
		cleanup();
	});

	it('debounces high-frequency preference changes and persists the latest value', () => {
		render(<PreferencesPanel />);
		fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));

		const textSize = screen.getByLabelText(/Text Size/i);
		fireEvent.change(textSize, { target: { value: '18' } });
		fireEvent.change(textSize, { target: { value: '20' } });

		expect(screen.getByText('Text Size: 20px')).toBeTruthy();
		expect(screen.getByText('Saving shortly')).toBeTruthy();
		expect(mutateMock).not.toHaveBeenCalled();

		act(() => {
			vi.advanceTimersByTime(449);
		});
		expect(mutateMock).not.toHaveBeenCalled();

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(mutateMock).toHaveBeenCalledTimes(1);
		expect(mutateMock).toHaveBeenCalledWith({ textSize: 20 });
	});

	it('flushes unsaved preferences when the panel closes', () => {
		render(<PreferencesPanel />);
		fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));

		fireEvent.change(screen.getByLabelText('Density'), { target: { value: 'compact' } });
		fireEvent.click(screen.getByRole('button', { name: 'Close' }));

		expect(mutateMock).toHaveBeenCalledWith({ density: 'compact' });
	});

	it('keeps the open draft when the preferences query refreshes mid-edit', () => {
		const { rerender } = render(<PreferencesPanel />);
		fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));

		fireEvent.click(screen.getByRole('checkbox', { name: 'Hide read articles' }));
		expect(
			(screen.getByRole('checkbox', { name: 'Hide read articles' }) as HTMLInputElement).checked,
		).toBe(true);

		preferencesMock = { ...defaultPreferences, fontFamily: 'Georgia' };
		rerender(<PreferencesPanel />);

		expect(
			(screen.getByRole('checkbox', { name: 'Hide read articles' }) as HTMLInputElement).checked,
		).toBe(true);
	});
});
