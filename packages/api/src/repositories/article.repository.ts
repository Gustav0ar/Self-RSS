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

/**
 * Decode the opaque pagination cursor emitted by `encodeCursor` in the
 * service. The format is `<articleId>:<unixSeconds>:<direction>`. If the
 * input doesn't match the new shape (e.g. a legacy id-only cursor still
 * in flight from before this change), the decoder returns null and the
 * caller falls back to no cursor — the request simply returns the first
 * page, which is the safe behavior for a malformed cursor.
 */
function decodeCursor(
	cursor: string | undefined,
	sort: string | undefined,
): { id: string; seconds: number; direction: 'a' | 'd' } | null {
	if (!cursor) return null;
	const parts = cursor.split(':');
	if (parts.length !== 3) return null;
	const [id, secondsRaw, direction] = parts;
	if (!id || !secondsRaw || !direction) return null;
	if (direction !== 'a' && direction !== 'd') return null;
	// Verify the encoded direction matches the requested sort. If the
	// client paginated with `latest` and then switched to `oldest`,
	// we don't have a way to translate the cursor; fall back to first
	// page.
	const expectedDirection = sort === 'oldest' ? 'a' : 'd';
	if (direction !== expectedDirection) return null;
	const seconds = Number.parseInt(secondsRaw, 10);
	if (!Number.isFinite(seconds) || seconds < 0) return null;
	return { id, seconds, direction };
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
		// Decode the opaque cursor produced by `encodeCursor` in the
		// service. The cursor embeds the sort timestamp of the last row
		// on the previous page, so we don't need a second round-trip
		// to look the row up by id. Falls back to the id-only shape
		// for legacy cursors (which the service no longer emits, but
		// in-flight pagination may still have one cached).
		const decodedCursor = decodeCursor(options.cursor, options.sort);
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

	async search(_userId: string, query: string, feedIds: string[], limit: number, cursor?: string) {
		if (feedIds.length === 0) return [];

		const ftsQuery = toFtsQuery(query);
		if (!ftsQuery) {
			return [];
		}

		const sortTimestamp = sql`coalesce(${articles.publishedAt}, ${articles.fetchedAt})`;
		const decodedCursor = decodeCursor(cursor, 'latest');
		const cursorSeconds = decodedCursor?.seconds;

		const conditions: SQL[] = [
			inArray(articles.feedId, feedIds),
			sql`${articles.id} IN (SELECT article_id FROM articles_fts WHERE articles_fts MATCH ${ftsQuery})`,
		];

		if (cursorSeconds != null && decodedCursor) {
			conditions.push(
				sql`(${sortTimestamp} < ${cursorSeconds} OR (${sortTimestamp} = ${cursorSeconds} AND ${articles.id} < ${decodedCursor.id}))`,
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
				// Fold the read-state lookup into the search query so the
				// caller doesn't need a second round-trip. The LEFT JOIN
				// hits the same `article_reads_pk` index that the
				// `getReadArticleIds` lookup would have used, so this is
				// at most as expensive as the two queries combined.
				isRead: sql<boolean>`${articleReads.userId} IS NOT NULL`,
			})
			.from(articles)
			.innerJoin(feeds, eq(articles.feedId, feeds.id))
			.leftJoin(
				articleReads,
				and(eq(articleReads.articleId, articles.id), eq(articleReads.userId, _userId)),
			)
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

			for (const article of inserted) {
				const media = params.mediaByGuid.get(article.guid);
				if (media && media.length > 0) {
					await tx
						.insert(articleMedia)
						.values(media.map((row) => ({ ...row, articleId: article.id })));
				}
			}

			for (const update of params.articlesToUpdate) {
				await tx
					.update(articles)
					.set({
						contentHtml: update.contentHtml,
						contentText: update.contentText,
						excerpt: update.excerpt,
						heroImageUrl: update.heroImageUrl,
						hash: update.hash,
					})
					.where(eq(articles.id, update.id));

				const replacement = params.updatedMediaByArticleId.get(update.id);
				await tx.delete(articleMedia).where(eq(articleMedia.articleId, update.id));
				if (replacement && replacement.length > 0) {
					await tx.insert(articleMedia).values(replacement);
				}
			}

			return inserted;
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
