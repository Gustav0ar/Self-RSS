const API_BASE = '/api/v1';
const RETRY_INITIAL_DELAY_MS = 300;
const RETRY_MAX_DELAY_MS = 2000;
const RETRY_MAX_ATTEMPTS = 3;
const CLIENT_ID_STORAGE_KEY = 'self-feed-client-id';
const AUTH_LOST_MESSAGE = 'Authentication was lost. Please sign in again.';

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;
let authLostHandler: ((message: string) => void) | null = null;
const clientId = getOrCreateClientId();

// The refresh token is now handled securely via HttpOnly cookies.
// We only keep the short-lived access token in memory.
export function setTokens(access: string) {
	accessToken = access;
}

export function loadTokens() {
	// No longer loading from localStorage as we keep access token in memory.
	// The refresh token is an HttpOnly cookie.
}

export function clearTokens() {
	accessToken = null;
}

export function getAccessToken() {
	return accessToken;
}

export function getClientId() {
	return clientId;
}

export function setAuthLostHandler(handler: ((message: string) => void) | null) {
	authLostHandler = handler;
}

function getOrCreateClientId() {
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

function shouldNotifyAuthLost(path: string) {
	return !(
		path.startsWith('/auth/login') ||
		path.startsWith('/auth/register') ||
		path.startsWith('/auth/registration-status') ||
		path.startsWith('/auth/refresh')
	);
}

function notifyAuthLost(path: string) {
	if (!shouldNotifyAuthLost(path)) return;
	clearTokens();
	authLostHandler?.(AUTH_LOST_MESSAGE);
}

export async function refreshAccessToken(): Promise<boolean> {
	if (refreshPromise) {
		return refreshPromise;
	}

	refreshPromise = (async () => {
		try {
			const res = await fetch(`${API_BASE}/auth/refresh`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
			});
			if (!res.ok) {
				if (res.status === 401) {
					clearTokens();
				}
				return false;
			}
			const { data } = await res.json();
			setTokens(data.tokens.accessToken);
			return true;
		} catch {
			return false;
		} finally {
			refreshPromise = null;
		}
	})();

	return refreshPromise;
}

function buildRequestHeaders(options: RequestInit) {
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
	headers['X-Self-Feed-Client-Id'] = clientId;
	headers['X-Self-Feed-Device-Name'] = getDeviceName();

	return headers;
}

async function authorizedFetch(path: string, options: RequestInit = {}) {
	throwIfAborted(options.signal);
	const headers = buildRequestHeaders(options);
	const method = options.method?.toUpperCase() ?? 'GET';
	const isMutation = method !== 'GET';

	async function doFetch(): Promise<Response> {
		return fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });
	}

	let res: Response;
	if (isMutation) {
		res = await doFetch();
	} else {
		res = await withRetry(doFetch, isRetriableResponse, options.signal);
	}

	if (res.status === 401) {
		throwIfAborted(options.signal);
		const refreshed = await refreshAccessToken();
		throwIfAborted(options.signal);
		if (refreshed) {
			headers.Authorization = `Bearer ${accessToken}`;
			res = await doFetch();
		} else {
			notifyAuthLost(path);
		}
	}

	if (res.status === 401) {
		notifyAuthLost(path);
	}

	return res;
}

async function throwApiError(res: Response): Promise<never> {
	const body = await res.json().catch(() => null);
	const message = body?.error?.message ?? `API error: ${res.status}`;
	throw new Error(message);
}

function parseContentDispositionFilename(header: string | null) {
	if (!header) {
		return null;
	}

	const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
	if (utf8Match?.[1]) {
		return decodeURIComponent(utf8Match[1]);
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

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

function throwIfAborted(signal?: AbortSignal | null): void {
	if (signal?.aborted) {
		throw createAbortError(signal.reason);
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
