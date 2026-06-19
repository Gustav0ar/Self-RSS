import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../../src/providers/auth';

const apiFetchMock = vi.fn();
const clearTokensMock = vi.fn();
const getAccessTokenMock = vi.fn();
const loadTokensMock = vi.fn();
const refreshAccessTokenMock = vi.fn();
const setTokensMock = vi.fn();

vi.mock('../../src/lib/api', () => ({
	apiFetch: (...args: unknown[]) => apiFetchMock(...args),
	clearTokens: () => clearTokensMock(),
	getAccessToken: () => getAccessTokenMock(),
	loadTokens: () => loadTokensMock(),
	refreshAccessToken: () => refreshAccessTokenMock(),
	setTokens: (token: string) => setTokensMock(token),
}));

function AuthProbe() {
	const auth = useAuth();
	if (auth.isLoading) {
		return <div>loading</div>;
	}

	return <div>{auth.isAuthenticated ? auth.username : 'logged-out'}</div>;
}

function AuthActionsProbe() {
	const auth = useAuth();
	if (auth.isLoading) {
		return <div>loading</div>;
	}

	return (
		<div>
			<div>{auth.isAuthenticated ? auth.username : 'logged-out'}</div>
			<button type="button" onClick={() => void auth.login('next@example.com', 'password123')}>
				login
			</button>
			<button
				type="button"
				onClick={() => void auth.register('next', 'registered@example.com', 'password123')}
			>
				register
			</button>
			<button type="button" onClick={() => void auth.logout()}>
				logout
			</button>
		</div>
	);
}

function renderWithQuery(node: ReactNode, queryClient = new QueryClient()) {
	return {
		queryClient,
		...render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>),
	};
}

describe('AuthProvider', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('restores the session through refresh and /auth/me when no access token is loaded', async () => {
		getAccessTokenMock.mockReturnValueOnce(null).mockReturnValue('restored-token');
		refreshAccessTokenMock.mockResolvedValue(true);
		apiFetchMock.mockResolvedValue({ data: { email: 'user@example.com' } });

		renderWithQuery(
			<AuthProvider>
				<AuthProbe />
			</AuthProvider>,
		);

		await waitFor(() => {
			expect(screen.getByText('user@example.com')).toBeTruthy();
		});
		expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1);
		expect(apiFetchMock).toHaveBeenCalledWith('/auth/me');
	});

	it('stays logged out when refresh cannot restore a session', async () => {
		getAccessTokenMock.mockReturnValue(null);
		refreshAccessTokenMock.mockResolvedValue(false);

		const queryClient = new QueryClient();
		queryClient.setQueryData(['preferences'], { hideRead: true });

		renderWithQuery(
			<AuthProvider>
				<AuthProbe />
			</AuthProvider>,
			queryClient,
		);

		await waitFor(() => {
			expect(screen.getByText('logged-out')).toBeTruthy();
		});
		expect(apiFetchMock).not.toHaveBeenCalled();
		expect(queryClient.getQueryData(['preferences'])).toBeUndefined();
	});

	it('clears cached user data before completing login', async () => {
		getAccessTokenMock.mockReturnValue(null);
		refreshAccessTokenMock.mockResolvedValue(false);
		apiFetchMock.mockResolvedValue({
			data: { tokens: { accessToken: 'next-token' }, user: { email: 'next@example.com' } },
		});
		const queryClient = new QueryClient();
		queryClient.setQueryData(['preferences'], { hideRead: true });

		renderWithQuery(
			<AuthProvider>
				<AuthActionsProbe />
			</AuthProvider>,
			queryClient,
		);
		await waitFor(() => {
			expect(screen.getByText('logged-out')).toBeTruthy();
		});

		fireEvent.click(screen.getByRole('button', { name: 'login' }));

		await waitFor(() => {
			expect(screen.getByText('next@example.com')).toBeTruthy();
		});
		expect(setTokensMock).toHaveBeenCalledWith('next-token');
		expect(queryClient.getQueryData(['preferences'])).toBeUndefined();
	});

	it('clears cached user data before completing registration', async () => {
		getAccessTokenMock.mockReturnValue(null);
		refreshAccessTokenMock.mockResolvedValue(false);
		apiFetchMock.mockResolvedValue({
			data: {
				tokens: { accessToken: 'registered-token' },
				user: { email: 'registered@example.com' },
			},
		});
		const queryClient = new QueryClient();
		queryClient.setQueryData(['stats'], { totalUnread: 5 });

		renderWithQuery(
			<AuthProvider>
				<AuthActionsProbe />
			</AuthProvider>,
			queryClient,
		);
		await waitFor(() => {
			expect(screen.getByText('logged-out')).toBeTruthy();
		});

		fireEvent.click(screen.getByRole('button', { name: 'register' }));

		await waitFor(() => {
			expect(screen.getByText('registered@example.com')).toBeTruthy();
		});
		expect(setTokensMock).toHaveBeenCalledWith('registered-token');
		expect(queryClient.getQueryData(['stats'])).toBeUndefined();
	});

	it('clears cached user data on logout even when the API call succeeds', async () => {
		getAccessTokenMock.mockReturnValue('current-token');
		apiFetchMock.mockImplementation(async (path: string) => {
			if (path === '/auth/me') return { data: { email: 'current@example.com' } };
			return { data: { success: true } };
		});
		const queryClient = new QueryClient();
		queryClient.setQueryData(['stats'], { totalUnread: 10 });

		renderWithQuery(
			<AuthProvider>
				<AuthActionsProbe />
			</AuthProvider>,
			queryClient,
		);
		await waitFor(() => {
			expect(screen.getByText('current@example.com')).toBeTruthy();
		});

		fireEvent.click(screen.getByRole('button', { name: 'logout' }));

		await waitFor(() => {
			expect(screen.getByText('logged-out')).toBeTruthy();
		});
		expect(clearTokensMock).toHaveBeenCalled();
		expect(queryClient.getQueryData(['stats'])).toBeUndefined();
	});
});
