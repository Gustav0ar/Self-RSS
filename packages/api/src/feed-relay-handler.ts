import { timingSafeEqual } from 'node:crypto';
import { createFeedFetchHeaders } from './utils/feed-fetch-headers.js';

const VIDEOCARDZ_FEED_URL = 'https://videocardz.com/rss-feed';
const VIDEOCARDZ_RELAY_PATH = '/videocardz/rss-feed';
const FORWARDED_REQUEST_HEADERS = [
	'cache-control',
	'if-modified-since',
	'if-none-match',
	'pragma',
] as const;
const FORWARDED_RESPONSE_HEADERS = [
	'cache-control',
	'content-length',
	'content-type',
	'date',
	'etag',
	'expires',
	'last-modified',
] as const;

interface FeedRelayHandlerOptions {
	token: string;
	fetchImpl?: typeof fetch;
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

function relayResponseHeaders(response: Response) {
	const headers = new Headers({ 'X-Self-Feed-Relay': 'videocardz' });
	for (const headerName of FORWARDED_RESPONSE_HEADERS) {
		const value = response.headers.get(headerName);
		if (value) headers.set(headerName, value);
	}
	return headers;
}

export function createFeedRelayHandler({ token, fetchImpl = fetch }: FeedRelayHandlerOptions) {
	if (token.length < 32) throw new Error('FEED_RELAY_TOKEN must contain at least 32 characters');

	return async (request: Request) => {
		const url = new URL(request.url);
		if (url.pathname === '/health' && request.method === 'GET') {
			return Response.json({ status: 'ok' });
		}

		if (url.pathname !== VIDEOCARDZ_RELAY_PATH || request.method !== 'GET') {
			return new Response('Not found', { status: 404 });
		}

		if (!isAuthorized(request, token)) {
			return new Response('Unauthorized', { status: 401 });
		}

		try {
			const upstream = await fetchImpl(VIDEOCARDZ_FEED_URL, {
				method: 'GET',
				headers: upstreamRequestHeaders(request),
				redirect: 'follow',
				signal: request.signal,
			});
			return new Response(upstream.body, {
				status: upstream.status,
				statusText: upstream.statusText,
				headers: relayResponseHeaders(upstream),
			});
		} catch (error) {
			console.error('VideoCardz feed relay failed', {
				error: error instanceof Error ? error.message : String(error),
			});
			return new Response('Upstream feed request failed', { status: 502 });
		}
	};
}
