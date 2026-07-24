import { desc, eq, sql } from 'drizzle-orm';
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
		if (!user) {
			throw AppError.internal('Failed to create user');
		}
		return user;
	}

	async createWithPreferences(data: { email: string; passwordHash: string; role?: string }) {
		return this.db.transaction((tx) => {
			const [user] = tx
				.insert(users)
				.values({
					email: data.email,
					passwordHash: data.passwordHash,
					role: data.role ?? 'user',
				})
				.returning()
				.all();
			if (!user) {
				throw AppError.internal('Failed to create user');
			}
			tx.insert(userPreferences).values({ userId: user.id }).run();
			return user;
		});
	}

	async registerUser(data: { email: string; passwordHash: string; registrationLocked: boolean }) {
		return this.db.transaction((tx) => {
			const existing = tx.query.users.findFirst({ where: eq(users.email, data.email) }).sync();
			if (existing) {
				throw AppError.conflict('Email already registered');
			}

			const countRows = tx.select({ count: sql<number>`count(*)` }).from(users).all();
			const isBootstrapAdmin = (countRows[0]?.count ?? 0) === 0;

			if (data.registrationLocked && !isBootstrapAdmin) {
				throw AppError.forbidden('Registration is currently closed');
			}

			const [user] = tx
				.insert(users)
				.values({
					email: data.email,
					passwordHash: data.passwordHash,
					role: isBootstrapAdmin ? 'admin' : 'user',
				})
				.returning()
				.all();
			if (!user) {
				throw AppError.internal('Failed to create user');
			}
			tx.insert(userPreferences).values({ userId: user.id }).run();

			return { user, isBootstrapAdmin };
		});
	}

	async createPreferences(userId: string) {
		const [prefs] = await this.db.insert(userPreferences).values({ userId }).returning();
		if (!prefs) {
			throw AppError.internal('Failed to create user preferences');
		}
		return prefs;
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

	async findActiveUserIds(): Promise<string[]> {
		const result = await this.db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.isActive, true));
		return result.map((r) => r.id);
	}

	async listForAdmin(limit: number, offset: number) {
		return this.db
			.select()
			.from(users)
			.orderBy(desc(users.createdAt), desc(users.id))
			.limit(limit + 1)
			.offset(offset);
	}

	async updateForAdmin(
		actorUserId: string,
		targetUserId: string,
		data: { role?: 'admin' | 'user'; isActive?: boolean },
	) {
		return this.db.transaction((tx) => {
			const target = tx.query.users.findFirst({ where: eq(users.id, targetUserId) }).sync();
			if (!target) throw AppError.notFound('User not found');
			this.assertAdminMutationAllowed(tx, actorUserId, target, data);

			const [updated] = tx
				.update(users)
				.set({ ...data, updatedAt: new Date() })
				.where(eq(users.id, targetUserId))
				.returning()
				.all();
			if (!updated) throw AppError.notFound('User not found');
			return updated;
		});
	}

	async assertAdminUpdateAllowed(
		actorUserId: string,
		targetUserId: string,
		data: { role?: 'admin' | 'user'; isActive?: boolean },
	) {
		return this.db.transaction((tx) => {
			const target = tx.query.users.findFirst({ where: eq(users.id, targetUserId) }).sync();
			if (!target) throw AppError.notFound('User not found');
			this.assertAdminMutationAllowed(tx, actorUserId, target, data);
		});
	}

	private assertAdminMutationAllowed(
		tx: Parameters<Parameters<Database['transaction']>[0]>[0],
		actorUserId: string,
		target: typeof users.$inferSelect,
		data: { role?: 'admin' | 'user'; isActive?: boolean },
	) {
		const removesAdmin =
			target.role === 'admin' &&
			target.isActive &&
			(data.role === 'user' || data.isActive === false);
		if (target.id === actorUserId && removesAdmin) {
			throw AppError.badRequest('You cannot demote or deactivate your current account');
		}
		if (removesAdmin) {
			const activeAdmins = tx
				.select({ count: sql<number>`count(*)` })
				.from(users)
				.where(sql`${users.role} = 'admin' AND ${users.isActive} = 1`)
				.get()?.count;
			if ((activeAdmins ?? 0) <= 1) {
				throw AppError.conflict('The last active administrator cannot be changed');
			}
		}
	}

	async updatePasswordHash(userId: string, passwordHash: string) {
		const [updated] = await this.db
			.update(users)
			.set({ passwordHash, updatedAt: new Date() })
			.where(eq(users.id, userId))
			.returning();
		if (!updated) throw AppError.notFound('User not found');
		return updated;
	}
}
