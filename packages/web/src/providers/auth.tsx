import type { ApiResponse, LoginResponse, RegisterResponse, User } from '@self-feed/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
	apiFetch,
	clearTokens,
	getAccessToken,
	loadTokens,
	refreshAccessToken,
	setAuthLostHandler,
	setTokens,
} from '../lib/api';

interface AuthState {
	isAuthenticated: boolean;
	isLoading: boolean;
	username: string | null;
	user: User | null;
	authLostMessage: string | null;
	logoutError: string | null;
	isLoggingOut: boolean;
	login: (username: string, password: string) => Promise<void>;
	register: (username: string, email: string, password: string) => Promise<void>;
	logout: () => Promise<boolean>;
	clearAuthLostMessage: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const queryClient = useQueryClient();
	const [isAuthenticated, setIsAuthenticated] = useState(false);
	const [isLoading, setIsLoading] = useState(true);
	const [username, setUsername] = useState<string | null>(null);
	const [user, setUser] = useState<User | null>(null);
	const [authLostMessage, setAuthLostMessage] = useState<string | null>(null);
	const [logoutError, setLogoutError] = useState<string | null>(null);
	const [isLoggingOut, setIsLoggingOut] = useState(false);

	useEffect(() => {
		setAuthLostHandler((message) => {
			clearTokens();
			queryClient.clear();
			setLogoutError(null);
			setIsAuthenticated(false);
			setUsername(null);
			setUser(null);
			setAuthLostMessage(message);
			setIsLoading(false);
		});

		return () => setAuthLostHandler(null);
	}, [queryClient]);

	useEffect(() => {
		let cancelled = false;

		const bootstrap = async () => {
			loadTokens();

			if (!getAccessToken()) {
				await refreshAccessToken();
			}

			if (!getAccessToken()) {
				if (!cancelled) {
					queryClient.clear();
					setIsAuthenticated(false);
					setUsername(null);
					setUser(null);
					setIsLoading(false);
				}
				return;
			}

			try {
				const response = await apiFetch<ApiResponse<User>>('/auth/me');
				if (!cancelled) {
					setIsAuthenticated(true);
					setUsername(response.data.email);
					setUser(response.data);
				}
			} catch {
				clearTokens();
				if (!cancelled) {
					queryClient.clear();
					setIsAuthenticated(false);
					setUsername(null);
					setUser(null);
				}
			} finally {
				if (!cancelled) {
					setIsLoading(false);
				}
			}
		};

		void bootstrap();

		return () => {
			cancelled = true;
		};
	}, [queryClient]);

	const login = useCallback(
		async (email: string, password: string) => {
			const res = await apiFetch<ApiResponse<LoginResponse>>('/auth/login', {
				method: 'POST',
				body: JSON.stringify({ email, password }),
			});
			queryClient.clear();
			setAuthLostMessage(null);
			setLogoutError(null);
			setTokens(res.data.tokens.accessToken);
			setUsername(res.data.user.email);
			setUser(res.data.user);
			setIsAuthenticated(true);
		},
		[queryClient],
	);

	const register = useCallback(
		async (_uname: string, email: string, password: string) => {
			const res = await apiFetch<ApiResponse<RegisterResponse>>('/auth/register', {
				method: 'POST',
				body: JSON.stringify({ email, password }),
			});
			queryClient.clear();
			setAuthLostMessage(null);
			setLogoutError(null);
			setTokens(res.data.tokens.accessToken);
			setUsername(res.data.user.email);
			setUser(res.data.user);
			setIsAuthenticated(true);
		},
		[queryClient],
	);

	const logout = useCallback(async () => {
		setIsLoggingOut(true);
		setLogoutError(null);
		try {
			await apiFetch('/auth/logout', { method: 'POST' });
		} catch {
			setLogoutError('Sign out failed. Your session is still active; please try again.');
			setIsLoggingOut(false);
			return false;
		}
		clearTokens();
		queryClient.clear();
		setIsAuthenticated(false);
		setUsername(null);
		setUser(null);
		setAuthLostMessage(null);
		setLogoutError(null);
		setIsLoggingOut(false);
		return true;
	}, [queryClient]);

	const clearAuthLostMessage = useCallback(() => {
		setAuthLostMessage(null);
	}, []);

	return (
		<AuthContext.Provider
			value={{
				isAuthenticated,
				isLoading,
				username,
				user,
				authLostMessage,
				logoutError,
				isLoggingOut,
				login,
				register,
				logout,
				clearAuthLostMessage,
			}}
		>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error('useAuth must be used within AuthProvider');
	return ctx;
}
