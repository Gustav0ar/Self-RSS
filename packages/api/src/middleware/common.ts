import type { Context, Next } from 'hono';
import { createLogger } from '../utils/logger.js';
import { AppError } from './errors.js';

export async function errorHandler(err: Error, c: Context): Promise<Response> {
	const requestId = c.get('requestId') as string | undefined;
	const logger = createLogger(requestId);

	if (err instanceof AppError) {
		if (err.statusCode >= 500) {
			logger.error(err.message, { code: err.code, stack: err.stack });
		}
		return c.json(
			{
				error: {
					code: err.code,
					message: err.message,
					...(err.details ? { details: err.details } : {}),
				},
			},
			err.statusCode as 400,
		);
	}

	logger.error('Unhandled error', { message: err.message, stack: err.stack });
	return c.json(
		{
			error: {
				code: 'INTERNAL_ERROR',
				message: 'Internal server error',
			},
		},
		500,
	);
}

export async function requestIdMiddleware(c: Context, next: Next): Promise<void> {
	const id = crypto.randomUUID();
	c.set('requestId', id);
	c.header('X-Request-Id', id);
	await next();
}

export async function requestLogger(c: Context, next: Next): Promise<void> {
	const start = performance.now();
	const requestId = c.get('requestId') as string | undefined;
	const logger = createLogger(requestId);

	await next();

	const duration = Math.round(performance.now() - start);
	logger.info(`${c.req.method} ${c.req.path}`, {
		status: c.res.status,
		duration,
	});
}

export async function securityHeaders(c: Context, next: Next): Promise<void> {
	await next();
	c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	c.header('X-Content-Type-Options', 'nosniff');
	c.header('X-Frame-Options', 'DENY');
	c.header('X-XSS-Protection', '0');
	c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
	c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	c.header(
		'Content-Security-Policy',
		[
			"default-src 'self'",
			"script-src 'self'",
			"style-src 'self' 'unsafe-inline'",
			"img-src 'self' https: data:",
			"media-src 'self' https:",
			"font-src 'self'",
			'frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://streamable.com https://videopress.com https://video.wordpress.com https://platform.twitter.com',
			"connect-src 'self'",
			"base-uri 'self'",
			"form-action 'self'",
		].join('; '),
	);
}
