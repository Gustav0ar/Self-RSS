import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopBar } from '../../src/components/layout/top-bar';

const setThemeMock = vi.fn();
const mutateMock = vi.fn();

vi.mock('../../src/components/preferences/preferences-panel', () => ({
	PreferencesPanel: () => <div data-testid="preferences-panel" />,
}));

vi.mock('../../src/components/search/search-bar', () => ({
	SearchBar: () => <div data-testid="search-bar" />,
}));

vi.mock('../../src/providers/auth', () => ({
	useAuth: () => ({
		isAuthenticated: true,
		logout: vi.fn(),
		username: 'admin@example.com',
	}),
}));

vi.mock('../../src/providers/theme', () => ({
	useTheme: () => ({
		theme: 'dark',
		resolvedTheme: 'dark',
		setTheme: setThemeMock,
	}),
}));

vi.mock('../../src/hooks/queries', () => ({
	useUpdatePreferences: () => ({
		mutate: mutateMock,
	}),
}));

describe('TopBar', () => {
	it('cycles from dark to amoled and persists the preference', () => {
		render(<TopBar />);

		fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));

		expect(setThemeMock).toHaveBeenCalledWith('amoled');
		expect(mutateMock).toHaveBeenCalledWith({ theme: 'amoled' });
	});
});
