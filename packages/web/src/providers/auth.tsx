import type { ApiResponse, LoginResponse, RegisterResponse } from '@self-feed/shared';
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
	authLostMessage: string | null;
	login: (username: string, password: string) => Promise<void>;
	register: (username: string, email: string, password: string) => Promise<void>;
	logout: () => void;
	clearAuthLostMessage: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const queryClient = useQueryClient();
	const [isAuthenticated, setIsAuthenticated] = useState(false);
	const [isLoading, setIsLoading] = useState(true);
	const [username, setUsername] = useState<string | null>(null);
	const [authLostMessage, setAuthLostMessage] = useState<string | null>(null);

	useEffect(() => {
		setAuthLostHandler((message) => {
			clearTokens();
			queryClient.clear();
			setIsAuthenticated(false);
			setUsername(null);
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
					setIsLoading(false);
				}
				return;
			}

			try {
				const user = await apiFetch<ApiResponse<{ email: string }>>('/auth/me');
				if (!cancelled) {
					setIsAuthenticated(true);
					setUsername(user.data.email);
				}
			} catch {
				clearTokens();
				if (!cancelled) {
					queryClient.clear();
					setIsAuthenticated(false);
					setUsername(null);
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
			setTokens(res.data.tokens.accessToken);
			setUsername(res.data.user.email);
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
			setTokens(res.data.tokens.accessToken);
			setUsername(res.data.user.email);
			setIsAuthenticated(true);
		},
		[queryClient],
	);

	const logout = useCallback(async () => {
		try {
			await apiFetch('/auth/logout', { method: 'POST' });
		} catch {
			// ignore failure
		}
		clearTokens();
		queryClient.clear();
		setIsAuthenticated(false);
		setUsername(null);
		setAuthLostMessage(null);
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
				authLostMessage,
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
