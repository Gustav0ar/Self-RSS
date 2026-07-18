export const FEED_FETCH_USER_AGENT =
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

export function createFeedFetchHeaders(
	options: { userAgent?: string } = {},
): Record<string, string> {
	return {
		'User-Agent': options.userAgent?.trim() || FEED_FETCH_USER_AGENT,
		Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
	};
}
