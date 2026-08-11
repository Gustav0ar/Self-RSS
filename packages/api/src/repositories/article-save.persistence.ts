import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { articleSaves } from '../db/schema.js';

export async function saveArticle(db: Database, userId: string, articleId: string) {
	const inserted = await db
		.insert(articleSaves)
		.values({ userId, articleId })
		.onConflictDoNothing()
		.returning({ articleId: articleSaves.articleId });
	return inserted.length > 0;
}

export async function unsaveArticle(db: Database, userId: string, articleId: string) {
	const deleted = await db
		.delete(articleSaves)
		.where(and(eq(articleSaves.userId, userId), eq(articleSaves.articleId, articleId)))
		.returning({ articleId: articleSaves.articleId });
	return deleted.length > 0;
}
