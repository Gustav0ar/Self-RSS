import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesPanel } from '../../src/components/preferences/preferences-panel';

const mutateAsyncMock = vi.fn();
const revokeSessionMock = vi.fn();
const resetMock = vi.fn();
const setThemeMock = vi.fn();
const refetchPreferencesMock = vi.fn();
const refetchSessionsMock = vi.fn();

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
let preferencesMock: typeof defaultPreferences | undefined = { ...defaultPreferences };
let preferencesError: Error | null = null;
let preferencesFailed = false;
let preferencesFetching = false;

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

vi.mock('../../src/hooks/queries', () => ({
	usePreferences: () => ({
		data: preferencesMock,
		error: preferencesError,
		isError: preferencesFailed,
		isFetching: preferencesFetching,
		isLoading: false,
		refetch: refetchPreferencesMock,
	}),
	useAuthSessions: () => ({
		data: [
			{
				id: 'session-1',
				deviceName: 'Web browser on Linux',
				clientId: 'client-1',
				ipAddress: '127.0.0.1',
				userAgent: 'Test browser',
				createdAt: '2026-06-21T00:00:00.000Z',
				lastSeenAt: '2026-06-21T00:00:00.000Z',
				current: true,
			},
		],
		error: null,
		isError: false,
		isFetching: false,
		isLoading: false,
		refetch: refetchSessionsMock,
	}),
	useRevokeAuthSession: () => ({
		mutate: revokeSessionMock,
		isPending: false,
	}),
	useUpdatePreferences: () => ({
		mutateAsync: mutateAsyncMock,
		reset: resetMock,
	}),
}));

vi.mock('../../src/providers/theme', () => ({
	useTheme: () => ({ setTheme: setThemeMock }),
}));

describe('PreferencesPanel', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mutateAsyncMock.mockReset();
		mutateAsyncMock.mockImplementation(async (patch) => ({
			...(preferencesMock ?? defaultPreferences),
			...patch,
		}));
		revokeSessionMock.mockClear();
		resetMock.mockClear();
		setThemeMock.mockClear();
		refetchPreferencesMock.mockClear();
		refetchSessionsMock.mockClear();
		preferencesMock = { ...defaultPreferences };
		preferencesError = null;
		preferencesFailed = false;
		preferencesFetching = false;
	});

	afterEach(async () => {
		await act(async () => {
			vi.runOnlyPendingTimers();
			await Promise.resolve();
		});
		vi.useRealTimers();
		cleanup();
	});

	it('debounces high-frequency preference changes and persists the latest value', async () => {
		render(<PreferencesPanel />);
		fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));

		const textSize = screen.getByLabelText(/Text Size/i);
		fireEvent.change(textSize, { target: { value: '18' } });
		fireEvent.change(textSize, { target: { value: '20' } });

		expect(screen.getByText('Text Size: 20px')).toBeTruthy();
		expect(screen.getByText('Saving shortly')).toBeTruthy();
		expect(mutateAsyncMock).not.toHaveBeenCalled();

		act(() => {
			vi.advanceTimersByTime(449);
		});
		expect(mutateAsyncMock).not.toHaveBeenCalled();

		await act(async () => {
			vi.advanceTimersByTime(1);
			await Promise.resolve();
		});
		expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
		expect(mutateAsyncMock).toHaveBeenCalledWith({ textSize: 20 });
	});

	it('keeps the panel open while a final save is pending, then closes after acknowledgement', async () => {
		const save = deferred<typeof defaultPreferences>();
		mutateAsyncMock.mockReturnValueOnce(save.promise);

		render(<PreferencesPanel />);
		fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));

		fireEvent.change(screen.getByLabelText('Density'), { target: { value: 'compact' } });
		fireEvent.click(screen.getByRole('button', { name: 'Close' }));

		expect(mutateAsyncMock).toHaveBeenCalledWith({ density: 'compact' });
		expect(screen.getByRole('button', { name: 'Saving and closing...' })).toBeTruthy();

		await act(async () => {
			save.resolve({ ...defaultPreferences, density: 'compact' });
			await save.promise;
		});

		expect(screen.getByRole('button', { name: 'Preferences' })).toBeTruthy();
	});

	it('keeps the panel open with recovery actions when its final save fails', async () => {
		mutateAsyncMock.mockRejectedValueOnce(new Error('save failed'));

		render(<PreferencesPanel />);
		fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
		fireEvent.change(screen.getByLabelText('Density'), { target: { value: 'compact' } });

		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'Close' }));
			await Promise.resolve();
		});

		expect(mutateAsyncMock).toHaveBeenCalledWith({ density: 'compact' });
		expect(screen.getByText('Changes not saved')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Retry save' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Preferences' })).toBeNull();
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

	it('lists active sessions and revokes the selected device', () => {
		render(<PreferencesPanel />);
		fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));

		expect(screen.getByText('Authenticated devices')).toBeTruthy();
		expect(screen.getByText('Web browser on Linux')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

		expect(revokeSessionMock).toHaveBeenCalledWith('session-1');
	});

	it('shows an actionable failure when preferences cannot be loaded', () => {
		preferencesMock = undefined;
		preferencesError = new Error('request failed');
		preferencesFailed = true;

		render(<PreferencesPanel />);
		fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));

		expect(screen.getByRole('alert')).toBeTruthy();
		expect(screen.getByText('Could not load preferences')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		expect(refetchPreferencesMock).toHaveBeenCalledTimes(1);
	});

	it('retains a rejected patch and retries the same changes successfully', async () => {
		mutateAsyncMock
			.mockRejectedValueOnce(new Error('save failed'))
			.mockResolvedValueOnce({ ...defaultPreferences, textSize: 20 });

		render(<PreferencesPanel />);
		fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
		fireEvent.change(screen.getByLabelText(/Text Size/i), { target: { value: '20' } });

		await act(async () => {
			vi.advanceTimersByTime(PREFERENCES_SAVE_DEBOUNCE_MS_FOR_TEST);
			await Promise.resolve();
		});

		expect(screen.getByText('Changes not saved')).toBeTruthy();
		expect(screen.getByText('Text Size: 20px')).toBeTruthy();

		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
			await Promise.resolve();
		});

		expect(mutateAsyncMock).toHaveBeenCalledTimes(2);
		expect(mutateAsyncMock).toHaveBeenNthCalledWith(2, { textSize: 20 });
		expect(screen.getByText('Saved')).toBeTruthy();
	});

	it('reverts a rejected draft to the last acknowledged preferences', async () => {
		mutateAsyncMock.mockRejectedValueOnce(new Error('save failed'));

		render(<PreferencesPanel />);
		fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
		fireEvent.change(screen.getByLabelText(/Text Size/i), { target: { value: '22' } });

		await act(async () => {
			vi.advanceTimersByTime(PREFERENCES_SAVE_DEBOUNCE_MS_FOR_TEST);
			await Promise.resolve();
		});
		fireEvent.click(screen.getByRole('button', { name: 'Revert changes' }));

		expect(screen.getByText('Text Size: 16px')).toBeTruthy();
		expect(screen.getByText('Saved')).toBeTruthy();
		expect(resetMock).toHaveBeenCalled();
	});

	it('queues edits made during an in-flight save and sends them only after acknowledgement', async () => {
		const firstSave = deferred<typeof defaultPreferences>();
		mutateAsyncMock
			.mockReturnValueOnce(firstSave.promise)
			.mockResolvedValueOnce({ ...defaultPreferences, textSize: 20, density: 'compact' });

		render(<PreferencesPanel />);
		fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
		fireEvent.change(screen.getByLabelText(/Text Size/i), { target: { value: '18' } });
		await act(async () => {
			vi.advanceTimersByTime(PREFERENCES_SAVE_DEBOUNCE_MS_FOR_TEST);
			await Promise.resolve();
		});

		fireEvent.change(screen.getByLabelText(/Text Size/i), { target: { value: '20' } });
		fireEvent.change(screen.getByLabelText('Density'), { target: { value: 'compact' } });
		expect(mutateAsyncMock).toHaveBeenCalledTimes(1);

		await act(async () => {
			firstSave.resolve({ ...defaultPreferences, textSize: 18 });
			await firstSave.promise;
			await Promise.resolve();
		});

		expect(mutateAsyncMock).toHaveBeenCalledTimes(2);
		expect(mutateAsyncMock).toHaveBeenNthCalledWith(2, {
			textSize: 20,
			density: 'compact',
		});
	});
});

const PREFERENCES_SAVE_DEBOUNCE_MS_FOR_TEST = 450;
