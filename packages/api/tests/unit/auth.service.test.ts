import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearEnvCache } from '../../src/config/env.js';
import { AuthService } from '../../src/services/auth.service.js';
import { hashPassword, verifyPassword } from '../../src/utils/password.js';

const originalEnv = { ...process.env };
type AuthServiceDeps = ConstructorParameters<typeof AuthService>;
const AUTH_LOST_MESSAGE = 'Authentication was lost. Please sign in again.';

function applyEnv(overrides: Record<string, string | undefined>) {
	process.env = {
		...originalEnv,
		DATABASE_URL: 'data/rss.db',
		REDIS_URL: 'redis://localhost:6379',
		JWT_SECRET: 'test-secret-1234567890-32-chars-long-secret',
		JWT_REFRESH_SECRET: 'test-refresh-secret-1234567890-32-chars-long-secret',
		...overrides,
	};
	clearEnvCache();
}

afterEach(() => {
	process.env = { ...originalEnv };
	clearEnvCache();
});

function hashRefreshToken(token: string) {
	return createHash('sha256').update(token).digest('base64url');
}

function createServiceWithMocks(overrides: Partial<Record<string, unknown>> = {}) {
	applyEnv({});
	const userRepo = {
		findById: vi.fn(),
		updatePasswordHash: vi.fn(),
		registerUser: vi.fn(),
		...(overrides.userRepo as Record<string, unknown> | undefined),
	};
	const sessionRepo = {
		create: vi.fn().mockResolvedValue({ id: 'new-session' }),
		findActiveById: vi.fn(),
		rotate: vi.fn(),
		revoke: vi.fn(),
		revokeForUser: vi.fn(),
		listActiveByUserId: vi.fn(),
		...(overrides.sessionRepo as Record<string, unknown> | undefined),
	};
	const settingsRepo = {
		get: vi.fn(),
		...(overrides.settingsRepo as Record<string, unknown> | undefined),
	};
	const tokenUtils = {
		accessExpiresIn: 900,
		signAccessToken: vi.fn(async () => 'new-access-token'),
		verifyRefreshToken: vi.fn(),
		...(overrides.tokenUtils as Record<string, unknown> | undefined),
	};
	const redis = {
		get: vi.fn().mockResolvedValue(null),
		eval: vi.fn().mockResolvedValue(1),
		set: vi.fn(),
		...(overrides.redis as Record<string, unknown> | undefined),
	};

	const service = new AuthService(
		userRepo as unknown as AuthServiceDeps[0],
		sessionRepo as unknown as AuthServiceDeps[1],
		settingsRepo as unknown as AuthServiceDeps[2],
		tokenUtils as unknown as AuthServiceDeps[3],
		redis as unknown as AuthServiceDeps[4],
	);

	return { service, userRepo, sessionRepo, settingsRepo, tokenUtils, redis };
}

describe('AuthService - changePassword', () => {
	const user = {
		id: 'user-1',
		email: 'reader@example.com',
		role: 'user',
		isActive: true,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:00.000Z'),
	};

	it('verifies the current password before changing credentials', async () => {
		const passwordHash = await hashPassword('current-password');
		const { service, userRepo, sessionRepo } = createServiceWithMocks();
		userRepo.findById.mockResolvedValue({ ...user, passwordHash });

		await expect(
			service.changePassword(user.id, 'wrong-password', 'new-password-123'),
		).rejects.toMatchObject({
			statusCode: 400,
			message: 'Current password is incorrect',
		});
		expect(sessionRepo.listActiveByUserId).not.toHaveBeenCalled();
		expect(userRepo.updatePasswordHash).not.toHaveBeenCalled();
	});

	it('revokes old sessions, updates the password, and issues a fresh session', async () => {
		const passwordHash = await hashPassword('current-password');
		const updatedUser = { ...user, updatedAt: new Date('2026-02-01T00:00:00.000Z') };
		const { service, userRepo, sessionRepo, tokenUtils, redis } = createServiceWithMocks();
		userRepo.findById.mockResolvedValue({ ...user, passwordHash });
		userRepo.updatePasswordHash.mockResolvedValue({
			user: updatedUser,
			revokedSessions: [
				{ id: '11111111-1111-4111-8111-111111111111' },
				{ id: '22222222-2222-4222-8222-222222222222' },
			],
		});
		sessionRepo.listActiveByUserId.mockResolvedValue([
			{ id: '11111111-1111-4111-8111-111111111111' },
			{ id: '22222222-2222-4222-8222-222222222222' },
		]);

		const result = await service.changePassword(user.id, 'current-password', 'new-password-123', {
			clientId: 'web-client',
			deviceName: 'Firefox',
		});

		expect(userRepo.updatePasswordHash).toHaveBeenCalledWith(
			user.id,
			expect.any(String),
			passwordHash,
		);
		expect(redis.eval).toHaveBeenCalledWith(
			expect.stringContaining('redis.call("SET", KEYS[1], "1", "EX", ARGV[1])'),
			2,
			'auth:session:revoked:11111111-1111-4111-8111-111111111111',
			'auth:session:active:11111111-1111-4111-8111-111111111111',
			'900',
		);
		const nextPasswordHash = userRepo.updatePasswordHash.mock.calls[0]?.[1] as string;
		await expect(verifyPassword('new-password-123', nextPasswordHash)).resolves.toBe(true);
		expect(sessionRepo.create).toHaveBeenCalledWith(
			expect.objectContaining({ userId: user.id, clientId: 'web-client', deviceName: 'Firefox' }),
			updatedUser,
		);
		expect(tokenUtils.signAccessToken).toHaveBeenCalledWith(user.id, user.role, expect.any(String));
		expect(result).toMatchObject({
			user: { id: user.id },
			tokens: { accessToken: 'new-access-token' },
		});
	});
});

describe('AuthService - getRegistrationStatus', () => {
	it('returns registrationEnabled: false when ALLOW_REGISTRATION env is false', async () => {
		applyEnv({ ALLOW_REGISTRATION: 'false' });

		const userRepo = {
			hasUsers: vi.fn(),
		};
		const settingsRepo = {
			get: vi.fn().mockResolvedValue({ registrationLocked: false }),
		};

		const service = new AuthService(
			userRepo as unknown as AuthServiceDeps[0],
			{} as AuthServiceDeps[1],
			settingsRepo as unknown as AuthServiceDeps[2],
			{} as AuthServiceDeps[3],
			{} as AuthServiceDeps[4],
		);

		const result = await service.getRegistrationStatus();
		expect(result).toEqual({ registrationEnabled: false });
		expect(settingsRepo.get).not.toHaveBeenCalled();
	});

	it('returns registrationEnabled: true when ALLOW_REGISTRATION is true and registrationLocked setting is false', async () => {
		applyEnv({ ALLOW_REGISTRATION: 'true' });

		const userRepo = {
			hasUsers: vi.fn(),
		};
		const settingsRepo = {
			get: vi.fn().mockResolvedValue({ registrationLocked: false }),
		};

		const service = new AuthService(
			userRepo as unknown as AuthServiceDeps[0],
			{} as AuthServiceDeps[1],
			settingsRepo as unknown as AuthServiceDeps[2],
			{} as AuthServiceDeps[3],
			{} as AuthServiceDeps[4],
		);

		const result = await service.getRegistrationStatus();
		expect(result).toEqual({ registrationEnabled: true });
		expect(settingsRepo.get).toHaveBeenCalled();
		expect(userRepo.hasUsers).not.toHaveBeenCalled();
	});

	it('returns registrationEnabled: true when registrationLocked is true but no users exist (bootstrap admin bypass)', async () => {
		applyEnv({ ALLOW_REGISTRATION: 'true' });

		const userRepo = {
			hasUsers: vi.fn().mockResolvedValue(false),
		};
		const settingsRepo = {
			get: vi.fn().mockResolvedValue({ registrationLocked: true }),
		};

		const service = new AuthService(
			userRepo as unknown as AuthServiceDeps[0],
			{} as AuthServiceDeps[1],
			settingsRepo as unknown as AuthServiceDeps[2],
			{} as AuthServiceDeps[3],
			{} as AuthServiceDeps[4],
		);

		const result = await service.getRegistrationStatus();
		expect(result).toEqual({ registrationEnabled: true });
		expect(settingsRepo.get).toHaveBeenCalled();
		expect(userRepo.hasUsers).toHaveBeenCalled();
	});

	it('returns registrationEnabled: false when registrationLocked is true and users already exist', async () => {
		applyEnv({ ALLOW_REGISTRATION: 'true' });

		const userRepo = {
			hasUsers: vi.fn().mockResolvedValue(true),
		};
		const settingsRepo = {
			get: vi.fn().mockResolvedValue({ registrationLocked: true }),
		};

		const service = new AuthService(
			userRepo as unknown as AuthServiceDeps[0],
			{} as AuthServiceDeps[1],
			settingsRepo as unknown as AuthServiceDeps[2],
			{} as AuthServiceDeps[3],
			{} as AuthServiceDeps[4],
		);

		const result = await service.getRegistrationStatus();
		expect(result).toEqual({ registrationEnabled: false });
		expect(settingsRepo.get).toHaveBeenCalled();
		expect(userRepo.hasUsers).toHaveBeenCalled();
	});
});

describe('AuthService - register', () => {
	it('rejects registration before touching settings or users when ALLOW_REGISTRATION is false', async () => {
		applyEnv({ ALLOW_REGISTRATION: 'false' });

		const userRepo = {
			registerUser: vi.fn(),
		};
		const settingsRepo = {
			get: vi.fn(),
		};

		const service = new AuthService(
			userRepo as unknown as AuthServiceDeps[0],
			{} as AuthServiceDeps[1],
			settingsRepo as unknown as AuthServiceDeps[2],
			{} as AuthServiceDeps[3],
			{} as AuthServiceDeps[4],
		);

		await expect(service.register('new@example.com', 'password123')).rejects.toMatchObject({
			code: 'FORBIDDEN',
			statusCode: 403,
			message: 'Registration is disabled.',
		});
		expect(settingsRepo.get).not.toHaveBeenCalled();
		expect(userRepo.registerUser).not.toHaveBeenCalled();
	});
});

describe('AuthService - refresh', () => {
	const sessionId = '11111111-1111-4111-8111-111111111111';
	const refreshToken = `${sessionId}.current-secret`;
	const currentRefreshTokenHash = hashRefreshToken(refreshToken);
	const user = {
		id: 'user-1',
		email: 'reader@example.com',
		role: 'user',
		isActive: true,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:00.000Z'),
	};
	const activeSession = {
		id: sessionId,
		userId: user.id,
		refreshTokenHash: currentRefreshTokenHash,
		clientId: 'web-client',
		deviceName: 'Web browser',
		userAgent: 'test-agent',
		ipAddress: null,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		lastSeenAt: new Date('2026-01-01T00:00:00.000Z'),
		rotatedAt: new Date('2026-01-01T00:00:00.000Z'),
		revokedAt: null,
	};

	it('rotates refresh tokens with a compare-and-swap on the current token hash', async () => {
		const { service, userRepo, sessionRepo, tokenUtils } = createServiceWithMocks();
		userRepo.findById.mockResolvedValue(user);
		sessionRepo.findActiveById.mockResolvedValue(activeSession);
		sessionRepo.rotate.mockResolvedValue(activeSession);

		const result = await service.refresh(refreshToken, {
			clientId: 'web-client',
			deviceName: '  Browser session  ',
			userAgent: 'Test Browser',
			ipAddress: '203.0.113.1',
		});

		expect(result.tokens.accessToken).toBe('new-access-token');
		expect(sessionRepo.rotate).toHaveBeenCalledTimes(1);
		const rotateArgs = sessionRepo.rotate.mock.calls[0];
		expect(rotateArgs?.[0]).toBe(sessionId);
		expect(rotateArgs?.[1]).toBe(currentRefreshTokenHash);
		expect(rotateArgs?.[2]).not.toBe(currentRefreshTokenHash);
		expect(rotateArgs?.[3]).toMatchObject({
			clientId: 'web-client',
			deviceName: 'Browser session',
			userAgent: 'Test Browser',
			ipAddress: '203.0.113.1',
		});
		expect(tokenUtils.signAccessToken).toHaveBeenCalledWith(user.id, user.role, sessionId);
	});

	it('rejects refresh when the token hash is stale before issuing a new access token', async () => {
		const { service, userRepo, sessionRepo, tokenUtils } = createServiceWithMocks();
		userRepo.findById.mockResolvedValue(user);
		sessionRepo.findActiveById.mockResolvedValue(activeSession);
		sessionRepo.rotate.mockResolvedValue(undefined);

		await expect(service.refresh(refreshToken)).rejects.toMatchObject({
			statusCode: 401,
			message: AUTH_LOST_MESSAGE,
		});
		expect(sessionRepo.rotate).toHaveBeenCalledWith(
			sessionId,
			currentRefreshTokenHash,
			expect.any(String),
			expect.objectContaining({ deviceName: 'Unknown device' }),
		);
		expect(tokenUtils.signAccessToken).not.toHaveBeenCalled();
	});
});

describe('AuthService - access session cache', () => {
	const sessionId = '11111111-1111-4111-8111-111111111111';
	const userId = 'user-1';
	const activeSession = {
		id: sessionId,
		userId,
		revokedAt: null,
	};

	it('verifies active sessions against SQLite', async () => {
		const { service, redis, sessionRepo } = createServiceWithMocks();
		sessionRepo.findActiveById.mockResolvedValue(activeSession);

		await expect(service.isAccessSessionActive(userId, sessionId)).resolves.toBe(true);

		expect(redis.get).toHaveBeenNthCalledWith(1, `auth:session:revoked:${sessionId}`);
		expect(redis.get).toHaveBeenNthCalledWith(2, `auth:session:revoked:${sessionId}`);
		expect(sessionRepo.findActiveById).toHaveBeenCalledExactlyOnceWith(sessionId);
	});

	it('rejects a session owned by another user', async () => {
		const { service, sessionRepo } = createServiceWithMocks();
		sessionRepo.findActiveById.mockResolvedValue({ ...activeSession, userId: 'different-user' });

		await expect(service.isAccessSessionActive(userId, sessionId)).resolves.toBe(false);

		expect(sessionRepo.findActiveById).toHaveBeenCalledExactlyOnceWith(sessionId);
	});

	it('rechecks SQLite when Redis reads fail', async () => {
		const { service, redis, sessionRepo } = createServiceWithMocks();
		redis.get.mockRejectedValue(new Error('Redis unavailable'));
		sessionRepo.findActiveById.mockResolvedValue(activeSession);

		await expect(service.isAccessSessionActive(userId, sessionId)).resolves.toBe(true);

		expect(sessionRepo.findActiveById).toHaveBeenCalledWith(sessionId);
		expect(sessionRepo.findActiveById).toHaveBeenCalledTimes(2);
	});

	it('lets a revoked tombstone dominate a stale active cache entry', async () => {
		const { service, redis, sessionRepo } = createServiceWithMocks();
		redis.get.mockResolvedValueOnce('1').mockResolvedValueOnce(userId);

		await expect(service.isAccessSessionActive(userId, sessionId)).resolves.toBe(false);

		expect(redis.get).toHaveBeenCalledTimes(1);
		expect(sessionRepo.findActiveById).not.toHaveBeenCalled();
	});

	it('rejects a tombstone created while a SQLite session read is in flight', async () => {
		let resolveLookup: ((session: typeof activeSession) => void) | undefined;
		const lookup = new Promise<typeof activeSession>((resolve) => {
			resolveLookup = resolve;
		});
		const { service, redis, sessionRepo } = createServiceWithMocks();
		redis.get.mockResolvedValueOnce(null).mockResolvedValue('1');
		sessionRepo.findActiveById.mockReturnValueOnce(lookup).mockResolvedValueOnce(activeSession);
		sessionRepo.revokeForUser.mockResolvedValue(activeSession);

		const validation = service.isAccessSessionActive(userId, sessionId);
		await vi.waitFor(() => expect(sessionRepo.findActiveById).toHaveBeenCalledWith(sessionId));

		await expect(service.revokeSession(userId, sessionId)).resolves.toEqual({ success: true });
		resolveLookup?.(activeSession);

		await expect(validation).resolves.toBe(false);
		expect(redis.eval).toHaveBeenNthCalledWith(
			1,
			expect.stringContaining('redis.call("SET", KEYS[1], "1", "EX", ARGV[1])'),
			2,
			`auth:session:revoked:${sessionId}`,
			`auth:session:active:${sessionId}`,
			'900',
		);
		expect(redis.get).toHaveBeenNthCalledWith(2, `auth:session:revoked:${sessionId}`);

		redis.get.mockReset().mockResolvedValueOnce('1');
		await expect(service.isAccessSessionActive(userId, sessionId)).resolves.toBe(false);
		expect(sessionRepo.findActiveById).toHaveBeenCalledTimes(2);
	});

	it('does not revoke or report success when cache invalidation fails and Redis recovers', async () => {
		const { service, redis, sessionRepo } = createServiceWithMocks();
		sessionRepo.findActiveById.mockResolvedValue(activeSession);
		await expect(service.isAccessSessionActive(userId, sessionId)).resolves.toBe(true);
		redis.eval.mockRejectedValueOnce(new Error('Redis write failed'));

		await expect(service.revokeSession(userId, sessionId)).rejects.toMatchObject({
			statusCode: 500,
			message: 'Unable to revoke session. Please try again.',
		});
		expect(sessionRepo.revokeForUser).not.toHaveBeenCalled();

		await expect(service.isAccessSessionActive(userId, sessionId)).resolves.toBe(true);
		expect(sessionRepo.findActiveById).toHaveBeenCalledTimes(3);
	});

	it('does not report logout success or revoke SQLite when cache invalidation fails', async () => {
		const refreshToken = `${sessionId}.current-secret`;
		const { service, redis, sessionRepo } = createServiceWithMocks();
		sessionRepo.findActiveById.mockResolvedValue({
			...activeSession,
			refreshTokenHash: hashRefreshToken(refreshToken),
		});
		await expect(service.isAccessSessionActive(userId, sessionId)).resolves.toBe(true);
		redis.eval.mockRejectedValueOnce(new Error('Redis write failed'));

		await expect(service.logout(refreshToken)).rejects.toMatchObject({
			statusCode: 500,
			message: 'Unable to revoke session. Please try again.',
		});
		expect(sessionRepo.revoke).not.toHaveBeenCalled();

		await expect(service.isAccessSessionActive(userId, sessionId)).resolves.toBe(true);
	});

	it('keeps the tombstone fail-closed when the database revoke throws', async () => {
		const databaseError = new Error('SQLite write failed');
		const { service, redis, sessionRepo } = createServiceWithMocks();
		sessionRepo.findActiveById.mockResolvedValue(activeSession);
		sessionRepo.revokeForUser.mockRejectedValue(databaseError);

		await expect(service.revokeSession(userId, sessionId)).rejects.toBe(databaseError);

		redis.get.mockReset().mockResolvedValueOnce('1');
		await expect(service.isAccessSessionActive(userId, sessionId)).resolves.toBe(false);
		expect(redis.get).toHaveBeenCalledTimes(1);
	});

	it('does not tombstone a session owned by another user', async () => {
		const { service, redis, sessionRepo } = createServiceWithMocks();
		sessionRepo.findActiveById.mockResolvedValue({
			...activeSession,
			userId: 'different-user',
		});

		await expect(service.revokeSession(userId, sessionId)).rejects.toMatchObject({
			statusCode: 404,
			message: 'Session not found',
		});

		expect(redis.eval).not.toHaveBeenCalled();
		expect(sessionRepo.revokeForUser).not.toHaveBeenCalled();
	});

	it('creates durable sessions without a positive cache entry', async () => {
		const user = {
			id: userId,
			email: 'new@example.com',
			role: 'user',
			isActive: true,
			createdAt: new Date('2026-01-01T00:00:00.000Z'),
			updatedAt: new Date('2026-01-01T00:00:00.000Z'),
		};
		const { service, userRepo, sessionRepo, settingsRepo, redis } = createServiceWithMocks();
		applyEnv({ ALLOW_REGISTRATION: 'true' });
		settingsRepo.get.mockResolvedValue({ registrationLocked: false });
		userRepo.registerUser.mockResolvedValue({ user });

		const result = await service.register(user.email, 'password123');
		expect(result.user).toMatchObject({ id: userId, email: user.email });

		const createdSession = sessionRepo.create.mock.calls[0]?.[0];
		expect(createdSession?.id).toEqual(expect.any(String));
		expect(redis.eval).not.toHaveBeenCalled();
	});
});
