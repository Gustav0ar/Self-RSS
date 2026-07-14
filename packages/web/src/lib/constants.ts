// Timing constants
export const REFRESH_INTERVALS = {
	SYNC_STATUS_POLL_MS: 750,
	// Long-running syncs stay non-blocking, but completion should still be
	// reflected promptly instead of leaving stale progress visible for tens
	// of seconds after the worker has finished.
	SYNC_STATUS_BACKGROUND_POLL_MS: 5_000,
	SYNC_STATUS_FOREGROUND_TIMEOUT_MS: 75_000,
	ARTICLE_STALE_MS: 30_000,
	CACHE_GC_MS: 5 * 60_000,
	SILENT_REFRESH_MS: 5 * 60_000,
	RECONNECT_MIN_MS: 1_000,
	RECONNECT_MAX_MS: 30_000,
} as const;

// Article limits
export const ARTICLE_LIMITS = {
	WARM_LIMIT: 5,
	DETAIL_WARM_STALE_MS: 60_000,
} as const;
