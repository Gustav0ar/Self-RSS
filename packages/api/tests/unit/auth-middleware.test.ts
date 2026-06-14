import type { Context, Next } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createAuthMiddleware, requireAdmin } from '../../src/middleware/auth.js';
import { AppError } from '../../src/middleware/errors.js';

function makeContext(authorizationHeader: string | undefined): Context {
	const headers = new Headers();
	if (authorizationHeader) {
		headers.set('Authorization', authorizationHeader);
	}
	const store = new Map<string, unknown>();
	return {
		req: { header: (name: string) => headers.get(name) ?? undefined },
		set: (key: string, value: unknown) => {
			store.set(key, value);
		},
		get: (key: string) => store.get(key),
	} as unknown as Context;
}

describe('createAuthMiddleware', () => {
	it('rejects requests without an Authorization header', async () => {
		const middleware = createAuthMiddleware({} as never);
		const c = makeContext(undefined);
		const next = vi.fn() as unknown as Next;

		await expect(middleware(c, next)).rejects.toBeInstanceOf(AppError);
		await expect(middleware(c, next)).rejects.toMatchObject({ statusCode: 401 });
	});

	it('rejects non-Bearer schemes', async () => {
		const middleware = createAuthMiddleware({} as never);
		const c = makeContext('Basic abc');
		const next = vi.fn() as unknown as Next;

		await expect(middleware(c, next)).rejects.toMatchObject({ statusCode: 401 });
	});

	it('rejects tokens of the wrong type', async () => {
		const tokenUtils = {
			verifyAccessToken: vi.fn().mockResolvedValue({ sub: 'user-1', type: 'refresh' }),
		} as never;
		const middleware = createAuthMiddleware(tokenUtils);
		const c = makeContext('Bearer good');
		const next = vi.fn() as unknown as Next;

		await expect(middleware(c, next)).rejects.toMatchObject({
			code: 'UNAUTHORIZED',
			message: 'Invalid token type',
		});
	});

	it('rejects when the underlying verifier throws and never reaches the handler', async () => {
		const tokenUtils = {
			verifyAccessToken: vi.fn().mockRejectedValue(new Error('signature mismatch')),
		} as never;
		const middleware = createAuthMiddleware(tokenUtils);
		const c = makeContext('Bearer bad');
		const next = vi.fn() as unknown as Next;

		await expect(middleware(c, next)).rejects.toMatchObject({ statusCode: 401 });
		expect(next).not.toHaveBeenCalled();
	});

	it('sets userId and userRole on the context for a valid access token', async () => {
		const tokenUtils = {
			verifyAccessToken: vi
				.fn()
				.mockResolvedValue({ sub: 'user-1', type: 'access', role: 'admin' }),
		} as never;
		const middleware = createAuthMiddleware(tokenUtils);
		const c = makeContext('Bearer good');
		const next = vi.fn() as unknown as Next;

		await middleware(c, next);

		expect(c.get('userId')).toBe('user-1');
		expect(c.get('userRole')).toBe('admin');
		expect(next).toHaveBeenCalled();
	});
});

describe('requireAdmin', () => {
	it('lets admin users through', async () => {
		const c = {
			get: (key: string) => (key === 'userRole' ? 'admin' : undefined),
		} as unknown as Context;
		const next = vi.fn(async () => undefined) as unknown as Next;

		await requireAdmin(c, next);
		expect(next).toHaveBeenCalled();
	});

	it('rejects non-admin users with a 403', async () => {
		const c = { get: () => 'user' } as unknown as Context;
		const next = vi.fn(async () => undefined) as unknown as Next;

		await expect(Promise.resolve().then(() => requireAdmin(c, next))).rejects.toMatchObject({
			code: 'FORBIDDEN',
			statusCode: 403,
		});
		expect(next).not.toHaveBeenCalled();
	});

	it('rejects when no role has been set on the context', async () => {
		const c = { get: () => undefined } as unknown as Context;
		const next = vi.fn(async () => undefined) as unknown as Next;

		await expect(Promise.resolve().then(() => requireAdmin(c, next))).rejects.toMatchObject({
			statusCode: 403,
		});
	});
});
