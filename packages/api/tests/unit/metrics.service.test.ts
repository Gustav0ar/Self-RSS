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

	it('sets article count by user', async () => {
		metricsService.setArticleCountByUser('user-123', 150);
		metricsService.setArticleCountByUser('user-456', 200);

		const metrics = await metricsService.getMetrics();
		expect(metrics).toContain('articles_total');
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
