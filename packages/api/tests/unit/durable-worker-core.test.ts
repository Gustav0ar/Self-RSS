import { describe, expect, it, vi } from 'vitest';
import { selectFeedPipelineWorkers } from '../../src/jobs/durable-ingestion-runtime.js';
import { createDurableFeedFetcher } from '../../src/services/durable-feed-fetcher.js';
import {
	runNonOverlappingLoop,
	withLeaseHeartbeat,
} from '../../src/services/durable-worker-loop.js';
import { classifyNetworkError } from '../../src/services/feed-network-error.js';
import { publisherTargetForRelayResponse } from '../../src/utils/feed-fetch-relay.js';

describe('durable worker core', () => {
	it('uses the authenticated relay after a direct publisher block', async () => {
		const relayFetch = vi.fn(
			async (_input: string | URL | Request, _init?: RequestInit) =>
				new Response('<rss />', { headers: { 'X-Self-Feed-Relay': 'generic' } }),
		);
		const fetcher = createDurableFeedFetcher(
			{
				relayUrl: 'https://relay.example/feed',
				relayToken: 'relay-token-with-more-than-thirty-two-characters',
			},
			{
				directFetch: vi.fn(async () => new Response(null, { status: 403 })) as never,
				relayFetch: relayFetch as never,
			},
		);

		const response = await fetcher(
			'https://publisher.example/feed.xml',
			{ headers: { 'If-None-Match': '"feed-v1"' } },
			{ allowPrivateHosts: false, maxRedirects: 3 },
		);

		expect(response.status).toBe(200);
		expect(relayFetch).toHaveBeenCalledOnce();
		const headers = new Headers(relayFetch.mock.calls[0]?.[1]?.headers);
		expect(headers.get('x-self-feed-target')).toBe('https://publisher.example/feed.xml');
		expect(headers.get('if-none-match')).toBe('"feed-v1"');
	});

	it('rejects a fixed-upstream relay response for a generic durable source', async () => {
		const fetcher = createDurableFeedFetcher(
			{
				relayUrl: 'https://relay.example/videocardz/rss-feed',
				relayToken: 'relay-token-with-more-than-thirty-two-characters',
			},
			{
				directFetch: vi.fn(async () => new Response(null, { status: 403 })) as never,
				relayFetch: vi.fn(async () => new Response('<rss />')) as never,
			},
		);

		await expect(
			fetcher(
				'https://publisher.example/feed.xml',
				{},
				{ allowPrivateHosts: false, maxRedirects: 3 },
			),
		).rejects.toThrow('configured relay does not support generic feed targets');
	});

	it('keeps publisher rate limiting on the direct durable path', async () => {
		const relayFetch = vi.fn();
		const rateLimited = new Response(null, {
			status: 429,
			headers: { 'Retry-After': '900' },
		});
		const fetcher = createDurableFeedFetcher(
			{
				relayUrl: 'https://relay.example/feed',
				relayToken: 'relay-token-with-more-than-thirty-two-characters',
			},
			{
				directFetch: vi.fn(async () => rateLimited) as never,
				relayFetch: relayFetch as never,
			},
		);

		const response = await fetcher(
			'https://publisher.example/feed.xml',
			{},
			{ allowPrivateHosts: false, maxRedirects: 3 },
		);

		expect(response).toBe(rateLimited);
		expect(response.headers.get('retry-after')).toBe('900');
		expect(relayFetch).not.toHaveBeenCalled();
	});

	it('does not trust a publisher-supplied relay marker', async () => {
		const directResponse = new Response('<rss />', {
			headers: { 'X-Self-Feed-Relay': 'generic' },
		});
		const response = await createDurableFeedFetcher(
			{},
			{ directFetch: vi.fn(async () => directResponse) as never },
		)('https://publisher.example/feed.xml', {}, { allowPrivateHosts: false, maxRedirects: 3 });

		expect(response).toBe(directResponse);
		expect(publisherTargetForRelayResponse(response)).toBeUndefined();
	});

	it('selects exactly one publisher pipeline for every supported rollout mode', () => {
		expect(selectFeedPipelineWorkers('legacy')).toEqual({
			legacyPublisherWorkers: true,
			durablePublisherWorkers: false,
		});
		expect(selectFeedPipelineWorkers('v2')).toEqual({
			legacyPublisherWorkers: false,
			durablePublisherWorkers: true,
		});
	});
	it('classifies nested DNS and TLS causes without relying on a top-level code', () => {
		expect(
			classifyNetworkError(
				new Error('request failed', { cause: new Error('DNS lookup timed out') }),
			),
		).toBe('dns');
		expect(
			classifyNetworkError(
				new Error('request failed', { cause: new Error('certificate handshake rejected') }),
			),
		).toBe('tls');
		expect(classifyNetworkError(new Error('socket closed'))).toBe('network');
	});

	it('renews a lease during long work and never overlaps loop ticks', async () => {
		let renewals = 0;
		await withLeaseHeartbeat({
			leaseSeconds: 0.03,
			renew: async () => {
				renewals += 1;
			},
			operation: () => new Promise((resolve) => setTimeout(resolve, 275)),
		});
		expect(renewals).toBeGreaterThanOrEqual(1);

		const controller = new AbortController();
		let active = 0;
		let maxActive = 0;
		let ticks = 0;
		await runNonOverlappingLoop({
			intervalMs: 0,
			signal: controller.signal,
			tick: async () => {
				active += 1;
				maxActive = Math.max(maxActive, active);
				await new Promise((resolve) => setTimeout(resolve, 2));
				active -= 1;
				ticks += 1;
				if (ticks === 3) controller.abort();
			},
		});
		expect(ticks).toBe(3);
		expect(maxActive).toBe(1);
	});
});
