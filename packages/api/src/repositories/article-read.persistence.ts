import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
	articleMedia,
	articleReads,
	articleSaves,
	articles,
	articleUserStates,
	feeds,
} from '../db/schema.js';

/** Current state for a bounded cached page, without loading article bodies. */
export async function findArticleStatesForUser(db: Database, userId: string, articleIds: string[]) {
	if (articleIds.length === 0) return [];
	return db
		.select({
			id: articles.id,
			isRead: sql`${articleReads.userId} IS NOT NULL`.mapWith(Boolean),
			isSaved: sql`${articleSaves.userId} IS NOT NULL`.mapWith(Boolean),
			readRevision: sql<number>`coalesce(${articleUserStates.readRevision}, 0)`,
			savedRevision: sql<number>`coalesce(${articleUserStates.savedRevision}, 0)`,
		})
		.from(articles)
		.innerJoin(feeds, and(eq(articles.feedId, feeds.id), eq(feeds.userId, userId)))
		.leftJoin(
			articleReads,
			and(eq(articleReads.articleId, articles.id), eq(articleReads.userId, userId)),
		)
		.leftJoin(
			articleSaves,
			and(eq(articleSaves.articleId, articles.id), eq(articleSaves.userId, userId)),
		)
		.leftJoin(
			articleUserStates,
			and(eq(articleUserStates.articleId, articles.id), eq(articleUserStates.userId, userId)),
		)
		.where(inArray(articles.id, articleIds));
}

export async function findArticleDetailForUser(db: Database, userId: string, articleId: string) {
	const [article] = await db
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
			isSaved: sql<boolean>`${articleSaves.userId} IS NOT NULL`,
			readRevision: sql<number>`coalesce(${articleUserStates.readRevision}, 0)`,
			savedRevision: sql<number>`coalesce(${articleUserStates.savedRevision}, 0)`,
		})
		.from(articles)
		.innerJoin(feeds, and(eq(articles.feedId, feeds.id), eq(feeds.userId, userId)))
		.leftJoin(
			articleReads,
			and(eq(articleReads.articleId, articles.id), eq(articleReads.userId, userId)),
		)
		.leftJoin(
			articleSaves,
			and(eq(articleSaves.articleId, articles.id), eq(articleSaves.userId, userId)),
		)
		.leftJoin(
			articleUserStates,
			and(eq(articleUserStates.articleId, articles.id), eq(articleUserStates.userId, userId)),
		)
		.where(eq(articles.id, articleId))
		.limit(1);

	if (!article) {
		return null;
	}

	const media = await db
		.select()
		.from(articleMedia)
		.where(eq(articleMedia.articleId, articleId))
		.orderBy(asc(articleMedia.position));

	return { ...article, media };
}
