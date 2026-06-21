import { and, desc, eq, isNull } from 'drizzle-orm';
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

export class AuthSessionRepository {
	constructor(private db: Database) {}

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
			})
			.returning();
		return session;
	}

	async findById(id: string) {
		return this.db.query.authSessions.findFirst({ where: eq(authSessions.id, id) });
	}

	async findActiveById(id: string) {
		return this.db.query.authSessions.findFirst({
			where: and(eq(authSessions.id, id), isNull(authSessions.revokedAt)),
		});
	}

	async listActiveByUserId(userId: string) {
		return this.db
			.select()
			.from(authSessions)
			.where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
			.orderBy(desc(authSessions.lastSeenAt), desc(authSessions.createdAt));
	}

	async rotate(id: string, refreshTokenHash: string, metadata: AuthSessionMetadataInput) {
		const now = new Date();
		const [session] = await this.db
			.update(authSessions)
			.set({
				refreshTokenHash,
				clientId: metadata.clientId ?? undefined,
				deviceName: metadata.deviceName ?? undefined,
				userAgent: metadata.userAgent ?? undefined,
				ipAddress: metadata.ipAddress ?? undefined,
				lastSeenAt: now,
				rotatedAt: now,
			})
			.where(and(eq(authSessions.id, id), isNull(authSessions.revokedAt)))
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
			.where(and(eq(authSessions.id, id), isNull(authSessions.revokedAt)))
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
}
