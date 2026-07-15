import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFeedRelayHandler } from '../../src/feed-relay-handler.js';
import { FEED_FETCH_USER_AGENT } from '../../src/utils/feed-fetch-headers.js';

const TOKEN = 'relay-token-with-more-than-thirty-two-characters';
const RELAY_URL = 'http://relay.internal/videocardz/rss-feed';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('createFeedRelayHandler', () => {
	it('exposes an unauthenticated health endpoint', async () => {
		const handler = createFeedRelayHandler({ token: TOKEN });
		const response = await handler(new Request('http://relay.internal/health'));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok' });
	});

	it('rejects unknown routes and methods', async () => {
		const handler = createFeedRelayHandler({ token: TOKEN });

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
	});

	it('requires the relay bearer token', async () => {
		const fetchImpl = vi.fn();
		const handler = createFeedRelayHandler({ token: TOKEN, fetchImpl: fetchImpl as never });

		expect((await handler(new Request(RELAY_URL))).status).toBe(401);
		expect(
			(
				await handler(
					new Request(RELAY_URL, { headers: { Authorization: 'Bearer incorrect-token' } }),
				)
			).status,
		).toBe(401);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('fetches only the fixed VideoCardz URL and forwards cache validators', async () => {
		const fetchImpl = vi.fn(async (_input: string, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			expect(headers.get('user-agent')).toBe(FEED_FETCH_USER_AGENT);
			expect(headers.get('accept')).toContain('application/rss+xml');
			expect(headers.get('if-none-match')).toBe('"feed-v1"');
			expect(headers.get('authorization')).toBeNull();
			return new Response('<rss><channel><title>VideoCardz</title></channel></rss>', {
				status: 200,
				headers: {
					'Content-Type': 'application/rss+xml',
					ETag: '"feed-v1"',
				},
			});
		});
		const handler = createFeedRelayHandler({ token: TOKEN, fetchImpl: fetchImpl as never });
		const response = await handler(
			new Request(RELAY_URL, {
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					'If-None-Match': '"feed-v1"',
				},
			}),
		);

		expect(fetchImpl).toHaveBeenCalledWith(
			'https://videocardz.com/rss-feed',
			expect.objectContaining({ method: 'GET', redirect: 'follow' }),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('x-self-feed-relay')).toBe('videocardz');
		expect(response.headers.get('etag')).toBe('"feed-v1"');
		expect(await response.text()).toContain('<title>VideoCardz</title>');
	});

	it('returns a generic bad gateway response when the upstream request fails', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const handler = createFeedRelayHandler({
			token: TOKEN,
			fetchImpl: vi.fn(async () => {
				throw new Error('connection failed');
			}) as never,
		});
		const response = await handler(
			new Request(RELAY_URL, { headers: { Authorization: `Bearer ${TOKEN}` } }),
		);

		expect(response.status).toBe(502);
		expect(await response.text()).toBe('Upstream feed request failed');
	});

	it('rejects weak relay tokens at startup', () => {
		expect(() => createFeedRelayHandler({ token: 'too-short' })).toThrow('at least 32 characters');
	});
});
