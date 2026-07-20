import type { FeedIngestionRepository } from '../repositories/feed-ingestion.repository.js';
import { MANUAL_REFRESH_REQUEST_MAX_AGE_MS } from './durable-refresh-queue.js';
import { MIN_SOURCE_INTERVAL_SECONDS } from './feed-publisher-hints.js';

export class DurableFeedScheduler {
	constructor(
		private repository: FeedIngestionRepository,
		private options: { batchSize?: number; jitter?: () => number } = {},
	) {}

	async tick(now = new Date()) {
		await this.repository.expireStaleManualRefreshRequests(now, MANUAL_REFRESH_REQUEST_MAX_AGE_MS);
		const sample = Math.max(0, Math.min(1, this.options.jitter?.() ?? 0));
		const jitterSeconds = Math.ceil(sample * MIN_SOURCE_INTERVAL_SECONDS);
		return this.repository.enqueueDueSources(this.options.batchSize ?? 100, now, jitterSeconds);
	}
}
