import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { categories, feeds } from '../db/schema.js';

export class FeedRepository {
	constructor(private db: Database) {}

	async findAllByUser(userId: string) {
		return this.db.query.feeds.findMany({
			where: eq(feeds.userId, userId),
			orderBy: [feeds.title],
		});
	}

	async findByCategory(userId: string, categoryId: string) {
		const categoryRows = this.db.all<{ id: string }>(sql`
			WITH RECURSIVE category_scope(id) AS (
				SELECT ${categories.id}
				FROM ${categories}
				WHERE ${categories.id} = ${categoryId}
					AND ${categories.userId} = ${userId}
				UNION ALL
				SELECT child.id
				FROM categories AS child
				INNER JOIN category_scope AS parent ON child.parent_category_id = parent.id
				WHERE child.user_id = ${userId}
			)
			SELECT id FROM category_scope
		`);
		const categoryIds = categoryRows.map((row) => row.id);
		if (categoryIds.length === 0) {
			return [];
		}

		return this.db.query.feeds.findMany({
			where: and(eq(feeds.userId, userId), inArray(feeds.categoryId, categoryIds)),
			orderBy: [feeds.title],
		});
	}

	async findById(id: string, userId: string) {
		return this.db.query.feeds.findFirst({
			where: and(eq(feeds.id, id), eq(feeds.userId, userId)),
		});
	}

	async findByUrl(userId: string, feedUrl: string) {
		return this.db.query.feeds.findFirst({
			where: and(eq(feeds.userId, userId), eq(feeds.feedUrl, feedUrl)),
		});
	}

	async findByUrls(userId: string, feedUrls: string[]) {
		if (feedUrls.length === 0) {
			return [];
		}

		return this.db.query.feeds.findMany({
			where: and(eq(feeds.userId, userId), inArray(feeds.feedUrl, feedUrls)),
		});
	}

	async create(data: {
		userId: string;
		categoryId: string;
		title: string;
		feedUrl: string;
		siteUrl?: string | null;
		faviconUrl?: string | null;
		description?: string | null;
	}) {
		const [feed] = await this.db.insert(feeds).values(data).returning();
		return feed!;
	}

	/**
	 * Bulk insert feeds inside a single transaction. Used by the OPML import
	 * path to amortize round-trips when the file declares hundreds of feeds.
	 * The caller is responsible for having pre-resolved category ids and for
	 * de-duplicating against the user's existing feed list.
	 */
	async createMany(rows: (typeof feeds.$inferInsert)[]) {
		if (rows.length === 0) return [];
		// `nextSyncAt` has no SQL DEFAULT (the column was added with
		// NOT NULL and no DEFAULT for backwards compatibility with the
		// pre-existing migration), so we populate it client-side here.
		// Drizzle's `$defaultFn` only runs for the single-row insert
		// path; the array form below does not invoke it.
		const now = new Date();
		const populated = rows.map((row) => ({
			...row,
			nextSyncAt: row.nextSyncAt ?? now,
		}));
		return this.db.transaction(async (tx) => {
			return tx.insert(feeds).values(populated).returning();
		});
	}

	async update(id: string, userId: string, data: Partial<typeof feeds.$inferInsert>) {
		const [feed] = await this.db
			.update(feeds)
			.set({ ...data, updatedAt: new Date() })
			.where(and(eq(feeds.id, id), eq(feeds.userId, userId)))
			.returning();
		return feed;
	}

	async delete(id: string, userId: string) {
		const [feed] = await this.db
			.delete(feeds)
			.where(and(eq(feeds.id, id), eq(feeds.userId, userId)))
			.returning();
		return feed;
	}

	/**
	 * Feeds whose `nextSyncAt` is in the past and whose status is retryable.
	 * Backed by the composite index `feeds_next_sync_at_idx`, so this is an
	 * index range scan even for very large feed tables — the previous shape
	 * ran a `datetime(...)` function call per row and could not use any
	 * index.
	 */
	async findDueForSync(limit: number) {
		return this.db.query.feeds.findMany({
			where: and(
				or(eq(feeds.syncStatus, 'idle'), eq(feeds.syncStatus, 'error')),
				// nextSyncAt is stored as Unix seconds; the column's default
				// fills the value at insert time, and the sync service
				// updates it on every successful sync.
				sql`${feeds.nextSyncAt} <= unixepoch()`,
			),
			orderBy: [asc(feeds.nextSyncAt)],
			limit,
		});
	}
}
