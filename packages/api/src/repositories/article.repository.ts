import type { Database as BunDatabase } from 'bun:sqlite';
import { and, asc, eq, inArray, lt, type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { articleMedia, articleReads, articles, feeds } from '../db/schema.js';
import { decodeArticleCursor } from '../utils/article-cursor.js';
import {
	type EnrichedContentReplacement,
	findPendingArticleEnrichments,
	markArticleEnrichmentAttempt,
	markArticleEnrichmentComplete,
	markArticleEnrichmentRetry,
	queueArticleEnrichments,
	replaceArticleEnrichedContent,
} from './article-enrichment.persistence.js';
import { type ArticleScope, type SearchRow, scopeConditions } from './article-query.helpers.js';
import { searchArticles, searchArticlesByScope } from './article-search.js';

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
				canonicalUrl: articles.canonicalUrl,
				title: articles.title,
				author: articles.author,
				excerpt: articles.excerpt,
				heroImageUrl: articles.heroImageUrl,
				contentStatus: articles.contentStatus,
				contentVersion: articles.contentVersion,
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
				canonicalUrl: articles.canonicalUrl,
				title: articles.title,
				author: articles.author,
				excerpt: articles.excerpt,
				heroImageUrl: articles.heroImageUrl,
				contentStatus: articles.contentStatus,
				contentVersion: articles.contentVersion,
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
				contentStatus: articles.contentStatus,
				contentVersion: articles.contentVersion,
				enrichmentQueuedAt: articles.enrichmentQueuedAt,
				enrichmentAttemptedAt: articles.enrichmentAttemptedAt,
				enrichedAt: articles.enrichedAt,
				enrichmentError: articles.enrichmentError,
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
				contentStatus: articles.contentStatus,
				contentVersion: articles.contentVersion,
				enrichmentAttempts: articles.enrichmentAttempts,
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
		return searchArticles(this.rawDb, _userId, query, feedIds, limit, cursor);
	}

	async searchByScope(
		scope: ArticleScope,
		query: string,
		limit: number,
		cursor?: string,
	): Promise<SearchRow[]> {
		return searchArticlesByScope(this.rawDb, scope, query, limit, cursor);
	}

	async insertMedia(data: (typeof articleMedia.$inferInsert)[]) {
		if (data.length === 0) return;
		await this.db.insert(articleMedia).values(data);
	}

	async updateContent(id: string, data: Partial<typeof articles.$inferInsert>) {
		await this.db.update(articles).set(data).where(eq(articles.id, id));
	}

	async queueEnrichments(articleIds: string[], queuedAt = new Date()) {
		await queueArticleEnrichments(this.db, articleIds, queuedAt);
	}

	async findPendingEnrichments(limit: number, now = new Date()) {
		return findPendingArticleEnrichments(this.db, limit, now);
	}

	async markEnrichmentAttempt(articleId: string, attemptedAt = new Date()) {
		await markArticleEnrichmentAttempt(this.db, articleId, attemptedAt);
	}

	async markEnrichmentRetry(
		articleId: string,
		data: { failed: boolean; error: string; nextEnrichmentAt: Date | null },
	) {
		return markArticleEnrichmentRetry(this.db, articleId, data);
	}

	async markEnrichmentComplete(articleId: string, enrichedAt = new Date()) {
		return markArticleEnrichmentComplete(this.db, articleId, enrichedAt);
	}

	async replaceEnrichedContent(articleId: string, data: EnrichedContentReplacement) {
		return replaceArticleEnrichedContent(this.db, articleId, data);
	}

	async replaceMedia(articleId: string, data: (typeof articleMedia.$inferInsert)[]) {
		this.db.transaction((tx) => {
			tx.delete(articleMedia).where(eq(articleMedia.articleId, articleId)).run();
			if (data.length > 0) {
				tx.insert(articleMedia).values(data).run();
			}
		});
	}

	async findByFeedGuids(feedId: string, guids: string[]) {
		if (guids.length === 0) return [];
		return this.db
			.select()
			.from(articles)
			.where(and(eq(articles.feedId, feedId), inArray(articles.guid, guids)));
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
			canonicalUrl?: string | null;
			title?: string;
			author?: string | null;
			contentHtml: string | null;
			contentText: string | null;
			excerpt: string | null;
			heroImageUrl: string | null;
			publishedAt?: Date | null;
			fetchedAt?: Date;
			incrementContentVersion?: boolean;
			hash: string;
		}[];
		mediaByGuid: Map<string, (typeof articleMedia.$inferInsert)[]>;
		updatedMediaByArticleId: Map<string, (typeof articleMedia.$inferInsert)[]>;
	}) {
		return this.db.transaction((tx) => {
			const inserted =
				params.articlesToInsert.length > 0
					? tx
							.insert(articles)
							.values(params.articlesToInsert)
							.onConflictDoNothing()
							.returning()
							.all()
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
				tx.insert(articleMedia).values(allNewMedia).run();
			}

			// Bun SQLite transactions are synchronous. Execute every update before
			// the callback returns so an exception rolls the entire batch back.
			for (const update of params.articlesToUpdate) {
				tx.update(articles)
					.set({
						canonicalUrl: update.canonicalUrl,
						title: update.title,
						author: update.author,
						contentHtml: update.contentHtml,
						contentText: update.contentText,
						excerpt: update.excerpt,
						heroImageUrl: update.heroImageUrl,
						publishedAt: update.publishedAt,
						fetchedAt: update.fetchedAt,
						hash: update.hash,
						contentVersion: update.incrementContentVersion
							? sql`${articles.contentVersion} + 1`
							: undefined,
					})
					.where(eq(articles.id, update.id))
					.run();
			}

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
				tx.delete(articleMedia).where(inArray(articleMedia.articleId, articleIdsToUpdate)).run();
			}

			// Batch insert all replacement media (1 query instead of N)
			if (allReplacementMedia.length > 0) {
				tx.insert(articleMedia).values(allReplacementMedia).run();
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
