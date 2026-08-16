import type { ApiResponse, LoginResponse, RegisterResponse, User } from '@self-feed/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
	ApiClientError,
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
	flushOfflineArticleMutations,
	isSignedOutLocally,
	loadOfflineUser,
	persistQueryClient,
	restoreQueryClient,
	saveOfflineUser,
	setOfflineSessionUser,
	setSignedOutLocally,
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
const AUTH_EVENT_STORAGE_KEY = 'self-feed-auth-event';

interface AuthSessionEvent {
	type: 'signed-out';
	userId: string;
	nonce: string;
}

function isUnavailable(error: unknown) {
	return (
		!(error instanceof ApiClientError) ||
		error.status === 408 ||
		error.status === 425 ||
		error.status === 429 ||
		error.status >= 500
	);
}

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
	const authChannel = useRef<BroadcastChannel | null>(null);

	const activateSession = useCallback(
		async (nextUser: User, offline: boolean) => {
			setOfflineSessionUser(nextUser.id);
			await restoreQueryClient(queryClient, nextUser.id);
			setProductAnalyticsUser(nextUser.id);
			trackProductAnalyticsAppOpen(nextUser.id);
			setIsAuthenticated(true);
			setIsOffline(offline);
			setUsername(nextUser.email);
			setUser(nextUser);
			if (offline) queueProductAnalyticsEvent('offline_restore', nextUser.id);
		},
		[queryClient],
	);

	const clearLocalSession = useCallback(
		async (userId?: string | null) => {
			clearTokens();
			setOfflineSessionUser(null);
			queryClient.clear();
			await clearOfflineState(userId ?? null);
			setLogoutError(null);
			setIsAuthenticated(false);
			setIsOffline(false);
			setUsername(null);
			setUser(null);
			setProductAnalyticsUser(null);
		},
		[queryClient],
	);

	useEffect(() => {
		setAuthLostHandler((message) => {
			void clearLocalSession(user?.id).finally(() => {
				setAuthLostMessage(message);
				setIsLoading(false);
			});
		});

		return () => setAuthLostHandler(null);
	}, [clearLocalSession, user?.id]);

	useEffect(() => {
		const handleSessionEvent = (event: AuthSessionEvent) => {
			if (event.type !== 'signed-out' || event.userId !== user?.id) return;
			void setSignedOutLocally(true)
				.then(() => clearLocalSession(event.userId))
				.finally(() => setAuthLostMessage('Signed out in another tab.'));
		};
		const channel =
			typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('self-feed-auth');
		authChannel.current = channel;
		if (channel) {
			channel.onmessage = (message: MessageEvent<unknown>) => {
				const event = message.data as Partial<AuthSessionEvent> | null;
				if (
					event?.type === 'signed-out' &&
					typeof event.userId === 'string' &&
					typeof event.nonce === 'string'
				) {
					handleSessionEvent(event as AuthSessionEvent);
				}
			};
		}
		const handleStorage = (storageEvent: StorageEvent) => {
			if (storageEvent.key !== AUTH_EVENT_STORAGE_KEY || !storageEvent.newValue) return;
			try {
				const event = JSON.parse(storageEvent.newValue) as Partial<AuthSessionEvent>;
				if (
					event.type === 'signed-out' &&
					typeof event.userId === 'string' &&
					typeof event.nonce === 'string'
				) {
					handleSessionEvent(event as AuthSessionEvent);
				}
			} catch {
				// Ignore malformed or unrelated storage messages.
			}
		};
		window.addEventListener('storage', handleStorage);
		return () => {
			window.removeEventListener('storage', handleStorage);
			channel?.close();
			if (authChannel.current === channel) authChannel.current = null;
		};
	}, [clearLocalSession, user?.id]);

	useEffect(() => {
		let cancelled = false;

		const bootstrap = async () => {
			loadTokens();
			if (await isSignedOutLocally()) {
				queryClient.clear();
				clearTokens();
				if (!cancelled) setIsLoading(false);
				return;
			}

			const offlineUser = await loadOfflineUser();
			if (!getAccessToken()) await refreshAccessToken();

			if (!getAccessToken()) {
				if (!cancelled && getLastRefreshOutcome() === 'unavailable' && offlineUser) {
					await activateSession(offlineUser, true);
				} else if (!cancelled) {
					await clearLocalSession(offlineUser?.id);
				}
				if (!cancelled) setIsLoading(false);
				return;
			}

			try {
				const response = await apiFetch<ApiResponse<User>>('/auth/me');
				if (cancelled) return;
				if (offlineUser && offlineUser.id !== response.data.id) {
					queryClient.clear();
					await clearOfflineState(offlineUser.id);
				}
				await activateSession(response.data, false);
				await saveOfflineUser(response.data);
				void flushOfflineArticleMutations().then(() => {
					void queryClient.invalidateQueries();
				});
				void flushProductAnalyticsEvents();
			} catch (error) {
				if (cancelled) return;
				if (offlineUser && isUnavailable(error)) {
					await activateSession(offlineUser, true);
				} else {
					await clearLocalSession(offlineUser?.id);
				}
			} finally {
				if (!cancelled) setIsLoading(false);
			}
		};

		void bootstrap();
		return () => {
			cancelled = true;
		};
	}, [activateSession, clearLocalSession, queryClient]);

	useEffect(() => {
		if (!user) return;
		let persistTimer: ReturnType<typeof setTimeout> | null = null;
		const persist = () => void persistQueryClient(queryClient, user.id);
		const schedulePersist = () => {
			if (persistTimer) clearTimeout(persistTimer);
			persistTimer = setTimeout(persist, 2_000);
		};
		const unsubscribe = queryClient.getQueryCache().subscribe(schedulePersist);
		window.addEventListener('pagehide', persist);
		return () => {
			unsubscribe();
			window.removeEventListener('pagehide', persist);
			if (persistTimer) clearTimeout(persistTimer);
			persist();
		};
	}, [queryClient, user]);

	useEffect(() => {
		let reconnecting = false;
		async function updateConnectionState() {
			if (!navigator.onLine) {
				setIsOffline(true);
				return;
			}
			if (!user || reconnecting) return;
			reconnecting = true;
			try {
				if (!getAccessToken() && !(await refreshAccessToken())) return;
				const response = await apiFetch<ApiResponse<User>>('/auth/me');
				if (response.data.id !== user.id) {
					await clearLocalSession(user.id);
					setAuthLostMessage('The signed-in account changed. Please sign in again.');
					return;
				}
				await saveOfflineUser(response.data);
				setUser(response.data);
				setUsername(response.data.email);
				setIsOffline(false);
				await flushOfflineArticleMutations();
				await queryClient.invalidateQueries();
				void flushProductAnalyticsEvents();
			} finally {
				reconnecting = false;
			}
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
	}, [clearLocalSession, queryClient, user]);

	const login = useCallback(
		async (email: string, password: string) => {
			const res = await apiFetch<ApiResponse<LoginResponse>>('/auth/login', {
				method: 'POST',
				body: JSON.stringify({ email, password }),
			});
			queryClient.clear();
			await clearOfflineQueryCache(user?.id);
			await setSignedOutLocally(false);
			setAuthLostMessage(null);
			setLogoutError(null);
			setTokens(res.data.tokens.accessToken);
			await saveOfflineUser(res.data.user);
			await activateSession(res.data.user, false);
			void flushProductAnalyticsEvents();
		},
		[activateSession, queryClient, user?.id],
	);

	const register = useCallback(
		async (_uname: string, email: string, password: string) => {
			const res = await apiFetch<ApiResponse<RegisterResponse>>('/auth/register', {
				method: 'POST',
				body: JSON.stringify({ email, password }),
			});
			queryClient.clear();
			await clearOfflineQueryCache(user?.id);
			await setSignedOutLocally(false);
			setAuthLostMessage(null);
			setLogoutError(null);
			setTokens(res.data.tokens.accessToken);
			await saveOfflineUser(res.data.user);
			await activateSession(res.data.user, false);
			void flushProductAnalyticsEvents();
		},
		[activateSession, queryClient, user?.id],
	);

	const logout = useCallback(async () => {
		setIsLoggingOut(true);
		setLogoutError(null);
		const userId = user?.id;
		const remoteLogout = apiFetch('/auth/logout', { method: 'POST' })
			.then(() => true)
			.catch(() => false);
		await setSignedOutLocally(true);
		if (userId) {
			const event: AuthSessionEvent = {
				type: 'signed-out',
				userId,
				nonce: crypto.randomUUID(),
			};
			authChannel.current?.postMessage(event);
			try {
				localStorage.setItem(AUTH_EVENT_STORAGE_KEY, JSON.stringify(event));
			} catch {
				// BroadcastChannel remains the primary path when localStorage is unavailable.
			}
		}
		await clearLocalSession(userId);
		setAuthLostMessage(null);
		setIsLoggingOut(false);
		void remoteLogout.then((revoked) => {
			if (revoked) void setSignedOutLocally(false);
		});
		return true;
	}, [clearLocalSession, user?.id]);

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

	const clearAuthLostMessage = useCallback(() => setAuthLostMessage(null), []);

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
