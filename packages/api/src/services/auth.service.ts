import type Redis from 'ioredis';
import { getEnv } from '../config/index.js';
import { CacheKeys } from '../db/redis.js';
import { AppError } from '../middleware/errors.js';
import type { AppSettingsRepository } from '../repositories/settings.repository.js';
import type { UserRepository } from '../repositories/user.repository.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import type { TokenPayload, TokenUtils } from '../utils/tokens.js';

function getRevocationTtlSeconds(payload: TokenPayload) {
	if (!payload.exp) {
		return 0;
	}

	return Math.max(1, payload.exp - Math.floor(Date.now() / 1000));
}

export class AuthService {
	constructor(
		private userRepo: UserRepository,
		private settingsRepo: AppSettingsRepository,
		private tokenUtils: TokenUtils,
		private redis: Redis,
	) {}

	async getRegistrationStatus(): Promise<{ registrationEnabled: boolean }> {
		if (!getEnv().ALLOW_REGISTRATION) {
			return { registrationEnabled: false };
		}
		const settings = await this.settingsRepo.get();
		if (!settings.registrationLocked) {
			return { registrationEnabled: true };
		}
		const hasUsers = await this.userRepo.hasUsers();
		return { registrationEnabled: !hasUsers };
	}

	async register(email: string, password: string) {
		if (!getEnv().ALLOW_REGISTRATION) {
			throw AppError.forbidden('Registration is disabled.');
		}
		const settings = await this.settingsRepo.get();
		const passwordHash = await hashPassword(password);
		const { user } = await this.userRepo.registerUser({
			email,
			passwordHash,
			registrationLocked: settings.registrationLocked,
		});

		const tokens = await this.issueTokens(user.id, user.role);
		return { user: this.sanitizeUser(user), tokens };
	}

	async login(email: string, password: string) {
		const user = await this.userRepo.findByEmail(email);
		if (!user) {
			throw AppError.unauthorized('Invalid email or password');
		}
		if (!user.isActive) {
			throw AppError.forbidden('Account is disabled');
		}

		const valid = await verifyPassword(password, user.passwordHash);
		if (!valid) {
			throw AppError.unauthorized('Invalid email or password');
		}

		const tokens = await this.issueTokens(user.id, user.role);
		return { user: this.sanitizeUser(user), tokens };
	}

	async refresh(refreshToken: string) {
		let payload: TokenPayload;
		try {
			payload = await this.tokenUtils.verifyRefreshToken(refreshToken);
		} catch {
			throw AppError.unauthorized('Invalid refresh token');
		}

		if (payload.type !== 'refresh' || !payload.jti) {
			throw AppError.unauthorized('Invalid refresh token');
		}

		const revoked = await this.revokeRefreshToken(payload);
		if (!revoked) {
			throw AppError.unauthorized('Token has been revoked');
		}

		const user = await this.userRepo.findById(payload.sub!);
		if (!user?.isActive) {
			throw AppError.unauthorized('User not found or inactive');
		}

		const tokens = await this.issueTokens(user.id, user.role);
		return { user: this.sanitizeUser(user), tokens };
	}

	async logout(refreshToken: string) {
		try {
			const payload = await this.tokenUtils.verifyRefreshToken(refreshToken);
			if (payload.type === 'refresh' && payload.jti) {
				await this.revokeRefreshToken(payload);
			}
		} catch {
			return;
		}
	}

	async getCurrentUser(userId: string) {
		const user = await this.userRepo.findById(userId);
		if (!user) throw AppError.notFound('User not found');
		return this.sanitizeUser(user);
	}

	async adminCreateUser(email: string, password: string, role: string) {
		const existing = await this.userRepo.findByEmail(email);
		if (existing) {
			throw AppError.conflict('Email already registered');
		}

		const passwordHash = await hashPassword(password);
		const user = await this.userRepo.createWithPreferences({ email, passwordHash, role });
		return this.sanitizeUser(user);
	}

	private async issueTokens(userId: string, role: string) {
		const [accessToken, refreshToken] = await Promise.all([
			this.tokenUtils.signAccessToken(userId, role),
			this.tokenUtils.signRefreshToken(userId, role),
		]);
		return {
			accessToken,
			refreshToken,
			expiresIn: this.tokenUtils.accessExpiresIn,
		};
	}

	private async revokeRefreshToken(payload: TokenPayload) {
		const ttl = getRevocationTtlSeconds(payload);
		if (!payload.jti || ttl <= 0) {
			return false;
		}

		const result = await this.redis.set(CacheKeys.refreshToken(payload.jti), '1', 'EX', ttl, 'NX');
		return result === 'OK';
	}

	private sanitizeUser(user: {
		id: string;
		email: string;
		role: string;
		isActive: boolean;
		createdAt: Date;
		updatedAt: Date;
	}) {
		return {
			id: user.id,
			email: user.email,
			role: user.role,
			isActive: user.isActive,
			createdAt: user.createdAt.toISOString(),
			updatedAt: user.updatedAt.toISOString(),
		};
	}
}
