// Timing constants
export const REFRESH_INTERVALS = {
	// SSE drives sync progress. These are low-frequency safety reconciliations
	// for a disconnected stream or a rare missed event.
	SYNC_STATUS_FALLBACK_MS: 30_000,
	SYNC_STATUS_CONNECTED_FALLBACK_MS: 60_000,
	SYNC_STATUS_BACKGROUND_POLL_MS: 30_000,
	SYNC_STATUS_FOREGROUND_TIMEOUT_MS: 75_000,
	SYNC_STATUS_MAX_MONITOR_MS: 5 * 60_000 + 30_000,
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
