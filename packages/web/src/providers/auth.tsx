import type { ApiResponse, LoginResponse, RegisterResponse, User } from '@self-feed/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
	apiFetch,
	clearTokens,
	getAccessToken,
	getLastRefreshOutcome,
	loadTokens,
	refreshAccessToken,
	setAuthLostHandler,
	setTokens,
} from '../lib/api';
import {
	clearOfflineQueryCache,
	clearOfflineState,
	loadOfflineUser,
	saveOfflineUser,
} from '../lib/offline-store';
import {
	flushProductAnalyticsEvents,
	queueProductAnalyticsEvent,
	setProductAnalyticsUser,
	trackProductAnalyticsAppOpen,
} from '../lib/product-analytics';

interface AuthState {
	isAuthenticated: boolean;
	isLoading: boolean;
	isOffline: boolean;
	username: string | null;
	user: User | null;
	authLostMessage: string | null;
	logoutError: string | null;
	isLoggingOut: boolean;
	login: (username: string, password: string) => Promise<void>;
	register: (username: string, email: string, password: string) => Promise<void>;
	logout: () => Promise<boolean>;
	changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
	clearAuthLostMessage: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const queryClient = useQueryClient();
	const [isAuthenticated, setIsAuthenticated] = useState(false);
	const [isLoading, setIsLoading] = useState(true);
	const [isOffline, setIsOffline] = useState(() => !navigator.onLine);
	const [username, setUsername] = useState<string | null>(null);
	const [user, setUser] = useState<User | null>(null);
	const [authLostMessage, setAuthLostMessage] = useState<string | null>(null);
	const [logoutError, setLogoutError] = useState<string | null>(null);
	const [isLoggingOut, setIsLoggingOut] = useState(false);

	useEffect(() => {
		setAuthLostHandler((message) => {
			clearTokens();
			queryClient.clear();
			void clearOfflineState();
			setLogoutError(null);
			setIsAuthenticated(false);
			setIsOffline(false);
			setUsername(null);
			setUser(null);
			setProductAnalyticsUser(null);
			setAuthLostMessage(message);
			setIsLoading(false);
		});

		return () => setAuthLostHandler(null);
	}, [queryClient]);

	useEffect(() => {
		let cancelled = false;

		const bootstrap = async () => {
			loadTokens();
			const offlineUser = await loadOfflineUser();

			if (!getAccessToken()) {
				await refreshAccessToken();
			}

			if (!getAccessToken()) {
				if (!cancelled) {
					if (getLastRefreshOutcome() === 'unavailable' && offlineUser) {
						setProductAnalyticsUser(offlineUser.id);
						trackProductAnalyticsAppOpen(offlineUser.id);
						queueProductAnalyticsEvent('offline_restore', offlineUser.id);
						setIsAuthenticated(true);
						setIsOffline(true);
						setUsername(offlineUser.email);
						setUser(offlineUser);
					} else {
						queryClient.clear();
						void clearOfflineState();
						setIsAuthenticated(false);
						setIsOffline(false);
						setUsername(null);
						setUser(null);
						setProductAnalyticsUser(null);
					}
					setIsLoading(false);
				}
				return;
			}

			try {
				const response = await apiFetch<ApiResponse<User>>('/auth/me');
				if (!cancelled) {
					setProductAnalyticsUser(response.data.id);
					trackProductAnalyticsAppOpen(response.data.id);
					setIsAuthenticated(true);
					setIsOffline(false);
					setUsername(response.data.email);
					setUser(response.data);
					void saveOfflineUser(response.data);
					void flushProductAnalyticsEvents();
				}
			} catch {
				clearTokens();
				if (!cancelled) {
					if (getLastRefreshOutcome() === 'unavailable' && offlineUser) {
						setProductAnalyticsUser(offlineUser.id);
						trackProductAnalyticsAppOpen(offlineUser.id);
						queueProductAnalyticsEvent('offline_restore', offlineUser.id);
						setIsAuthenticated(true);
						setIsOffline(true);
						setUsername(offlineUser.email);
						setUser(offlineUser);
					} else {
						queryClient.clear();
						void clearOfflineState();
						setIsAuthenticated(false);
						setIsOffline(false);
						setUsername(null);
						setUser(null);
						setProductAnalyticsUser(null);
					}
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

	useEffect(() => {
		function updateConnectionState() {
			setIsOffline(!navigator.onLine || !getAccessToken());
			if (navigator.onLine) void flushProductAnalyticsEvents();
		}
		function recordVisibleAppOpen() {
			if (document.visibilityState === 'visible') trackProductAnalyticsAppOpen();
		}
		window.addEventListener('offline', updateConnectionState);
		window.addEventListener('online', updateConnectionState);
		document.addEventListener('visibilitychange', recordVisibleAppOpen);
		return () => {
			window.removeEventListener('offline', updateConnectionState);
			window.removeEventListener('online', updateConnectionState);
			document.removeEventListener('visibilitychange', recordVisibleAppOpen);
		};
	}, []);

	const login = useCallback(
		async (email: string, password: string) => {
			const res = await apiFetch<ApiResponse<LoginResponse>>('/auth/login', {
				method: 'POST',
				body: JSON.stringify({ email, password }),
			});
			queryClient.clear();
			await clearOfflineQueryCache();
			setAuthLostMessage(null);
			setLogoutError(null);
			setTokens(res.data.tokens.accessToken);
			setUsername(res.data.user.email);
			setUser(res.data.user);
			setProductAnalyticsUser(res.data.user.id);
			trackProductAnalyticsAppOpen(res.data.user.id);
			setIsOffline(false);
			await saveOfflineUser(res.data.user);
			setIsAuthenticated(true);
			void flushProductAnalyticsEvents();
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
			await clearOfflineQueryCache();
			setAuthLostMessage(null);
			setLogoutError(null);
			setTokens(res.data.tokens.accessToken);
			setUsername(res.data.user.email);
			setUser(res.data.user);
			setProductAnalyticsUser(res.data.user.id);
			trackProductAnalyticsAppOpen(res.data.user.id);
			setIsOffline(false);
			await saveOfflineUser(res.data.user);
			setIsAuthenticated(true);
			void flushProductAnalyticsEvents();
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
		await clearOfflineState();
		setIsAuthenticated(false);
		setIsOffline(false);
		setUsername(null);
		setUser(null);
		setProductAnalyticsUser(null);
		setAuthLostMessage(null);
		setLogoutError(null);
		setIsLoggingOut(false);
		return true;
	}, [queryClient]);

	const changePassword = useCallback(
		async (currentPassword: string, newPassword: string) => {
			const res = await apiFetch<ApiResponse<LoginResponse>>('/auth/change-password', {
				method: 'POST',
				body: JSON.stringify({ currentPassword, newPassword }),
			});
			setTokens(res.data.tokens.accessToken);
			setUser(res.data.user);
			setProductAnalyticsUser(res.data.user.id);
			trackProductAnalyticsAppOpen(res.data.user.id);
			setUsername(res.data.user.email);
			setIsOffline(false);
			await saveOfflineUser(res.data.user);
			await queryClient.invalidateQueries({ queryKey: ['auth-sessions'] });
		},
		[queryClient],
	);

	const clearAuthLostMessage = useCallback(() => {
		setAuthLostMessage(null);
	}, []);

	return (
		<AuthContext.Provider
			value={{
				isAuthenticated,
				isLoading,
				isOffline,
				username,
				user,
				authLostMessage,
				logoutError,
				isLoggingOut,
				login,
				register,
				logout,
				changePassword,
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
