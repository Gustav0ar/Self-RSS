import { describe, expect, it, vi } from 'vitest';
import {
	DurableIngestionTelemetry,
	readDurableIngestionCounters,
} from '../../src/services/durable-ingestion-telemetry.js';

describe('DurableIngestionTelemetry', () => {
	it('records only bounded runtime dimensions locally and in Redis', async () => {
		const metrics = {
			recordDurablePublisherRequest: vi.fn(),
			recordDurablePublisherOutcome: vi.fn(),
			recordDurableLoopError: vi.fn(),
			recordDurableCleanup: vi.fn(),
		};
		const redis = { hincrby: vi.fn().mockResolvedValue(1) };
		const telemetry = new DurableIngestionTelemetry(metrics as never, redis as never);

		telemetry.recordPublisherRequest();
		telemetry.recordPublisherOutcome('rate_limited');
		telemetry.recordLoopError('cleanup');
		telemetry.recordCleanup({
			expiredSnapshotBodies: 2,
			refreshRequests: 1,
			fetchJobs: 0,
			deliveries: 0,
			snapshots: 3,
			discoveryCandidates: 0,
		});
		await Promise.resolve();

		expect(metrics.recordDurablePublisherRequest).toHaveBeenCalledOnce();
		expect(metrics.recordDurablePublisherOutcome).toHaveBeenCalledWith('rate_limited');
		expect(metrics.recordDurableLoopError).toHaveBeenCalledWith('cleanup');
		expect(metrics.recordDurableCleanup).toHaveBeenCalledWith('expiredSnapshotBodies', 2);
		expect(metrics.recordDurableCleanup).toHaveBeenCalledWith('refreshRequests', 1);
		expect(metrics.recordDurableCleanup).toHaveBeenCalledWith('snapshots', 3);
		expect(redis.hincrby.mock.calls).toEqual([
			[expect.any(String), 'publisher_requests', 1],
			[expect.any(String), 'publisher_outcome:rate_limited', 1],
			[expect.any(String), 'loop_error:cleanup', 1],
			[expect.any(String), 'cleanup:expiredSnapshotBodies', 2],
			[expect.any(String), 'cleanup:refreshRequests', 1],
			[expect.any(String), 'cleanup:snapshots', 3],
		]);
	});

	it('reads a fixed counter allowlist and ignores sensitive or unknown Redis fields', async () => {
		const redis = {
			hgetall: vi.fn().mockResolvedValue({
				publisher_requests: '12',
				'publisher_outcome:success': '9',
				'publisher_outcome:https://private.example/feed': '500',
				'user_id:secret-user': '100',
			}),
		};

		const counters = await readDurableIngestionCounters(redis as never);
		expect(counters.publisher_requests).toBe(12);
		expect(counters['publisher_outcome:success']).toBe(9);
		expect(counters).not.toHaveProperty('publisher_outcome:https://private.example/feed');
		expect(counters).not.toHaveProperty('user_id:secret-user');
	});
});
