export interface FeedSourceUrlIdentity {
	normalizedUrl: string;
	scheme: 'http' | 'https';
	host: string;
	port: number;
}

export class FeedSourceUrlError extends Error {
	constructor(
		message: string,
		readonly code: 'invalid_url' | 'unsupported_scheme' | 'credentials_not_allowed',
	) {
		super(message);
		this.name = 'FeedSourceUrlError';
	}
}

/**
 * Canonicalizes only URL syntax with deterministic WHATWG parsing. It does not
 * infer redirects, reorder query parameters, fold paths, or remove trailing slashes.
 */
export function normalizeFeedSourceUrl(input: string): FeedSourceUrlIdentity {
	const trimmed = input.trim();
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new FeedSourceUrlError('Feed source URL is invalid', 'invalid_url');
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new FeedSourceUrlError('Feed source URL must use HTTP or HTTPS', 'unsupported_scheme');
	}
	if (url.username || url.password) {
		throw new FeedSourceUrlError(
			'Feed source URL must not contain credentials',
			'credentials_not_allowed',
		);
	}

	url.hash = '';
	const scheme = url.protocol.slice(0, -1) as 'http' | 'https';
	const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
	const port = url.port ? Number(url.port) : scheme === 'https' ? 443 : 80;
	return { normalizedUrl: url.toString(), scheme, host, port };
}
