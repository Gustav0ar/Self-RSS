import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { feeds } from '../db/schema.js';

export class FeedRepository {
	constructor(private db: Database) {}

	async findAllByUser(userId: string) {
		return this.db.query.feeds.findMany({
			where: eq(feeds.userId, userId),
			orderBy: [feeds.title],
		});
	}

	async findByCategory(userId: string, categoryId: string) {
		return this.db.query.feeds.findMany({
			where: and(eq(feeds.userId, userId), eq(feeds.categoryId, categoryId)),
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

	async findDueForSync(limit: number) {
		return this.db.query.feeds.findMany({
			where: and(
				eq(feeds.syncStatus, 'idle'),
				sql`${feeds.lastSyncedAt} IS NULL OR datetime(${feeds.lastSyncedAt}, 'unixepoch', '+' || ${feeds.pollingIntervalMinutes} || ' minutes') < datetime('now')`,
			),
			limit,
		});
	}
}
