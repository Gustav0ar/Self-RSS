import { eq, type SQL, sql } from 'drizzle-orm';
import { categories, feeds } from '../db/schema.js';

export interface ArticleScope {
	userId: string;
	feedId?: string;
	categoryId?: string;
}

export interface RawSearchRow {
	id: string;
	feedId: string;
	title: string | null;
	author: string | null;
	excerpt: string | null;
	heroImageUrl: string | null;
	publishedAt: Date | number | string | null;
	fetchedAt: Date | number | string;
	feedTitle: string;
	feedFaviconUrl: string | null;
	isRead: number | boolean;
	ftsRank: number;
}

export interface SearchRow {
	id: string;
	feedId: string;
	title: string | null;
	author: string | null;
	excerpt: string | null;
	heroImageUrl: string | null;
	publishedAt: Date | null;
	fetchedAt: Date;
	feedTitle: string;
	feedFaviconUrl: string | null;
	isRead: boolean;
	ftsRank: number;
}

export function toFtsQuery(query: string): string | null {
	const terms = query
		.trim()
		.split(/[^\p{L}\p{N}_]+/u)
		.map((term) => term.trim())
		.filter(Boolean)
		.slice(0, 16);

	if (terms.length === 0) {
		return null;
	}

	return terms
		.map((term) => {
			const sanitized = term.replace(/[^\p{L}\p{N}_]/gu, '');
			if (!sanitized) return null;
			return `"${sanitized}"*`;
		})
		.filter(Boolean)
		.join(' ');
}

export function mapSearchRow(row: RawSearchRow): SearchRow {
	const fetchedAt = sqliteTimestampToDate(row.fetchedAt);
	if (!fetchedAt) {
		throw new Error(`Invalid fetched_at timestamp for article ${row.id}`);
	}

	return {
		...row,
		publishedAt: sqliteTimestampToDate(row.publishedAt),
		fetchedAt,
		isRead: Boolean(row.isRead),
	};
}

export function scopeConditions(scope: ArticleScope): SQL[] {
	const conditions: SQL[] = [eq(feeds.userId, scope.userId)];
	if (scope.feedId) {
		conditions.push(eq(feeds.id, scope.feedId));
	}
	if (scope.categoryId) {
		conditions.push(categoryScopeSql(scope));
	}
	return conditions;
}

function sqliteTimestampToDate(value: Date | number | string | null): Date | null {
	if (value == null) {
		return null;
	}
	if (value instanceof Date) {
		return value;
	}

	const numericValue = typeof value === 'number' ? value : Number(value);
	if (Number.isFinite(numericValue)) {
		return new Date(numericValue > 1_000_000_000_000 ? numericValue : numericValue * 1000);
	}

	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function categoryScopeSql(scope: ArticleScope) {
	return sql`${feeds.categoryId} IN (
		WITH RECURSIVE category_scope(id) AS (
			SELECT ${categories.id}
			FROM ${categories}
			WHERE ${categories.id} = ${scope.categoryId}
				AND ${categories.userId} = ${scope.userId}
			UNION ALL
			SELECT child.id
			FROM categories AS child
			INNER JOIN category_scope AS parent ON child.parent_category_id = parent.id
			WHERE child.user_id = ${scope.userId}
		)
		SELECT id FROM category_scope
	)`;
}
