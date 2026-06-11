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

	/**
	 * Bulk insert categories inside a single transaction. Used by the OPML
	 * import path: a single import can declare hundreds of categories, and we
	 * want one round-trip per batch instead of one per category.
	 *
	 * `rows` must already be topologically ordered: any row whose parent is
	 * also in the batch must appear after that parent. The OPML import
	 * service walks the category path root-to-leaf per entry and only
	 * queues each new category once, which produces a topologically valid
	 * order automatically.
	 */
	async createMany(rows: (typeof categories.$inferInsert)[]) {
		if (rows.length === 0) return [];
		return this.db.transaction(async (tx) => {
			return tx.insert(categories).values(rows).returning();
		});
	}

	/**
	 * Insert categories one at a time inside a single transaction, rewriting
	 * placeholder parent ids (the `__pending__:<idx>` strings the OPML
	 * service uses when the parent is also in the batch) to the real id
	 * produced by the previous insert. Used when a category's parent is
	 * also being created in the same batch and the caller does not know
	 * the new id up front.
	 *
	 * `rows` must be topologically ordered: any row whose parent is also in
	 * the batch must appear after that parent. The OPML import service walks
	 * each entry's category path root-to-leaf and only queues each new
	 * category once, which produces a valid order automatically.
	 */
	async createManyInTransaction(rows: (typeof categories.$inferInsert)[]) {
		if (rows.length === 0) return [];
		return this.db.transaction(async (tx) => {
			const inserted: (typeof categories.$inferSelect)[] = [];
			for (const row of rows) {
				const parentId = row.parentCategoryId;
				let resolvedParent: string | null = null;
				if (parentId == null) {
					resolvedParent = null;
				} else if (typeof parentId === 'string' && parentId.startsWith('__pending__:')) {
					const idx = Number.parseInt(parentId.slice('__pending__:'.length), 10);
					resolvedParent =
						Number.isInteger(idx) && idx >= 0 && idx < inserted.length
							? (inserted[idx]?.id ?? null)
							: null;
				} else {
					resolvedParent = parentId;
				}
				const [created] = await tx
					.insert(categories)
					.values({ ...row, parentCategoryId: resolvedParent })
					.returning();
				if (created) {
					inserted.push(created);
				}
			}
			return inserted;
		});
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
