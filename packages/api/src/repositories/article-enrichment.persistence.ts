import { and, asc, desc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { articleMedia, articles, feeds } from '../db/schema.js';

export interface EnrichedContentReplacement {
	contentHtml: string | null;
	contentText: string | null;
	excerpt: string | null;
	heroImageUrl: string | null;
	hash: string;
	media: (typeof articleMedia.$inferInsert)[];
	enrichedAt: Date;
}

export async function queueArticleEnrichments(
	db: Database,
	articleIds: string[],
	queuedAt = new Date(),
) {
	if (articleIds.length === 0) return;
	await db
		.update(articles)
		.set({
			contentStatus: 'enrichment_pending',
			enrichmentQueuedAt: queuedAt,
			nextEnrichmentAt: queuedAt,
			enrichmentError: null,
		})
		.where(inArray(articles.id, articleIds));
}

export function findPendingArticleEnrichments(db: Database, limit: number, now = new Date()) {
	return db
		.select({
			articleId: articles.id,
			userId: feeds.userId,
			feedId: articles.feedId,
			canonicalUrl: articles.canonicalUrl,
			contentHtml: articles.contentHtml,
			heroImageUrl: articles.heroImageUrl,
			fetchedAt: articles.fetchedAt,
			enrichmentQueuedAt: articles.enrichmentQueuedAt,
			enrichmentAttempts: articles.enrichmentAttempts,
			contentVersion: articles.contentVersion,
		})
		.from(articles)
		.innerJoin(feeds, eq(articles.feedId, feeds.id))
		.where(
			and(
				eq(articles.contentStatus, 'enrichment_pending'),
				sql`${articles.canonicalUrl} IS NOT NULL`,
				or(sql`${articles.nextEnrichmentAt} IS NULL`, lte(articles.nextEnrichmentAt, now)),
			),
		)
		.orderBy(asc(articles.nextEnrichmentAt), desc(articles.fetchedAt))
		.limit(limit);
}

export async function markArticleEnrichmentAttempt(
	db: Database,
	articleId: string,
	attemptedAt = new Date(),
) {
	await db
		.update(articles)
		.set({
			enrichmentAttemptedAt: attemptedAt,
			enrichmentAttempts: sql`${articles.enrichmentAttempts} + 1`,
			nextEnrichmentAt: null,
		})
		.where(eq(articles.id, articleId));
}

export async function markArticleEnrichmentRetry(
	db: Database,
	articleId: string,
	data: { failed: boolean; error: string; nextEnrichmentAt: Date | null },
) {
	const [updated] = await db
		.update(articles)
		.set({
			contentStatus: data.failed ? 'failed' : 'enrichment_pending',
			...(data.failed ? { contentVersion: sql`${articles.contentVersion} + 1` } : {}),
			enrichmentError: data.error,
			nextEnrichmentAt: data.nextEnrichmentAt,
		})
		.where(eq(articles.id, articleId))
		.returning({ contentVersion: articles.contentVersion, feedId: articles.feedId });
	return data.failed ? (updated ?? null) : null;
}

export async function markArticleEnrichmentComplete(
	db: Database,
	articleId: string,
	enrichedAt = new Date(),
) {
	const [updated] = await db
		.update(articles)
		.set({
			contentStatus: 'full_ready',
			contentVersion: sql`${articles.contentVersion} + 1`,
			enrichedAt,
			enrichmentError: null,
			nextEnrichmentAt: null,
		})
		.where(eq(articles.id, articleId))
		.returning({ contentVersion: articles.contentVersion, feedId: articles.feedId });
	return updated ?? null;
}

export function replaceArticleEnrichedContent(
	db: Database,
	articleId: string,
	data: EnrichedContentReplacement,
) {
	return db.transaction((tx) => {
		const [updated] = tx
			.update(articles)
			.set({
				contentHtml: data.contentHtml,
				contentText: data.contentText,
				excerpt: data.excerpt,
				heroImageUrl: data.heroImageUrl,
				hash: data.hash,
				contentStatus: 'full_ready',
				contentVersion: sql`${articles.contentVersion} + 1`,
				enrichedAt: data.enrichedAt,
				enrichmentError: null,
				nextEnrichmentAt: null,
			})
			.where(eq(articles.id, articleId))
			.returning({ contentVersion: articles.contentVersion, feedId: articles.feedId })
			.all();
		tx.delete(articleMedia).where(eq(articleMedia.articleId, articleId)).run();
		if (data.media.length > 0) tx.insert(articleMedia).values(data.media).run();
		return updated ?? null;
	});
}
