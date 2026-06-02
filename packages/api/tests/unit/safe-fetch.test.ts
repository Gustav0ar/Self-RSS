import { describe, expect, it } from 'vitest';
import type { AppError } from '../../src/middleware/errors.js';
import { assertSafeRemoteUrl, fetchWithValidatedRedirects } from '../../src/utils/safe-fetch.js';

function lookupAll(addresses: Array<{ address: string; family: 4 | 6 }>) {
	return async () => addresses;
}

function fetchSequence(responses: Response[]) {
	return async () => responses.shift() ?? new Response(null, { status: 500 });
}

describe('assertSafeRemoteUrl', () => {
	it('accepts a public https URL', async () => {
		const url = await assertSafeRemoteUrl(
			'https://example.com/feed.xml',
			{ allowPrivateHosts: false },
			lookupAll([{ address: '93.184.216.34', family: 4 }]),
		);

		expect(url).toBe('https://example.com/feed.xml');
	});

	it('rejects non-http schemes', async () => {
		await expect(
			assertSafeRemoteUrl('ftp://example.com/feed.xml', { allowPrivateHosts: false }),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: 'Only HTTP and HTTPS feed URLs are allowed',
		} satisfies Partial<AppError>);
	});

	it('rejects embedded credentials', async () => {
		await expect(
			assertSafeRemoteUrl('https://user:pass@example.com/feed.xml', { allowPrivateHosts: false }),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: 'Feed URLs must not include credentials',
		} satisfies Partial<AppError>);
	});

	it('rejects localhost and private addresses by default', async () => {
		await expect(
			assertSafeRemoteUrl('http://127.0.0.1/feed.xml', { allowPrivateHosts: false }),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: 'Feed URL must not target a local or private network host',
		} satisfies Partial<AppError>);
		await expect(
			assertSafeRemoteUrl('http://localhost/feed.xml', { allowPrivateHosts: false }),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: 'Feed URL must not target a local or private network host',
		} satisfies Partial<AppError>);
	});

	it('rejects hostnames that resolve to private addresses', async () => {
		await expect(
			assertSafeRemoteUrl(
				'https://feeds.example.com/rss.xml',
				{ allowPrivateHosts: false },
				lookupAll([{ address: '10.0.0.8', family: 4 }]),
			),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: 'Feed URL must not target a local or private network host',
		} satisfies Partial<AppError>);
	});

	it('allows local addresses only when explicitly enabled', async () => {
		const url = await assertSafeRemoteUrl('http://127.0.0.1/feed.xml', { allowPrivateHosts: true });
		expect(url).toBe('http://127.0.0.1/feed.xml');
	});
});

describe('fetchWithValidatedRedirects', () => {
	it('follows safe redirects', async () => {
		const responses = [
			new Response(null, {
				status: 302,
				headers: { location: 'https://feeds.example.com/feed.xml' },
			}),
			new Response('<rss />', { status: 200 }),
		];
		const fetchImpl = fetchSequence(responses);
		const response = await fetchWithValidatedRedirects(
			'https://example.com/redirect',
			{},
			{ allowPrivateHosts: false, maxRedirects: 3 },
			{
				fetchImpl,
				lookupFn: async (hostname) => {
					if (hostname === 'example.com') return [{ address: '93.184.216.34', family: 4 as const }];
					return [{ address: '203.0.113.10', family: 4 as const }];
				},
			},
		);

		expect(response.status).toBe(200);
	});

	it('rejects redirects into private networks', async () => {
		const fetchImpl = fetchSequence([
			new Response(null, {
				status: 302,
				headers: { location: 'http://127.0.0.1/feed.xml' },
			}),
		]);

		await expect(
			fetchWithValidatedRedirects(
				'https://example.com/redirect',
				{},
				{ allowPrivateHosts: false, maxRedirects: 3 },
				{
					fetchImpl,
					lookupFn: lookupAll([{ address: '93.184.216.34', family: 4 }]),
				},
			),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: 'Feed URL must not target a local or private network host',
		} satisfies Partial<AppError>);
	});
});
