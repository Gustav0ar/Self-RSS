export type FeedPipelineMode = 'legacy' | 'v2';

export interface DurableIngestionOperationalSnapshot {
	fetchJobs: {
		queued: number;
		running: number;
		dead: number;
		due: number;
		oldestDueAgeSeconds: number;
		oldestQueuedAgeSeconds: number;
	};
	parseBacklog: number;
	deliveries: {
		pending: number;
		running: number;
		failed: number;
		oldestDueAgeSeconds: number;
	};
	refreshRequests: { active: number; error: number };
	sources: { active: number; backoff: number; paused: number };
	origins: { blocked: number; circuitOpen: number };
}

export interface DurableIngestionCleanupResult {
	expiredSnapshotBodies: number;
	refreshRequests: number;
	fetchJobs: number;
	deliveries: number;
	snapshots: number;
	discoveryCandidates: number;
}

export type DurablePublisherOutcome =
	| 'success'
	| 'not_modified'
	| 'rate_limited'
	| 'http_error'
	| 'network_error'
	| 'aborted'
	| 'oversize';
export type DurableLoopName = 'schedule' | 'fetch' | 'delivery' | 'cleanup';
export type DurableCleanupResource = keyof DurableIngestionCleanupResult;
