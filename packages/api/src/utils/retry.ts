import { createLogger } from './logger.js';

const logger = createLogger();

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;

export interface RetryOptions {
	maxRetries?: number;
	baseDelayMs?: number;
	maxDelayMs?: number;
}

/**
 * Determines if an error should trigger a retry.
 * Only retries on 5xx errors or network errors, not on 4xx client errors.
 */
export function isRetryableError(error: unknown): boolean {
	if (error instanceof TypeError && error.message.includes('fetch')) {
		// Network errors (DNS failure, connection refused, etc.)
		return true;
	}

	if (error instanceof Error && error.name === 'AbortError') {
		// Request timeout/abort - could be transient
		return true;
	}

	if (error instanceof Response) {
		// Retry on 5xx server errors, not 4xx client errors
		return error.status >= 500;
	}

	// For other errors (including Error instances with status), check if it's a 5xx
	if (
		error instanceof Error &&
		(error.message.includes('HTTP 5') || error.message.includes('status 5'))
	) {
		return true;
	}

	// Retry on unknown errors that might be transient
	if (error instanceof Error && !error.message.includes('HTTP 4')) {
		return true;
	}

	return false;
}

function isClientError(error: unknown): boolean {
	if (error instanceof Response) {
		return error.status >= 400 && error.status < 500;
	}
	if (error instanceof Error) {
		const msg = error.message.toLowerCase();
		return (
			msg.includes('http 4') ||
			msg.includes('status 4') ||
			msg.includes('not found') ||
			msg.includes('bad request') ||
			msg.includes('forbidden') ||
			msg.includes('unauthorized')
		);
	}
	return false;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff.
 *
 * Backoff delays: 0ms (attempt 1), 1000ms (attempt 2), 2000ms (attempt 3), 4000ms (attempt 4)
 *
 * @param fn The function to retry
 * @param options Retry configuration options
 * @param context Optional context for logging (e.g., feedUrl)
 * @returns The result of the function
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	options: RetryOptions = {},
	context?: Record<string, unknown>,
): Promise<T> {
	const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
	const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
	const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

	let lastError: unknown;

	for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;

			// Don't retry on client errors (4xx)
			if (isClientError(error)) {
				logger.debug('Skipping retry due to client error', {
					...context,
					attempt,
					error: error instanceof Error ? error.message : String(error),
				});
				throw error;
			}

			// Check if we should retry
			if (attempt > maxRetries + 1 || !isRetryableError(error)) {
				logger.debug('Not retrying - max attempts reached or non-retryable error', {
					...context,
					attempt,
					error: error instanceof Error ? error.message : String(error),
				});
				throw error;
			}

			// Calculate delay: baseDelayMs * 2^(attempt-2) = 1s, 2s, 4s, ...
			const delayMs = Math.min(baseDelayMs * Math.pow(2, attempt - 2), maxDelayMs);

			logger.info('Retrying after error', {
				...context,
				attempt,
				maxAttempts: maxRetries + 1,
				delayMs,
				error: error instanceof Error ? error.message : String(error),
			});

			await sleep(delayMs);
		}
	}

	throw lastError;
}

/**
 * Creates a retry wrapper for a fetch operation with built-in response handling.
 *
 * @param fetchFn The async fetch function to wrap
 * @param options Retry configuration options
 * @param context Optional context for logging
 * @returns The response from the fetch
 */
export async function fetchWithRetry(
	fetchFn: () => Promise<Response>,
	options: RetryOptions = {},
	context?: Record<string, unknown>,
): Promise<Response> {
	return withRetry(async () => {
		const response = await fetchFn();

		// Check for retryable HTTP status codes
		if (response.status >= 500) {
			throw response;
		}

		// Don't retry on client errors
		if (response.status >= 400 && response.status < 500) {
			throw response;
		}

		return response;
	}, options, context);
}
