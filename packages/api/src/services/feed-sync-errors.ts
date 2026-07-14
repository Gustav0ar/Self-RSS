export interface SyncErrorDetails {
	error: string;
	stack?: string;
	status?: number;
	statusText?: string;
	url?: string;
}

export class FeedSyncFetchError extends Error {
	constructor(readonly details: SyncErrorDetails) {
		super(details.error);
		this.name = 'FeedSyncFetchError';
	}
}

export function getSyncErrorDetails(error: unknown): SyncErrorDetails {
	if (error instanceof FeedSyncFetchError) return error.details;
	if (error instanceof Error) {
		if (error.name === 'AbortError') {
			return {
				error: 'The feed server timed out before returning a response',
				stack: error.stack,
			};
		}
		if (error instanceof TypeError && /fetch|network|socket|dns/i.test(error.message)) {
			return {
				error: `Network error while contacting the feed server: ${error.message}`,
				stack: error.stack,
			};
		}
		return { error: error.message, stack: error.stack };
	}

	if (typeof Response !== 'undefined' && error instanceof Response) {
		const statusText = error.statusText || 'Unknown status';
		return {
			error: `HTTP ${error.status}: ${statusText}`,
			status: error.status,
			statusText,
			...(error.url ? { url: error.url } : {}),
		};
	}

	if (error && typeof error === 'object') {
		const responseLike = error as { status?: unknown; statusText?: unknown; url?: unknown };
		if (typeof responseLike.status === 'number') {
			const statusText =
				typeof responseLike.statusText === 'string' && responseLike.statusText
					? responseLike.statusText
					: 'Unknown status';
			return {
				error: `HTTP ${responseLike.status}: ${statusText}`,
				status: responseLike.status,
				statusText,
				...(typeof responseLike.url === 'string' && responseLike.url
					? { url: responseLike.url }
					: {}),
			};
		}
	}

	return { error: String(error) };
}

export function normalizeSyncThrowable(error: unknown, details: SyncErrorDetails): Error {
	return error instanceof Error ? error : new Error(details.error);
}

export function buildPartialSyncWarning(
	existingWarning: string | null,
	itemFailures: Array<{ error: string }>,
) {
	const itemWarning =
		itemFailures.length > 0
			? `Skipped ${itemFailures.length} malformed article item(s). First error: ${itemFailures[0]?.error.slice(0, 180) ?? 'Unknown item error'}`
			: null;
	const persistedWarning = [existingWarning, itemWarning]
		.filter((warning): warning is string => !!warning)
		.join(' ')
		.trim();
	return { itemWarning, persistedWarning };
}

export function nextFailedSyncRetryAt(pollingIntervalMinutes: number) {
	const retryMinutes = Math.min(15, Math.max(5, pollingIntervalMinutes));
	return new Date(Date.now() + retryMinutes * 60_000);
}
