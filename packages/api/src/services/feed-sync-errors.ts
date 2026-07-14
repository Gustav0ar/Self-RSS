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
	if (error instanceof Error) return { error: error.message, stack: error.stack };

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
