import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { authSessions } from '../db/schema.js';

export interface AuthSessionCreateInput {
	id: string;
	userId: string;
	refreshTokenHash: string;
	clientId?: string | null;
	deviceName: string;
	userAgent?: string | null;
	ipAddress?: string | null;
}

export interface AuthSessionMetadataInput {
	clientId?: string | null;
	deviceName?: string | null;
	userAgent?: string | null;
	ipAddress?: string | null;
}

export interface AuthSessionLifetimePolicy {
	absoluteTtlMs: number;
	idleTtlMs: number;
}

const DEFAULT_POLICY: AuthSessionLifetimePolicy = {
	absoluteTtlMs: 400 * 24 * 60 * 60 * 1000,
	idleTtlMs: 30 * 24 * 60 * 60 * 1000,
};

export class AuthSessionRepository {
	constructor(
		private db: Database,
		private policy: AuthSessionLifetimePolicy = DEFAULT_POLICY,
	) {}

	private activeWhere(id: string, now = new Date()) {
		return and(
			eq(authSessions.id, id),
			isNull(authSessions.revokedAt),
			gt(authSessions.expiresAt, now),
			gt(authSessions.lastSeenAt, new Date(now.getTime() - this.policy.idleTtlMs)),
		);
	}

	async create(data: AuthSessionCreateInput) {
		const now = new Date();
		const [session] = await this.db
			.insert(authSessions)
			.values({
				id: data.id,
				userId: data.userId,
				refreshTokenHash: data.refreshTokenHash,
				clientId: data.clientId ?? null,
				deviceName: data.deviceName,
				userAgent: data.userAgent ?? null,
				ipAddress: data.ipAddress ?? null,
				createdAt: now,
				lastSeenAt: now,
				rotatedAt: now,
				expiresAt: new Date(now.getTime() + this.policy.absoluteTtlMs),
			})
			.returning();
		return session;
	}

	async findById(id: string) {
		return this.db.query.authSessions.findFirst({ where: eq(authSessions.id, id) });
	}

	async findActiveById(id: string) {
		return this.db.query.authSessions.findFirst({
			where: this.activeWhere(id),
		});
	}

	async listActiveByUserId(userId: string) {
		return this.db
			.select()
			.from(authSessions)
			.where(
				and(
					eq(authSessions.userId, userId),
					isNull(authSessions.revokedAt),
					gt(authSessions.expiresAt, new Date()),
					gt(authSessions.lastSeenAt, new Date(Date.now() - this.policy.idleTtlMs)),
				),
			)
			.orderBy(desc(authSessions.lastSeenAt), desc(authSessions.createdAt));
	}

	async rotate(
		id: string,
		currentRefreshTokenHash: string,
		nextRefreshTokenHash: string,
		metadata: AuthSessionMetadataInput,
	) {
		const now = new Date();
		const [session] = await this.db
			.update(authSessions)
			.set({
				refreshTokenHash: nextRefreshTokenHash,
				clientId: metadata.clientId ?? undefined,
				deviceName: metadata.deviceName ?? undefined,
				userAgent: metadata.userAgent ?? undefined,
				ipAddress: metadata.ipAddress ?? undefined,
				lastSeenAt: now,
				rotatedAt: now,
			})
			.where(
				and(
					eq(authSessions.id, id),
					eq(authSessions.refreshTokenHash, currentRefreshTokenHash),
					this.activeWhere(id),
				),
			)
			.returning();
		return session;
	}

	async touch(id: string, metadata: AuthSessionMetadataInput = {}) {
		const [session] = await this.db
			.update(authSessions)
			.set({
				clientId: metadata.clientId ?? undefined,
				deviceName: metadata.deviceName ?? undefined,
				userAgent: metadata.userAgent ?? undefined,
				ipAddress: metadata.ipAddress ?? undefined,
				lastSeenAt: new Date(),
			})
			.where(this.activeWhere(id))
			.returning();
		return session;
	}

	async revokeForUser(userId: string, id: string) {
		const [session] = await this.db
			.update(authSessions)
			.set({ revokedAt: new Date() })
			.where(
				and(
					eq(authSessions.userId, userId),
					eq(authSessions.id, id),
					isNull(authSessions.revokedAt),
				),
			)
			.returning();
		return session;
	}

	async revoke(id: string) {
		const [session] = await this.db
			.update(authSessions)
			.set({ revokedAt: new Date() })
			.where(and(eq(authSessions.id, id), isNull(authSessions.revokedAt)))
			.returning();
		return session;
	}

	async revokeAllForUser(userId: string) {
		return this.db
			.update(authSessions)
			.set({ revokedAt: new Date() })
			.where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
			.returning();
	}

	async cleanupExpired(batchSize: number, now = new Date()) {
		const revokedCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
		const rows = await this.db
			.select({ id: authSessions.id })
			.from(authSessions)
			.where(
				or(
					lte(authSessions.expiresAt, now),
					and(isNotNull(authSessions.revokedAt), lte(authSessions.revokedAt, revokedCutoff)),
				),
			)
			.limit(batchSize);
		if (rows.length === 0) return 0;
		await this.db.delete(authSessions).where(
			inArray(
				authSessions.id,
				rows.map((row) => row.id),
			),
		);
		return rows.length;
	}
}
