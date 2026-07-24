import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type Redis from 'ioredis';
import { getEnv } from '../config/index.js';
import { CacheKeys, CacheTTL } from '../db/redis.js';
import { AppError } from '../middleware/errors.js';
import type {
	AuthSessionMetadataInput,
	AuthSessionRepository,
} from '../repositories/auth-session.repository.js';
import type { AppSettingsRepository } from '../repositories/settings.repository.js';
import type { UserRepository } from '../repositories/user.repository.js';
import { createLogger } from '../utils/logger.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import type { TokenPayload, TokenUtils } from '../utils/tokens.js';

const logger = createLogger();

const CACHE_NEW_AUTH_SESSION_SCRIPT = `
redis.call("DEL", KEYS[1])
redis.call("SET", KEYS[2], ARGV[1], "EX", ARGV[2])
return 1
`;

const REVOKE_AUTH_SESSION_SCRIPT = `
redis.call("SET", KEYS[1], "1", "EX", ARGV[1])
redis.call("DEL", KEYS[2])
return 1
`;

const CACHE_ACTIVE_AUTH_SESSION_SCRIPT = `
if redis.call("GET", KEYS[1]) then
	return 0
end
redis.call("SET", KEYS[2], ARGV[1], "EX", ARGV[2])
return 1
`;

function getRevocationTtlSeconds(payload: TokenPayload) {
	if (!payload.exp) {
		return 0;
	}

	return Math.max(1, payload.exp - Math.floor(Date.now() / 1000));
}

const AUTH_LOST_MESSAGE = 'Authentication was lost. Please sign in again.';

function createRefreshToken(sessionId: string = randomUUID()) {
	return `${sessionId}.${randomBytes(32).toString('base64url')}`;
}

function parseRefreshToken(token: string) {
	const parts = token.split('.');
	if (parts.length !== 2 || !parts[0] || !parts[1]) {
		return null;
	}
	const [sessionId, secret] = parts;
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)
	) {
		return null;
	}
	return { sessionId, secret };
}

function hashRefreshToken(token: string) {
	return createHash('sha256').update(token).digest('base64url');
}

function constantTimeEqual(a: string, b: string) {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

function sanitizeDeviceName(deviceName?: string | null) {
	const trimmed = deviceName?.trim();
	return trimmed ? trimmed.slice(0, 120) : 'Unknown device';
}

export class AuthService {
	constructor(
		private userRepo: UserRepository,
		private sessionRepo: AuthSessionRepository,
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

	async register(email: string, password: string, metadata: AuthSessionMetadataInput = {}) {
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

		const tokens = await this.issueTokens(user.id, user.role, metadata);
		return { user: this.sanitizeUser(user), tokens };
	}

	async login(email: string, password: string, metadata: AuthSessionMetadataInput = {}) {
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

		const tokens = await this.issueTokens(user.id, user.role, metadata);
		return { user: this.sanitizeUser(user), tokens };
	}

	async refresh(refreshToken: string, metadata: AuthSessionMetadataInput = {}) {
		const parsed = parseRefreshToken(refreshToken);
		if (!parsed) {
			return this.refreshLegacyJwt(refreshToken, metadata);
		}

		const currentRefreshTokenHash = hashRefreshToken(refreshToken);
		const session = await this.sessionRepo.findActiveById(parsed.sessionId);
		if (!session || !constantTimeEqual(session.refreshTokenHash, currentRefreshTokenHash)) {
			throw AppError.unauthorized(AUTH_LOST_MESSAGE);
		}

		const user = await this.userRepo.findById(session.userId);
		if (!user?.isActive) {
			await this.prepareSessionRevocation(session.id);
			await this.sessionRepo.revoke(session.id);
			throw AppError.unauthorized(AUTH_LOST_MESSAGE);
		}

		const tokens = await this.rotateSessionTokens(
			user.id,
			user.role,
			session.id,
			currentRefreshTokenHash,
			metadata,
		);
		return { user: this.sanitizeUser(user), tokens };
	}

	async logout(refreshToken: string) {
		const parsed = parseRefreshToken(refreshToken);
		if (parsed) {
			const session = await this.sessionRepo.findActiveById(parsed.sessionId);
			if (session && constantTimeEqual(session.refreshTokenHash, hashRefreshToken(refreshToken))) {
				await this.prepareSessionRevocation(session.id);
				await this.sessionRepo.revoke(session.id);
			}
			return;
		}

		await this.logoutLegacyJwt(refreshToken);
	}

	async getCurrentUser(userId: string) {
		const user = await this.userRepo.findById(userId);
		if (!user) throw AppError.notFound('User not found');
		return this.sanitizeUser(user);
	}

	async listSessions(userId: string, currentSessionId?: string | null) {
		const sessions = await this.sessionRepo.listActiveByUserId(userId);
		return sessions.map((session) => ({
			id: session.id,
			deviceName: session.deviceName,
			clientId: session.clientId,
			ipAddress: session.ipAddress,
			userAgent: session.userAgent,
			createdAt: session.createdAt.toISOString(),
			lastSeenAt: session.lastSeenAt.toISOString(),
			current: session.id === currentSessionId,
		}));
	}

	async revokeSession(userId: string, sessionId: string) {
		const session = await this.sessionRepo.findActiveById(sessionId);
		if (session?.userId !== userId) {
			throw AppError.notFound('Session not found');
		}
		await this.prepareSessionRevocation(sessionId);
		// The tombstone remains fail-closed if this database write throws. That
		// prevents a requested revocation from resurfacing through stale cache.
		await this.sessionRepo.revokeForUser(userId, sessionId);
		return { success: true };
	}

	async isAccessSessionActive(userId: string, sessionId?: string | null) {
		if (!sessionId) {
			// Legacy access tokens had no session id. They are short-lived and
			// can continue until expiry while the refresh path upgrades them to
			// durable sessions.
			return true;
		}

		try {
			const revoked = await this.redis.get(CacheKeys.authSessionRevoked(sessionId));
			if (revoked !== null) {
				return false;
			}
			const activeOwner = await this.redis.get(CacheKeys.authSessionActive(sessionId));
			if (activeOwner !== null) {
				return activeOwner === userId;
			}
		} catch (error) {
			this.logSessionCacheFailure('read', sessionId, error);
		}

		const session = await this.sessionRepo.findActiveById(sessionId);
		if (session?.userId !== userId) {
			return false;
		}

		try {
			const cached = await this.redis.eval(
				CACHE_ACTIVE_AUTH_SESSION_SCRIPT,
				2,
				CacheKeys.authSessionRevoked(sessionId),
				CacheKeys.authSessionActive(sessionId),
				userId,
				String(CacheTTL.authSessionActive),
			);
			const cacheResult =
				typeof cached === 'number' || typeof cached === 'string' ? Number(cached) : Number.NaN;
			if (cacheResult !== 0 && cacheResult !== 1) {
				throw new Error('Invalid Redis auth session cache response');
			}
			if (cacheResult === 0) {
				return false;
			}
		} catch (error) {
			this.logSessionCacheFailure('populate', sessionId, error);
			const currentSession = await this.sessionRepo.findActiveById(sessionId);
			return currentSession?.userId === userId;
		}

		return true;
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

	async adminListUsers(limit: number, offset: number) {
		const rows = await this.userRepo.listForAdmin(limit, offset);
		const hasMore = rows.length > limit;
		const users = rows.slice(0, limit).map((user) => this.sanitizeUser(user));
		return {
			users,
			hasMore,
			cursor: hasMore ? String(offset + limit) : null,
		};
	}

	async adminUpdateUser(
		actorUserId: string,
		targetUserId: string,
		data: { role?: 'admin' | 'user'; isActive?: boolean },
	) {
		await this.userRepo.assertAdminUpdateAllowed(actorUserId, targetUserId, data);
		if (data.isActive === false || data.role !== undefined) {
			await this.revokeAllUserSessions(targetUserId);
		}
		const user = await this.userRepo.updateForAdmin(actorUserId, targetUserId, data);
		return this.sanitizeUser(user);
	}

	async adminResetPassword(targetUserId: string, password: string) {
		await this.revokeAllUserSessions(targetUserId);
		const passwordHash = await hashPassword(password);
		const user = await this.userRepo.updatePasswordHash(targetUserId, passwordHash);
		return this.sanitizeUser(user);
	}

	private async issueTokens(userId: string, role: string, metadata: AuthSessionMetadataInput) {
		const refreshToken = createRefreshToken();
		const sessionId = parseRefreshToken(refreshToken)?.sessionId;
		if (!sessionId) {
			throw AppError.internal('Failed to create auth session');
		}
		await this.sessionRepo.create({
			id: sessionId,
			userId,
			refreshTokenHash: hashRefreshToken(refreshToken),
			clientId: metadata.clientId ?? null,
			deviceName: sanitizeDeviceName(metadata.deviceName),
			userAgent: metadata.userAgent ?? null,
			ipAddress: metadata.ipAddress ?? null,
		});
		await this.cacheNewSession(userId, sessionId);
		const accessToken = await this.tokenUtils.signAccessToken(userId, role, sessionId);
		return {
			accessToken,
			refreshToken,
			expiresIn: this.tokenUtils.accessExpiresIn,
		};
	}

	private async rotateSessionTokens(
		userId: string,
		role: string,
		sessionId: string,
		currentRefreshTokenHash: string,
		metadata: AuthSessionMetadataInput,
	) {
		const refreshToken = createRefreshToken(sessionId);
		const session = await this.sessionRepo.rotate(
			sessionId,
			currentRefreshTokenHash,
			hashRefreshToken(refreshToken),
			{
				...metadata,
				deviceName: sanitizeDeviceName(metadata.deviceName),
			},
		);
		if (!session) {
			throw AppError.unauthorized(AUTH_LOST_MESSAGE);
		}
		const accessToken = await this.tokenUtils.signAccessToken(userId, role, sessionId);
		return {
			accessToken,
			refreshToken,
			expiresIn: this.tokenUtils.accessExpiresIn,
		};
	}

	private async refreshLegacyJwt(refreshToken: string, metadata: AuthSessionMetadataInput = {}) {
		let payload: TokenPayload;
		try {
			payload = await this.tokenUtils.verifyRefreshToken(refreshToken);
		} catch {
			throw AppError.unauthorized('Invalid refresh token');
		}

		if (payload.type !== 'refresh' || !payload.jti) {
			throw AppError.unauthorized('Invalid refresh token');
		}

		const revoked = await this.revokeLegacyRefreshToken(payload);
		if (!revoked) {
			throw AppError.unauthorized(AUTH_LOST_MESSAGE);
		}

		const user = await this.userRepo.findById(payload.sub!);
		if (!user?.isActive) {
			throw AppError.unauthorized(AUTH_LOST_MESSAGE);
		}

		const tokens = await this.issueTokens(user.id, user.role, metadata);
		return { user: this.sanitizeUser(user), tokens };
	}

	private async logoutLegacyJwt(refreshToken: string) {
		try {
			const payload = await this.tokenUtils.verifyRefreshToken(refreshToken);
			if (payload.type === 'refresh' && payload.jti) {
				await this.revokeLegacyRefreshToken(payload);
			}
		} catch {
			return;
		}
	}

	private async cacheNewSession(userId: string, sessionId: string) {
		try {
			await this.redis.eval(
				CACHE_NEW_AUTH_SESSION_SCRIPT,
				2,
				CacheKeys.authSessionRevoked(sessionId),
				CacheKeys.authSessionActive(sessionId),
				userId,
				String(CacheTTL.authSessionActive),
			);
		} catch (error) {
			this.logSessionCacheFailure('create', sessionId, error);
		}
	}

	private async prepareSessionRevocation(sessionId: string) {
		try {
			const result = await this.redis.eval(
				REVOKE_AUTH_SESSION_SCRIPT,
				2,
				CacheKeys.authSessionRevoked(sessionId),
				CacheKeys.authSessionActive(sessionId),
				String(Math.max(CacheTTL.authSessionActive + 1, this.tokenUtils.accessExpiresIn)),
			);
			if (Number(result) !== 1) {
				throw new Error('Invalid Redis auth session revocation response');
			}
		} catch (error) {
			this.logSessionCacheFailure('revoke', sessionId, error);
			throw AppError.internal('Unable to revoke session. Please try again.');
		}
	}

	private async revokeAllUserSessions(userId: string) {
		const sessions = await this.sessionRepo.listActiveByUserId(userId);
		await Promise.all(sessions.map((session) => this.prepareSessionRevocation(session.id)));
		await this.sessionRepo.revokeAllForUser(userId);
	}

	private logSessionCacheFailure(operation: string, sessionId: string, error: unknown) {
		logger.warn('Auth session cache unavailable', {
			operation,
			sessionId,
			error: error instanceof Error ? error.message : String(error),
		});
	}

	private async revokeLegacyRefreshToken(payload: TokenPayload) {
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
