import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getMetricsService, resetMetricsService } from '../../src/services/metrics.service.js';

describe('MetricsService', () => {
	let metricsService: ReturnType<typeof getMetricsService>;

	beforeAll(() => {
		resetMetricsService();
		metricsService = getMetricsService();
	});

	afterAll(() => {
		// Keep singleton for other tests
	});

	it('records HTTP request metrics', async () => {
		metricsService.recordHttpRequest('GET', '/api/v1/articles', 200, 0.05);
		metricsService.recordHttpRequest('POST', '/api/v1/feeds', 201, 0.1);
		metricsService.recordHttpRequest('GET', '/api/v1/articles', 500, 0.01);

		const metrics = await metricsService.getMetrics();

		// Check request duration histogram
		expect(metrics).toContain('http_request_duration_seconds');

		// Check request counter
		expect(metrics).toContain('http_requests_total');
	});

	it('increments and decrements SSE connections', async () => {
		metricsService.setSseConnections(0);

		metricsService.incrementSseConnections();
		metricsService.incrementSseConnections();
		metricsService.incrementSseConnections();

		metricsService.decrementSseConnections();

		const metrics = await metricsService.getMetrics();
		expect(metrics).toContain('sse_connections_active');
	});

	it('updates Redis connection status', async () => {
		metricsService.setRedisConnected(true);
		let metrics = await metricsService.getMetrics();
		expect(metrics).toContain('redis_connected');

		metricsService.setRedisConnected(false);
		metrics = await metricsService.getMetrics();
		expect(metrics).toContain('redis_connected');
	});

	it('updates feed sync status', async () => {
		metricsService.updateFeedSyncStatus(5, 10, 2);

		const metrics = await metricsService.getMetrics();
		expect(metrics).toContain('feed_sync_running');
		expect(metrics).toContain('feed_sync_pending');
		expect(metrics).toContain('feed_sync_failed');
	});

	it('records cache hits and misses', async () => {
		metricsService.recordCacheHit('article_list');
		metricsService.recordCacheHit('article_detail');
		metricsService.recordCacheMiss('article_list');

		const metrics = await metricsService.getMetrics();
		expect(metrics).toContain('cache_hits_total');
		expect(metrics).toContain('cache_misses_total');
	});

	it('sets only an aggregate article count without user labels', async () => {
		metricsService.setArticleCount(350);

		const metrics = await metricsService.getMetrics();
		expect(metrics).toContain('articles_total 350');
		expect(metrics).not.toContain('user-123');
		expect(metrics).not.toContain('user_id');
	});

	it('exports durable queue truth with only bounded, non-sensitive labels', async () => {
		metricsService.updateDurableIngestion('v2', {
			fetchJobs: {
				queued: 7,
				running: 2,
				dead: 3,
				due: 5,
				oldestDueAgeSeconds: 120,
				oldestQueuedAgeSeconds: 300,
			},
			parseBacklog: 4,
			deliveries: { pending: 6, running: 1, failed: 2, oldestDueAgeSeconds: 90 },
			refreshRequests: { active: 3, error: 1 },
			sources: { active: 8, backoff: 2, paused: 1 },
			origins: { blocked: 2, circuitOpen: 1 },
		});
		metricsService.recordDurablePublisherRequest();
		metricsService.recordDurablePublisherOutcome('rate_limited');
		metricsService.recordDurableLoopError('fetch');
		metricsService.recordDurableCleanup('snapshots', 2);

		const metrics = await metricsService.getMetrics();
		expect(metrics).toContain('feed_ingestion_pipeline_mode{mode="v2"} 1');
		expect(metrics).toContain('feed_ingestion_fetch_jobs{status="queued"} 7');
		expect(metrics).toContain('feed_ingestion_fetch_jobs{status="due"} 5');
		expect(metrics).toContain('feed_ingestion_parse_backlog 4');
		expect(metrics).toContain('feed_ingestion_delivery_backlog{status="failed"} 2');
		expect(metrics).toContain('feed_ingestion_sources{state="backoff"} 2');
		expect(metrics).toContain('feed_ingestion_origins{state="circuit_open"} 1');
		expect(metrics).toContain('feed_ingestion_publisher_requests_total 1');
		expect(metrics).toContain('feed_ingestion_publisher_outcomes_total{outcome="rate_limited"} 1');
		expect(metrics).toContain('feed_ingestion_loop_errors_total{loop="fetch"} 1');
		expect(metrics).toContain('feed_ingestion_cleanup_total{resource="snapshots"} 2');
		expect(metrics).not.toContain('publisher.example.com');
		expect(metrics).not.toContain('https://');
		expect(metrics).not.toContain('user_id');
	});

	it('keeps mirrored counters monotonic while counting Redis resets from zero', async () => {
		const publisherRequests = async () => {
			const metrics = await metricsService.getMetrics();
			const line = metrics
				.split('\n')
				.find((candidate) => candidate.startsWith('feed_ingestion_publisher_requests_total '));
			return Number(line?.split(' ')[1]);
		};
		metricsService.syncDurableCounters({ publisher_requests: 5 });
		const beforeReset = await publisherRequests();
		metricsService.syncDurableCounters({ publisher_requests: 1 });
		expect(await publisherRequests()).toBe(beforeReset + 1);
	});

	it('returns prometheus content type', () => {
		const contentType = metricsService.getContentType();
		expect(contentType).toContain('text/plain');
		expect(contentType).toContain('version=');
	});

	it('includes default Node.js metrics', async () => {
		const metrics = await metricsService.getMetrics();
		// Default metrics include process CPU, memory, etc.
		expect(metrics).toContain('process_cpu');
		expect(metrics).toContain('process_resident_memory');
	});
});
