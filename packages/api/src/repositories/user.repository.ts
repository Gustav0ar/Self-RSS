import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { userPreferences, users } from '../db/schema.js';
import { AppError } from '../middleware/errors.js';

export class UserRepository {
	constructor(private db: Database) {}

	async findById(id: string) {
		return this.db.query.users.findFirst({ where: eq(users.id, id) });
	}

	async findByEmail(email: string) {
		return this.db.query.users.findFirst({ where: eq(users.email, email) });
	}

	async create(data: { email: string; passwordHash: string; role?: string }) {
		const [user] = await this.db
			.insert(users)
			.values({
				email: data.email,
				passwordHash: data.passwordHash,
				role: data.role ?? 'user',
			})
			.returning();
		return user!;
	}

	async createWithPreferences(data: { email: string; passwordHash: string; role?: string }) {
		return this.db.transaction(async (tx) => {
			const [user] = await tx
				.insert(users)
				.values({
					email: data.email,
					passwordHash: data.passwordHash,
					role: data.role ?? 'user',
				})
				.returning();
			await tx.insert(userPreferences).values({ userId: user!.id });
			return user!;
		});
	}

	async registerUser(data: { email: string; passwordHash: string; registrationLocked: boolean }) {
		return this.db.transaction(async (tx) => {
			const existing = await tx.query.users.findFirst({ where: eq(users.email, data.email) });
			if (existing) {
				throw AppError.conflict('Email already registered');
			}

			const countRows = await tx.select({ count: sql<number>`count(*)` }).from(users);
			const isBootstrapAdmin = (countRows[0]?.count ?? 0) === 0;

			if (data.registrationLocked && !isBootstrapAdmin) {
				throw AppError.forbidden('Registration is currently closed');
			}

			const [user] = await tx
				.insert(users)
				.values({
					email: data.email,
					passwordHash: data.passwordHash,
					role: isBootstrapAdmin ? 'admin' : 'user',
				})
				.returning();
			await tx.insert(userPreferences).values({ userId: user!.id });

			return { user: user!, isBootstrapAdmin };
		});
	}

	async createPreferences(userId: string) {
		const [prefs] = await this.db.insert(userPreferences).values({ userId }).returning();
		return prefs!;
	}

	async getPreferences(userId: string) {
		return this.db.query.userPreferences.findFirst({
			where: eq(userPreferences.userId, userId),
		});
	}

	async updatePreferences(userId: string, data: Partial<typeof userPreferences.$inferInsert>) {
		const [prefs] = await this.db
			.update(userPreferences)
			.set({ ...data, updatedAt: new Date() })
			.where(eq(userPreferences.userId, userId))
			.returning();
		return prefs;
	}

	async hasUsers(): Promise<boolean> {
		const countRows = await this.db.select({ count: sql<number>`count(*)` }).from(users);
		return (countRows[0]?.count ?? 0) > 0;
	}
}
