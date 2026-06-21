import { loginSchema, registerSchema } from '@self-feed/shared';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { getEnv } from '../config/index.js';
import { AppError } from '../middleware/errors.js';
import type { AuthService } from '../services/auth.service.js';
import { enforceRateLimit, RATE_LIMITS, type RateLimiter } from '../utils/index.js';
import { parseBody } from '../utils/validation.js';

const COOKIE_NAME = 'rss_refresh_token';
const REFRESH_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const COOKIE_OPTIONS = {
	httpOnly: true,
	secure: process.env.NODE_ENV === 'production',
	sameSite: 'strict' as const,
	path: '/api/v1/auth',
	maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
};

function deriveDeviceName(userAgent?: string | null) {
	const ua = userAgent ?? '';
	if (/SelfFeed Android/i.test(ua)) return 'Android app';
	if (/Android/i.test(ua)) return 'Android device';
	if (/iPhone|iPad|Mobile/i.test(ua)) return 'Mobile browser';
	if (/Firefox/i.test(ua)) return 'Firefox';
	if (/Edg/i.test(ua)) return 'Microsoft Edge';
	if (/Chrome/i.test(ua)) return 'Chrome';
	if (/Safari/i.test(ua)) return 'Safari';
	return 'Web browser';
}

function getClientIp(c: Context) {
	if (!getEnv().TRUST_PROXY) {
		return null;
	}

	const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
	if (forwarded) return forwarded;
	const realIp = c.req.header('x-real-ip')?.trim();
	if (realIp) return realIp;
	return c.req.header('cf-connecting-ip')?.trim() ?? null;
}

function getSessionMetadata(c: Context) {
	const userAgent = c.req.header('user-agent') ?? null;
	const explicitName = c.req.header('x-self-feed-device-name')?.trim();
	return {
		clientId: c.req.header('x-self-feed-client-id') ?? null,
		deviceName: explicitName || deriveDeviceName(userAgent),
		userAgent,
		ipAddress: getClientIp(c),
	};
}

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
		const result = await authService.register(body.email, body.password, getSessionMetadata(c));

		setCookie(c, COOKIE_NAME, result.tokens.refreshToken, COOKIE_OPTIONS);

		return c.json(
			{ data: { user: result.user, tokens: { accessToken: result.tokens.accessToken } } },
			201,
		);
	});

	auth.post('/login', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'auth', RATE_LIMITS.auth);
		const body = await parseBody(c, loginSchema);
		const result = await authService.login(body.email, body.password, getSessionMetadata(c));

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
			const result = await authService.refresh(refreshToken, getSessionMetadata(c));
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

	auth.get('/sessions', authMiddleware, async (c) => {
		const userId = c.get('userId');
		const currentSessionId = c.get('sessionId');
		const sessions = await authService.listSessions(userId, currentSessionId);
		return c.json({ data: { sessions } });
	});

	auth.delete('/sessions/:sessionId', authMiddleware, async (c) => {
		const userId = c.get('userId');
		const currentSessionId = c.get('sessionId');
		const sessionId = c.req.param('sessionId');
		const result = await authService.revokeSession(userId, sessionId);
		if (sessionId === currentSessionId) {
			deleteCookie(c, COOKIE_NAME, { path: '/api/v1/auth' });
		}
		return c.json({ data: result });
	});

	return auth;
}
