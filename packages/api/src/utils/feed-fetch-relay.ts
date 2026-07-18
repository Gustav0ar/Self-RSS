import { cancelResponseBody } from './bounded-response.js';
import { fetchWithValidatedRedirects, type RemoteFetchSecurityOptions } from './safe-fetch.js';

export interface FeedFetchRelayConfig {
	relayUrl?: string;
	relayToken?: string;
	/** @deprecated Relay targets are authenticated and SSRF-validated instead. */
	allowedHosts?: readonly string[];
}

interface FeedFetchRelayDeps {
	directFetch?: typeof fetchWithValidatedRedirects;
	fetchImpl?: typeof fetch;
}

const RELAY_HTTP_STATUSES = new Set([401, 403]);
const LEGACY_VIDEOCARDZ_FEED_URL = 'https://videocardz.com/rss-feed';
const RELAY_REQUEST_HEADERS = [
	'accept',
	'cache-control',
	'if-modified-since',
	'if-none-match',
	'pragma',
] as const;

function canUseRelay(config: FeedFetchRelayConfig) {
	return Boolean(config.relayUrl && config.relayToken);
}

function relayHeaders(init: RequestInit, token: string, targetUrl: string) {
	const incoming = new Headers(init.headers);
	const headers = new Headers({
		Authorization: `Bearer ${token}`,
		'X-Self-Feed-Target': targetUrl,
	});
	for (const headerName of RELAY_REQUEST_HEADERS) {
		const value = incoming.get(headerName);
		if (value) headers.set(headerName, value);
	}
	return headers;
}

export async function fetchFeedWithRelayFallback(
	input: string,
	init: RequestInit,
	securityOptions: RemoteFetchSecurityOptions,
	config: FeedFetchRelayConfig,
	deps: FeedFetchRelayDeps = {},
) {
	const directFetch = deps.directFetch ?? fetchWithValidatedRedirects;
	const directResponse = await directFetch(input, init, securityOptions);
	if (!RELAY_HTTP_STATUSES.has(directResponse.status) || !canUseRelay(config)) {
		return directResponse;
	}

	cancelResponseBody(directResponse);
	try {
		const relayResponse = await (deps.fetchImpl ?? fetch)(config.relayUrl!, {
			method: 'GET',
			headers: relayHeaders(init, config.relayToken!, input),
			redirect: 'error',
			signal: init.signal,
		});
		if (
			relayResponse.ok &&
			new URL(input).toString() !== LEGACY_VIDEOCARDZ_FEED_URL &&
			relayResponse.headers.get('x-self-feed-relay') !== 'generic'
		) {
			cancelResponseBody(relayResponse);
			throw new Error('configured relay does not support generic feed targets');
		}
		return relayResponse;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Feed relay request failed: ${message}`);
	}
}
