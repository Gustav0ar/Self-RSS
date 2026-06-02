import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../../src/providers/auth';

const apiFetchMock = vi.fn();
const clearTokensMock = vi.fn();
const getAccessTokenMock = vi.fn();
const loadTokensMock = vi.fn();
const refreshAccessTokenMock = vi.fn();

vi.mock('../../src/lib/api', () => ({
	apiFetch: (...args: unknown[]) => apiFetchMock(...args),
	clearTokens: () => clearTokensMock(),
	getAccessToken: () => getAccessTokenMock(),
	loadTokens: () => loadTokensMock(),
	refreshAccessToken: () => refreshAccessTokenMock(),
	setTokens: vi.fn(),
}));

function AuthProbe() {
	const auth = useAuth();
	if (auth.isLoading) {
		return <div>loading</div>;
	}

	return <div>{auth.isAuthenticated ? auth.username : 'logged-out'}</div>;
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

		render(
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

		render(
			<AuthProvider>
				<AuthProbe />
			</AuthProvider>,
		);

		await waitFor(() => {
			expect(screen.getByText('logged-out')).toBeTruthy();
		});
		expect(apiFetchMock).not.toHaveBeenCalled();
	});
});
