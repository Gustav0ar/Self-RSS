import { describe, expect, it } from 'vitest';
import {
	type FeedSourceUrlError,
	normalizeFeedSourceUrl,
	resolveFeedFetchUrl,
} from '../../src/utils/feed-source-url.js';

describe('resolveFeedFetchUrl', () => {
	it.each([
		['https://www.melhoresdestinos.com.br/feed', 'https://www.melhoresdestinos.com.br/feed/atom'],
		[
			'https://melhoresdestinos.com.br/feed/?cache=stale',
			'https://melhoresdestinos.com.br/feed/atom',
		],
	])('uses the promptly updated Atom endpoint for %s', (input, expected) => {
		expect(resolveFeedFetchUrl(input)).toBe(expected);
	});

	it.each([
		'https://www.melhoresdestinos.com.br/article/feed',
		'https://publisher.example/feed',
		'not a URL',
	])('leaves unrelated sources unchanged for %s', (input) => {
		expect(resolveFeedFetchUrl(input)).toBe(input);
	});
});

describe('normalizeFeedSourceUrl', () => {
	it.each([
		[
			' HTTPS://Example.COM:443/Feed/Path/?b=2&a=1#section ',
			'https://example.com/Feed/Path/?b=2&a=1',
			{ scheme: 'https', host: 'example.com', port: 443 },
		],
		[
			'http://192.0.2.10:8080/rss',
			'http://192.0.2.10:8080/rss',
			{ scheme: 'http', host: '192.0.2.10', port: 8080 },
		],
		[
			'https://[2001:db8::1]:443/feed',
			'https://[2001:db8::1]/feed',
			{ scheme: 'https', host: '2001:db8::1', port: 443 },
		],
	])('normalizes URL syntax without broad equivalence for %s', (input, normalizedUrl, origin) => {
		expect(normalizeFeedSourceUrl(input)).toEqual({ normalizedUrl, ...origin });
	});

	it.each([
		['ftp://example.com/feed', 'unsupported_scheme'],
		['https://user:secret@example.com/feed', 'credentials_not_allowed'],
		['not a URL', 'invalid_url'],
		['', 'invalid_url'],
	])('rejects unsafe or malformed input %s', (input, code) => {
		expect(() => normalizeFeedSourceUrl(input)).toThrowError(
			expect.objectContaining({ code }) as FeedSourceUrlError,
		);
	});
});
