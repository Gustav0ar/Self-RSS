import { createFeedFetchHeaders } from '../utils/feed-fetch-headers.js';
import { fetchWithValidatedRedirects } from '../utils/safe-fetch.js';

export const SOURCE_FETCH_USER_AGENT = 'Self-Feed/1.0 (+https://github.com/Gustav0ar/Self-RSS)';

export function createSourceFetchHeaders(
	options: { contact?: string; userAgent?: string } = {},
): Record<string, string> {
	const identity = options.userAgent?.trim() || SOURCE_FETCH_USER_AGENT;
	const contact = options.contact?.trim();
	return {
		...createFeedFetchHeaders({
			userAgent: contact ? `${identity}; contact=${contact}` : identity,
		}),
		Accept:
			'application/rss+xml, application/atom+xml, application/feed+json, application/json, application/xml, text/xml;q=0.9',
	};
}

export function fetchSourceSafely(
	url: string,
	init: RequestInit,
	options: { allowPrivateHosts: boolean; maxRedirects?: number },
) {
	const headers = new Headers(createSourceFetchHeaders());
	new Headers(init.headers).forEach((value, key) => {
		headers.set(key, value);
	});
	return fetchWithValidatedRedirects(url, { ...init, headers }, options);
}
