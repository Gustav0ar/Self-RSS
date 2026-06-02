import type { ApiResponse, LoginResponse, RegisterResponse } from '@self-feed/shared';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
	apiFetch,
	clearTokens,
	getAccessToken,
	loadTokens,
	refreshAccessToken,
	setTokens,
} from '../lib/api';

interface AuthState {
	isAuthenticated: boolean;
	isLoading: boolean;
	username: string | null;
	login: (username: string, password: string) => Promise<void>;
	register: (username: string, email: string, password: string) => Promise<void>;
	logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const [isAuthenticated, setIsAuthenticated] = useState(false);
	const [isLoading, setIsLoading] = useState(true);
	const [username, setUsername] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		const bootstrap = async () => {
			loadTokens();

			if (!getAccessToken()) {
				await refreshAccessToken();
			}

			if (!getAccessToken()) {
				if (!cancelled) {
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
	}, []);

	const login = useCallback(async (email: string, password: string) => {
		const res = await apiFetch<ApiResponse<LoginResponse>>('/auth/login', {
			method: 'POST',
			body: JSON.stringify({ email, password }),
		});
		setTokens(res.data.tokens.accessToken);
		setUsername(res.data.user.email);
		setIsAuthenticated(true);
	}, []);

	const register = useCallback(async (_uname: string, email: string, password: string) => {
		const res = await apiFetch<ApiResponse<RegisterResponse>>('/auth/register', {
			method: 'POST',
			body: JSON.stringify({ email, password }),
		});
		setTokens(res.data.tokens.accessToken);
		setUsername(res.data.user.email);
		setIsAuthenticated(true);
	}, []);

	const logout = useCallback(async () => {
		try {
			await apiFetch('/auth/logout', { method: 'POST' });
		} catch {
			// ignore failure
		}
		clearTokens();
		setIsAuthenticated(false);
		setUsername(null);
	}, []);

	return (
		<AuthContext.Provider value={{ isAuthenticated, isLoading, username, login, register, logout }}>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error('useAuth must be used within AuthProvider');
	return ctx;
}
