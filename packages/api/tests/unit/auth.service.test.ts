import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearEnvCache } from '../../src/config/env.js';
import { AuthService } from '../../src/services/auth.service.js';

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
		...(overrides.userRepo as Record<string, unknown> | undefined),
	};
	const sessionRepo = {
		findActiveById: vi.fn(),
		rotate: vi.fn(),
		revoke: vi.fn(),
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
