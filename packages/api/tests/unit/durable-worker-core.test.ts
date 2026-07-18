import { describe, expect, it } from 'vitest';
import { selectFeedPipelineWorkers } from '../../src/jobs/durable-ingestion-runtime.js';
import { classifyNetworkError } from '../../src/services/durable-feed-worker.js';
import {
	runNonOverlappingLoop,
	withLeaseHeartbeat,
} from '../../src/services/durable-worker-loop.js';

describe('durable worker core', () => {
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
