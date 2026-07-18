import type { AppDeps } from '../config/deps.js';
import { DurableFeedScheduler } from '../services/durable-feed-scheduler.js';
import { DurableFeedWorker } from '../services/durable-feed-worker.js';
import { runNonOverlappingLoop } from '../services/durable-worker-loop.js';
import { FeedSnapshotDeliveryService } from '../services/feed-snapshot-delivery.service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('durable-feed-runtime');

export function selectFeedPipelineWorkers(mode: 'legacy' | 'v2') {
	return mode === 'v2'
		? { legacyPublisherWorkers: false, durablePublisherWorkers: true }
		: { legacyPublisherWorkers: true, durablePublisherWorkers: false };
}

export function startDurableIngestionRuntime(
	deps: AppDeps,
	options: {
		timeoutMs: number;
		maxContentLength: number;
		concurrency: number;
		allowPrivateHosts: boolean;
		contact?: string;
	},
) {
	const controller = new AbortController();
	const scheduler = new DurableFeedScheduler(deps.repos.feedIngestion, { batchSize: 100 });
	const fetchWorker = new DurableFeedWorker(deps.repos.feedIngestion, {
		networkConcurrency: Math.min(4, options.concurrency),
		requestTimeoutMs: options.timeoutMs,
		maxBodyBytes: options.maxContentLength,
		allowPrivateHosts: options.allowPrivateHosts,
		contact: options.contact,
		handleDiscovery: (input) => deps.services.durableFeed.persistDiscoveryCandidates(input),
	});
	const deliveryWorker = new FeedSnapshotDeliveryService(
		deps.repos.feedIngestion,
		deps.repos.article,
		{
			afterCommit: async ({ feedId, userId, insertedArticleIds }) => {
				await deps.services.articleCache.invalidateCache(userId);
				const updatedAt = new Date().toISOString();
				await deps.services.realtime.publishEvent(userId, {
					type: 'feed.health.updated',
					eventId: crypto.randomUUID(),
					feedId,
					severity: 'healthy',
					syncStatus: 'idle',
					lastSyncedAt: updatedAt,
					lastSyncError: null,
					lastSyncErrorAt: null,
					updatedAt,
				});
				if (insertedArticleIds.length > 0) {
					await deps.services.realtime.publishEvent(userId, {
						type: 'articles.new',
						eventId: crypto.randomUUID(),
						feedId,
						articleIds: insertedArticleIds,
						count: insertedArticleIds.length,
						updatedAt,
					});
				}
			},
		},
	);
	const guarded = (name: string, tick: () => Promise<unknown>) => async () => {
		try {
			await tick();
		} catch (error) {
			if (controller.signal.aborted) return;
			logger.error('Durable ingestion cycle failed', {
				cycle: name,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	};
	const loops = [
		runNonOverlappingLoop({
			tick: guarded('schedule', () => scheduler.tick()),
			intervalMs: 30_000,
			signal: controller.signal,
		}),
		runNonOverlappingLoop({
			tick: guarded('fetch', () => fetchWorker.drainOnce(controller.signal)),
			intervalMs: 250,
			signal: controller.signal,
		}),
		runNonOverlappingLoop({
			tick: guarded('delivery', () => deliveryWorker.drainOnce('durable-delivery', { limit: 20 })),
			intervalMs: 250,
			signal: controller.signal,
		}),
		runNonOverlappingLoop({
			tick: guarded('cleanup', async () => {
				await deps.repos.feedIngestion.cleanupExpiredSnapshots();
				await deps.services.durableFeed.cleanupDiscoveryCandidates();
			}),
			intervalMs: 60 * 60 * 1_000,
			signal: controller.signal,
		}),
	];
	logger.info('Durable feed ingestion runtime started');
	return {
		async stop() {
			controller.abort(new DOMException('Worker is shutting down', 'AbortError'));
			await Promise.allSettled(loops);
			logger.info('Durable feed ingestion runtime stopped');
		},
	};
}
