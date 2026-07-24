import {
	adminCreateUserSchema,
	adminResetPasswordSchema,
	adminUpdateUserSchema,
	updateAppSettingsSchema,
} from '@self-feed/shared';
import { Hono } from 'hono';
import type {
	AppSettingsRepository,
	AuditLogRepository,
} from '../repositories/settings.repository.js';
import type { AuthService } from '../services/auth.service.js';
import { createLogger } from '../utils/logger.js';
import { enforceRateLimit, RATE_LIMITS, type RateLimiter } from '../utils/rate-limiter.js';
import { parseBody, parseUuidParam } from '../utils/validation.js';

export function createAdminRoutes(
	authService: AuthService,
	settingsRepo: AppSettingsRepository,
	auditLogRepo: AuditLogRepository,
	rateLimiter: RateLimiter,
) {
	const admin = new Hono();

	admin.get('/users', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'admin', RATE_LIMITS.admin);
		const params = new URL(c.req.url).searchParams;
		const limit = Math.min(100, Math.max(1, Number(params.get('limit') ?? 25) || 25));
		const cursor = params.get('cursor');
		const offset = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
		return c.json({ data: await authService.adminListUsers(limit, offset) });
	});

	admin.get('/settings', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'admin', RATE_LIMITS.admin);
		const settings = await settingsRepo.get();
		return c.json({
			data: { registrationLocked: settings.registrationLocked },
		});
	});

	admin.patch('/settings', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'admin', RATE_LIMITS.admin);
		const body = await parseBody(c, updateAppSettingsSchema);
		const settings = await settingsRepo.update(body);
		await auditLogRepo.create({
			adminUserId: c.get('userId'),
			action: 'app_settings.updated',
			resource: 'app_settings',
			details: body,
		});
		const logger = createLogger(c.get('requestId'));
		logger.info('Admin updated app settings', {
			userId: c.get('userId'),
			changes: body,
		});
		return c.json({
			data: { registrationLocked: settings.registrationLocked },
		});
	});

	admin.post('/users', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'admin', RATE_LIMITS.admin);
		const body = await parseBody(c, adminCreateUserSchema);
		const role = body.role ?? 'user';
		const user = await authService.adminCreateUser(body.email, body.password, role);
		await auditLogRepo.create({
			adminUserId: c.get('userId'),
			action: 'user.created',
			resource: 'users',
			details: { newUserId: user.id, email: user.email, role },
		});
		const logger = createLogger(c.get('requestId'));
		logger.info('Admin created user', {
			adminId: c.get('userId'),
			newUserId: user.id,
			role,
		});
		return c.json({ data: user }, 201);
	});

	admin.patch('/users/:userId', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'admin', RATE_LIMITS.admin);
		const userId = parseUuidParam(c, 'userId');
		const body = await parseBody(c, adminUpdateUserSchema);
		const user = await authService.adminUpdateUser(c.get('userId'), userId, body);
		await auditLogRepo.create({
			adminUserId: c.get('userId'),
			action: 'user.updated',
			resource: 'users',
			details: { userId, changes: body },
		});
		return c.json({ data: user });
	});

	admin.post('/users/:userId/reset-password', async (c) => {
		await enforceRateLimit(c, rateLimiter, 'admin', RATE_LIMITS.admin);
		const userId = parseUuidParam(c, 'userId');
		const body = await parseBody(c, adminResetPasswordSchema);
		const user = await authService.adminResetPassword(userId, body.password);
		await auditLogRepo.create({
			adminUserId: c.get('userId'),
			action: 'user.password_reset',
			resource: 'users',
			details: { userId },
		});
		return c.json({ data: user });
	});

	return admin;
}
