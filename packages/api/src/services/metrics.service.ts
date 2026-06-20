import type { Counter, Histogram, Gauge, Registry } from 'prom-client';
import {
	collectDefaultMetrics,
	Counter as CounterMetric,
	Histogram as HistogramMetric,
	Gauge as GaugeMetric,
	register,
} from 'prom-client';

// Track if default metrics have been collected
let defaultMetricsCollected = false;

// Application-specific metrics
export class MetricsService {
	// HTTP metrics
	private httpRequestDuration: Histogram<string>;
	private httpRequestTotal: Counter<string>;

	// SSE metrics
	private sseConnectionsGauge: Gauge<string>;

	// Database metrics
	private dbPoolActive: Gauge<string>;
	private dbPoolIdle: Gauge<string>;
	private dbPoolTotal: Gauge<string>;

	// Redis metrics
	private redisConnected: Gauge<string>;
	private redisCommandDuration: Histogram<string>;

	// Feed sync metrics
	private feedSyncRunning: Gauge<string>;
	private feedSyncPending: Gauge<string>;
	private feedSyncFailed: Gauge<string>;

	// Cache metrics
	private cacheHitTotal: Counter<string>;
	private cacheMissTotal: Counter<string>;
	private cacheHitsGauge: Gauge<string>;
	private cacheMissesGauge: Gauge<string>;

	// Article metrics
	private articleCountByUser: Gauge<string>;

	// Registry reference
	public readonly registry: Registry = register;

	constructor() {
		// HTTP request duration histogram
		this.httpRequestDuration = new HistogramMetric({
			name: 'http_request_duration_seconds',
			help: 'Duration of HTTP requests in seconds',
			labelNames: ['method', 'route', 'status_code'],
			buckets: [0.001, 0.005, 0.015, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
		});

		// HTTP request counter
		this.httpRequestTotal = new CounterMetric({
			name: 'http_requests_total',
			help: 'Total number of HTTP requests',
			labelNames: ['method', 'route', 'status_code'],
		});

		// SSE connections gauge
		this.sseConnectionsGauge = new GaugeMetric({
			name: 'sse_connections_active',
			help: 'Number of active SSE connections',
		});

		// Database pool gauges
		this.dbPoolActive = new GaugeMetric({
			name: 'db_pool_active_connections',
			help: 'Number of active database connections',
		});

		this.dbPoolIdle = new GaugeMetric({
			name: 'db_pool_idle_connections',
			help: 'Number of idle database connections',
		});

		this.dbPoolTotal = new GaugeMetric({
			name: 'db_pool_total_connections',
			help: 'Total number of database connections in pool',
		});

		// Redis gauges
		this.redisConnected = new GaugeMetric({
			name: 'redis_connected',
			help: 'Redis connection status (1 = connected, 0 = disconnected)',
		});

		this.redisCommandDuration = new HistogramMetric({
			name: 'redis_command_duration_seconds',
			help: 'Duration of Redis commands in seconds',
			buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
		});

		// Feed sync gauges
		this.feedSyncRunning = new GaugeMetric({
			name: 'feed_sync_running',
			help: 'Number of feeds currently syncing',
		});

		this.feedSyncPending = new GaugeMetric({
			name: 'feed_sync_pending',
			help: 'Number of feeds pending sync',
		});

		this.feedSyncFailed = new GaugeMetric({
			name: 'feed_sync_failed',
			help: 'Number of feeds in error state',
		});

		// Cache hit/miss counters
		this.cacheHitTotal = new CounterMetric({
			name: 'cache_hits_total',
			help: 'Total number of cache hits',
		});

		this.cacheMissTotal = new CounterMetric({
			name: 'cache_misses_total',
			help: 'Total number of cache misses',
		});

		// Cache hit/miss gauges (for current values)
		this.cacheHitsGauge = new GaugeMetric({
			name: 'cache_hits',
			help: 'Number of cache hits (current window)',
			labelNames: ['cache_type'],
		});

		this.cacheMissesGauge = new GaugeMetric({
			name: 'cache_misses',
			help: 'Number of cache misses (current window)',
			labelNames: ['cache_type'],
		});

		// Article count by user
		this.articleCountByUser = new GaugeMetric({
			name: 'articles_total',
			help: 'Total number of articles per user',
			labelNames: ['user_id'],
		});

		// Collect default Node.js metrics only once
		if (!defaultMetricsCollected) {
			collectDefaultMetrics({ register });
			defaultMetricsCollected = true;
		}
	}

	// Record HTTP request
	recordHttpRequest(method: string, route: string, statusCode: number, durationSeconds: number) {
		const labels = { method, route, status_code: statusCode.toString() };
		this.httpRequestDuration.observe(labels, durationSeconds);
		this.httpRequestTotal.inc(labels);
	}

	// Set SSE connection count
	setSseConnections(count: number) {
		this.sseConnectionsGauge.set(count);
	}

	// Update SSE connections (increment/decrement)
	incrementSseConnections() {
		this.sseConnectionsGauge.inc();
	}

	decrementSseConnections() {
		this.sseConnectionsGauge.dec();
	}

	// Update database pool stats
	updateDbPoolStats(active: number, idle: number, total: number) {
		this.dbPoolActive.set(active);
		this.dbPoolIdle.set(idle);
		this.dbPoolTotal.set(total);
	}

	// Update Redis connection status
	setRedisConnected(connected: boolean) {
		this.redisConnected.set(connected ? 1 : 0);
	}

	// Record Redis command duration
	recordRedisCommand(durationSeconds: number) {
		this.redisCommandDuration.observe(durationSeconds);
	}

	// Update feed sync status counts
	updateFeedSyncStatus(running: number, pending: number, failed: number) {
		this.feedSyncRunning.set(running);
		this.feedSyncPending.set(pending);
		this.feedSyncFailed.set(failed);
	}

	// Record cache hit
	recordCacheHit(cacheType: string) {
		this.cacheHitTotal.inc();
		this.cacheHitsGauge.labels(cacheType).inc();
	}

	// Record cache miss
	recordCacheMiss(cacheType: string) {
		this.cacheMissTotal.inc();
		this.cacheMissesGauge.labels(cacheType).inc();
	}

	// Update article count for a user
	setArticleCountByUser(userId: string, count: number) {
		this.articleCountByUser.labels(userId).set(count);
	}

	// Remove user from article metrics
	removeUserArticleCount(userId: string) {
		this.articleCountByUser.remove(userId);
	}

	// Get all metrics as string
	async getMetrics(): Promise<string> {
		return this.registry.metrics();
	}

	// Get content type for metrics
	getContentType(): string {
		return this.registry.contentType;
	}

	// Reset all custom metrics to zero (useful for testing)
	// Note: This clears values but keeps the metric definitions
	reset() {
		// Clear only the values of our custom metrics
		// The default metrics from collectDefaultMetrics persist in the registry
		// We only reset our custom counters/gauges
		this.sseConnectionsGauge.set(0);
		this.redisConnected.set(0);
		this.feedSyncRunning.set(0);
		this.feedSyncPending.set(0);
		this.feedSyncFailed.set(0);
		// Note: We don't reset counters as they can only be incremented
		// For counters, a full registry reset is needed between test suites
	}
}

// Singleton instance
let metricsServiceInstance: MetricsService | null = null;

export function getMetricsService(): MetricsService {
	if (!metricsServiceInstance) {
		metricsServiceInstance = new MetricsService();
	}
	return metricsServiceInstance;
}

export function resetMetricsService(): void {
	if (metricsServiceInstance) {
		metricsServiceInstance.reset();
		metricsServiceInstance = null;
	}
	// Reset the flag so new instances can re-collect defaults if needed
	defaultMetricsCollected = false;
}
