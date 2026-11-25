import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode, useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../../src/providers/auth';

const apiFetchMock = vi.fn();
const clearTokensMock = vi.fn();
const getAccessTokenMock = vi.fn();
const getLastRefreshOutcomeMock = vi.fn();
const loadTokensMock = vi.fn();
const refreshAccessTokenMock = vi.fn();
const setAuthLostHandlerMock = vi.fn();
const setTokensMock = vi.fn();
const clearOfflineQueryCacheMock = vi.fn();
const clearOfflineStateMock = vi.fn();
const loadOfflineUserMock = vi.fn();
const saveOfflineUserMock = vi.fn();
const restoreQueryClientMock = vi.fn();
const setSignedOutLocallyMock = vi.fn();

vi.mock('../../src/lib/product-analytics', () => ({
	flushProductAnalyticsEvents: vi.fn(),
	queueProductAnalyticsEvent: vi.fn(),
	setProductAnalyticsUser: vi.fn(),
	trackProductAnalyticsAppOpen: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
	ApiClientError: class extends Error {
		constructor(readonly status: number) {
			super('API error');
		}
	},
	apiFetch: (...args: unknown[]) => apiFetchMock(...args),
	clearTokens: () => clearTokensMock(),
	getAccessToken: () => getAccessTokenMock(),
	getLastRefreshOutcome: () => getLastRefreshOutcomeMock(),
	loadTokens: () => loadTokensMock(),
	refreshAccessToken: () => refreshAccessTokenMock(),
	setAuthLostHandler: (handler: ((message: string) => void) | null) =>
		setAuthLostHandlerMock(handler),
	setTokens: (token: string) => setTokensMock(token),
	setSessionOwner: vi.fn(),
}));

vi.mock('../../src/lib/offline-store', async (importOriginal) => ({
	clearOfflineQueryCache: () => clearOfflineQueryCacheMock(),
	clearOfflineState: (...args: unknown[]) => clearOfflineStateMock(...args),
	flushOfflineArticleMutations: vi.fn(async () => []),
	isSignedOutLocally: vi.fn(async () => false),
	loadOfflineUser: () => loadOfflineUserMock(),
	persistQueryClient: vi.fn(async () => undefined),
	restoreQueryClient: (...args: unknown[]) => restoreQueryClientMock(...args),
	saveOfflineUser: (user: unknown) => saveOfflineUserMock(user),
	setOfflineSessionUser: (await importOriginal<typeof import('../../src/lib/offline-store')>())
		.setOfflineSessionUser,
	setSignedOutLocally: (value: boolean) => setSignedOutLocallyMock(value),
}));

function user(email: string, id = 'user-1') {
	return {
		id,
		email,
		role: 'user',
		isActive: true,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	};
}

function AuthProbe() {
	const auth = useAuth();
	if (auth.isLoading) {
		return <div>loading</div>;
	}

	return (
		<div>
			<div>{auth.isAuthenticated ? auth.username : 'logged-out'}</div>
			<div>{auth.isOffline ? 'offline' : 'online'}</div>
		</div>
	);
}

function ConnectionProbe() {
	return <div>{useAuth().isOffline ? 'offline' : 'online'}</div>;
}

function AuthActionsProbe() {
	const auth = useAuth();
	if (auth.isLoading) {
		return <div>loading</div>;
	}

	return (
		<div>
			<div>{auth.isAuthenticated ? auth.username : 'logged-out'}</div>
			<div>{auth.authLostMessage ?? 'no-auth-lost-message'}</div>
			<div>{auth.logoutError ?? 'no-logout-error'}</div>
			<div>{auth.isLoggingOut ? 'logging-out' : 'logout-idle'}</div>
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

function ReconnectedReader() {
	const { username } = useAuth();
	useLayoutEffect(() => {
		if (username === 'old@example.com') window.dispatchEvent(new Event('online'));
	}, [username]);
	return <AuthActionsProbe />;
}

describe('AuthProvider', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		apiFetchMock.mockReset();
		Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
		getLastRefreshOutcomeMock.mockReturnValue('rejected');
		loadOfflineUserMock.mockResolvedValue(null);
		clearOfflineQueryCacheMock.mockResolvedValue(undefined);
		clearOfflineStateMock.mockResolvedValue(undefined);
		saveOfflineUserMock.mockResolvedValue(undefined);
		restoreQueryClientMock.mockResolvedValue(false);
		setSignedOutLocallyMock.mockResolvedValue(true);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('reports an offline connection on the initial render', () => {
		Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
		loadOfflineUserMock.mockReturnValue(new Promise(() => {}));

		renderWithQuery(
			<AuthProvider>
				<ConnectionProbe />
			</AuthProvider>,
		);

		expect(screen.getByText('offline')).toBeTruthy();
	});

	it('restores the session through refresh and /auth/me when no access token is loaded', async () => {
		getAccessTokenMock.mockReturnValueOnce(null).mockReturnValue('restored-token');
		refreshAccessTokenMock.mockResolvedValue(true);
		apiFetchMock.mockResolvedValue({ data: user('user@example.com') });

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

	it('restores the last reader and retained queries when the server is unavailable', async () => {
		getAccessTokenMock.mockReturnValue(null);
		refreshAccessTokenMock.mockResolvedValue(false);
		getLastRefreshOutcomeMock.mockReturnValue('unavailable');
		loadOfflineUserMock.mockResolvedValue(user('offline@example.com'));
		const queryClient = new QueryClient();
		queryClient.setQueryData(['articles'], { data: [{ id: 'article-1' }] });

		renderWithQuery(
			<AuthProvider>
				<AuthProbe />
			</AuthProvider>,
			queryClient,
		);

		await waitFor(() => expect(screen.getByText('offline@example.com')).toBeTruthy());
		expect(screen.getByText('offline')).toBeTruthy();
		expect(queryClient.getQueryData(['articles'])).toEqual({ data: [{ id: 'article-1' }] });
		expect(clearOfflineStateMock).not.toHaveBeenCalled();
	});

	it('clears cached user data before completing login', async () => {
		getAccessTokenMock.mockReturnValue(null);
		refreshAccessTokenMock.mockResolvedValue(false);
		apiFetchMock.mockResolvedValue({
			data: { tokens: { accessToken: 'next-token' }, user: user('next@example.com', 'user-2') },
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
				user: user('registered@example.com', 'user-3'),
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
			if (path === '/auth/me') return { data: user('current@example.com') };
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

	it('logs out locally without waiting for server revocation', async () => {
		let finishLogout: (() => void) | null = null;
		getAccessTokenMock.mockReturnValue('current-token');
		apiFetchMock.mockImplementation((path: string) => {
			if (path === '/auth/me') return Promise.resolve({ data: user('current@example.com') });
			return new Promise((resolve) => {
				finishLogout = () => resolve({ data: { success: true } });
			});
		});

		renderWithQuery(
			<AuthProvider>
				<AuthActionsProbe />
			</AuthProvider>,
		);
		await waitFor(() => expect(screen.getByText('current@example.com')).toBeTruthy());

		fireEvent.click(screen.getByRole('button', { name: 'logout' }));

		await waitFor(() => expect(screen.getByText('logged-out')).toBeTruthy());
		expect(clearTokensMock).toHaveBeenCalled();

		act(() => finishLogout?.());
		await waitFor(() => expect(screen.getByText('logged-out')).toBeTruthy());
		expect(screen.getByText('logout-idle')).toBeTruthy();
	});

	it('keeps the user logged out when server revocation fails', async () => {
		getAccessTokenMock.mockReturnValue('current-token');
		apiFetchMock.mockImplementation(async (path: string) => {
			if (path === '/auth/me') return { data: user('current@example.com') };
			throw new Error('Service unavailable');
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

		await waitFor(() => expect(screen.getByText('logged-out')).toBeTruthy());
		expect(clearTokensMock).toHaveBeenCalled();
		expect(queryClient.getQueryData(['stats'])).toBeUndefined();
	});

	it('keeps the reader signed in until remote revocation succeeds if the local marker fails', async () => {
		getAccessTokenMock.mockReturnValue('current-token');
		apiFetchMock
			.mockResolvedValueOnce({ data: user('current@example.com') })
			.mockRejectedValueOnce(new TypeError('offline'))
			.mockResolvedValueOnce({ data: { success: true } });
		setSignedOutLocallyMock.mockResolvedValue(false);
		const { queryClient } = renderWithQuery(
			<AuthProvider>
				<AuthActionsProbe />
			</AuthProvider>,
		);
		await screen.findByText('current@example.com');
		queryClient.setQueryData(['stats'], { totalUnread: 10 });

		fireEvent.click(screen.getByRole('button', { name: 'logout' }));
		await screen.findByText('Could not finish signing out. Please try again.');
		expect(screen.getByText('current@example.com')).toBeTruthy();
		expect(screen.getByText('logout-idle')).toBeTruthy();
		expect(clearOfflineStateMock).not.toHaveBeenCalled();
		expect(clearTokensMock).not.toHaveBeenCalled();
		expect(queryClient.getQueryData(['stats'])).toEqual({ totalUnread: 10 });

		fireEvent.click(screen.getByRole('button', { name: 'logout' }));
		await screen.findByText('logged-out');
		expect(screen.getByText('no-logout-error')).toBeTruthy();
		expect(queryClient.getQueryData(['stats'])).toBeUndefined();
	});

	it('retains pending edits for the previous account when bootstrap verifies a different account', async () => {
		loadOfflineUserMock.mockResolvedValue(user('old@example.com', 'old'));
		getAccessTokenMock.mockReturnValue('current-token');
		apiFetchMock.mockResolvedValue({ data: user('current@example.com') });

		renderWithQuery(
			<AuthProvider>
				<AuthProbe />
			</AuthProvider>,
		);
		await screen.findByText('current@example.com');
		expect(clearOfflineStateMock).toHaveBeenCalledWith('old', { keepPendingChanges: true });
	});

	it('retains the original account’s edits when reconnect verifies a different account', async () => {
		getAccessTokenMock.mockReturnValue('current-token');
		apiFetchMock
			.mockResolvedValueOnce({ data: user('old@example.com', 'old') })
			.mockResolvedValueOnce({ data: user('current@example.com') });
		renderWithQuery(
			<AuthProvider>
				<ReconnectedReader />
			</AuthProvider>,
		);
		await screen.findByText('The signed-in account changed. Please sign in again.');
		expect(screen.getByText('logged-out')).toBeTruthy();
		expect(clearOfflineStateMock).toHaveBeenCalledWith('old', { keepPendingChanges: true });
	});

	it('keeps the reader offline when a reconnect cannot verify the session', async () => {
		getAccessTokenMock.mockReturnValue('current-token');
		apiFetchMock
			.mockResolvedValueOnce({ data: user('current@example.com') })
			.mockRejectedValueOnce(new TypeError('Connection interrupted'));
		renderWithQuery(
			<AuthProvider>
				<AuthProbe />
			</AuthProvider>,
		);
		await screen.findByText('online');
		fireEvent(window, new Event('online'));
		await screen.findByText('offline');
		expect(screen.getByText('current@example.com')).toBeTruthy();
		expect(clearOfflineStateMock).not.toHaveBeenCalled();
	});

	it.each(['verify', 'restore'])(
		'honors another tab signing out during bootstrap (%s)',
		async (stage) => {
			getAccessTokenMock.mockReturnValue('current-token');
			const verify = Promise.withResolvers<{ data: ReturnType<typeof user> }>();
			const restore = Promise.withResolvers<boolean>();
			apiFetchMock.mockReturnValue(verify.promise);
			restoreQueryClientMock.mockReturnValue(restore.promise);
			renderWithQuery(
				<AuthProvider>
					<AuthActionsProbe />
				</AuthProvider>,
			);
			await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/auth/me'));
			const reader = { data: user('current@example.com') };
			if (stage === 'restore') {
				verify.resolve(reader);
				await waitFor(() => expect(restoreQueryClientMock).toHaveBeenCalled());
			}
			fireEvent(
				window,
				new StorageEvent('storage', {
					key: 'self-feed-auth-event',
					newValue: JSON.stringify({ type: 'signed-out', userId: 'user-1', nonce: 'other-tab' }),
				}),
			);
			await act(async () => {
				verify.resolve(reader);
				restore.resolve(true);
			});
			expect(await screen.findByText('logged-out')).toBeTruthy();
			expect(saveOfflineUserMock).not.toHaveBeenCalled();
		},
	);

	it('clears the session when another tab signs out the same account', async () => {
		getAccessTokenMock.mockReturnValue('current-token');
		apiFetchMock.mockResolvedValue({ data: user('current@example.com') });
		const queryClient = new QueryClient();
		queryClient.setQueryData(['stats'], { totalUnread: 10 });

		renderWithQuery(
			<AuthProvider>
				<AuthActionsProbe />
			</AuthProvider>,
			queryClient,
		);
		await waitFor(() => expect(screen.getByText('current@example.com')).toBeTruthy());

		window.dispatchEvent(
			new StorageEvent('storage', {
				key: 'self-feed-auth-event',
				newValue: JSON.stringify({
					type: 'signed-out',
					userId: 'user-1',
					nonce: 'other-tab',
				}),
			}),
		);

		await waitFor(() => expect(screen.getByText('logged-out')).toBeTruthy());
		expect(queryClient.getQueryData(['stats'])).toBeUndefined();
		expect(screen.getByText('Signed out in another tab.')).toBeTruthy();
	});

	it('clears cached user data when the API reports authentication was lost', async () => {
		let authLostHandler: ((message: string) => void) | null = null;
		setAuthLostHandlerMock.mockImplementation((handler) => {
			authLostHandler = handler;
		});
		getAccessTokenMock.mockReturnValue('current-token');
		apiFetchMock.mockResolvedValue({ data: user('current@example.com') });
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

		act(() => {
			authLostHandler?.('Authentication was lost. Please sign in again.');
		});

		await waitFor(() => {
			expect(screen.getByText('logged-out')).toBeTruthy();
		});
		expect(clearTokensMock).toHaveBeenCalled();
		expect(clearOfflineStateMock).toHaveBeenCalledWith('user-1', { keepPendingChanges: true });
		expect(queryClient.getQueryData(['stats'])).toBeUndefined();
	});
});
