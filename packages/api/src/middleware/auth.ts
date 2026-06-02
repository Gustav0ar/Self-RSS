import type { Context, Next } from 'hono';
import type { TokenUtils } from '../utils/tokens.js';
import { AppError } from './errors.js';

export function createAuthMiddleware(tokenUtils: TokenUtils) {
	return async function authMiddleware(c: Context, next: Next) {
		const header = c.req.header('Authorization');
		if (!header?.startsWith('Bearer ')) {
			throw AppError.unauthorized('Missing or invalid authorization header');
		}

		const token = header.slice(7);
		try {
			const payload = await tokenUtils.verifyAccessToken(token);
			if (payload.type !== 'access') {
				throw AppError.unauthorized('Invalid token type');
			}
			c.set('userId', payload.sub);
			c.set('userRole', payload.role);
		} catch (err) {
			if (err instanceof AppError) throw err;
			throw AppError.unauthorized('Invalid or expired token');
		}

		await next();
	};
}

export function requireAdmin(c: Context, next: Next) {
	const role = c.get('userRole') as string;
	if (role !== 'admin') {
		throw AppError.forbidden('Admin access required');
	}
	return next();
}
