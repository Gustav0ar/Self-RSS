import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { categories, feeds } from '../db/schema.js';

export class CategoryRepository {
	constructor(private db: Database) {}

	async findAllByUser(userId: string) {
		return this.db.query.categories.findMany({
			where: eq(categories.userId, userId),
			orderBy: [categories.sortOrder, categories.name],
		});
	}

	async findById(id: string, userId: string) {
		return this.db.query.categories.findFirst({
			where: and(eq(categories.id, id), eq(categories.userId, userId)),
		});
	}

	async findByName(userId: string, name: string, parentCategoryId: string | null) {
		return this.db.query.categories.findFirst({
			where: and(
				eq(categories.userId, userId),
				eq(categories.name, name),
				parentCategoryId === null
					? sql`${categories.parentCategoryId} IS NULL`
					: eq(categories.parentCategoryId, parentCategoryId),
			),
		});
	}

	async create(data: {
		userId: string;
		name: string;
		slug: string;
		parentCategoryId?: string | null;
		sortOrder?: number;
	}) {
		const [cat] = await this.db.insert(categories).values(data).returning();
		return cat!;
	}

	async update(id: string, userId: string, data: Partial<typeof categories.$inferInsert>) {
		const [cat] = await this.db
			.update(categories)
			.set({ ...data, updatedAt: new Date() })
			.where(and(eq(categories.id, id), eq(categories.userId, userId)))
			.returning();
		return cat;
	}

	async delete(id: string, userId: string) {
		const [cat] = await this.db
			.delete(categories)
			.where(and(eq(categories.id, id), eq(categories.userId, userId)))
			.returning();
		return cat;
	}

	async feedCount(categoryId: string) {
		const result = await this.db
			.select({ count: sql<number>`count(*)` })
			.from(feeds)
			.where(eq(feeds.categoryId, categoryId));
		return result[0]?.count ?? 0;
	}
}
