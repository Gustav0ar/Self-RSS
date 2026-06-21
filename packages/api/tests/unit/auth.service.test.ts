import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearEnvCache } from '../../src/config/env.js';
import { AuthService } from '../../src/services/auth.service.js';

const originalEnv = { ...process.env };
type AuthServiceDeps = ConstructorParameters<typeof AuthService>;

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
