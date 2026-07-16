import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFeedRelayHandler } from '../../src/feed-relay-handler.js';
import { FEED_FETCH_USER_AGENT } from '../../src/utils/feed-fetch-headers.js';

const TOKEN = 'relay-token-with-more-than-thirty-two-characters';
const RELAY_URL = 'http://relay.internal/feed';
const TARGET_URL = 'https://publisher.example/feed.xml';

afterEach(() => {
	vi.restoreAllMocks();
});

function relayRequest(target = TARGET_URL, headers: HeadersInit = {}) {
	return new Request(RELAY_URL, {
		headers: {
			Authorization: `Bearer ${TOKEN}`,
			'X-Self-Feed-Target': target,
			...headers,
		},
	});
}

describe('createFeedRelayHandler', () => {
	it('exposes an unauthenticated health endpoint', async () => {
		const handler = createFeedRelayHandler({ token: TOKEN });
		const response = await handler(new Request('http://relay.internal/health'));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok' });
	});

	it('rejects unknown routes, methods, missing targets, and invalid tokens', async () => {
		const upstreamFetch = vi.fn();
		const handler = createFeedRelayHandler({
			token: TOKEN,
			upstreamFetch: upstreamFetch as never,
		});

		expect((await handler(new Request('http://relay.internal/anything'))).status).toBe(404);
		expect(
			(
				await handler(
					new Request(RELAY_URL, {
						method: 'POST',
						headers: { Authorization: `Bearer ${TOKEN}` },
					}),
				)
			).status,
		).toBe(404);
		expect((await handler(new Request(RELAY_URL))).status).toBe(401);
		expect(
			(
				await handler(
					new Request(RELAY_URL, {
						headers: { Authorization: 'Bearer incorrect-token' },
					}),
				)
			).status,
		).toBe(401);
		expect(
			(
				await handler(
					new Request(RELAY_URL, {
						headers: { Authorization: `Bearer ${TOKEN}` },
					}),
				)
			).status,
		).toBe(400);
		expect(upstreamFetch).not.toHaveBeenCalled();
	});

	it('fetches an authenticated target and forwards only safe cache validators', async () => {
		const upstreamFetch = vi.fn(async (_input: string, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			expect(headers.get('user-agent')).toBe(FEED_FETCH_USER_AGENT);
			expect(headers.get('accept')).toContain('application/rss+xml');
			expect(headers.get('if-none-match')).toBe('"feed-v1"');
			expect(headers.get('authorization')).toBeNull();
			return new Response('<rss><channel><title>Publisher</title></channel></rss>', {
				status: 200,
				headers: {
					'Content-Type': 'application/rss+xml',
					ETag: '"feed-v1"',
				},
			});
		});
		const handler = createFeedRelayHandler({ token: TOKEN, upstreamFetch });
		const response = await handler(relayRequest(TARGET_URL, { 'If-None-Match': '"feed-v1"' }));

		expect(upstreamFetch).toHaveBeenCalledWith(
			TARGET_URL,
			expect.objectContaining({ method: 'GET', redirect: 'manual' }),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('x-self-feed-relay')).toBe('generic');
		expect(response.headers.get('etag')).toBe('"feed-v1"');
		expect(await response.text()).toContain('<title>Publisher</title>');
	});

	it('keeps the legacy VideoCardz endpoint compatible', async () => {
		const upstreamFetch = vi.fn(async () => new Response('<rss />'));
		const handler = createFeedRelayHandler({ token: TOKEN, upstreamFetch });
		const response = await handler(
			new Request('http://relay.internal/videocardz/rss-feed', {
				headers: { Authorization: `Bearer ${TOKEN}` },
			}),
		);

		expect(response.status).toBe(200);
		expect(upstreamFetch).toHaveBeenCalledWith(
			'https://videocardz.com/rss-feed',
			expect.any(Object),
		);
	});

	it('coalesces concurrent calls and caches the same feed for one minute', async () => {
		let resolveUpstream!: (response: Response) => void;
		const upstreamFetch = vi
			.fn()
			.mockImplementationOnce(
				async () =>
					new Promise<Response>((resolve) => {
						resolveUpstream = resolve;
					}),
			)
			.mockResolvedValue(new Response('<rss />'));
		let now = 1_000;
		const handler = createFeedRelayHandler({
			token: TOKEN,
			upstreamFetch,
			now: () => now,
		});
		const first = handler(relayRequest());
		const concurrent = handler(relayRequest());
		resolveUpstream(new Response('<rss />'));

		expect((await first).status).toBe(200);
		expect((await concurrent).status).toBe(200);
		expect((await handler(relayRequest())).status).toBe(200);
		expect(upstreamFetch).toHaveBeenCalledTimes(1);

		now += 60_001;
		expect((await handler(relayRequest())).status).toBe(200);
		expect(upstreamFetch).toHaveBeenCalledTimes(2);
	});

	it('rejects different validators during the same feed cooldown', async () => {
		const upstreamFetch = vi.fn(async () => new Response('<rss />'));
		const handler = createFeedRelayHandler({ token: TOKEN, upstreamFetch });
		expect((await handler(relayRequest())).status).toBe(200);

		const response = await handler(relayRequest(TARGET_URL, { 'If-None-Match': '"other"' }));
		expect(response.status).toBe(429);
		expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
		expect(upstreamFetch).toHaveBeenCalledTimes(1);
	});

	it('blocks private relay targets before making a network request', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const handler = createFeedRelayHandler({ token: TOKEN });
		const response = await handler(relayRequest('http://127.0.0.1/private-feed'));

		expect(response.status).toBe(502);
		expect(await response.text()).toBe('Upstream feed request failed');
	});

	it('returns a generic bad gateway response when the upstream request fails', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const handler = createFeedRelayHandler({
			token: TOKEN,
			upstreamFetch: vi.fn(async () => {
				throw new Error('connection failed');
			}),
		});
		const response = await handler(relayRequest());

		expect(response.status).toBe(502);
		expect(await response.text()).toBe('Upstream feed request failed');
	});

	it('rejects weak relay tokens and cooldowns shorter than one minute at startup', () => {
		expect(() => createFeedRelayHandler({ token: 'too-short' })).toThrow('at least 32 characters');
		expect(() => createFeedRelayHandler({ token: TOKEN, cooldownMs: 59_999 })).toThrow(
			'at least 60000',
		);
	});
});
