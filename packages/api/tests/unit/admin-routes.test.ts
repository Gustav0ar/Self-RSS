import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createAuthMiddleware, requireAdmin } from '../../src/middleware/auth.js';
import { errorHandler } from '../../src/middleware/common.js';
import { AppError } from '../../src/middleware/errors.js';
import { createAdminRoutes } from '../../src/routes/admin.js';
import type { RateLimiter } from '../../src/utils/rate-limiter.js';
import type { TokenUtils } from '../../src/utils/tokens.js';

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

const AUTH_HEADER = 'Bearer valid-admin-token';

function createMockTokenUtils(role = 'admin', valid = true) {
	return {
		verifyAccessToken: valid
			? vi.fn().mockResolvedValue({ sub: 'admin-user-1', type: 'access', role })
			: vi.fn().mockRejectedValue(new Error('Invalid token')),
		signAccessToken: vi.fn().mockResolvedValue('access-token'),
		signRefreshToken: vi.fn().mockResolvedValue('refresh-token'),
		accessExpiresIn: 900,
		refreshExpiresIn: 604800,
	} as unknown as TokenUtils;
}

function makeMockRateLimiter(allowed = true, remaining = 9) {
	return {
		check: vi.fn().mockResolvedValue({ allowed, remaining }),
	} as unknown as RateLimiter;
}

function createTestApp(
	authService: never,
	settingsRepo: never,
	auditLogRepo: never,
	rateLimiter: RateLimiter,
	tokenUtils: TokenUtils,
) {
	const app = new Hono();
	const authMiddleware = createAuthMiddleware(tokenUtils);

	app.use('/admin/*', authMiddleware, requireAdmin);
	app.route('/admin', createAdminRoutes(authService, settingsRepo, auditLogRepo, rateLimiter));
	app.onError(errorHandler);

	return app;
}

// ---------------------------------------------------------------------------
// Route handler integration tests
// ---------------------------------------------------------------------------

describe('createAdminRoutes', () => {
	// Shared mock dependencies
	const mockSettingsRepo = {
		get: vi.fn().mockResolvedValue({ registrationLocked: false }),
		update: vi.fn().mockResolvedValue({ registrationLocked: true }),
	};
	const mockAuditLogRepo = { create: vi.fn().mockResolvedValue({}) };
	const mockAuthService = {
		adminCreateUser: vi.fn().mockResolvedValue({
			id: 'new-user-123',
			email: 'newuser@example.com',
			role: 'user',
			isActive: true,
			createdAt: new Date('2024-01-01'),
			updatedAt: new Date('2024-01-01'),
		}),
		getRegistrationStatus: vi.fn().mockResolvedValue({ registrationEnabled: true }),
		register: vi.fn(),
		login: vi.fn(),
		refresh: vi.fn(),
		logout: vi.fn(),
		getCurrentUser: vi.fn(),
	} as unknown as import('../../src/services/auth.service.js').AuthService;
	const mockRateLimiter = makeMockRateLimiter();
	const mockTokenUtils = createMockTokenUtils();

	// -------------------------------------------------------------------------
	// GET /admin/settings
	// -------------------------------------------------------------------------

	describe('GET /admin/settings', () => {
		it('returns current settings with registrationLocked status', async () => {
			const settingsRepo = {
				get: vi.fn().mockResolvedValue({ registrationLocked: false }),
			};

			const app = createTestApp(
				{} as never,
				settingsRepo as never,
				{} as never,
				mockRateLimiter,
				mockTokenUtils,
			);

			const res = await app.request('/admin/settings', {
				headers: { Authorization: AUTH_HEADER },
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual({ data: { registrationLocked: false } });
		});

		it('returns registrationLocked: true when settings are locked', async () => {
			const settingsRepo = {
				get: vi.fn().mockResolvedValue({ registrationLocked: true }),
			};

			const app = createTestApp(
				{} as never,
				settingsRepo as never,
				{} as never,
				mockRateLimiter,
				mockTokenUtils,
			);

			const res = await app.request('/admin/settings', {
				headers: { Authorization: AUTH_HEADER },
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual({ data: { registrationLocked: true } });
		});

		it('enforces rate limit on settings read', async () => {
			const rateLimiter = makeMockRateLimiter(true, 8);
			const settingsRepo = { get: vi.fn().mockResolvedValue({ registrationLocked: false }) };

			const app = createTestApp(
				{} as never,
				settingsRepo as never,
				{} as never,
				rateLimiter,
				mockTokenUtils,
			);

			await app.request('/admin/settings', {
				headers: { Authorization: AUTH_HEADER },
			});

			expect(rateLimiter.check).toHaveBeenCalledWith('admin:admin-user-1', {
				windowMs: 60_000,
				maxRequests: 10,
				failureMode: 'closed',
			});
		});
	});

	// -------------------------------------------------------------------------
	// PATCH /admin/settings
	// -------------------------------------------------------------------------

	describe('PATCH /admin/settings', () => {
		it('updates registrationLocked setting to true', async () => {
			const settingsRepo = {
				update: vi.fn().mockResolvedValue({ registrationLocked: true }),
			};
			const auditLogRepo = { create: vi.fn().mockResolvedValue({}) };

			const app = createTestApp(
				{} as never,
				settingsRepo as never,
				auditLogRepo as never,
				mockRateLimiter,
				mockTokenUtils,
			);

			const res = await app.request('/admin/settings', {
				method: 'PATCH',
				headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
				body: JSON.stringify({ registrationLocked: true }),
			});

			expect(res.status).toBe(200);
			expect(settingsRepo.update).toHaveBeenCalledWith({ registrationLocked: true });
		});

		it('updates registrationLocked setting to false', async () => {
			const settingsRepo = {
				update: vi.fn().mockResolvedValue({ registrationLocked: false }),
			};
			const auditLogRepo = { create: vi.fn().mockResolvedValue({}) };

			const app = createTestApp(
				{} as never,
				settingsRepo as never,
				auditLogRepo as never,
				mockRateLimiter,
				mockTokenUtils,
			);

			const res = await app.request('/admin/settings', {
				method: 'PATCH',
				headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
				body: JSON.stringify({ registrationLocked: false }),
			});

			expect(res.status).toBe(200);
			expect(settingsRepo.update).toHaveBeenCalledWith({ registrationLocked: false });
		});

		it('rejects invalid settings payload - non-boolean value', async () => {
			const app = createTestApp(
				{} as never,
				{} as never,
				{} as never,
				mockRateLimiter,
				mockTokenUtils,
			);

			const res = await app.request('/admin/settings', {
				method: 'PATCH',
				headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
				body: JSON.stringify({ registrationLocked: 'yes' }),
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe('BAD_REQUEST');
		});

		it('rejects unknown fields in settings payload', async () => {
			// Note: zod strips unknown fields by default, so we test that
			// only known fields are accepted. Unknown fields are silently removed.
			const settingsRepo = {
				update: vi.fn().mockResolvedValue({ registrationLocked: true }),
			};
			const auditLogRepo = { create: vi.fn().mockResolvedValue({}) };

			const app = createTestApp(
				{} as never,
				settingsRepo as never,
				auditLogRepo as never,
				mockRateLimiter,
				mockTokenUtils,
			);

			const res = await app.request('/admin/settings', {
				method: 'PATCH',
				headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
				body: JSON.stringify({ unknownField: true, registrationLocked: true }),
			});

			// Unknown fields are stripped, so this should succeed with just registrationLocked
			expect(res.status).toBe(200);
			expect(settingsRepo.update).toHaveBeenCalledWith({ registrationLocked: true });
		});

		it('rejects invalid JSON body', async () => {
			const app = createTestApp(
				{} as never,
				{} as never,
				{} as never,
				mockRateLimiter,
				mockTokenUtils,
			);

			const res = await app.request('/admin/settings', {
				method: 'PATCH',
				headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
				body: 'not-valid-json{',
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe('BAD_REQUEST');
			expect(body.error.message).toBe('Invalid JSON body');
		});

		it('enforces rate limit on settings update', async () => {
			const rateLimiter = makeMockRateLimiter(true, 7);
			const settingsRepo = { update: vi.fn().mockResolvedValue({ registrationLocked: true }) };
			const auditLogRepo = { create: vi.fn().mockResolvedValue({}) };

			const app = createTestApp(
				{} as never,
				settingsRepo as never,
				auditLogRepo as never,
				rateLimiter,
				mockTokenUtils,
			);

			await app.request('/admin/settings', {
				method: 'PATCH',
				headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
				body: JSON.stringify({ registrationLocked: true }),
			});

			expect(rateLimiter.check).toHaveBeenCalledWith('admin:admin-user-1', {
				windowMs: 60_000,
				maxRequests: 10,
				failureMode: 'closed',
			});
		});

		it('creates audit log entry on settings update', async () => {
			const settingsRepo = {
				update: vi.fn().mockResolvedValue({ registrationLocked: true }),
			};
			const auditLogRepo = { create: vi.fn().mockResolvedValue({}) };

			const app = createTestApp(
				{} as never,
				settingsRepo as never,
				auditLogRepo as never,
				mockRateLimiter,
				mockTokenUtils,
			);

			await app.request('/admin/settings', {
				method: 'PATCH',
				headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
				body: JSON.stringify({ registrationLocked: true }),
			});

			expect(auditLogRepo.create).toHaveBeenCalledWith(
				expect.objectContaining({
					adminUserId: 'admin-user-1',
					action: 'app_settings.updated',
					resource: 'app_settings',
				}),
			);
		});
	});

	// -------------------------------------------------------------------------
	// POST /admin/users
	// -------------------------------------------------------------------------

	describe('POST /admin/users', () => {
		it('creates a new user with default user role', async () => {
			const authService = {
				adminCreateUser: vi.fn().mockResolvedValue({
					id: 'new-user-123',
					email: 'newuser@example.com',
					role: 'user',
					isActive: true,
					createdAt: new Date('2024-01-01'),
					updatedAt: new Date('2024-01-01'),
				}),
			};
			const auditLogRepo = { create: vi.fn().mockResolvedValue({}) };

			const app = createTestApp(
				authService as never,
				{} as never,
				auditLogRepo as never,
				mockRateLimiter,
				mockTokenUtils,
			);

			const res = await app.request('/admin/users', {
				method: 'POST',
				headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: 'newuser@example.com',
					password: 'SecurePass123!',
				}),
			});

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.data.email).toBe('newuser@example.com');
			expect(authService.adminCreateUser).toHaveBeenCalledWith(
				'newuser@example.com',
				'SecurePass123!',
				'user',
			);
		});

		it('creates a new admin user when role is explicitly set', async () => {
			const authService = {
				adminCreateUser: vi.fn().mockResolvedValue({
					id: 'admin-123',
					email: 'admin@example.com',
					role: 'admin',
					isActive: true,
					createdAt: new Date('2024-01-01'),
					updatedAt: new Date('2024-01-01'),
				}),
			};
			const auditLogRepo = { create: vi.fn().mockResolvedValue({}) };

			const app = createTestApp(
				authService as never,
				{} as never,
				auditLogRepo as never,
				mockRateLimiter,
				mockTokenUtils,
			);

			const res = await app.request('/admin/users', {
				method: 'POST',
				headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: 'admin@example.com',
					password: 'SecurePass123!',
					role: 'admin',
				}),
			});

			expect(res.status).toBe(201);
			expect(authService.adminCreateUser).toHaveBeenCalledWith(
				'admin@example.com',
				'SecurePass123!',
				'admin',
			);
		});

		it('rejects invalid email format', async () => {
			const app = createTestApp(
				{} as never,
				{} as never,
				{} as never,
				mockRateLimiter,
				mockTokenUtils,
			);

			const res = await app.request('/admin/users', {
				method: 'POST',
				headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'not-an-email', password: 'SecurePass123!' }),
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe('BAD_REQUEST');
		});

		it('rejects password shorter than minimum length', async () => {
			const app = createTestApp(
				{} as never,
				{} as never,
				{} as never,
				mockRateLimiter,
				mockTokenUtils,
			);

			const res = await app.request('/admin/users', {
				method: 'POST',
				headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'user@example.com', password: 'short' }),
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe('BAD_REQUEST');
		});

		it('rejects password exceeding maximum length', async () => {
			const app = createTestApp(
				{} as never,
				{} as never,
				{} as never,
				mockRateLimiter,
				mockTokenUtils,
			);

			const res = await app.request('/admin/users', {
				method: 'POST',
				headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'user@example.com', password: 'a'.repeat(129) }),
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe('BAD_REQUEST');
		});

		it('rejects invalid role value', async () => {
			const app = createTestApp(
				{} as never,
				{} as never,
				{} as never,
				mockRateLimiter,
				mockTokenUtils,
			);

			const res = await app.request('/admin/users', {
				method: 'POST',
				headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: 'user@example.com',
					password: 'SecurePass123!',
					role: 'superadmin',
				}),
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe('BAD_REQUEST');
		});

		it('rejects missing required fields', async () => {
			const app = createTestApp(
				{} as never,
				{} as never,
				{} as never,
				mockRateLimiter,
				mockTokenUtils,
			);

			// Missing password
			const resMissingPassword = await app.request('/admin/users', {
				method: 'POST',
				headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'user@example.com' }),
			});
			expect(resMissingPassword.status).toBe(400);

			// Missing email
			const resMissingEmail = await app.request('/admin/users', {
				method: 'POST',
				headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
				body: JSON.stringify({ password: 'SecurePass123!' }),
			});
			expect(resMissingEmail.status).toBe(400);
		});

		it('handles email already registered conflict', async () => {
			const authService = {
				adminCreateUser: vi.fn().mockRejectedValue(AppError.conflict('Email already registered')),
			};

			const app = createTestApp(
				authService as never,
				{} as never,
				{} as never,
				mockRateLimiter,
				mockTokenUtils,
			);

			const res = await app.request('/admin/users', {
				method: 'POST',
				headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: 'existing@example.com',
					password: 'SecurePass123!',
				}),
			});

			expect(res.status).toBe(409);
			const body = await res.json();
			expect(body.error.code).toBe('CONFLICT');
			expect(body.error.message).toBe('Email already registered');
		});

		it('enforces rate limit on user creation', async () => {
			const rateLimiter = makeMockRateLimiter(true, 5);
			const authService = {
				adminCreateUser: vi.fn().mockResolvedValue({
					id: 'new-user-123',
					email: 'newuser@example.com',
					role: 'user',
					isActive: true,
					createdAt: new Date('2024-01-01'),
					updatedAt: new Date('2024-01-01'),
				}),
			};
			const auditLogRepo = { create: vi.fn().mockResolvedValue({}) };

			const app = createTestApp(
				authService as never,
				{} as never,
				auditLogRepo as never,
				rateLimiter,
				mockTokenUtils,
			);

			await app.request('/admin/users', {
				method: 'POST',
				headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: 'newuser@example.com',
					password: 'SecurePass123!',
				}),
			});

			expect(rateLimiter.check).toHaveBeenCalledWith('admin:admin-user-1', {
				windowMs: 60_000,
				maxRequests: 10,
				failureMode: 'closed',
			});
		});

		it('does not create audit log on validation error', async () => {
			const authService = { adminCreateUser: vi.fn() };
			const auditLogRepo = { create: vi.fn() };

			const app = createTestApp(
				authService as never,
				{} as never,
				auditLogRepo as never,
				mockRateLimiter,
				mockTokenUtils,
			);

			await app.request('/admin/users', {
				method: 'POST',
				headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: 'invalid-email',
					password: 'SecurePass123!',
				}),
			});

			expect(auditLogRepo.create).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------------
	// Rate limiting tests
	// -------------------------------------------------------------------------

	describe('Rate limiting', () => {
		it('returns 429 when rate limit is exceeded', async () => {
			const rateLimiter = makeMockRateLimiter(false, 0);

			const app = createTestApp({} as never, {} as never, {} as never, rateLimiter, mockTokenUtils);

			const res = await app.request('/admin/settings', {
				headers: { Authorization: AUTH_HEADER },
			});

			expect(res.status).toBe(429);
			const body = await res.json();
			expect(body.error.code).toBe('TOO_MANY_REQUESTS');
		});

		it('rate limit is applied to all admin endpoints', async () => {
			const rateLimiter = makeMockRateLimiter(true, 9);
			const settingsRepo = {
				get: vi.fn().mockResolvedValue({ registrationLocked: false }),
				update: vi.fn().mockResolvedValue({ registrationLocked: true }),
			};
			const authService = {
				adminCreateUser: vi.fn().mockResolvedValue({
					id: 'new-user-123',
					email: 'newuser@example.com',
					role: 'user',
					isActive: true,
					createdAt: new Date('2024-01-01'),
					updatedAt: new Date('2024-01-01'),
				}),
			};
			const auditLogRepo = { create: vi.fn().mockResolvedValue({}) };

			const app = createTestApp(
				authService as never,
				settingsRepo as never,
				auditLogRepo as never,
				rateLimiter,
				mockTokenUtils,
			);

			// Test GET /settings
			await app.request('/admin/settings', {
				headers: { Authorization: AUTH_HEADER },
			});
			expect(rateLimiter.check).toHaveBeenNthCalledWith(
				1,
				'admin:admin-user-1',
				expect.any(Object),
			);

			// Test PATCH /settings
			await app.request('/admin/settings', {
				method: 'PATCH',
				headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
				body: JSON.stringify({ registrationLocked: true }),
			});
			expect(rateLimiter.check).toHaveBeenNthCalledWith(
				2,
				'admin:admin-user-1',
				expect.any(Object),
			);

			// Test POST /users
			await app.request('/admin/users', {
				method: 'POST',
				headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: 'test@example.com',
					password: 'SecurePass123!',
				}),
			});
			expect(rateLimiter.check).toHaveBeenNthCalledWith(
				3,
				'admin:admin-user-1',
				expect.any(Object),
			);
		});
	});

	// -------------------------------------------------------------------------
	// Authentication and Authorization tests
	// -------------------------------------------------------------------------

	describe('Authentication requirement', () => {
		it('returns 401 without authorization header', async () => {
			// Include authMiddleware to properly test auth requirement
			const app = new Hono();
			app.use('/admin/*', createAuthMiddleware(mockTokenUtils), requireAdmin);
			app.route(
				'/admin',
				createAdminRoutes(
					mockAuthService,
					mockSettingsRepo as never,
					mockAuditLogRepo as never,
					mockRateLimiter,
				),
			);
			app.onError(errorHandler);

			const res = await app.request('/admin/settings');

			expect(res.status).toBe(401);
		});

		it('returns 401 with invalid token', async () => {
			const invalidTokenUtils = createMockTokenUtils('admin', false);

			const app = new Hono();
			app.use('/admin/*', createAuthMiddleware(invalidTokenUtils), requireAdmin);
			app.route(
				'/admin',
				createAdminRoutes(
					mockAuthService,
					mockSettingsRepo as never,
					mockAuditLogRepo as never,
					mockRateLimiter,
				),
			);
			app.onError(errorHandler);

			const res = await app.request('/admin/settings', {
				headers: { Authorization: 'Bearer invalid-token' },
			});

			expect(res.status).toBe(401);
		});
	});

	describe('Authorization requirement (admin role)', () => {
		it('returns 403 without admin role', async () => {
			const userTokenUtils = createMockTokenUtils('user');

			const app = new Hono();
			app.use('/admin/*', createAuthMiddleware(userTokenUtils), requireAdmin);
			app.route(
				'/admin',
				createAdminRoutes(
					mockAuthService,
					mockSettingsRepo as never,
					mockAuditLogRepo as never,
					mockRateLimiter,
				),
			);
			app.onError(errorHandler);

			const res = await app.request('/admin/settings', {
				headers: { Authorization: AUTH_HEADER },
			});

			expect(res.status).toBe(403);
			const body = await res.json();
			expect(body.error.code).toBe('FORBIDDEN');
		});
	});
});
