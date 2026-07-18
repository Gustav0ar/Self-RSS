import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
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

	it('bounds DNS resolution with a configurable timeout', async () => {
		await expect(
			assertSafeRemoteUrl(
				'https://slow-dns.example/feed.xml',
				{ allowPrivateHosts: false, dnsTimeoutMs: 5 },
				async () => new Promise(() => undefined),
			),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: 'Remote URL hostname resolution timed out',
		});
	});

	it('stops waiting for DNS when the caller aborts', async () => {
		const controller = new AbortController();
		const reason = new Error('caller deadline reached');
		const resolution = assertSafeRemoteUrl(
			'https://slow-dns.example/feed.xml',
			{ allowPrivateHosts: false, dnsTimeoutMs: 5_000 },
			async () => new Promise(() => undefined),
			controller.signal,
		);

		controller.abort(reason);
		await expect(resolution).rejects.toBe(reason);
	});
});

describe('fetchWithValidatedRedirects', () => {
	it('keeps the caller abort signal attached after response headers arrive', async () => {
		const callerController = new AbortController();
		let requestSignal!: AbortSignal;
		const response = await fetchWithValidatedRedirects(
			'https://example.com/feed.xml',
			{ signal: callerController.signal },
			{ allowPrivateHosts: false, maxRedirects: 0 },
			{
				lookupFn: lookupAll([{ address: '93.184.216.34', family: 4 }]),
				fetchImpl: async (_input, init) => {
					if (!init?.signal) throw new Error('Expected a request signal');
					requestSignal = init.signal;
					return new Response(
						new ReadableStream({
							start(controller) {
								controller.enqueue(new TextEncoder().encode('<rss>'));
							},
						}),
					);
				},
			},
		);

		expect(response.status).toBe(200);
		expect(requestSignal.aborted).toBe(false);
		callerController.abort();
		expect(requestSignal.aborted).toBe(true);
	});

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

	it('cancels an unused redirect body before following the next hop', async () => {
		const cancel = vi.fn();
		const redirectBody = new ReadableStream({ cancel });
		const fetchImpl = fetchSequence([
			new Response(redirectBody, {
				status: 302,
				headers: { location: 'https://feeds.example.com/feed.xml' },
			}),
			new Response('<rss />', { status: 200 }),
		]);

		await fetchWithValidatedRedirects(
			'https://example.com/redirect',
			{},
			{ allowPrivateHosts: false, maxRedirects: 3 },
			{
				fetchImpl,
				lookupFn: async () => [{ address: '93.184.216.34', family: 4 as const }],
			},
		);

		expect(cancel).toHaveBeenCalledOnce();
	});

	it('does not wait for a redirect body cancellation that never settles', async () => {
		const cancel = vi.fn(() => new Promise<void>(() => undefined));
		const redirectBody = new ReadableStream({ cancel });
		const fetchImpl = fetchSequence([
			new Response(redirectBody, {
				status: 302,
				headers: { location: 'https://feeds.example.com/feed.xml' },
			}),
			new Response('<rss />', { status: 200 }),
		]);

		const response = await fetchWithValidatedRedirects(
			'https://example.com/redirect',
			{},
			{ allowPrivateHosts: false, maxRedirects: 3 },
			{
				fetchImpl,
				lookupFn: async () => [{ address: '93.184.216.34', family: 4 as const }],
			},
		);

		expect(response.status).toBe(200);
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('validates DNS before delegating to an injected fetch implementation', async () => {
		const server = createServer((_req, res) => {
			res.writeHead(200, { 'content-type': 'application/xml' });
			res.end('<rss />');
		});
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		const port = (server.address() as AddressInfo).port;

		try {
			const response = await fetchWithValidatedRedirects(
				`http://feeds.example.test:${port}/feed.xml`,
				{},
				{ allowPrivateHosts: false, maxRedirects: 0 },
				{
					lookupFn: async () => [{ address: '203.0.113.10', family: 4 as const }],
					fetchImpl: async (input) => {
						expect(input).toBe(`http://feeds.example.test:${port}/feed.xml`);
						return fetch(`http://127.0.0.1:${port}/feed.xml`);
					},
				},
			);

			expect(response.status).toBe(200);
			expect(await response.text()).toBe('<rss />');
		} finally {
			server.close();
		}
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

	it('falls back sequentially across validated addresses before headers arrive', async () => {
		const attemptedAddresses: string[] = [];
		const response = await fetchWithValidatedRedirects(
			'https://feeds.example.com/feed.xml',
			{},
			{ allowPrivateHosts: false, maxRedirects: 0 },
			{
				lookupFn: lookupAll([
					{ address: '93.184.216.34', family: 4 },
					{ address: '203.0.113.10', family: 4 },
				]),
				pinnedFetchImpl: async (validated, address, init) => {
					attemptedAddresses.push(address.address);
					expect(validated.url).toBe('https://feeds.example.com/feed.xml');
					expect(init.signal?.aborted).toBe(false);
					if (attemptedAddresses.length === 1) {
						throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
					}
					return new Response('<rss />', { status: 200 });
				},
			},
		);

		expect(response.status).toBe(200);
		expect(attemptedAddresses).toEqual(['93.184.216.34', '203.0.113.10']);
	});

	it('never attempts an address when any DNS result fails SSRF validation', async () => {
		const pinnedFetchImpl = vi.fn();
		await expect(
			fetchWithValidatedRedirects(
				'https://feeds.example.com/feed.xml',
				{},
				{ allowPrivateHosts: false, maxRedirects: 0 },
				{
					lookupFn: lookupAll([
						{ address: '93.184.216.34', family: 4 },
						{ address: '127.0.0.1', family: 4 },
					]),
					pinnedFetchImpl,
				},
			),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: 'Feed URL must not target a local or private network host',
		});
		expect(pinnedFetchImpl).not.toHaveBeenCalled();
	});
});
