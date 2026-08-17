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
	it('routes the delayed Melhores Destinos RSS endpoint to its current Atom feed', async () => {
		const directFetch = vi.fn(async () => new Response('<feed />', { status: 200 }));

		await fetchFeedWithRelayFallback(
			'https://www.melhoresdestinos.com.br/feed',
			{},
			securityOptions,
			{},
			{ directFetch: directFetch as never },
		);

		expect(directFetch).toHaveBeenCalledWith(
			'https://www.melhoresdestinos.com.br/feed/atom',
			{},
			securityOptions,
		);
	});

	it('settles when an injected direct fetch ignores the caller abort', async () => {
		const controller = new AbortController();
		const reason = new Error('publisher deadline reached');
		const pending = fetchFeedWithRelayFallback(
			'https://publisher.example/feed.xml',
			{ signal: controller.signal },
			securityOptions,
			relayConfig,
			{
				directFetch: vi.fn(async () => new Promise<Response>(() => undefined)) as never,
			},
		);

		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
	});

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
		expect(headers.get('x-self-feed-target')).toBe('https://videocardz.com/rss-feed');
		expect(headers.get('if-none-match')).toBe('"feed-v1"');
		expect(headers.get('x-do-not-forward')).toBeNull();
	});

	it('does not wait for direct response cancellation before using the relay', async () => {
		const cancel = vi.fn(() => new Promise<void>(() => undefined));
		const relayResponse = new Response('<rss />', { status: 200 });

		const response = await fetchFeedWithRelayFallback(
			'https://videocardz.com/rss-feed',
			{},
			securityOptions,
			relayConfig,
			{
				directFetch: vi.fn(
					async () => new Response(new ReadableStream({ cancel }), { status: 403 }),
				) as never,
				fetchImpl: vi.fn(async () => relayResponse) as never,
			},
		);

		expect(response).toBe(relayResponse);
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('uses the relay after direct HTTP 401', async () => {
		const relayResponse = new Response('<rss />', { status: 200 });
		const response = await fetchFeedWithRelayFallback(
			'https://videocardz.com/rss-feed',
			{},
			securityOptions,
			relayConfig,
			{
				directFetch: vi.fn(async () => new Response(null, { status: 401 })) as never,
				fetchImpl: vi.fn(async () => relayResponse) as never,
			},
		);

		expect(response).toBe(relayResponse);
	});

	it('returns direct HTTP 429 without calling or cancelling through the relay', async () => {
		const relayFetch = vi.fn();
		const cancel = vi.fn();
		const rateLimited = new Response(new ReadableStream({ cancel }), {
			status: 429,
			headers: { 'Retry-After': '900' },
		});

		const response = await fetchFeedWithRelayFallback(
			'https://videocardz.com/rss-feed',
			{},
			securityOptions,
			relayConfig,
			{
				directFetch: vi.fn(async () => rateLimited) as never,
				fetchImpl: relayFetch as never,
			},
		);

		expect(response).toBe(rateLimited);
		expect(response.headers.get('retry-after')).toBe('900');
		expect(relayFetch).not.toHaveBeenCalled();
		expect(cancel).not.toHaveBeenCalled();
	});

	it('does not relay server failures', async () => {
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

		expect(relayFetch).not.toHaveBeenCalled();
	});

	it('relays any authenticated public feed after a direct access block', async () => {
		const relayFetch = vi.fn(
			async (_input: string | URL | Request, _init?: RequestInit) =>
				new Response('<rss />', { headers: { 'X-Self-Feed-Relay': 'generic' } }),
		);
		await fetchFeedWithRelayFallback(
			'https://publisher.example/feed.xml',
			{},
			securityOptions,
			relayConfig,
			{
				directFetch: vi.fn(async () => new Response(null, { status: 403 })) as never,
				fetchImpl: relayFetch as never,
			},
		);

		const headers = new Headers(relayFetch.mock.calls[0]?.[1]?.headers);
		expect(headers.get('x-self-feed-target')).toBe('https://publisher.example/feed.xml');
	});

	it('rejects an old fixed-upstream relay for non-VideoCardz targets', async () => {
		await expect(
			fetchFeedWithRelayFallback(
				'https://publisher.example/feed.xml',
				{},
				securityOptions,
				relayConfig,
				{
					directFetch: vi.fn(async () => new Response(null, { status: 403 })) as never,
					fetchImpl: vi.fn(
						async () =>
							new Response('<rss><title>Wrong feed</title></rss>', {
								headers: { 'X-Self-Feed-Relay': 'videocardz' },
							}),
					) as never,
				},
			),
		).rejects.toThrow('configured relay does not support generic feed targets');
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
