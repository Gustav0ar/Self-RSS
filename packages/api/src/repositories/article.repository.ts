import { and, asc, eq, inArray, lt, type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { articleMedia, articleReads, articles, feeds } from '../db/schema.js';

function toFtsQuery(query: string): string | null {
	const terms = query
		.trim()
		.split(/[^\p{L}\p{N}_]+/u)
		.map((term) => term.trim())
		.filter(Boolean)
		.slice(0, 16);

	if (terms.length === 0) {
		return null;
	}

	return terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' ');
}

export class ArticleRepository {
	constructor(private db: Database) {}

	async findByFeeds(
		userId: string,
		feedIds: string[],
		options: { limit: number; cursor?: string; sort?: string; unreadOnly?: boolean },
	) {
		if (feedIds.length === 0) {
			return [];
		}

		const conditions: SQL[] = [inArray(articles.feedId, feedIds)];
		const sortTimestamp = sql`coalesce(${articles.publishedAt}, ${articles.fetchedAt})`;
		const cursorArticle = options.cursor
			? await this.db.query.articles.findFirst({
					where: eq(articles.id, options.cursor),
					columns: { id: true, publishedAt: true, fetchedAt: true },
				})
			: null;

		if (cursorArticle) {
			const cursorTimestamp = cursorArticle.publishedAt ?? cursorArticle.fetchedAt;
			const cursorSeconds = Math.floor(cursorTimestamp.getTime() / 1000);
			conditions.push(
				options.sort === 'oldest'
					? sql`(${sortTimestamp} > ${cursorSeconds} OR (${sortTimestamp} = ${cursorSeconds} AND ${articles.id} > ${cursorArticle.id}))`
					: sql`(${sortTimestamp} < ${cursorSeconds} OR (${sortTimestamp} = ${cursorSeconds} AND ${articles.id} < ${cursorArticle.id}))`,
			);
		}

		if (options.unreadOnly) {
			conditions.push(sql`${articleReads.userId} IS NULL`);
		}

		const orderBy =
			options.sort === 'oldest'
				? sql`${sortTimestamp} ASC, ${articles.id} ASC`
				: sql`${sortTimestamp} DESC, ${articles.id} DESC`;

		return this.db
			.select({
				id: articles.id,
				feedId: articles.feedId,
				title: articles.title,
				author: articles.author,
				excerpt: articles.excerpt,
				heroImageUrl: articles.heroImageUrl,
				publishedAt: articles.publishedAt,
				fetchedAt: articles.fetchedAt,
				feedTitle: feeds.title,
				feedFaviconUrl: feeds.faviconUrl,
				isRead: sql<boolean>`${articleReads.userId} IS NOT NULL`,
			})
			.from(articles)
			.innerJoin(feeds, eq(articles.feedId, feeds.id))
			.leftJoin(
				articleReads,
				and(eq(articleReads.articleId, articles.id), eq(articleReads.userId, userId)),
			)
			.where(and(...conditions))
			.orderBy(orderBy)
			.limit(options.limit + 1);
	}

	async countByFeeds(feedIds: string[]): Promise<number> {
		if (feedIds.length === 0) return 0;
		const result = await this.db
			.select({ count: sql<number>`count(*)` })
			.from(articles)
			.where(inArray(articles.feedId, feedIds));
		return result[0]?.count ?? 0;
	}

	async countReadByFeeds(userId: string, feedIds: string[]): Promise<number> {
		if (feedIds.length === 0) return 0;
		const result = await this.db
			.select({ count: sql<number>`count(*)` })
			.from(articleReads)
			.innerJoin(articles, eq(articleReads.articleId, articles.id))
			.where(and(eq(articleReads.userId, userId), inArray(articles.feedId, feedIds)));
		return result[0]?.count ?? 0;
	}

	async findById(id: string) {
		return this.db.query.articles.findFirst({
			where: eq(articles.id, id),
			with: { media: true, feed: true },
		});
	}

	async findDetailForUser(userId: string, articleId: string) {
		const [article] = await this.db
			.select({
				id: articles.id,
				feedId: articles.feedId,
				guid: articles.guid,
				canonicalUrl: articles.canonicalUrl,
				title: articles.title,
				author: articles.author,
				excerpt: articles.excerpt,
				contentHtml: articles.contentHtml,
				contentText: articles.contentText,
				heroImageUrl: articles.heroImageUrl,
				publishedAt: articles.publishedAt,
				fetchedAt: articles.fetchedAt,
				hash: articles.hash,
				feedTitle: feeds.title,
				feedFaviconUrl: feeds.faviconUrl,
				feedSiteUrl: feeds.siteUrl,
				isRead: sql<boolean>`${articleReads.userId} IS NOT NULL`,
			})
			.from(articles)
			.innerJoin(feeds, and(eq(articles.feedId, feeds.id), eq(feeds.userId, userId)))
			.leftJoin(
				articleReads,
				and(eq(articleReads.articleId, articles.id), eq(articleReads.userId, userId)),
			)
			.where(eq(articles.id, articleId))
			.limit(1);

		if (!article) {
			return null;
		}

		const media = await this.db
			.select()
			.from(articleMedia)
			.where(eq(articleMedia.articleId, articleId))
			.orderBy(asc(articleMedia.position));

		return { ...article, media };
	}

	async findRefForUser(userId: string, articleId: string) {
		const [article] = await this.db
			.select({
				id: articles.id,
				feedId: articles.feedId,
			})
			.from(articles)
			.innerJoin(feeds, and(eq(articles.feedId, feeds.id), eq(feeds.userId, userId)))
			.where(eq(articles.id, articleId))
			.limit(1);

		return article ?? null;
	}

	async findExistingGuids(feedId: string, guids: string[]) {
		if (guids.length === 0) return [];
		const result = await this.db
			.select({ guid: articles.guid })
			.from(articles)
			.where(and(eq(articles.feedId, feedId), inArray(articles.guid, guids)));
		return result.map((r) => r.guid);
	}

	async findByFeedAndGuids(feedId: string, guids: string[]) {
		if (guids.length === 0) return [];
		return this.db
			.select({
				id: articles.id,
				guid: articles.guid,
				contentHtml: articles.contentHtml,
				heroImageUrl: articles.heroImageUrl,
			})
			.from(articles)
			.where(and(eq(articles.feedId, feedId), inArray(articles.guid, guids)));
	}

	async insertMany(data: (typeof articles.$inferInsert)[]) {
		if (data.length === 0) return [];
		const inserted = await this.db.insert(articles).values(data).onConflictDoNothing().returning();
		return inserted;
	}

	async refreshSearchVectors(_articleIds: string[]) {
		// No-op for SQLite (searchVector index removed)
	}

	async markRead(userId: string, articleId: string, source: string) {
		await this.db.insert(articleReads).values({ userId, articleId, source }).onConflictDoNothing();
	}

	async markUnread(userId: string, articleId: string) {
		await this.db
			.delete(articleReads)
			.where(and(eq(articleReads.userId, userId), eq(articleReads.articleId, articleId)));
	}

	async markAllRead(userId: string, feedIds: string[]) {
		if (feedIds.length === 0) return 0;
		// 1. Select all unread articles for these feeds
		const unread = await this.db
			.select({ id: articles.id })
			.from(articles)
			.leftJoin(
				articleReads,
				and(eq(articleReads.articleId, articles.id), eq(articleReads.userId, userId)),
			)
			.where(and(inArray(articles.feedId, feedIds), sql`${articleReads.userId} IS NULL`));

		if (unread.length === 0) return 0;

		// 2. Insert into article_reads
		const values = unread.map((a) => ({
			userId,
			articleId: a.id,
			source: 'mark_all',
		}));

		// Chunk inserts if too many (SQLite has a limit of variables, usually 32766 or 999 depending on version)
		const chunkSize = 100;
		for (let i = 0; i < values.length; i += chunkSize) {
			const chunk = values.slice(i, i + chunkSize);
			await this.db.insert(articleReads).values(chunk).onConflictDoNothing();
		}

		return unread.length;
	}

	async isRead(userId: string, articleId: string): Promise<boolean> {
		const result = await this.db.query.articleReads.findFirst({
			where: and(eq(articleReads.userId, userId), eq(articleReads.articleId, articleId)),
		});
		return !!result;
	}

	async getReadArticleIds(userId: string, articleIds: string[]): Promise<Set<string>> {
		if (articleIds.length === 0) return new Set();
		const result = await this.db
			.select({ articleId: articleReads.articleId })
			.from(articleReads)
			.where(and(eq(articleReads.userId, userId), inArray(articleReads.articleId, articleIds)));
		return new Set(result.map((r) => r.articleId));
	}

	async unreadCount(userId: string, feedIds: string[]): Promise<number> {
		if (feedIds.length === 0) return 0;
		const result = await this.db
			.select({ count: sql<number>`count(*)` })
			.from(articles)
			.leftJoin(
				articleReads,
				and(eq(articleReads.articleId, articles.id), eq(articleReads.userId, userId)),
			)
			.where(and(inArray(articles.feedId, feedIds), sql`${articleReads.userId} IS NULL`));
		return result[0]?.count ?? 0;
	}

	async unreadCountByFeed(userId: string, feedIds: string[]) {
		if (feedIds.length === 0) {
			return new Map<string, number>();
		}

		const result = await this.db
			.select({
				feedId: articles.feedId,
				count: sql<number>`count(*)`,
			})
			.from(articles)
			.leftJoin(
				articleReads,
				and(eq(articleReads.articleId, articles.id), eq(articleReads.userId, userId)),
			)
			.where(and(inArray(articles.feedId, feedIds), sql`${articleReads.userId} IS NULL`))
			.groupBy(articles.feedId);

		return new Map(result.map(({ feedId, count }) => [feedId, count]));
	}

	async search(_userId: string, query: string, feedIds: string[], limit: number, cursor?: string) {
		if (feedIds.length === 0) return [];

		const ftsQuery = toFtsQuery(query);
		if (!ftsQuery) {
			return [];
		}

		const sortTimestamp = sql`coalesce(${articles.publishedAt}, ${articles.fetchedAt})`;
		const cursorArticle = cursor
			? await this.db.query.articles.findFirst({
					where: eq(articles.id, cursor),
					columns: { id: true, publishedAt: true, fetchedAt: true },
				})
			: null;

		const conditions: SQL[] = [
			inArray(articles.feedId, feedIds),
			sql`${articles.id} IN (SELECT article_id FROM articles_fts WHERE articles_fts MATCH ${ftsQuery})`,
		];

		if (cursorArticle) {
			const cursorTimestamp = cursorArticle.publishedAt ?? cursorArticle.fetchedAt;
			const cursorSeconds = Math.floor(cursorTimestamp.getTime() / 1000);
			conditions.push(
				sql`(${sortTimestamp} < ${cursorSeconds} OR (${sortTimestamp} = ${cursorSeconds} AND ${articles.id} < ${cursorArticle.id}))`,
			);
		}

		return this.db
			.select({
				id: articles.id,
				feedId: articles.feedId,
				title: articles.title,
				author: articles.author,
				excerpt: articles.excerpt,
				heroImageUrl: articles.heroImageUrl,
				publishedAt: articles.publishedAt,
				fetchedAt: articles.fetchedAt,
				feedTitle: feeds.title,
				feedFaviconUrl: feeds.faviconUrl,
			})
			.from(articles)
			.innerJoin(feeds, eq(articles.feedId, feeds.id))
			.where(and(...conditions))
			.orderBy(sql`${sortTimestamp} DESC, ${articles.id} DESC`)
			.limit(limit + 1);
	}

	async insertMedia(data: (typeof articleMedia.$inferInsert)[]) {
		if (data.length === 0) return;
		await this.db.insert(articleMedia).values(data);
	}

	async updateContent(id: string, data: Partial<typeof articles.$inferInsert>) {
		await this.db.update(articles).set(data).where(eq(articles.id, id));
	}

	async replaceMedia(articleId: string, data: (typeof articleMedia.$inferInsert)[]) {
		await this.db.transaction(async (tx) => {
			await tx.delete(articleMedia).where(eq(articleMedia.articleId, articleId));
			if (data.length > 0) {
				await tx.insert(articleMedia).values(data);
			}
		});
	}

	async deleteOlderThan(days: number) {
		const cutoff = sql`unixepoch('now', '-' || ${days} || ' days')`;
		const result = await this.db
			.delete(articles)
			.where(
				and(
					lt(articles.fetchedAt, cutoff),
					sql`${articles.id} NOT IN (SELECT article_id FROM article_reads)`,
				),
			)
			.returning({ id: articles.id });
		return result.length;
	}
}
