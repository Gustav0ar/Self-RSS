import { describe, expect, it, vi } from 'vitest';
import { fetchFeedWithRelayFallback } from '../../src/utils/feed-fetch-relay.js';

const TOKEN = 'relay-token-with-more-than-thirty-two-characters';
const relayConfig = {
	relayUrl: 'http://relay.internal/videocardz/rss-feed',
	relayToken: TOKEN,
	allowedHosts: ['videocardz.com'],
};
const securityOptions = { allowPrivateHosts: false, maxRedirects: 3 };

describe('fetchFeedWithRelayFallback', () => {
	it('uses the direct response and skips the relay after direct access recovers', async () => {
		const directResponse = new Response('<rss />', { status: 200 });
		const relayFetch = vi.fn();

		const response = await fetchFeedWithRelayFallback(
			'https://videocardz.com/rss-feed',
			{},
			securityOptions,
			relayConfig,
			{
				directFetch: vi.fn(async () => directResponse) as never,
				fetchImpl: relayFetch as never,
			},
		);

		expect(response).toBe(directResponse);
		expect(relayFetch).not.toHaveBeenCalled();
	});

	it('falls back after an allowlisted direct 403 and forwards validators', async () => {
		const cancel = vi.fn();
		const blockedBody = new ReadableStream({ cancel });
		const relayResponse = new Response('<rss />', { status: 200 });
		const relayFetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
			Promise.resolve(relayResponse),
		);

		const response = await fetchFeedWithRelayFallback(
			'https://videocardz.com/rss-feed',
			{
				headers: {
					Accept: 'application/rss+xml',
					'If-None-Match': '"feed-v1"',
					'X-Do-Not-Forward': 'private',
				},
			},
			securityOptions,
			relayConfig,
			{
				directFetch: vi.fn(
					async () => new Response(blockedBody, { status: 403, statusText: 'Forbidden' }),
				) as never,
				fetchImpl: relayFetch as never,
			},
		);

		expect(cancel).toHaveBeenCalledOnce();
		expect(response).toBe(relayResponse);
		expect(relayFetch).toHaveBeenCalledOnce();
		const [url, init] = relayFetch.mock.calls[0]!;
		const headers = new Headers(init?.headers);
		expect(url).toBe(relayConfig.relayUrl);
		expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
		expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
		expect(headers.get('if-none-match')).toBe('"feed-v1"');
		expect(headers.get('x-do-not-forward')).toBeNull();
	});

	it.each([401, 429])('uses the relay after direct HTTP %s', async (status) => {
		const relayResponse = new Response('<rss />', { status: 200 });
		const response = await fetchFeedWithRelayFallback(
			'https://videocardz.com/rss-feed',
			{},
			securityOptions,
			relayConfig,
			{
				directFetch: vi.fn(async () => new Response(null, { status })) as never,
				fetchImpl: vi.fn(async () => relayResponse) as never,
			},
		);

		expect(response).toBe(relayResponse);
	});

	it('does not relay server failures or unallowlisted hosts', async () => {
		const relayFetch = vi.fn();
		const serverFailure = new Response(null, { status: 503 });
		expect(
			await fetchFeedWithRelayFallback(
				'https://videocardz.com/rss-feed',
				{},
				securityOptions,
				relayConfig,
				{
					directFetch: vi.fn(async () => serverFailure) as never,
					fetchImpl: relayFetch as never,
				},
			),
		).toBe(serverFailure);

		const unrelatedBlock = new Response(null, { status: 403 });
		expect(
			await fetchFeedWithRelayFallback(
				'https://example.com/feed',
				{},
				securityOptions,
				relayConfig,
				{
					directFetch: vi.fn(async () => unrelatedBlock) as never,
					fetchImpl: relayFetch as never,
				},
			),
		).toBe(unrelatedBlock);
		expect(relayFetch).not.toHaveBeenCalled();
	});

	it('does not treat subdomains as implicitly allowlisted', async () => {
		const relayFetch = vi.fn();
		const response = new Response(null, { status: 403 });

		expect(
			await fetchFeedWithRelayFallback(
				'https://news.videocardz.com/rss-feed',
				{},
				securityOptions,
				relayConfig,
				{
					directFetch: vi.fn(async () => response) as never,
					fetchImpl: relayFetch as never,
				},
			),
		).toBe(response);
		expect(relayFetch).not.toHaveBeenCalled();
	});

	it('surfaces relay transport failures without exposing credentials', async () => {
		await expect(
			fetchFeedWithRelayFallback(
				'https://videocardz.com/rss-feed',
				{},
				securityOptions,
				relayConfig,
				{
					directFetch: vi.fn(async () => new Response(null, { status: 403 })) as never,
					fetchImpl: vi.fn(async () => {
						throw new Error('connection refused');
					}) as never,
				},
			),
		).rejects.toThrow('Feed relay request failed: connection refused');
	});
});
