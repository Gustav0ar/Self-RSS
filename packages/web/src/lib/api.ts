const API_BASE = '/api/v1';
const RETRY_INITIAL_DELAY_MS = 300;
const RETRY_MAX_DELAY_MS = 2000;
const RETRY_MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 45_000;
const CLIENT_ID_STORAGE_KEY = 'self-feed-client-id';
const AUTH_LOST_MESSAGE = 'Authentication was lost. Please sign in again.';

export class ApiClientError extends Error {
	readonly summary: string;

	constructor(
		readonly code: string,
		summary: string,
		readonly status: number,
		readonly details?: unknown,
	) {
		const detail = typeof details === 'string' ? details.trim() : '';
		super(detail && detail !== summary ? `${summary}: ${detail}` : summary);
		this.name = 'ApiClientError';
		this.summary = summary;
	}
}

let accessToken: string | null = null;
let sessionOwner: string | null = null;
let sessionGeneration = 0;
let pendingRefresh: { generation: number; result: Promise<boolean> } | null = null;
export type RefreshOutcome = 'idle' | 'success' | 'rejected' | 'unavailable';
let lastRefreshOutcome: RefreshOutcome = 'idle';
let authLostHandler: ((message: string) => void) | null = null;
const deviceClientId = getOrCreateDeviceClientId();
// A document gets its own event identity, including duplicated tabs and reloads.
const clientId = crypto.randomUUID();

// The refresh token is now handled securely via HttpOnly cookies.
// We only keep the short-lived access token in memory.
export function setTokens(access: string) {
	sessionGeneration++;
	accessToken = access;
}

function tokenOwner(token: string): string | null {
	try {
		const payload = token.split('.')[1];
		if (!payload) return null;
		const claims: unknown = JSON.parse(atob(payload.replaceAll('-', '+').replaceAll('_', '/')));
		return claims && typeof claims === 'object' && 'sub' in claims && typeof claims.sub === 'string'
			? claims.sub
			: null;
	} catch {
		return null;
	}
}

// The server authenticates requests. The tab uses the subject only to keep
// another account’s rotated cookie out of this reader’s cache and outbox.
export function setSessionOwner(ownerId: string) {
	if (sessionOwner !== ownerId) sessionGeneration++;
	sessionOwner = ownerId;
	if (accessToken && tokenOwner(accessToken) !== ownerId) accessToken = null;
}

export function loadTokens() {
	// No longer loading from localStorage as we keep access token in memory.
	// The refresh token is an HttpOnly cookie.
}

export function clearTokens() {
	sessionGeneration++;
	sessionOwner = null;
	accessToken = null;
}

export function getAccessToken() {
	return accessToken;
}

export function getLastRefreshOutcome(): RefreshOutcome {
	return lastRefreshOutcome;
}

export function getClientId() {
	return clientId;
}

export function setAuthLostHandler(handler: ((message: string) => void) | null) {
	authLostHandler = handler;
}

function getOrCreateDeviceClientId() {
	try {
		const existing = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
		if (existing) return existing;
		const next = crypto.randomUUID();
		localStorage.setItem(CLIENT_ID_STORAGE_KEY, next);
		return next;
	} catch {
		return crypto.randomUUID();
	}
}

function getDeviceName() {
	const platform = navigator.platform?.trim();
	if (platform) return `Web browser on ${platform}`;
	return 'Web browser';
}

const publicAuthPaths = new Set([
	'/auth/login',
	'/auth/register',
	'/auth/registration-status',
	'/auth/logout',
	'/auth/refresh',
]);
const cookieWrites = new Set([
	'/auth/login',
	'/auth/register',
	'/auth/logout',
	'/auth/refresh',
	'/auth/change-password',
]);
let pendingCookieWrite = Promise.resolve();

// The browser applies Set-Cookie before fetch resolves, even after the initiating view closes.
function withCookieLock<T>(operation: () => Promise<T>): Promise<T> {
	if (navigator.locks) return navigator.locks.request('self-feed:auth-refresh', operation);
	const result = pendingCookieWrite.then(operation);
	pendingCookieWrite = result.then(
		() => {},
		() => {},
	);
	return result;
}

async function requestRefresh(generation: number): Promise<boolean> {
	if (generation !== sessionGeneration) return false;
	const res = await fetchWithTimeout(`${API_BASE}/auth/refresh`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Self-Feed-Client-Id': deviceClientId,
			'X-Self-Feed-Device-Name': getDeviceName(),
		},
		credentials: 'include',
	});
	if (generation !== sessionGeneration) return false;
	if (!res.ok) {
		if (res.status === 401) {
			accessToken = null;
			lastRefreshOutcome = 'rejected';
		} else {
			lastRefreshOutcome = 'unavailable';
		}
		return false;
	}
	const { data } = await res.json();
	if (generation !== sessionGeneration) return false;
	if (sessionOwner && tokenOwner(data.tokens.accessToken) !== sessionOwner) {
		accessToken = null;
		lastRefreshOutcome = 'rejected';
		return false;
	}
	accessToken = data.tokens.accessToken;
	lastRefreshOutcome = 'success';
	return true;
}

export async function refreshAccessToken(): Promise<boolean> {
	if (pendingRefresh?.generation === sessionGeneration) return pendingRefresh.result;
	// Each tab needs its own access token, but all tabs rotate the same cookie.
	// Hold the lock until the browser has applied the response's Set-Cookie.
	const generation = sessionGeneration;
	const refresh = () => requestRefresh(generation);
	const result = (async () => {
		try {
			return await withCookieLock(refresh);
		} catch {
			if (generation === sessionGeneration) lastRefreshOutcome = 'unavailable';
			return false;
		}
	})().finally(() => {
		if (pendingRefresh?.result === result) pendingRefresh = null;
	});
	pendingRefresh = { generation, result };
	return result;
}

function buildRequestHeaders(path: string, options: RequestInit) {
	const isFormData = options.body instanceof FormData;
	const headers: Record<string, string> = {
		...(options.headers as Record<string, string>),
	};

	if (!isFormData && !headers['Content-Type']) {
		headers['Content-Type'] = 'application/json';
	}

	if (accessToken) {
		headers.Authorization = `Bearer ${accessToken}`;
	}
	// Auth records the stable device; article events identify the originating tab.
	headers['X-Self-Feed-Client-Id'] = path.startsWith('/auth/') ? deviceClientId : clientId;
	headers['X-Self-Feed-Device-Name'] = getDeviceName();

	return headers;
}

async function authorizedFetch(path: string, options: RequestInit = {}) {
	throwIfAborted(options.signal);
	const generation = sessionGeneration;
	const headers = buildRequestHeaders(path, options);
	const method = options.method?.toUpperCase() ?? 'GET';
	const isMutation = method !== 'GET';

	const updateCookie =
		isMutation &&
		(cookieWrites.has(path) || (method === 'DELETE' && path.startsWith('/auth/sessions/')));
	function sendRequest() {
		throwIfAborted(options.signal);
		if (!publicAuthPaths.has(path) && generation !== sessionGeneration) throw createAbortError();
		return fetchWithTimeout(`${API_BASE}${path}`, {
			...options,
			headers,
			credentials: 'include',
		});
	}

	const doFetch = () => (updateCookie ? withCookieLock(sendRequest) : sendRequest());

	let res: Response;
	if (isMutation) {
		res = await doFetch();
	} else {
		res = await withRetry(doFetch, isRetriableResponse, options.signal);
	}

	if (res.status === 401 && generation === sessionGeneration && !publicAuthPaths.has(path)) {
		throwIfAborted(options.signal);
		const refreshed = await refreshAccessToken();
		throwIfAborted(options.signal);
		if (generation !== sessionGeneration) return res;
		if (!refreshed && lastRefreshOutcome === 'unavailable') {
			await releaseResponseBody(res);
			throw new ApiClientError(
				'AUTH_UNAVAILABLE',
				'Session refresh is temporarily unavailable',
				503,
			);
		}
		if (refreshed) {
			await releaseResponseBody(res);
			throwIfAborted(options.signal);
			if (generation !== sessionGeneration) throw createAbortError();
			headers.Authorization = `Bearer ${accessToken}`;
			res = await doFetch();
		}
		// A network or server failure while refreshing is not proof that the
		// session was revoked. Keep the offline identity and cached data until
		// the refresh endpoint explicitly rejects it. If refresh succeeded but
		// the retried request is still unauthorized, the session is invalid.
		if (
			res.status === 401 &&
			generation === sessionGeneration &&
			(refreshed || lastRefreshOutcome === 'rejected')
		) {
			clearTokens();
			authLostHandler?.(AUTH_LOST_MESSAGE);
		}
	}

	return res;
}

async function throwApiError(res: Response): Promise<never> {
	const body = (await res.json().catch(() => null)) as {
		error?: { code?: unknown; message?: unknown; details?: unknown };
	} | null;
	const message =
		typeof body?.error?.message === 'string' ? body.error.message : `API error: ${res.status}`;
	const code = typeof body?.error?.code === 'string' ? body.error.code : 'API_ERROR';
	throw new ApiClientError(code, message, res.status, body?.error?.details);
}

function parseContentDispositionFilename(header: string | null) {
	if (!header) {
		return null;
	}

	const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
	if (utf8Match?.[1]) {
		try {
			return decodeURIComponent(utf8Match[1]);
		} catch {
			return utf8Match[1];
		}
	}

	const basicMatch = header.match(/filename="([^"]+)"|filename=([^;]+)/i);
	return basicMatch?.[1] ?? basicMatch?.[2]?.trim() ?? null;
}

function createAbortError(reason?: unknown): Error {
	if (reason instanceof Error) {
		return reason;
	}
	const error = new Error(typeof reason === 'string' ? reason : 'The operation was aborted');
	error.name = 'AbortError';
	return error;
}

function createTimeoutError(): Error {
	const error = new Error(`Request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s`);
	error.name = 'TimeoutError';
	return error;
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

function throwIfAborted(signal?: AbortSignal | null): void {
	if (signal?.aborted) {
		throw createAbortError(signal.reason);
	}
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
	throwIfAborted(init.signal);

	const controller = new AbortController();
	const timeout = globalThis.setTimeout(() => {
		controller.abort(createTimeoutError());
	}, REQUEST_TIMEOUT_MS);

	const onAbort = () => {
		controller.abort(init.signal?.reason);
	};

	init.signal?.addEventListener('abort', onAbort, { once: true });

	try {
		return await fetch(input, { ...init, signal: controller.signal });
	} catch (error) {
		if (controller.signal.aborted && controller.signal.reason instanceof Error) {
			throw controller.signal.reason;
		}
		throw error;
	} finally {
		globalThis.clearTimeout(timeout);
		init.signal?.removeEventListener('abort', onAbort);
	}
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(createAbortError(signal.reason));
			return;
		}

		let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
		const cleanup = () => {
			if (timer !== null) {
				globalThis.clearTimeout(timer);
				timer = null;
			}
			signal?.removeEventListener('abort', onAbort);
		};
		const onAbort = () => {
			cleanup();
			reject(createAbortError(signal?.reason));
		};

		timer = globalThis.setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

function getExponentialBackoffDelay(attempt: number): number {
	const baseDelay = Math.min(RETRY_INITIAL_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
	// Add jitter: random value between 0% and 50% of base delay
	const jitter = Math.random() * baseDelay * 0.5;
	return baseDelay + jitter;
}

function isRetriableResponse(res: Response): boolean {
	return res.status >= 500;
}

async function releaseResponseBody(res: Response): Promise<void> {
	try {
		await res.body?.cancel();
	} catch {
		// Releasing a discarded retry response is best-effort. Preserve the
		// original response and retry behavior if the stream cannot be cancelled.
	}
}

async function withRetry(
	fetchFn: () => Promise<Response>,
	isRetriable: (res: Response) => boolean,
	signal?: AbortSignal | null,
): Promise<Response> {
	let lastError: Error | null = null;

	for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
		throwIfAborted(signal);

		try {
			const res = await fetchFn();

			if (res.ok || !isRetriable(res)) {
				return res;
			}

			// Server error and we have retries left
			if (attempt < RETRY_MAX_ATTEMPTS - 1) {
				lastError = new Error(`API error: ${res.status}`);
				await releaseResponseBody(res);
				await sleep(getExponentialBackoffDelay(attempt), signal);
				continue;
			}

			return res;
		} catch (err) {
			if (isAbortError(err) || signal?.aborted) {
				throw createAbortError(signal?.reason ?? err);
			}
			lastError = err instanceof Error ? err : new Error(String(err));

			if (attempt < RETRY_MAX_ATTEMPTS - 1) {
				await sleep(getExponentialBackoffDelay(attempt), signal);
			}
		}
	}

	throw lastError ?? new Error('Retry exhausted');
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
	const res = await authorizedFetch(path, options);

	if (!res.ok) {
		return throwApiError(res);
	}

	return res.json();
}

export async function apiDownload(path: string, options: RequestInit = {}) {
	const res = await authorizedFetch(path, options);

	if (!res.ok) {
		return throwApiError(res);
	}

	return {
		blob: await res.blob(),
		filename: parseContentDispositionFilename(res.headers.get('Content-Disposition')),
	};
}
