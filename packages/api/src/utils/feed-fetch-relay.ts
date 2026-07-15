import { fetchWithValidatedRedirects, type RemoteFetchSecurityOptions } from './safe-fetch.js';

export interface FeedFetchRelayConfig {
	relayUrl?: string;
	relayToken?: string;
	allowedHosts?: readonly string[];
}

interface FeedFetchRelayDeps {
	directFetch?: typeof fetchWithValidatedRedirects;
	fetchImpl?: typeof fetch;
}

const RELAY_HTTP_STATUSES = new Set([401, 403, 429]);
const RELAY_REQUEST_HEADERS = [
	'accept',
	'cache-control',
	'if-modified-since',
	'if-none-match',
	'pragma',
] as const;

function normalizeHostname(value: string) {
	return value.trim().toLowerCase().replace(/\.$/, '');
}

function canUseRelay(input: string, config: FeedFetchRelayConfig) {
	if (!config.relayUrl || !config.relayToken || !config.allowedHosts?.length) return false;
	const hostname = normalizeHostname(new URL(input).hostname);
	return config.allowedHosts.some((allowedHost) => normalizeHostname(allowedHost) === hostname);
}

function relayHeaders(init: RequestInit, token: string) {
	const incoming = new Headers(init.headers);
	const headers = new Headers({ Authorization: `Bearer ${token}` });
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
	if (!RELAY_HTTP_STATUSES.has(directResponse.status) || !canUseRelay(input, config)) {
		return directResponse;
	}

	await directResponse.body?.cancel().catch(() => undefined);
	try {
		return await (deps.fetchImpl ?? fetch)(config.relayUrl!, {
			method: 'GET',
			headers: relayHeaders(init, config.relayToken!),
			redirect: 'error',
			signal: init.signal,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Feed relay request failed: ${message}`);
	}
}
