import { timingSafeEqual } from 'node:crypto';
import { readResponseBytesWithinLimit } from './utils/bounded-response.js';
import { createFeedFetchHeaders } from './utils/feed-fetch-headers.js';
import { fetchWithValidatedRedirects } from './utils/safe-fetch.js';

const VIDEOCARDZ_FEED_URL = 'https://videocardz.com/rss-feed';
const LEGACY_VIDEOCARDZ_RELAY_PATH = '/videocardz/rss-feed';
const GENERIC_RELAY_PATH = '/feed';
const TARGET_HEADER = 'X-Self-Feed-Target';
const DEFAULT_MAX_CONTENT_LENGTH = 5 * 1024 * 1024;
const DEFAULT_COOLDOWN_MS = 60_000;
const FORWARDED_REQUEST_HEADERS = [
	'cache-control',
	'if-modified-since',
	'if-none-match',
	'pragma',
] as const;
const FORWARDED_RESPONSE_HEADERS = [
	'cache-control',
	'content-type',
	'date',
	'etag',
	'expires',
	'last-modified',
] as const;

interface RelaySnapshot {
	status: number;
	statusText: string;
	headers: Headers;
	body: Uint8Array | null;
}

interface CachedRelaySnapshot {
	expiresAt: number;
	requestValidators: string;
	snapshot: RelaySnapshot;
}

interface InFlightRelaySnapshot {
	requestValidators: string;
	promise: Promise<RelaySnapshot>;
}

interface FeedRelayHandlerOptions {
	token: string;
	maxContentLength?: number;
	cooldownMs?: number;
	now?: () => number;
	upstreamFetch?: (input: string, init: RequestInit) => Promise<Response>;
}

function tokensMatch(provided: string, expected: string) {
	const providedBytes = new TextEncoder().encode(provided);
	const expectedBytes = new TextEncoder().encode(expected);
	return (
		providedBytes.byteLength === expectedBytes.byteLength &&
		timingSafeEqual(providedBytes, expectedBytes)
	);
}

function isAuthorized(request: Request, token: string) {
	const authorization = request.headers.get('authorization');
	if (!authorization?.startsWith('Bearer ')) return false;
	return tokensMatch(authorization.slice('Bearer '.length), token);
}

function upstreamRequestHeaders(request: Request) {
	const headers = new Headers(createFeedFetchHeaders());
	for (const headerName of FORWARDED_REQUEST_HEADERS) {
		const value = request.headers.get(headerName);
		if (value) headers.set(headerName, value);
	}
	return headers;
}

function requestValidators(request: Request) {
	return JSON.stringify([
		request.headers.get('if-none-match') ?? '',
		request.headers.get('if-modified-since') ?? '',
		request.headers.get('cache-control') ?? '',
		request.headers.get('pragma') ?? '',
	]);
}

function relayResponseHeaders(response: Response) {
	const headers = new Headers({ 'X-Self-Feed-Relay': 'generic' });
	for (const headerName of FORWARDED_RESPONSE_HEADERS) {
		const value = response.headers.get(headerName);
		if (value) headers.set(headerName, value);
	}
	return headers;
}

function responseFromSnapshot(snapshot: RelaySnapshot) {
	return new Response(snapshot.body?.slice() ?? null, {
		status: snapshot.status,
		statusText: snapshot.statusText,
		headers: new Headers(snapshot.headers),
	});
}

function resolveTarget(request: Request, pathname: string) {
	const target = request.headers.get(TARGET_HEADER)?.trim();
	if (target) return target;
	return pathname === LEGACY_VIDEOCARDZ_RELAY_PATH ? VIDEOCARDZ_FEED_URL : null;
}

export function createFeedRelayHandler({
	token,
	maxContentLength = DEFAULT_MAX_CONTENT_LENGTH,
	cooldownMs = DEFAULT_COOLDOWN_MS,
	now = Date.now,
	upstreamFetch = (input, init) =>
		fetchWithValidatedRedirects(input, init, {
			allowPrivateHosts: false,
			maxRedirects: 3,
		}),
}: FeedRelayHandlerOptions) {
	if (token.length < 32) throw new Error('FEED_RELAY_TOKEN must contain at least 32 characters');
	if (!Number.isInteger(maxContentLength) || maxContentLength < 1024) {
		throw new Error('Feed relay maximum content length must be at least 1024 bytes');
	}
	if (!Number.isFinite(cooldownMs) || cooldownMs < 60_000) {
		throw new Error('Feed relay cooldown must be at least 60000 milliseconds');
	}

	const cache = new Map<string, CachedRelaySnapshot>();
	const inFlight = new Map<string, InFlightRelaySnapshot>();

	return async (request: Request) => {
		const url = new URL(request.url);
		if (url.pathname === '/health' && request.method === 'GET') {
			return Response.json({ status: 'ok' });
		}

		if (
			request.method !== 'GET' ||
			(url.pathname !== GENERIC_RELAY_PATH && url.pathname !== LEGACY_VIDEOCARDZ_RELAY_PATH)
		) {
			return new Response('Not found', { status: 404 });
		}

		if (!isAuthorized(request, token)) {
			return new Response('Unauthorized', { status: 401 });
		}

		const target = resolveTarget(request, url.pathname);
		if (!target) {
			return new Response('Missing feed target', { status: 400 });
		}

		const validators = requestValidators(request);
		const requestTime = now();
		for (const [cachedTarget, entry] of cache) {
			if (entry.expiresAt <= requestTime) cache.delete(cachedTarget);
		}
		const cached = cache.get(target);
		if (cached) {
			if (cached.requestValidators === validators) {
				return responseFromSnapshot(cached.snapshot);
			}
			return new Response('Feed request cooldown is active', {
				status: 429,
				headers: {
					'Retry-After': String(Math.max(1, Math.ceil((cached.expiresAt - now()) / 1000))),
				},
			});
		}
		const active = inFlight.get(target);
		if (active && active.requestValidators !== validators) {
			return new Response('Feed request cooldown is active', {
				status: 429,
				headers: { 'Retry-After': '60' },
			});
		}

		try {
			let pending = active?.promise;
			if (!pending) {
				pending = (async () => {
					const upstream = await upstreamFetch(target, {
						method: 'GET',
						headers: upstreamRequestHeaders(request),
						redirect: 'manual',
						signal: request.signal,
					});
					const contentLength = upstream.headers.get('content-length');
					if (contentLength && Number.parseInt(contentLength, 10) > maxContentLength) {
						await upstream.body?.cancel().catch(() => undefined);
						throw new Error('Feed content exceeds maximum size');
					}
					const body =
						upstream.status === 204 || upstream.status === 205 || upstream.status === 304
							? null
							: await readResponseBytesWithinLimit(upstream, maxContentLength);
					return {
						status: upstream.status,
						statusText: upstream.statusText,
						headers: relayResponseHeaders(upstream),
						body,
					};
				})();
				inFlight.set(target, { requestValidators: validators, promise: pending });
			}

			const snapshot = await pending;
			cache.set(target, {
				expiresAt: now() + cooldownMs,
				requestValidators: validators,
				snapshot,
			});
			return responseFromSnapshot(snapshot);
		} catch (error) {
			console.error('Feed relay request failed', {
				error: error instanceof Error ? error.message : String(error),
			});
			return new Response('Upstream feed request failed', { status: 502 });
		} finally {
			inFlight.delete(target);
		}
	};
}
