import type Redis from 'ioredis';
import { CacheKeys } from '../db/redis.js';
import type {
	DurableCleanupResource,
	DurableIngestionCleanupResult,
	DurableLoopName,
	DurablePublisherOutcome,
} from './durable-ingestion-ops.types.js';
import type { MetricsService } from './metrics.service.js';

const publisherOutcomes = [
	'success',
	'not_modified',
	'rate_limited',
	'http_error',
	'network_error',
	'aborted',
	'oversize',
] as const;
const loopNames = ['schedule', 'fetch', 'delivery', 'cleanup'] as const;
const cleanupResources = [
	'expiredSnapshotBodies',
	'refreshRequests',
	'fetchJobs',
	'deliveries',
	'snapshots',
	'discoveryCandidates',
] as const;

export class DurableIngestionTelemetry {
	constructor(
		private readonly metrics: MetricsService,
		private readonly redis?: Redis,
	) {}

	recordPublisherRequest() {
		this.metrics.recordDurablePublisherRequest();
		this.increment('publisher_requests');
	}

	recordPublisherOutcome(outcome: DurablePublisherOutcome) {
		this.metrics.recordDurablePublisherOutcome(outcome);
		this.increment(`publisher_outcome:${outcome}`);
	}

	recordLoopError(loop: DurableLoopName) {
		this.metrics.recordDurableLoopError(loop);
		this.increment(`loop_error:${loop}`);
	}

	recordCleanup(result: DurableIngestionCleanupResult) {
		for (const resource of cleanupResources) {
			const count = result[resource];
			if (count <= 0) continue;
			this.metrics.recordDurableCleanup(resource, count);
			this.increment(`cleanup:${resource}`, count);
		}
	}

	private increment(field: string, count = 1) {
		if (!this.redis || count <= 0) return;
		void this.redis
			.hincrby(CacheKeys.durableIngestionCounters(), field, count)
			.catch(() => undefined);
	}
}

export async function readDurableIngestionCounters(redis: Redis) {
	const stored = await redis.hgetall(CacheKeys.durableIngestionCounters());
	const fields = [
		'publisher_requests',
		...publisherOutcomes.map((outcome) => `publisher_outcome:${outcome}`),
		...loopNames.map((loop) => `loop_error:${loop}`),
		...cleanupResources.map((resource) => `cleanup:${resource}`),
	];
	return Object.fromEntries(
		fields.map((field) => {
			const value = Number(stored[field]);
			return [field, Number.isFinite(value) && value > 0 ? value : 0];
		}),
	) as Record<string, number>;
}

export type { DurableCleanupResource, DurableLoopName, DurablePublisherOutcome };
