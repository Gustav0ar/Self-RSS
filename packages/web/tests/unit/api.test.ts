import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	apiDownload,
	apiFetch,
	clearTokens,
	getAccessToken,
	loadTokens,
	refreshAccessToken,
	setTokens,
} from '../../src/lib/api';

describe('api module', () => {
	afterEach(() => {
		clearTokens();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe('setTokens and clearTokens', () => {
		it('stores and retrieves the access token', () => {
			setTokens('test-access-token');
			expect(getAccessToken()).toBe('test-access-token');
		});

		it('clearTokens removes the access token', () => {
			setTokens('test-access-token');
			clearTokens();
			expect(getAccessToken()).toBeNull();
		});

		it('setTokens overwrites the previous token', () => {
			setTokens('first-token');
			setTokens('second-token');
			expect(getAccessToken()).toBe('second-token');
		});

		it('getAccessToken returns null when no token is set', () => {
			expect(getAccessToken()).toBeNull();
		});
	});

	describe('loadTokens', () => {
		it('loadTokens does not throw and does not set a token', () => {
			expect(() => loadTokens()).not.toThrow();
			expect(getAccessToken()).toBeNull();
		});
	});

	describe('auth header inclusion', () => {
		it('includes Authorization header when token is set', async () => {
			setTokens('my-access-token');
			const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await apiFetch('/test');

			const calls = fetchMock.mock.calls as unknown[][];
			const requestInit = calls[0]?.[1] as RequestInit | undefined;
			const headers = (requestInit?.headers ?? {}) as Record<string, string>;
			expect(headers.Authorization).toBe('Bearer my-access-token');
		});

		it('includes X-Self-Feed-Client-Id header on every request', async () => {
			const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await apiFetch('/test');

			const calls = fetchMock.mock.calls as unknown[][];
			const requestInit = calls[0]?.[1] as RequestInit | undefined;
			const headers = (requestInit?.headers ?? {}) as Record<string, string>;
			expect(headers['X-Self-Feed-Client-Id']).toBeTruthy();
		});

		it('includes device metadata headers on refresh requests', async () => {
			const fetchMock = vi.fn(
				async () =>
					new Response('{"data":{"tokens":{"accessToken":"new-token"}}}', { status: 200 }),
			);
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			const refreshed = await refreshAccessToken();

			expect(refreshed).toBe(true);
			const calls = fetchMock.mock.calls as unknown[][];
			const requestInit = calls[0]?.[1] as RequestInit | undefined;
			const headers = (requestInit?.headers ?? {}) as Record<string, string>;
			expect(headers['X-Self-Feed-Client-Id']).toBeTruthy();
			expect(headers['X-Self-Feed-Device-Name']).toMatch(/^Web browser/);
		});

		it('does not include Authorization header when no token is set', async () => {
			const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await apiFetch('/test');

			const calls = fetchMock.mock.calls as unknown[][];
			const requestInit = calls[0]?.[1] as RequestInit | undefined;
			const headers = (requestInit?.headers ?? {}) as Record<string, string>;
			expect(headers.Authorization).toBeUndefined();
		});
	});

	describe('401 response triggers logout', () => {
		it('refreshAccessToken returns false and clears tokens on 401', async () => {
			setTokens('expired-token');
			const fetchMock = vi.fn(async () => new Response('', { status: 401 }));
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			const result = await refreshAccessToken();

			expect(result).toBe(false);
			expect(getAccessToken()).toBeNull();
		});

		it('apiFetch retries after token refresh on 401', async () => {
			setTokens('expired-token');
			let callCount = 0;
			const fetchMock = vi.fn(async () => {
				callCount++;
				if (callCount === 1) {
					return new Response('', { status: 401 });
				}
				return new Response('{"data":{"tokens":{"accessToken":"new-token"}}}', { status: 200 });
			});
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await apiFetch('/test');

			expect(fetchMock).toHaveBeenCalledTimes(3); // 1st attempt + refresh + 2nd attempt
			expect(getAccessToken()).toBe('new-token');
		});

		it('apiFetch does not retry and returns error when refresh fails', async () => {
			setTokens('expired-token');
			let callCount = 0;
			const fetchMock = vi.fn(async () => {
				callCount++;
				if (callCount === 1) {
					return new Response('', { status: 401 });
				}
				return new Response('', { status: 401 });
			});
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await expect(apiFetch('/test')).rejects.toThrow();
			expect(fetchMock).toHaveBeenCalledTimes(2); // 1st attempt + failed refresh
		});
	});

	describe('request/response handling', () => {
		it('sends requests to the correct API base path', async () => {
			const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await apiFetch('/feeds');

			const calls = fetchMock.mock.calls as unknown[][];
			const url = (calls[0]?.[0] as string | undefined) ?? '';
			expect(url).toContain('/api/v1/feeds');
		});

		it('parses JSON response correctly', async () => {
			const fetchMock = vi.fn(
				async () => new Response('{"data":{"id":"1","name":"Test"}}', { status: 200 }),
			);
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			const result = await apiFetch<{ data: { id: string; name: string } }>('/test');

			expect(result.data.id).toBe('1');
			expect(result.data.name).toBe('Test');
		});

		it('includes credentials in requests', async () => {
			const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await apiFetch('/test');

			const calls = fetchMock.mock.calls as unknown[][];
			const requestInit = calls[0]?.[1] as RequestInit | undefined;
			expect(requestInit?.credentials).toBe('include');
		});

		it('apiDownload returns blob and filename from Content-Disposition', async () => {
			// Create a mock response that properly handles blob() calls
			const headers = new Headers();
			headers.set('Content-Disposition', 'attachment; filename="test.pdf"');
			const mockBlob = new Blob(['test'], { type: 'application/pdf' });
			const mockResponse = {
				ok: true,
				status: 200,
				headers,
				blob: async () => mockBlob,
				json: async () => ({}),
			} as unknown as Response;
			const fetchMock = vi.fn(async () => mockResponse);
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			const result = await apiDownload('/download');

			expect(result.blob).toBeInstanceOf(Blob);
			expect(result.filename).toBe('test.pdf');
		});

		it('apiDownload returns null filename when Content-Disposition is missing', async () => {
			const mockBlob = new Blob(['test']);
			const mockResponse = {
				ok: true,
				status: 200,
				headers: new Headers(),
				blob: async () => mockBlob,
				json: async () => ({}),
			} as unknown as Response;
			const fetchMock = vi.fn(async () => mockResponse);
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			const result = await apiDownload('/download');

			expect(result.filename).toBeNull();
		});

		it('sets Content-Type to application/json by default', async () => {
			const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await apiFetch('/test');

			const calls = fetchMock.mock.calls as unknown[][];
			const requestInit = calls[0]?.[1] as RequestInit | undefined;
			const headers = (requestInit?.headers ?? {}) as Record<string, string>;
			expect(headers['Content-Type']).toBe('application/json');
		});

		it('does not override Content-Type when body is FormData', async () => {
			const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
			const formData = new FormData();

			await apiFetch('/upload', { body: formData });

			const calls = fetchMock.mock.calls as unknown[][];
			const requestInit = calls[0]?.[1] as RequestInit | undefined;
			const headers = (requestInit?.headers ?? {}) as Record<string, string>;
			expect(headers['Content-Type']).toBeUndefined();
		});

		it('preserves custom headers passed to apiFetch', async () => {
			const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await apiFetch('/test', {
				headers: { 'X-Custom-Header': 'custom-value' },
			});

			const calls = fetchMock.mock.calls as unknown[][];
			const requestInit = calls[0]?.[1] as RequestInit | undefined;
			const headers = (requestInit?.headers ?? {}) as Record<string, string>;
			expect(headers['X-Custom-Header']).toBe('custom-value');
		});
	});

	describe('error handling', () => {
		it('throws error with message from response body on non-ok response', async () => {
			const fetchMock = vi.fn(
				async () => new Response('{"error":{"message":"Resource not found"}}', { status: 404 }),
			);
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await expect(apiFetch('/test')).rejects.toThrow('Resource not found');
		});

		it('preserves actionable API error details for feed failures', async () => {
			const fetchMock = vi.fn(
				async () =>
					new Response(
						'{"error":{"code":"BAD_GATEWAY","message":"Could not fetch or parse the feed URL","details":"The feed publisher denied access from this server (HTTP 403: Forbidden)"}}',
						{ status: 502 },
					),
			);
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await expect(apiFetch('/test', { method: 'POST' })).rejects.toMatchObject({
				code: 'BAD_GATEWAY',
				status: 502,
				details: 'The feed publisher denied access from this server (HTTP 403: Forbidden)',
				message:
					'Could not fetch or parse the feed URL: The feed publisher denied access from this server (HTTP 403: Forbidden)',
			});
		});

		it('throws generic error when response body has no error message', async () => {
			const fetchMock = vi.fn(async () => new Response('', { status: 500 }));
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await expect(apiFetch('/test')).rejects.toThrow('API error: 500');
		});

		it('throws generic error when response body is not valid JSON', async () => {
			const fetchMock = vi.fn(async () => new Response('not json', { status: 400 }));
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await expect(apiFetch('/test')).rejects.toThrow('API error: 400');
		});

		it('apiDownload throws error on non-ok response', async () => {
			const fetchMock = vi.fn(
				async () => new Response('{"error":{"message":"Download failed"}}', { status: 500 }),
			);
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await expect(apiDownload('/download')).rejects.toThrow('Download failed');
		});

		it('refreshAccessToken returns false on network error', async () => {
			const fetchMock = vi.fn(async () => {
				throw new Error('Network failure');
			});
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			const result = await refreshAccessToken();

			expect(result).toBe(false);
		});
	});

	describe('request cancellation', () => {
		it('does not start a request when the signal is already aborted', async () => {
			const controller = new AbortController();
			controller.abort();
			const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await expect(apiFetch('/test', { signal: controller.signal })).rejects.toMatchObject({
				name: 'AbortError',
			});
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('does not retry when fetch rejects with an abort error', async () => {
			const abortError = new Error('aborted');
			abortError.name = 'AbortError';
			const fetchMock = vi.fn(async () => {
				throw abortError;
			});
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await expect(apiFetch('/test')).rejects.toMatchObject({ name: 'AbortError' });
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it('times out mutations that never settle', async () => {
			vi.useFakeTimers();
			const fetchMock = vi.fn(
				async (_input: RequestInfo | URL, init?: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						const signal = init?.signal;
						signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
					}),
			);
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			const request = apiFetch('/feeds/sync', { method: 'POST' });
			const handledRequest = request.catch((error: unknown) => error);
			await Promise.resolve();

			await vi.advanceTimersByTimeAsync(45_000);

			await expect(handledRequest).resolves.toMatchObject({ name: 'TimeoutError' });
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it('stops retrying when a signal aborts during retry backoff', async () => {
			vi.useFakeTimers();
			const controller = new AbortController();
			const retryResponse = new Response('', { status: 503 });
			const cancel = vi.spyOn(retryResponse.body!, 'cancel');
			const fetchMock = vi.fn(async () => retryResponse);
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			const request = apiFetch('/test', { signal: controller.signal });
			for (let tick = 0; tick < 10 && cancel.mock.calls.length === 0; tick++) {
				await Promise.resolve();
			}
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(cancel).toHaveBeenCalledTimes(1);

			controller.abort();

			await expect(request).rejects.toMatchObject({ name: 'AbortError' });
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});
	});

	describe('refresh token deduplication', () => {
		it('returns the same promise when refresh is already in progress', async () => {
			let resolveRefresh: ((value: Response) => void) | null = null;
			let callCount = 0;
			const fetchMock = vi.fn(async (): Promise<Response> => {
				callCount++;
				if (callCount === 1) {
					return new Promise<Response>((resolve) => {
						resolveRefresh = resolve;
					});
				}
				return new Response('', { status: 401 });
			});
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			const promise1 = refreshAccessToken();
			const promise2 = refreshAccessToken();

			// Give a tick for the second call to resolve
			await new Promise((r) => setTimeout(r, 0));

			// Verify only one fetch call was made (deduplication worked)
			expect(callCount).toBe(1);

			resolveRefresh!(new Response('', { status: 401 }));
			await Promise.all([promise1, promise2]);
		});
	});

	describe('retry with exponential backoff', () => {
		it('releases retriable 500 and 502 response bodies before retrying', async () => {
			const firstResponse = new Response('temporary failure', { status: 500 });
			const secondResponse = new Response('temporary failure', { status: 502 });
			const firstCancel = vi.spyOn(firstResponse.body!, 'cancel');
			const secondCancel = vi.spyOn(secondResponse.body!, 'cancel');
			const fetchMock = vi
				.fn()
				.mockResolvedValueOnce(firstResponse)
				.mockResolvedValueOnce(secondResponse)
				.mockResolvedValueOnce(new Response('{"data":{"result":"success"}}', { status: 200 }));
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			const result = await apiFetch<{ data: { result: string } }>('/feeds');

			expect(result.data.result).toBe('success');
			expect(firstCancel).toHaveBeenCalledTimes(1);
			expect(secondCancel).toHaveBeenCalledTimes(1);
		});

		it('retries safely when a retriable response has no body', async () => {
			const fetchMock = vi
				.fn()
				.mockResolvedValueOnce(new Response(null, { status: 500 }))
				.mockResolvedValueOnce(new Response('{"data":{"result":"success"}}', { status: 200 }));
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			const result = await apiFetch<{ data: { result: string } }>('/feeds');

			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(result.data.result).toBe('success');
		});

		it('preserves retry behavior when response cancellation rejects', async () => {
			const retryResponse = new Response('temporary failure', { status: 500 });
			const cancelError = new Error('stream cancellation failed');
			const cancel = vi.spyOn(retryResponse.body!, 'cancel').mockRejectedValueOnce(cancelError);
			const fetchMock = vi
				.fn()
				.mockResolvedValueOnce(retryResponse)
				.mockResolvedValueOnce(new Response('{"data":{"result":"success"}}', { status: 200 }));
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			const result = await apiFetch<{ data: { result: string } }>('/feeds');

			expect(cancel).toHaveBeenCalledTimes(1);
			expect(result.data.result).toBe('success');
		});

		it('leaves the final retriable response body for apiFetch error parsing', async () => {
			const responses = [500, 502, 503].map(
				(status) =>
					new Response(JSON.stringify({ error: { message: `Request failed with ${status}` } }), {
						status,
					}),
			);
			const cancelSpies = responses.map((response) => vi.spyOn(response.body!, 'cancel'));
			const fetchMock = vi
				.fn()
				.mockResolvedValueOnce(responses[0]!)
				.mockResolvedValueOnce(responses[1]!)
				.mockResolvedValueOnce(responses[2]!);
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await expect(apiFetch('/feeds')).rejects.toThrow('Request failed with 503');

			expect(cancelSpies[0]).toHaveBeenCalledTimes(1);
			expect(cancelSpies[1]).toHaveBeenCalledTimes(1);
			expect(cancelSpies[2]).not.toHaveBeenCalled();
			expect(responses[2]?.bodyUsed).toBe(true);
		});

		it('retries on 5xx responses for GET requests', async () => {
			let callCount = 0;
			const fetchMock = vi.fn(async () => {
				callCount++;
				if (callCount < 3) {
					return new Response('', { status: 503 });
				}
				return new Response('{"data":{"result":"success"}}', { status: 200 });
			});
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			// 300ms initial + 450ms max = ~750ms for retries to complete
			const result = await apiFetch<{ data: { result: string } }>('/feeds');

			expect(callCount).toBe(3);
			expect(result.data.result).toBe('success');
		});

		it('does not retry on 4xx responses for GET requests', async () => {
			const response = new Response('{"error":{"message":"Not found"}}', { status: 404 });
			const cancel = vi.spyOn(response.body!, 'cancel');
			const fetchMock = vi.fn(async () => response);
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await expect(apiFetch('/feeds')).rejects.toThrow('Not found');

			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(cancel).not.toHaveBeenCalled();
			expect(response.bodyUsed).toBe(true);
		});

		it('retries on network errors with backoff', async () => {
			let callCount = 0;
			const fetchMock = vi.fn(async () => {
				callCount++;
				if (callCount < 2) {
					throw new Error('Network failure');
				}
				return new Response('{"data":{"result":"success"}}', { status: 200 });
			});
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			const result = await apiFetch<{ data: { result: string } }>('/feeds');

			expect(callCount).toBe(2);
			expect(result.data.result).toBe('success');
		});

		it('does not retry mutations (POST requests)', async () => {
			let callCount = 0;
			const fetchMock = vi.fn(async () => {
				callCount++;
				return new Response('', { status: 500 });
			});
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await expect(
				apiFetch('/test', { method: 'POST', body: JSON.stringify({}) }),
			).rejects.toThrow();

			expect(callCount).toBe(1);
		});

		it('does not retry mutations (PUT requests)', async () => {
			let callCount = 0;
			const fetchMock = vi.fn(async () => {
				callCount++;
				return new Response('', { status: 503 });
			});
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await expect(
				apiFetch('/test', { method: 'PUT', body: JSON.stringify({}) }),
			).rejects.toThrow();

			expect(callCount).toBe(1);
		});

		it('does not retry mutations (DELETE requests)', async () => {
			let callCount = 0;
			const fetchMock = vi.fn(async () => {
				callCount++;
				return new Response('', { status: 503 });
			});
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await expect(apiFetch('/test', { method: 'DELETE' })).rejects.toThrow();

			expect(callCount).toBe(1);
		});

		it('respects max retry limit and throws after all retries fail', async () => {
			let callCount = 0;
			const fetchMock = vi.fn(async () => {
				callCount++;
				return new Response('', { status: 503 });
			});
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			await expect(apiFetch('/feeds')).rejects.toThrow();

			expect(callCount).toBe(3); // Initial + 2 retries
		});

		it('succeeds on first try without retry', async () => {
			const response = new Response('{"data":{"result":"success"}}', { status: 200 });
			const cancel = vi.spyOn(response.body!, 'cancel');
			const fetchMock = vi.fn(async () => response);
			vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

			const result = await apiFetch<{ data: { result: string } }>('/feeds');

			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(cancel).not.toHaveBeenCalled();
			expect(response.bodyUsed).toBe(true);
			expect(result.data.result).toBe('success');
		});
	});
});
