import { describe, expect, it, vi } from 'vitest';
import { fetchWithRetry, isRetryableError, withRetry } from '../../src/utils/retry.js';

describe('isRetryableError', () => {
	it('returns true for network errors (TypeError)', () => {
		const error = new TypeError('Failed to fetch');
		expect(isRetryableError(error)).toBe(true);
	});

	it('returns true for AbortError', () => {
		const error = new Error('Aborted');
		error.name = 'AbortError';
		expect(isRetryableError(error)).toBe(true);
	});

	it('returns false for feeds that exceed the configured content limit', () => {
		const error = new Error('Feed content exceeds maximum size');
		expect(isRetryableError(error)).toBe(false);
	});

	it('returns true for 5xx HTTP responses', () => {
		const response = new Response('', { status: 500 });
		expect(isRetryableError(response)).toBe(true);
	});

	it('returns true for 503 HTTP responses', () => {
		const response = new Response('Service Unavailable', { status: 503 });
		expect(isRetryableError(response)).toBe(true);
	});

	it('returns false for 4xx HTTP responses', () => {
		const response = new Response('Not Found', { status: 404 });
		expect(isRetryableError(response)).toBe(false);
	});

	it('returns false for 400 HTTP responses', () => {
		const response = new Response('Bad Request', { status: 400 });
		expect(isRetryableError(response)).toBe(false);
	});

	it('returns false for HTTP 4xx error messages', () => {
		const error = new Error('HTTP 404: Not Found');
		expect(isRetryableError(error)).toBe(false);
	});

	it('returns true for HTTP 5xx error messages', () => {
		const error = new Error('HTTP 500: Internal Server Error');
		expect(isRetryableError(error)).toBe(true);
	});

	it('returns true for generic errors that are not 4xx', () => {
		const error = new Error('Connection timeout');
		expect(isRetryableError(error)).toBe(true);
	});
});

describe('withRetry', () => {
	it('succeeds on first attempt and returns result', async () => {
		const fn = vi.fn().mockResolvedValue('success');
		const result = await withRetry(fn, { maxRetries: 3 });
		expect(result).toBe('success');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('retries on failure and succeeds eventually', async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error('Temporary failure'))
			.mockRejectedValueOnce(new Error('Still failing'))
			.mockResolvedValue('success');

		const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1 });
		expect(result).toBe('success');
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it('does not retry on 4xx errors', async () => {
		const error = new Error('HTTP 404: Not Found');
		const fn = vi.fn().mockRejectedValue(error);

		await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow('HTTP 404');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('does not retry on client error Response objects thrown as errors', async () => {
		const notFoundResponse = new Response('Not Found', { status: 404 });
		const fn = vi.fn().mockRejectedValue(notFoundResponse);

		await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow();
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('retries on 5xx errors and eventually fails', async () => {
		const serverErrorResponse = new Response('Server Error', { status: 500 });
		const fn = vi.fn().mockRejectedValue(serverErrorResponse);

		await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow();
		// 3 total attempts: initial + 2 retries
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it('retries on network errors and eventually fails', async () => {
		const fn = vi.fn().mockRejectedValue(new TypeError('Network failure'));

		await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow();
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it('respects maxRetries option', async () => {
		const fn = vi.fn().mockRejectedValue(new Error('Always fails'));

		await expect(withRetry(fn, { maxRetries: 1, baseDelayMs: 1 })).rejects.toThrow();
		// 2 total attempts: initial + 1 retry
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('does not wait after the final failed attempt', async () => {
		const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
		const fn = vi.fn().mockRejectedValue(new Error('Always fails'));

		try {
			await expect(withRetry(fn, { maxRetries: 0, baseDelayMs: 1000 })).rejects.toThrow(
				'Always fails',
			);
			expect(fn).toHaveBeenCalledTimes(1);
			expect(timeoutSpy).not.toHaveBeenCalled();
		} finally {
			timeoutSpy.mockRestore();
		}
	});

	it('includes context in retry logging', async () => {
		const fn = vi.fn().mockRejectedValue(new Error('Temporary failure'));
		const context = { feedUrl: 'https://example.com/feed.xml' };

		await expect(withRetry(fn, { maxRetries: 1, baseDelayMs: 1 }, context)).rejects.toThrow();
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('makes correct number of retry attempts', async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new TypeError('Fail 1'))
			.mockRejectedValueOnce(new TypeError('Fail 2'))
			.mockRejectedValueOnce(new TypeError('Fail 3'))
			.mockResolvedValueOnce('success');

		await withRetry(fn, { maxRetries: 3, baseDelayMs: 1 });

		// 4 attempts: initial + 3 retries
		expect(fn).toHaveBeenCalledTimes(4);
	});
});

describe('fetchWithRetry', () => {
	it('succeeds when fetch returns 200', async () => {
		const mockResponse = new Response('OK', { status: 200 });
		const fetchFn = vi.fn().mockResolvedValue(mockResponse);

		const result = await fetchWithRetry(fetchFn, { maxRetries: 3 });
		expect(result).toBe(mockResponse);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('retries when fetch returns 500', async () => {
		const errorResponse = new Response('Server Error', { status: 500 });
		const successResponse = new Response('OK', { status: 200 });
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(errorResponse)
			.mockResolvedValueOnce(successResponse);

		const result = await fetchWithRetry(fetchFn, { maxRetries: 3, baseDelayMs: 1 });
		expect(result).toBe(successResponse);
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it('does not retry when fetch returns 404', async () => {
		const notFoundResponse = new Response('Not Found', { status: 404 });
		const fetchFn = vi.fn().mockResolvedValue(notFoundResponse);

		await expect(fetchWithRetry(fetchFn, { maxRetries: 3 })).rejects.toThrow();
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('does not retry when fetch returns 400', async () => {
		const badRequestResponse = new Response('Bad Request', { status: 400 });
		const fetchFn = vi.fn().mockResolvedValue(badRequestResponse);

		await expect(fetchWithRetry(fetchFn, { maxRetries: 3 })).rejects.toThrow();
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('retries on network error from fetch', async () => {
		const networkError = new TypeError('Failed to fetch');
		const successResponse = new Response('OK', { status: 200 });
		const fetchFn = vi
			.fn()
			.mockRejectedValueOnce(networkError)
			.mockResolvedValueOnce(successResponse);

		const result = await fetchWithRetry(fetchFn, { maxRetries: 3, baseDelayMs: 1 });
		expect(result).toBe(successResponse);
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it('retries multiple times on persistent 500 errors', async () => {
		const errorResponse = new Response('Server Error', { status: 500 });
		const successResponse = new Response('OK', { status: 200 });
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(errorResponse)
			.mockResolvedValueOnce(errorResponse)
			.mockResolvedValueOnce(successResponse);

		const result = await fetchWithRetry(fetchFn, { maxRetries: 3, baseDelayMs: 1 });
		expect(result).toBe(successResponse);
		expect(fetchFn).toHaveBeenCalledTimes(3);
	});
});

describe('withRetry - exponential backoff logic', () => {
	it('retries with increasing delays for subsequent failures', async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new TypeError('Fail 1'))
			.mockRejectedValueOnce(new TypeError('Fail 2'))
			.mockRejectedValueOnce(new TypeError('Fail 3'))
			.mockResolvedValueOnce('success');

		// maxRetries: 3 with baseDelayMs: 1 - retries happen quickly
		await withRetry(fn, { maxRetries: 3, baseDelayMs: 1 });

		// 4 attempts: initial + 3 retries
		expect(fn).toHaveBeenCalledTimes(4);
	});

	it('uses maxDelayMs cap on backoff', async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new TypeError('Fail 1'))
			.mockResolvedValueOnce('success');

		// Even with large baseDelayMs, maxDelayMs caps the delay
		await withRetry(fn, { maxRetries: 1, baseDelayMs: 1000, maxDelayMs: 100 });

		expect(fn).toHaveBeenCalledTimes(2);
	});
});
