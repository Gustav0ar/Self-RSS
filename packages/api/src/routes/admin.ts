import { adminCreateUserSchema, updateAppSettingsSchema } from '@self-feed/shared';
import { Hono } from 'hono';
import type {
	AppSettingsRepository,
	AuditLogRepository,
} from '../repositories/settings.repository.js';
import type { AuthService } from '../services/auth.service.js';
import { createLogger } from '../utils/logger.js';
import { parseBody } from '../utils/validation.js';

export function createAdminRoutes(
	authService: AuthService,
	settingsRepo: AppSettingsRepository,
	auditLogRepo: AuditLogRepository,
) {
	const admin = new Hono();

	admin.get('/settings', async (c) => {
		const settings = await settingsRepo.get();
		return c.json({
			data: { registrationLocked: settings.registrationLocked },
		});
	});

	admin.patch('/settings', async (c) => {
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

	return admin;
}
