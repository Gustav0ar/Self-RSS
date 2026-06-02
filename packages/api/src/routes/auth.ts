import { loginSchema, registerSchema } from '@self-feed/shared';
import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { getEnv } from '../config/index.js';
import { AppError } from '../middleware/errors.js';
import type { AuthService } from '../services/auth.service.js';
import { enforceRateLimit, RATE_LIMITS, type RateLimiter } from '../utils/index.js';
import { parseBody } from '../utils/validation.js';

const COOKIE_NAME = 'rss_refresh_token';
const COOKIE_OPTIONS = {
	httpOnly: true,
	secure: process.env.NODE_ENV === 'production',
	sameSite: 'strict' as const,
	path: '/api/v1/auth',
	maxAge: 7 * 24 * 60 * 60, // 7 days
};

export function createAuthRoutes(
	authService: AuthService,
	authMiddleware: MiddlewareHandler,
	rateLimiter: RateLimiter,
) {
	const auth = new Hono();

	auth.get('/registration-status', async (c) => {
		const status = await authService.getRegistrationStatus();
		return c.json({ data: status });
	});

	auth.post('/register', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'auth', RATE_LIMITS.auth);
		if (!getEnv().ALLOW_REGISTRATION) {
			throw AppError.forbidden('Registration is disabled.');
		}
		const body = await parseBody(c, registerSchema);
		const result = await authService.register(body.email, body.password);

		setCookie(c, COOKIE_NAME, result.tokens.refreshToken, COOKIE_OPTIONS);

		return c.json(
			{ data: { user: result.user, tokens: { accessToken: result.tokens.accessToken } } },
			201,
		);
	});

	auth.post('/login', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'auth', RATE_LIMITS.auth);
		const body = await parseBody(c, loginSchema);
		const result = await authService.login(body.email, body.password);

		setCookie(c, COOKIE_NAME, result.tokens.refreshToken, COOKIE_OPTIONS);

		return c.json({
			data: { user: result.user, tokens: { accessToken: result.tokens.accessToken } },
		});
	});

	auth.post('/logout', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'auth', RATE_LIMITS.auth);
		const refreshToken = getCookie(c, COOKIE_NAME);
		if (refreshToken) {
			await authService.logout(refreshToken);
		}
		deleteCookie(c, COOKIE_NAME, { path: '/api/v1/auth' });
		return c.json({ data: { success: true } });
	});

	auth.post('/refresh', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'auth', RATE_LIMITS.auth);
		const refreshToken = getCookie(c, COOKIE_NAME);
		if (!refreshToken) {
			throw AppError.unauthorized('No refresh token provided');
		}

		try {
			const result = await authService.refresh(refreshToken);
			setCookie(c, COOKIE_NAME, result.tokens.refreshToken, COOKIE_OPTIONS);
			return c.json({ data: { tokens: { accessToken: result.tokens.accessToken } } });
		} catch (err) {
			deleteCookie(c, COOKIE_NAME, { path: '/api/v1/auth' });
			throw err;
		}
	});

	auth.get('/me', authMiddleware, async (c) => {
		const userId = c.get('userId');
		const user = await authService.getCurrentUser(userId);
		return c.json({ data: user });
	});

	return auth;
}
