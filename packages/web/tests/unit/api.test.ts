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
		vi.unstubAllGlobals();
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
			vi.stubGlobal('fetch', fetchMock);

			await apiFetch('/test');

			const calls = fetchMock.mock.calls as unknown[][];
			const requestInit = calls[0]?.[1] as RequestInit | undefined;
			const headers = (requestInit?.headers ?? {}) as Record<string, string>;
			expect(headers.Authorization).toBe('Bearer my-access-token');
		});

		it('includes X-Self-Feed-Client-Id header on every request', async () => {
			const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
			vi.stubGlobal('fetch', fetchMock);

			await apiFetch('/test');

			const calls = fetchMock.mock.calls as unknown[][];
			const requestInit = calls[0]?.[1] as RequestInit | undefined;
			const headers = (requestInit?.headers ?? {}) as Record<string, string>;
			expect(headers['X-Self-Feed-Client-Id']).toBeTruthy();
		});

		it('does not include Authorization header when no token is set', async () => {
			const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
			vi.stubGlobal('fetch', fetchMock);

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
			vi.stubGlobal('fetch', fetchMock);

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
			vi.stubGlobal('fetch', fetchMock);

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
			vi.stubGlobal('fetch', fetchMock);

			await expect(apiFetch('/test')).rejects.toThrow();
			expect(fetchMock).toHaveBeenCalledTimes(2); // 1st attempt + failed refresh
		});
	});

	describe('request/response handling', () => {
		it('sends requests to the correct API base path', async () => {
			const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
			vi.stubGlobal('fetch', fetchMock);

			await apiFetch('/feeds');

			const calls = fetchMock.mock.calls as unknown[][];
			const url = (calls[0]?.[0] as string | undefined) ?? '';
			expect(url).toContain('/api/v1/feeds');
		});

		it('parses JSON response correctly', async () => {
			const fetchMock = vi.fn(
				async () => new Response('{"data":{"id":"1","name":"Test"}}', { status: 200 }),
			);
			vi.stubGlobal('fetch', fetchMock);

			const result = await apiFetch<{ data: { id: string; name: string } }>('/test');

			expect(result.data.id).toBe('1');
			expect(result.data.name).toBe('Test');
		});

		it('includes credentials in requests', async () => {
			const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
			vi.stubGlobal('fetch', fetchMock);

			await apiFetch('/test');

			const calls = fetchMock.mock.calls as unknown[][];
			const requestInit = calls[0]?.[1] as RequestInit | undefined;
			expect(requestInit?.credentials).toBe('include');
		});

		it('apiDownload returns blob and filename from Content-Disposition', async () => {
			const fetchMock = vi.fn(async () => {
				const headers = new Headers();
				headers.set('Content-Disposition', 'attachment; filename="test.pdf"');
				return new Response(new Blob(['test'], { type: 'application/pdf' }), {
					headers,
					status: 200,
				});
			});
			vi.stubGlobal('fetch', fetchMock);

			const result = await apiDownload('/download');

			expect(result.blob).toBeInstanceOf(Blob);
			expect(result.filename).toBe('test.pdf');
		});

		it('apiDownload returns null filename when Content-Disposition is missing', async () => {
			const fetchMock = vi.fn(async () => new Response(new Blob(['test']), { status: 200 }));
			vi.stubGlobal('fetch', fetchMock);

			const result = await apiDownload('/download');

			expect(result.filename).toBeNull();
		});

		it('sets Content-Type to application/json by default', async () => {
			const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
			vi.stubGlobal('fetch', fetchMock);

			await apiFetch('/test');

			const calls = fetchMock.mock.calls as unknown[][];
			const requestInit = calls[0]?.[1] as RequestInit | undefined;
			const headers = (requestInit?.headers ?? {}) as Record<string, string>;
			expect(headers['Content-Type']).toBe('application/json');
		});

		it('does not override Content-Type when body is FormData', async () => {
			const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
			vi.stubGlobal('fetch', fetchMock);
			const formData = new FormData();

			await apiFetch('/upload', { body: formData });

			const calls = fetchMock.mock.calls as unknown[][];
			const requestInit = calls[0]?.[1] as RequestInit | undefined;
			const headers = (requestInit?.headers ?? {}) as Record<string, string>;
			expect(headers['Content-Type']).toBeUndefined();
		});

		it('preserves custom headers passed to apiFetch', async () => {
			const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
			vi.stubGlobal('fetch', fetchMock);

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
			vi.stubGlobal('fetch', fetchMock);

			await expect(apiFetch('/test')).rejects.toThrow('Resource not found');
		});

		it('throws generic error when response body has no error message', async () => {
			const fetchMock = vi.fn(async () => new Response('', { status: 500 }));
			vi.stubGlobal('fetch', fetchMock);

			await expect(apiFetch('/test')).rejects.toThrow('API error: 500');
		});

		it('throws generic error when response body is not valid JSON', async () => {
			const fetchMock = vi.fn(async () => new Response('not json', { status: 400 }));
			vi.stubGlobal('fetch', fetchMock);

			await expect(apiFetch('/test')).rejects.toThrow('API error: 400');
		});

		it('apiDownload throws error on non-ok response', async () => {
			const fetchMock = vi.fn(
				async () => new Response('{"error":{"message":"Download failed"}}', { status: 500 }),
			);
			vi.stubGlobal('fetch', fetchMock);

			await expect(apiDownload('/download')).rejects.toThrow('Download failed');
		});

		it('refreshAccessToken returns false on network error', async () => {
			const fetchMock = vi.fn(async () => {
				throw new Error('Network failure');
			});
			vi.stubGlobal('fetch', fetchMock);

			const result = await refreshAccessToken();

			expect(result).toBe(false);
		});
	});

	describe('refresh token deduplication', () => {
		it('returns the same promise when refresh is already in progress', async () => {
			let resolveRefresh: ((value: boolean) => void) | null = null;
			let callCount = 0;
			const fetchMock = vi.fn(async () => {
				callCount++;
				if (callCount === 1) {
					return new Promise((resolve) => {
						resolveRefresh = resolve;
					});
				}
				return new Response('', { status: 401 });
			});
			vi.stubGlobal('fetch', fetchMock);

			const promise1 = refreshAccessToken();
			const _promise2 = refreshAccessToken();

			// Give a tick for the second call to resolve
			await new Promise((r) => setTimeout(r, 0));

			// Verify only one fetch call was made (deduplication worked)
			expect(callCount).toBe(1);

			resolveRefresh!(true);
			await promise1;
		});
	});
});
