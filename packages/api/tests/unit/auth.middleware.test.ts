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

describe('auth middleware', () => {
	describe('createAuthMiddleware', () => {
		describe('valid JWT parsing', () => {
			it('parses valid access token and sets user context', async () => {
				const tokenUtils = {
					verifyAccessToken: vi.fn().mockResolvedValue({
						sub: 'user-123',
						role: 'admin',
						type: 'access',
						jti: 'unique-id',
					}),
				};
				const middleware = createAuthMiddleware(tokenUtils);
				const c = makeContext('Bearer valid.jwt.token');
				const next = vi.fn() as unknown as Next;

				await middleware(c, next);

				expect(c.get('userId')).toBe('user-123');
				expect(c.get('userRole')).toBe('admin');
				expect(next).toHaveBeenCalledTimes(1);
				expect(tokenUtils.verifyAccessToken).toHaveBeenCalledWith('valid.jwt.token');
			});

			it('handles user with different roles', async () => {
				const tokenUtils = {
					verifyAccessToken: vi.fn().mockResolvedValue({
						sub: 'user-456',
						role: 'moderator',
						type: 'access',
					}),
				};
				const middleware = createAuthMiddleware(tokenUtils);
				const c = makeContext('Bearer token');
				const next = vi.fn() as unknown as Next;

				await middleware(c, next);

				expect(c.get('userId')).toBe('user-456');
				expect(c.get('userRole')).toBe('moderator');
			});
		});

		describe('missing authorization header', () => {
			it('rejects requests without Authorization header', async () => {
				const middleware = createAuthMiddleware({} as never);
				const c = makeContext(undefined);
				const next = vi.fn() as unknown as Next;

				await expect(middleware(c, next)).rejects.toMatchObject({
					code: 'UNAUTHORIZED',
					message: 'Missing or invalid authorization header',
				});
			});

			it('rejects requests with empty Authorization header', async () => {
				const middleware = createAuthMiddleware({} as never);
				const c = makeContext('');
				const next = vi.fn() as unknown as Next;

				await expect(middleware(c, next)).rejects.toMatchObject({
					statusCode: 401,
				});
			});
		});

		describe('invalid authorization format', () => {
			it('rejects non-Bearer schemes like Basic', async () => {
				const middleware = createAuthMiddleware({} as never);
				const c = makeContext('Basic abc123');
				const next = vi.fn() as unknown as Next;

				await expect(middleware(c, next)).rejects.toMatchObject({
					statusCode: 401,
					message: 'Missing or invalid authorization header',
				});
			});

			it('rejects non-Bearer schemes like Digest', async () => {
				const middleware = createAuthMiddleware({} as never);
				const c = makeContext('Digest username="admin"');
				const next = vi.fn() as unknown as Next;

				await expect(middleware(c, next)).rejects.toMatchObject({
					statusCode: 401,
				});
			});

			it('rejects Bearer with empty token', async () => {
				const middleware = createAuthMiddleware({} as never);
				const c = makeContext('Bearer ');
				const next = vi.fn() as unknown as Next;

				// Empty Bearer token should fail at verification stage
				const tokenUtils = {
					verifyAccessToken: vi.fn().mockRejectedValue(new Error('Invalid token')),
				};
				const middlewareWithUtils = createAuthMiddleware(tokenUtils);
				const cWithUtils = makeContext('Bearer ');

				await expect(middlewareWithUtils(cWithUtils, next)).rejects.toMatchObject({
					statusCode: 401,
				});
			});
		});

		describe('invalid JWT handling', () => {
			it('rejects malformed JWTs', async () => {
				const tokenUtils = {
					verifyAccessToken: vi.fn().mockRejectedValue(new Error('Invalid signature')),
				};
				const middleware = createAuthMiddleware(tokenUtils);
				const c = makeContext('Bearer not.a.valid.jwt');
				const next = vi.fn() as unknown as Next;

				await expect(middleware(c, next)).rejects.toMatchObject({
					statusCode: 401,
					message: 'Invalid or expired token',
				});
			});

			it('rejects tokens with invalid signatures', async () => {
				const tokenUtils = {
					verifyAccessToken: vi
						.fn()
						.mockRejectedValue(new Error('signature verification failed')),
				};
				const middleware = createAuthMiddleware(tokenUtils);
				const c = makeContext('Bearer tampered.jwt.here');
				const next = vi.fn() as unknown as Next;

				await expect(middleware(c, next)).rejects.toMatchObject({
					statusCode: 401,
				});
			});

			it('rejects tokens signed with wrong secret', async () => {
				const tokenUtils = {
					verifyAccessToken: vi.fn().mockRejectedValue(new Error('jwt signature mismatch')),
				};
				const middleware = createAuthMiddleware(tokenUtils);
				const c = makeContext('Bearer wrong.secret.token');
				const next = vi.fn() as unknown as Next;

				await expect(middleware(c, next)).rejects.toMatchObject({
					statusCode: 401,
				});
			});

			it('does not call next when JWT is invalid', async () => {
				const tokenUtils = {
					verifyAccessToken: vi.fn().mockRejectedValue(new Error('invalid')),
				};
				const middleware = createAuthMiddleware(tokenUtils);
				const c = makeContext('Bearer invalid');
				const next = vi.fn() as unknown as Next;

				await expect(middleware(c, next)).rejects.toThrow();
				expect(next).not.toHaveBeenCalled();
			});
		});

		describe('expired tokens', () => {
			it('rejects expired access tokens', async () => {
				const tokenUtils = {
					verifyAccessToken: vi.fn().mockRejectedValue(new Error('Token expired')),
				};
				const middleware = createAuthMiddleware(tokenUtils);
				const c = makeContext('Bearer expired.jwt.token');
				const next = vi.fn() as unknown as Next;

				await expect(middleware(c, next)).rejects.toMatchObject({
					statusCode: 401,
					message: 'Invalid or expired token',
				});
			});

			it('does not call next for expired tokens', async () => {
				const tokenUtils = {
					verifyAccessToken: vi.fn().mockRejectedValue(new Error('jwt expired')),
				};
				const middleware = createAuthMiddleware(tokenUtils);
				const c = makeContext('Bearer expired.jwt');
				const next = vi.fn() as unknown as Next;

				await expect(middleware(c, next)).rejects.toThrow();
				expect(next).not.toHaveBeenCalled();
			});
		});

		describe('token type validation', () => {
			it('rejects refresh tokens when expecting access tokens', async () => {
				const tokenUtils = {
					verifyAccessToken: vi
						.fn()
						.mockResolvedValue({ sub: 'user-1', type: 'refresh', role: 'admin' }),
				};
				const middleware = createAuthMiddleware(tokenUtils);
				const c = makeContext('Bearer refresh.token.here');
				const next = vi.fn() as unknown as Next;

				await expect(middleware(c, next)).rejects.toMatchObject({
					code: 'UNAUTHORIZED',
					message: 'Invalid token type',
				});
			});

			it('does not call next when token type is invalid', async () => {
				const tokenUtils = {
					verifyAccessToken: vi
						.fn()
						.mockResolvedValue({ sub: 'user-1', type: 'unknown', role: 'admin' }),
				};
				const middleware = createAuthMiddleware(tokenUtils);
				const c = makeContext('Bearer unknown.type.token');
				const next = vi.fn() as unknown as Next;

				await expect(middleware(c, next)).rejects.toMatchObject({
					statusCode: 401,
					message: 'Invalid token type',
				});
				expect(next).not.toHaveBeenCalled();
			});
		});

		describe('authorization checks', () => {
			it('allows access token with correct type', async () => {
				const tokenUtils = {
					verifyAccessToken: vi
						.fn()
						.mockResolvedValue({ sub: 'user-1', type: 'access', role: 'user' }),
				};
				const middleware = createAuthMiddleware(tokenUtils);
				const c = makeContext('Bearer access.token');
				const next = vi.fn() as unknown as Next;

				await middleware(c, next);

				expect(next).toHaveBeenCalledTimes(1);
			});
		});
	});

	describe('requireAdmin', () => {
		it('allows admin users to proceed', () => {
			const c = {
				get: (key: string) => (key === 'userRole' ? 'admin' : undefined),
			} as unknown as Context;
			const next = vi.fn(async () => undefined) as unknown as Next;

			requireAdmin(c, next);

			expect(next).toHaveBeenCalledTimes(1);
		});

		it('blocks non-admin users with 403', () => {
			const c = {
				get: (key: string) => (key === 'userRole' ? 'user' : undefined),
			} as unknown as Context;
			const next = vi.fn(async () => undefined) as unknown as Next;

			expect(() => requireAdmin(c, next)).toThrow(AppError);
			expect(next).not.toHaveBeenCalled();
		});

		it('blocks when userRole is undefined', () => {
			const c = {
				get: () => undefined,
			} as unknown as Context;
			const next = vi.fn(async () => undefined) as unknown as Next;

			expect(() => requireAdmin(c, next)).toThrow(AppError);
			expect(next).not.toHaveBeenCalled();
		});

		it('blocks when userRole is empty string', () => {
			const c = {
				get: () => '',
			} as unknown as Context;
			const next = vi.fn(async () => undefined) as unknown as Next;

			expect(() => requireAdmin(c, next)).toThrow(AppError);
		});

		it('blocks moderator users', () => {
			const c = {
				get: (key: string) => (key === 'userRole' ? 'moderator' : undefined),
			} as unknown as Context;
			const next = vi.fn(async () => undefined) as unknown as Next;

			expect(() => requireAdmin(c, next)).toThrow(AppError);
		});
	});
});
