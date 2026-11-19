import { and, asc, desc, eq, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { articleMedia, articles, feeds } from '../db/schema.js';

export interface EnrichmentAttempt {
	articleId: string;
	attempts: number;
	contentVersion: number;
	hash: string;
}

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
	source: 'background' | 'reader' = 'background',
	queuedAt = new Date(),
) {
	if (articleIds.length === 0) return;
	await db
		.update(articles)
		.set({
			contentStatus: 'enrichment_pending',
			enrichmentQueuedAt: queuedAt,
			nextEnrichmentAt: source === 'reader' ? new Date(0) : queuedAt,
			enrichmentAttempts: 0,
			enrichmentAttemptedAt: null,
			enrichmentError: null,
		})
		.where(
			and(
				inArray(articles.id, articleIds),
				or(
					eq(articles.contentStatus, 'feed_ready'),
					source === 'reader'
						? or(
								eq(articles.contentStatus, 'failed'),
								and(
									eq(articles.contentStatus, 'enrichment_pending'),
									eq(articles.enrichmentAttempts, 0),
								),
							)
						: undefined,
				),
			),
		);
}

function dueArticleEnrichment(at: Date) {
	return and(
		eq(articles.contentStatus, 'enrichment_pending'),
		ne(articles.canonicalUrl, ''),
		or(isNull(articles.nextEnrichmentAt), lte(articles.nextEnrichmentAt, at)),
	);
}

export function findPendingArticleEnrichments(db: Database, limit: number, now = new Date()) {
	return db
		.select({
			articleId: articles.id,
			userId: feeds.userId,
		})
		.from(articles)
		.innerJoin(feeds, eq(articles.feedId, feeds.id))
		.where(dueArticleEnrichment(now))
		.orderBy(asc(articles.nextEnrichmentAt), desc(articles.fetchedAt))
		.limit(limit);
}

export async function markArticleEnrichmentAttempt(
	db: Database,
	articleId: string,
	attemptedAt = new Date(),
) {
	const [attempt] = await db
		.update(articles)
		.set({
			enrichmentAttemptedAt: attemptedAt,
			enrichmentAttempts: sql`${articles.enrichmentAttempts} + 1`,
			nextEnrichmentAt: null,
		})
		.where(and(eq(articles.id, articleId), dueArticleEnrichment(attemptedAt)))
		.returning({
			articleId: articles.id,
			attempts: articles.enrichmentAttempts,
			contentVersion: articles.contentVersion,
			hash: articles.hash,
			canonicalUrl: articles.canonicalUrl,
			title: articles.title,
			author: articles.author,
			contentHtml: articles.contentHtml,
			heroImageUrl: articles.heroImageUrl,
		});
	return attempt?.canonicalUrl ? { ...attempt, canonicalUrl: attempt.canonicalUrl } : null;
}

function currentAttempt(attempt: EnrichmentAttempt) {
	return and(
		eq(articles.id, attempt.articleId),
		eq(articles.contentStatus, 'enrichment_pending'),
		eq(articles.enrichmentAttempts, attempt.attempts),
		eq(articles.contentVersion, attempt.contentVersion),
		// Legacy refreshes change the hash without advancing the public content version.
		eq(articles.hash, attempt.hash),
	);
}

export async function markArticleEnrichmentRetry(
	db: Database,
	attempt: EnrichmentAttempt,
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
		.where(currentAttempt(attempt))
		.returning({ contentVersion: articles.contentVersion, feedId: articles.feedId });
	return updated ?? null;
}

export async function markArticleEnrichmentComplete(
	db: Database,
	attempt: EnrichmentAttempt,
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
		.where(currentAttempt(attempt))
		.returning({ contentVersion: articles.contentVersion, feedId: articles.feedId });
	return updated ?? null;
}

export function replaceArticleEnrichedContent(
	db: Database,
	attempt: EnrichmentAttempt,
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
			.where(currentAttempt(attempt))
			.returning({ contentVersion: articles.contentVersion, feedId: articles.feedId })
			.all();
		if (!updated) return null;
		tx.delete(articleMedia).where(eq(articleMedia.articleId, attempt.articleId)).run();
		if (data.media.length > 0) tx.insert(articleMedia).values(data.media).run();
		return updated;
	});
}
