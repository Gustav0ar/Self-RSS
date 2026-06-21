import type { Database as BunDatabase } from 'bun:sqlite';
import { and, asc, eq, inArray, lt, type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { getRawDb } from '../db/client.js';
import { articleMedia, articleReads, articles, feeds } from '../db/schema.js';
import { decodeArticleCursor } from '../utils/article-cursor.js';
import {
	type ArticleScope,
	mapSearchRow,
	type RawSearchRow,
	type SearchRow,
	scopeConditions,
	toFtsQuery,
} from './article-query.helpers.js';

export type { ArticleScope } from './article-query.helpers.js';

export class ArticleRepository {
	constructor(
		private db: Database,
		private rawDb?: BunDatabase,
	) {}

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
		// Decode the opaque cursor produced by `encodeCursor` in the
		// service. The cursor embeds the sort timestamp of the last row
		// on the previous page, so we don't need a second round-trip
		// to look the row up by id. Falls back to the id-only shape
		// for legacy cursors (which the service no longer emits, but
		// in-flight pagination may still have one cached).
		const decodedCursor = decodeArticleCursor(options.cursor, options.sort);
		if (decodedCursor) {
			conditions.push(
				options.sort === 'oldest'
					? sql`(${sortTimestamp} > ${decodedCursor.seconds} OR (${sortTimestamp} = ${decodedCursor.seconds} AND ${articles.id} > ${decodedCursor.id}))`
					: sql`(${sortTimestamp} < ${decodedCursor.seconds} OR (${sortTimestamp} = ${decodedCursor.seconds} AND ${articles.id} < ${decodedCursor.id}))`,
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

	async findByScope(
		scope: ArticleScope,
		options: { limit: number; cursor?: string; sort?: string; unreadOnly?: boolean },
	) {
		const conditions: SQL[] = scopeConditions(scope);
		const sortTimestamp = sql`coalesce(${articles.publishedAt}, ${articles.fetchedAt})`;
		const decodedCursor = decodeArticleCursor(options.cursor, options.sort);
		if (decodedCursor) {
			conditions.push(
				options.sort === 'oldest'
					? sql`(${sortTimestamp} > ${decodedCursor.seconds} OR (${sortTimestamp} = ${decodedCursor.seconds} AND ${articles.id} > ${decodedCursor.id}))`
					: sql`(${sortTimestamp} < ${decodedCursor.seconds} OR (${sortTimestamp} = ${decodedCursor.seconds} AND ${articles.id} < ${decodedCursor.id}))`,
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
				and(eq(articleReads.articleId, articles.id), eq(articleReads.userId, scope.userId)),
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

	async countByScope(scope: ArticleScope): Promise<number> {
		const result = await this.db
			.select({ count: sql<number>`count(*)` })
			.from(articles)
			.innerJoin(feeds, eq(articles.feedId, feeds.id))
			.where(and(...scopeConditions(scope)));
		return result[0]?.count ?? 0;
	}

	async countReadByScope(scope: ArticleScope): Promise<number> {
		const result = await this.db
			.select({ count: sql<number>`count(*)` })
			.from(articleReads)
			.innerJoin(articles, eq(articleReads.articleId, articles.id))
			.innerJoin(feeds, eq(articles.feedId, feeds.id))
			.where(and(eq(articleReads.userId, scope.userId), ...scopeConditions(scope)));
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
				canonicalUrl: articles.canonicalUrl,
				title: articles.title,
				author: articles.author,
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
		const inserted = await this.db
			.insert(articleReads)
			.values({ userId, articleId, source })
			.onConflictDoNothing()
			.returning({ articleId: articleReads.articleId });
		return inserted.length > 0;
	}

	async markUnread(userId: string, articleId: string) {
		const deleted = await this.db
			.delete(articleReads)
			.where(and(eq(articleReads.userId, userId), eq(articleReads.articleId, articleId)))
			.returning({ articleId: articleReads.articleId });
		return deleted.length > 0;
	}

	async markAllRead(userId: string, feedIds: string[]) {
		if (feedIds.length === 0) return 0;
		// Single round-trip: insert into article_reads every article that
		// belongs to the given feeds and is not already marked read by this
		// user. The SELECT is the only place that touches the articles
		// table; the inserted rows are materialized in the same statement.
		// `INSERT ... SELECT` is atomic on SQLite and avoids the previous
		// shape that read the unread ids in one query and then chunked
		// 100-row inserts in a loop. The RETURNING clause gives us the
		// affected row count without a second query.
		const inserted = await this.db.all<{ article_id: string }>(sql`
			INSERT INTO article_reads (user_id, article_id, source, read_at)
			SELECT ${userId}, articles.id, 'mark_all', unixepoch()
			FROM articles
			LEFT JOIN article_reads
				ON article_reads.article_id = articles.id
				AND article_reads.user_id = ${userId}
			WHERE articles.feed_id IN (${sql.join(
				feedIds.map((id) => sql`${id}`),
				sql`, `,
			)})
				AND article_reads.user_id IS NULL
			RETURNING article_id
		`);
		return inserted.length;
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

	async search(
		_userId: string,
		query: string,
		feedIds: string[],
		limit: number,
		cursor?: string,
	): Promise<SearchRow[]> {
		if (feedIds.length === 0) return [];

		const ftsQuery = toFtsQuery(query);
		if (!ftsQuery) {
			return [];
		}

		const decodedCursor = decodeArticleCursor(cursor, 'latest');

		// Use parameterized query to prevent SQL injection
		// All user input (feedIds, _userId, cursor values) are passed as bound parameters
		const params: (string | number)[] = [ftsQuery, _userId, ...feedIds];

		// Cursor pagination: results are ordered by fts_rank ASC, sortTimestamp DESC, id DESC
		// bm25() returns negative values where lower = more relevant
		// For pagination, we want articles that come AFTER the cursor:
		// - Either fts_rank > cursorRank (less relevant after more relevant)
		// - Or fts_rank = cursorRank AND (sortTimestamp < cursorTimestamp OR (sortTimestamp = cursorTimestamp AND id < cursorId))
		let cursorCondition = '';
		if (decodedCursor?.ftsRank != null) {
			const cursorRank = decodedCursor.ftsRank;
			const cursorSeconds = decodedCursor.seconds;
			const cursorId = decodedCursor.id;
			cursorCondition = ` AND (fts.fts_rank > ? OR (fts.fts_rank = ? AND (coalesce(a.published_at, a.fetched_at) < ? OR (coalesce(a.published_at, a.fetched_at) = ? AND a.id < ?))))`;
			params.push(cursorRank, cursorRank, cursorSeconds, cursorSeconds, cursorId);
		}

		// Use parameterized IN clause for feed IDs
		const feedIdPlaceholders = feedIds.map(() => '?').join(', ');

		const sqlQuery =
			`WITH fts AS (SELECT article_id, bm25(articles_fts) AS fts_rank FROM articles_fts WHERE articles_fts MATCH ?) SELECT a.id, a.feed_id as feedId, a.title, a.author, a.excerpt, a.hero_image_url as heroImageUrl, a.published_at as publishedAt, a.fetched_at as fetchedAt, f.title as feedTitle, f.favicon_url as feedFaviconUrl, ar.user_id IS NOT NULL as isRead, fts.fts_rank as ftsRank FROM articles a INNER JOIN feeds f ON a.feed_id = f.id INNER JOIN fts ON a.id = fts.article_id LEFT JOIN article_reads ar ON a.id = ar.article_id AND ar.user_id = ? WHERE a.feed_id IN (${feedIdPlaceholders})` +
			cursorCondition +
			` ORDER BY fts.fts_rank ASC, coalesce(a.published_at, a.fetched_at) DESC, a.id DESC LIMIT ?`;

		// Add limit parameter
		params.push(limit + 1);

		// Use raw SQLite client for FTS queries with bm25
		const rawDb = this.rawDb ?? getRawDb();
		if (!rawDb) {
			return [];
		}

		const rows = rawDb.query(sqlQuery).all(...params) as RawSearchRow[];

		return rows.map(mapSearchRow);
	}

	async searchByScope(
		scope: ArticleScope,
		query: string,
		limit: number,
		cursor?: string,
	): Promise<SearchRow[]> {
		const ftsQuery = toFtsQuery(query);
		if (!ftsQuery) {
			return [];
		}

		const decodedCursor = decodeArticleCursor(cursor, 'latest');

		// Use parameterized query to prevent SQL injection
		// All user input (scope.userId, scope.feedId, scope.categoryId, cursor values) are passed as bound parameters
		// Parameter order must match SQL placeholders:
		// 1. ftsQuery (MATCH), 2. ar.user_id (JOIN), 3. f.user_id (WHERE), then feedId/categoryId, then cursor, then limit
		const params: (string | number)[] = [ftsQuery, scope.userId]; // ftsQuery and ar.user_id first

		// Build scope filter - f.user_id placeholder comes FIRST in WHERE (before categoryId)
		let scopeFilter = 'f.user_id = ?';
		params.push(scope.userId); // for f.user_id in WHERE (comes before categoryId in SQL)

		if (scope.feedId) {
			scopeFilter += ' AND f.id = ?';
			params.push(scope.feedId);
		}
		if (scope.categoryId) {
			// Include the category and all its descendants
			scopeFilter +=
				' AND f.category_id IN (WITH RECURSIVE category_scope(id) AS (SELECT id FROM categories WHERE id = ? AND user_id = ? UNION ALL SELECT child.id FROM categories child INNER JOIN category_scope parent ON child.parent_category_id = parent.id WHERE child.user_id = ?) SELECT id FROM category_scope)';
			params.push(scope.categoryId, scope.userId, scope.userId);
		}

		// Cursor pagination: results are ordered by fts_rank ASC, sortTimestamp DESC, id DESC
		// bm25() returns negative values where lower = more relevant
		// For pagination, we want articles that come AFTER the cursor:
		// - Either fts_rank > cursorRank (less relevant after more relevant)
		// - Or fts_rank = cursorRank AND (sortTimestamp < cursorTimestamp OR (sortTimestamp = cursorTimestamp AND id < cursorId))
		let cursorCondition = '';
		if (decodedCursor?.ftsRank != null) {
			const cursorRank = decodedCursor.ftsRank;
			const cursorSeconds = decodedCursor.seconds;
			const cursorId = decodedCursor.id;
			cursorCondition = ` AND (fts.fts_rank > ? OR (fts.fts_rank = ? AND (coalesce(a.published_at, a.fetched_at) < ? OR (coalesce(a.published_at, a.fetched_at) = ? AND a.id < ?))))`;
			params.push(cursorRank, cursorRank, cursorSeconds, cursorSeconds, cursorId);
		}

		const sqlQuery =
			`WITH fts AS (SELECT article_id, bm25(articles_fts) AS fts_rank FROM articles_fts WHERE articles_fts MATCH ?) SELECT a.id, a.feed_id as feedId, a.title, a.author, a.excerpt, a.hero_image_url as heroImageUrl, a.published_at as publishedAt, a.fetched_at as fetchedAt, f.title as feedTitle, f.favicon_url as feedFaviconUrl, ar.user_id IS NOT NULL as isRead, fts.fts_rank as ftsRank FROM articles a INNER JOIN feeds f ON a.feed_id = f.id INNER JOIN fts ON a.id = fts.article_id LEFT JOIN article_reads ar ON a.id = ar.article_id AND ar.user_id = ? WHERE ` +
			scopeFilter +
			cursorCondition +
			` ORDER BY fts.fts_rank ASC, coalesce(a.published_at, a.fetched_at) DESC, a.id DESC LIMIT ?`;

		// Add limit
		params.push(limit + 1);

		// Use raw SQLite client for FTS queries with bm25
		const rawDb = this.rawDb ?? getRawDb();
		if (!rawDb) {
			return [];
		}

		const rows = rawDb.query(sqlQuery).all(...params) as RawSearchRow[];

		return rows.map(mapSearchRow);
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

	/**
	 * Persist the results of a feed sync in a single transaction: insert any
	 * new articles, store their media rows, and apply content updates to
	 * existing articles (each with its own media replacement). If any step
	 * fails the whole batch rolls back so the feed is never left in a state
	 * where articles exist with empty `contentHtml` or stale media.
	 *
	 * `mediaByGuid` and `updatedMediaByArticleId` are pre-extracted media
	 * lists. For new articles we key by `guid` because the article id is
	 * assigned by the database; the repository rewrites the rows to use
	 * the freshly-inserted id after the insert returns.
	 */
	async persistSyncResults(params: {
		articlesToInsert: (typeof articles.$inferInsert)[];
		articlesToUpdate: {
			id: string;
			contentHtml: string | null;
			contentText: string | null;
			excerpt: string | null;
			heroImageUrl: string | null;
			hash: string;
		}[];
		mediaByGuid: Map<string, (typeof articleMedia.$inferInsert)[]>;
		updatedMediaByArticleId: Map<string, (typeof articleMedia.$inferInsert)[]>;
	}) {
		return this.db.transaction(async (tx) => {
			const inserted =
				params.articlesToInsert.length > 0
					? await tx
							.insert(articles)
							.values(params.articlesToInsert)
							.onConflictDoNothing()
							.returning()
					: [];

			// Batch insert all media for newly inserted articles (1 query instead of N)
			const allNewMedia: (typeof articleMedia.$inferInsert)[] = [];
			for (const article of inserted) {
				const media = params.mediaByGuid.get(article.guid);
				if (media && media.length > 0) {
					allNewMedia.push(...media.map((row) => ({ ...row, articleId: article.id })));
				}
			}
			if (allNewMedia.length > 0) {
				await tx.insert(articleMedia).values(allNewMedia);
			}

			// Update all articles with new content in parallel
			await Promise.all(
				params.articlesToUpdate.map((update) =>
					tx
						.update(articles)
						.set({
							contentHtml: update.contentHtml,
							contentText: update.contentText,
							excerpt: update.excerpt,
							heroImageUrl: update.heroImageUrl,
							hash: update.hash,
						})
						.where(eq(articles.id, update.id)),
				),
			);

			// Collect all replacement media and delete old media in batch
			const allReplacementMedia: (typeof articleMedia.$inferInsert)[] = [];
			for (const update of params.articlesToUpdate) {
				const replacement = params.updatedMediaByArticleId.get(update.id);
				if (replacement && replacement.length > 0) {
					allReplacementMedia.push(...replacement);
				}
			}

			// Delete old media for all updated articles (1 query instead of N)
			const articleIdsToUpdate = params.articlesToUpdate.map((u) => u.id);
			if (articleIdsToUpdate.length > 0) {
				await tx.delete(articleMedia).where(inArray(articleMedia.articleId, articleIdsToUpdate));
			}

			// Batch insert all replacement media (1 query instead of N)
			if (allReplacementMedia.length > 0) {
				await tx.insert(articleMedia).values(allReplacementMedia);
			}

			return inserted;
		});
	}

	/**
	 * Delete articles older than the specified number of days that have not been read.
	 * When dryRun is true, returns the count of articles that would be deleted without
	 * actually deleting them. This is useful for safely previewing cleanup impact.
	 */
	async deleteOlderThan(days: number, dryRun = false) {
		const cutoff = sql`unixepoch('now', '-' || ${days} || ' days')`;

		// First, count what would be deleted (always runs to provide logging info)
		const candidates = await this.db
			.select({ id: articles.id })
			.from(articles)
			.where(
				and(
					lt(articles.fetchedAt, cutoff),
					sql`${articles.id} NOT IN (SELECT article_id FROM article_reads)`,
				),
			);

		if (dryRun) {
			return candidates.length;
		}

		// Only perform actual deletion if not in dry-run mode
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

	/**
	 * Count articles that would be deleted by retention cleanup.
	 * Returns the number of unread articles older than the cutoff date.
	 * This is always a read-only operation.
	 */
	async countOlderThan(days: number) {
		const cutoff = sql`unixepoch('now', '-' || ${days} || ' days')`;
		const result = await this.db
			.select({ count: sql<number>`count(*)` })
			.from(articles)
			.where(
				and(
					lt(articles.fetchedAt, cutoff),
					sql`${articles.id} NOT IN (SELECT article_id FROM article_reads)`,
				),
			);
		return result[0]?.count ?? 0;
	}
}
