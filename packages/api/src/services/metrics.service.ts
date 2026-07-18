import type { Counter, Gauge, Histogram, Registry } from 'prom-client';
import {
	Counter as CounterMetric,
	collectDefaultMetrics,
	Gauge as GaugeMetric,
	Histogram as HistogramMetric,
	register,
} from 'prom-client';
import type {
	DurableCleanupResource,
	DurableIngestionOperationalSnapshot,
	DurableLoopName,
	DurablePublisherOutcome,
	FeedPipelineMode,
} from './durable-ingestion-ops.types.js';

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
	private articleCount: Gauge<string>;
	private articleEnrichmentDuration: Histogram<string>;
	private articleEnrichmentQueueDepth: Gauge<string>;
	private articleEnrichmentTotal: Counter<string>;

	// Durable feed ingestion metrics. Every label has a fixed, bounded vocabulary.
	private durablePipelineMode: Gauge<string>;
	private durableFetchJobs: Gauge<string>;
	private durableOldestDueFetchAge: Gauge<string>;
	private durableOldestQueuedFetchAge: Gauge<string>;
	private durableParseBacklog: Gauge<string>;
	private durableDeliveryBacklog: Gauge<string>;
	private durableOldestDueDeliveryAge: Gauge<string>;
	private durableRefreshRequests: Gauge<string>;
	private durableSources: Gauge<string>;
	private durableOrigins: Gauge<string>;
	private durablePublisherRequests: Counter<string>;
	private durablePublisherOutcomes: Counter<string>;
	private durableLoopErrors: Counter<string>;
	private durableCleanup: Counter<string>;
	private mirroredDurableCounters = new Map<string, number>();

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

		// Aggregate article count. User IDs must never appear in Prometheus labels.
		this.articleCount = new GaugeMetric({
			name: 'articles_total',
			help: 'Total number of articles',
		});

		this.articleEnrichmentDuration = new HistogramMetric({
			name: 'article_enrichment_duration_seconds',
			help: 'Time spent extracting and persisting canonical article content',
			labelNames: ['outcome'],
			buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
		});
		this.articleEnrichmentQueueDepth = new GaugeMetric({
			name: 'article_enrichment_queue_depth',
			help: 'Number of due article enrichment jobs observed by the worker',
		});
		this.articleEnrichmentTotal = new CounterMetric({
			name: 'article_enrichment_total',
			help: 'Canonical article enrichment attempts by outcome',
			labelNames: ['outcome'],
		});

		this.durablePipelineMode = new GaugeMetric({
			name: 'feed_ingestion_pipeline_mode',
			help: 'Selected feed pipeline mode (1 = selected)',
			labelNames: ['mode'],
		});
		this.durableFetchJobs = new GaugeMetric({
			name: 'feed_ingestion_fetch_jobs',
			help: 'Durable fetch jobs by bounded status',
			labelNames: ['status'],
		});
		this.durableOldestDueFetchAge = new GaugeMetric({
			name: 'feed_ingestion_oldest_due_fetch_job_age_seconds',
			help: 'Age of the oldest due queued fetch job',
		});
		this.durableOldestQueuedFetchAge = new GaugeMetric({
			name: 'feed_ingestion_oldest_queued_fetch_job_age_seconds',
			help: 'Age of the oldest queued fetch job, including delayed work',
		});
		this.durableParseBacklog = new GaugeMetric({
			name: 'feed_ingestion_parse_backlog',
			help: 'Snapshots with a retained body awaiting successful parsing',
		});
		this.durableDeliveryBacklog = new GaugeMetric({
			name: 'feed_ingestion_delivery_backlog',
			help: 'Snapshot deliveries by bounded status',
			labelNames: ['status'],
		});
		this.durableOldestDueDeliveryAge = new GaugeMetric({
			name: 'feed_ingestion_oldest_due_delivery_age_seconds',
			help: 'Age of the oldest due pending snapshot delivery',
		});
		this.durableRefreshRequests = new GaugeMetric({
			name: 'feed_ingestion_refresh_requests',
			help: 'Durable refresh requests by bounded status',
			labelNames: ['status'],
		});
		this.durableSources = new GaugeMetric({
			name: 'feed_ingestion_sources',
			help: 'Durable sources by bounded lifecycle state',
			labelNames: ['state'],
		});
		this.durableOrigins = new GaugeMetric({
			name: 'feed_ingestion_origins',
			help: 'Publisher origins by bounded protection state',
			labelNames: ['state'],
		});
		this.durablePublisherRequests = new CounterMetric({
			name: 'feed_ingestion_publisher_requests_total',
			help: 'Actual publisher HTTP requests started by the durable worker',
		});
		this.durablePublisherOutcomes = new CounterMetric({
			name: 'feed_ingestion_publisher_outcomes_total',
			help: 'Actual publisher request outcomes by bounded class',
			labelNames: ['outcome'],
		});
		this.durableLoopErrors = new CounterMetric({
			name: 'feed_ingestion_loop_errors_total',
			help: 'Durable worker loop failures by bounded loop name',
			labelNames: ['loop'],
		});
		this.durableCleanup = new CounterMetric({
			name: 'feed_ingestion_cleanup_total',
			help: 'Durable ingestion rows or payloads cleaned by bounded resource type',
			labelNames: ['resource'],
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

	setArticleCount(count: number) {
		this.articleCount.set(count);
	}

	updateDurableIngestion(mode: FeedPipelineMode, snapshot: DurableIngestionOperationalSnapshot) {
		this.durablePipelineMode.labels('legacy').set(mode === 'legacy' ? 1 : 0);
		this.durablePipelineMode.labels('v2').set(mode === 'v2' ? 1 : 0);
		this.durableFetchJobs.labels('queued').set(snapshot.fetchJobs.queued);
		this.durableFetchJobs.labels('running').set(snapshot.fetchJobs.running);
		this.durableFetchJobs.labels('dead').set(snapshot.fetchJobs.dead);
		this.durableFetchJobs.labels('due').set(snapshot.fetchJobs.due);
		this.durableOldestDueFetchAge.set(snapshot.fetchJobs.oldestDueAgeSeconds);
		this.durableOldestQueuedFetchAge.set(snapshot.fetchJobs.oldestQueuedAgeSeconds);
		this.durableParseBacklog.set(snapshot.parseBacklog);
		this.durableDeliveryBacklog.labels('pending').set(snapshot.deliveries.pending);
		this.durableDeliveryBacklog.labels('running').set(snapshot.deliveries.running);
		this.durableDeliveryBacklog.labels('failed').set(snapshot.deliveries.failed);
		this.durableOldestDueDeliveryAge.set(snapshot.deliveries.oldestDueAgeSeconds);
		this.durableRefreshRequests.labels('active').set(snapshot.refreshRequests.active);
		this.durableRefreshRequests.labels('error').set(snapshot.refreshRequests.error);
		this.durableSources.labels('active').set(snapshot.sources.active);
		this.durableSources.labels('backoff').set(snapshot.sources.backoff);
		this.durableSources.labels('paused').set(snapshot.sources.paused);
		this.durableOrigins.labels('blocked').set(snapshot.origins.blocked);
		this.durableOrigins.labels('circuit_open').set(snapshot.origins.circuitOpen);
	}

	recordDurablePublisherRequest() {
		this.durablePublisherRequests.inc();
	}

	recordDurablePublisherOutcome(outcome: DurablePublisherOutcome) {
		this.durablePublisherOutcomes.labels(outcome).inc();
	}

	recordDurableLoopError(loop: DurableLoopName) {
		this.durableLoopErrors.labels(loop).inc();
	}

	recordDurableCleanup(resource: DurableCleanupResource, count: number) {
		if (count > 0) this.durableCleanup.labels(resource).inc(count);
	}

	syncDurableCounters(counters: Record<string, number>) {
		this.syncMirroredCounter('publisher_requests', counters.publisher_requests, (delta) =>
			this.durablePublisherRequests.inc(delta),
		);
		for (const outcome of [
			'success',
			'not_modified',
			'rate_limited',
			'http_error',
			'network_error',
			'aborted',
			'oversize',
		] as const) {
			this.syncMirroredCounter(
				`publisher_outcome:${outcome}`,
				counters[`publisher_outcome:${outcome}`],
				(delta) => this.durablePublisherOutcomes.labels(outcome).inc(delta),
			);
		}
		for (const loop of ['schedule', 'fetch', 'delivery', 'cleanup'] as const) {
			this.syncMirroredCounter(`loop_error:${loop}`, counters[`loop_error:${loop}`], (delta) =>
				this.durableLoopErrors.labels(loop).inc(delta),
			);
		}
		for (const resource of [
			'expiredSnapshotBodies',
			'refreshRequests',
			'fetchJobs',
			'deliveries',
			'snapshots',
			'discoveryCandidates',
		] as const) {
			this.syncMirroredCounter(`cleanup:${resource}`, counters[`cleanup:${resource}`], (delta) =>
				this.durableCleanup.labels(resource).inc(delta),
			);
		}
	}

	private syncMirroredCounter(
		key: string,
		absoluteValue: number | undefined,
		increment: (delta: number) => void,
	) {
		const absolute = Number.isFinite(absoluteValue) ? Math.max(0, absoluteValue ?? 0) : 0;
		const previous = this.mirroredDurableCounters.get(key) ?? 0;
		const delta = absolute >= previous ? absolute - previous : absolute;
		if (delta > 0) increment(delta);
		this.mirroredDurableCounters.set(key, absolute);
	}

	recordArticleEnrichment(outcome: 'success' | 'retry' | 'failed', durationSeconds: number) {
		this.articleEnrichmentDuration.labels(outcome).observe(durationSeconds);
		this.articleEnrichmentTotal.labels(outcome).inc();
	}

	setArticleEnrichmentQueueDepth(depth: number) {
		this.articleEnrichmentQueueDepth.set(depth);
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
		this.articleEnrichmentQueueDepth.set(0);
		this.articleCount.set(0);
		this.durablePipelineMode.reset();
		this.durableFetchJobs.reset();
		this.durableOldestDueFetchAge.set(0);
		this.durableOldestQueuedFetchAge.set(0);
		this.durableParseBacklog.set(0);
		this.durableDeliveryBacklog.reset();
		this.durableOldestDueDeliveryAge.set(0);
		this.durableRefreshRequests.reset();
		this.durableSources.reset();
		this.durableOrigins.reset();
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
