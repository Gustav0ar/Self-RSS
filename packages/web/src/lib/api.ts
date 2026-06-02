const API_BASE = '/api/v1';

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

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

	return headers;
}

async function authorizedFetch(path: string, options: RequestInit = {}) {
	const headers = buildRequestHeaders(options);

	let res = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });

	if (res.status === 401) {
		const refreshed = await refreshAccessToken();
		if (refreshed) {
			headers.Authorization = `Bearer ${accessToken}`;
			res = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });
		}
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
