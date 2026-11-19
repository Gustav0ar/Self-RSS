import type { ApiResponse, LoginResponse, RegisterResponse, User } from '@self-feed/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
} from 'react';
import {
	ApiClientError,
	apiFetch,
	clearTokens,
	getAccessToken,
	getLastRefreshOutcome,
	loadTokens,
	refreshAccessToken,
	setAuthLostHandler,
	setSessionOwner,
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
	const session = useRef<{ userId: string; signal: AbortSignal } | null>(null);
	const bootstrapSignOuts = useRef<Set<string> | null>(null);

	const activateSession = useCallback(
		async (nextUser: User, offline: boolean) => {
			setSessionOwner(nextUser.id);
			const signal = setOfflineSessionUser(nextUser.id);
			session.current = { userId: nextUser.id, signal };
			await restoreQueryClient(queryClient, nextUser.id);
			if (signal.aborted) return false;
			if (!offline) await saveOfflineUser(nextUser);
			if (signal.aborted) return false;
			setProductAnalyticsUser(nextUser.id);
			trackProductAnalyticsAppOpen(nextUser.id);
			setIsAuthenticated(true);
			setIsOffline(offline);
			setUsername(nextUser.email);
			setUser(nextUser);
			if (offline) queueProductAnalyticsEvent('offline_restore', nextUser.id);
			return true;
		},
		[queryClient],
	);

	const clearLocalSession = useCallback(
		async (userId?: string | null, { keepPendingChanges = false } = {}) => {
			session.current = null;
			clearTokens();
			setOfflineSessionUser(null);
			queryClient.clear();
			setLogoutError(null);
			setIsAuthenticated(false);
			setIsOffline(false);
			setUsername(null);
			setUser(null);
			setProductAnalyticsUser(null);
			await clearOfflineState(userId ?? null, { keepPendingChanges });
		},
		[queryClient],
	);

	useEffect(() => {
		setAuthLostHandler((message) => {
			void clearLocalSession(session.current?.userId, { keepPendingChanges: true }).finally(() => {
				setAuthLostMessage(message);
				setIsLoading(false);
			});
		});

		return () => setAuthLostHandler(null);
	}, [clearLocalSession]);

	useEffect(() => {
		const handleSessionEvent = (event: AuthSessionEvent) => {
			bootstrapSignOuts.current?.add(event.userId);
			if (event.userId !== session.current?.userId) return;
			setAuthLostMessage('Signed out in another tab.');
			void clearLocalSession(event.userId);
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
	}, [clearLocalSession]);

	useEffect(() => {
		let cancelled = false;
		// A sign-out may arrive before /auth/me identifies the account for this tab.
		const signedOut = new Set<string>();
		bootstrapSignOuts.current = signedOut;
		const restoreSession = async (reader: User, offline: boolean) => {
			if (cancelled) return false;
			if (signedOut.has(reader.id)) {
				setAuthLostMessage('Signed out in another tab.');
				await clearLocalSession(reader.id);
				return false;
			}
			return activateSession(reader, offline);
		};

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
					await restoreSession(offlineUser, true);
				} else if (!cancelled) {
					await clearLocalSession(offlineUser?.id, { keepPendingChanges: true });
				}
				if (!cancelled) setIsLoading(false);
				return;
			}

			try {
				const response = await apiFetch<ApiResponse<User>>('/auth/me');
				if (cancelled) return;
				if (offlineUser && offlineUser.id !== response.data.id) {
					queryClient.clear();
					await clearOfflineState(offlineUser.id, { keepPendingChanges: true });
				}
				if (!(await restoreSession(response.data, false))) return;
				void flushOfflineArticleMutations().then(() => {
					void queryClient.invalidateQueries();
				});
				void flushProductAnalyticsEvents();
			} catch (error) {
				if (cancelled) return;
				if (offlineUser && isUnavailable(error)) {
					await restoreSession(offlineUser, true);
				} else {
					await clearLocalSession(offlineUser?.id, { keepPendingChanges: true });
				}
			} finally {
				if (!cancelled) setIsLoading(false);
			}
		};

		void bootstrap().finally(() => {
			if (bootstrapSignOuts.current === signedOut) bootstrapSignOuts.current = null;
		});
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

	const getActiveSession = useEffectEvent(() => {
		const current = session.current;
		return current?.userId === user?.id ? current : null;
	});
	useEffect(() => {
		let reconnecting: AbortSignal | null = null;
		async function updateConnectionState() {
			if (!navigator.onLine) {
				setIsOffline(true);
				return;
			}
			const current = getActiveSession();
			if (!current || current.signal.aborted || reconnecting === current.signal) return;
			reconnecting = current.signal;
			try {
				if (!getAccessToken() && !(await refreshAccessToken())) {
					if (current.signal.aborted) return;
					if (getLastRefreshOutcome() === 'rejected') {
						await clearLocalSession(current.userId, { keepPendingChanges: true });
						setAuthLostMessage('Authentication was lost. Please sign in again.');
					} else {
						setIsOffline(true);
					}
					return;
				}
				const response = await apiFetch<ApiResponse<User>>('/auth/me');
				if (current.signal.aborted) return;
				if (response.data.id !== current.userId) {
					await clearLocalSession(current.userId, { keepPendingChanges: true });
					setAuthLostMessage('The signed-in account changed. Please sign in again.');
					return;
				}
				await saveOfflineUser(response.data);
				if (current.signal.aborted) return;
				setUser(response.data);
				setUsername(response.data.email);
				setIsOffline(false);
				await flushOfflineArticleMutations();
				await queryClient.invalidateQueries();
				void flushProductAnalyticsEvents();
			} catch (error) {
				if (current.signal.aborted) return;
				if (isUnavailable(error)) {
					setIsOffline(true);
				} else {
					await clearLocalSession(current.userId, { keepPendingChanges: true });
					setAuthLostMessage('Authentication was lost. Please sign in again.');
				}
			} finally {
				if (reconnecting === current.signal) reconnecting = null;
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
	}, [clearLocalSession, queryClient]);

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
			if (!(await activateSession(res.data.user, false))) return;
			void flushOfflineArticleMutations().then((results) => {
				if (results.length) void queryClient.invalidateQueries();
			});
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
			if (!(await activateSession(res.data.user, false))) return;
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
		const markedLocally = await setSignedOutLocally(true);
		if (!markedLocally && !(await remoteLogout)) {
			setLogoutError('Could not finish signing out. Please try again.');
			setIsLoggingOut(false);
			return false;
		}
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
		return true;
	}, [clearLocalSession, user?.id]);

	const changePassword = useCallback(
		async (currentPassword: string, newPassword: string) => {
			const current = session.current;
			if (!current) throw new Error('Please sign in again.');
			const res = await apiFetch<ApiResponse<LoginResponse>>('/auth/change-password', {
				method: 'POST',
				body: JSON.stringify({ currentPassword, newPassword }),
				signal: current.signal,
			});
			current.signal.throwIfAborted();
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
