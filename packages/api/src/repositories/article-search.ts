import type { Database as BunDatabase } from 'bun:sqlite';
import { getRawDb } from '../db/client.js';
import { decodeArticleCursor } from '../utils/article-cursor.js';
import {
	type ArticleScope,
	mapSearchRow,
	type RawSearchRow,
	type SearchRow,
	toFtsQuery,
} from './article-query.helpers.js';

export function searchArticles(
	rawDbOverride: BunDatabase | undefined,
	userId: string,
	query: string,
	feedIds: string[],
	limit: number,
	cursor?: string,
): SearchRow[] {
	if (feedIds.length === 0) return [];
	const ftsQuery = toFtsQuery(query);
	if (!ftsQuery) return [];

	const params: (string | number)[] = [ftsQuery, userId, userId, ...feedIds];
	const cursorCondition = appendSearchCursor(params, cursor);
	const feedIdPlaceholders = feedIds.map(() => '?').join(', ');
	const querySql = `${searchSelectSql()} WHERE a.feed_id IN (${feedIdPlaceholders})${cursorCondition}${searchOrderSql()}`;
	params.push(limit + 1);
	return runSearch(rawDbOverride, querySql, params);
}

export function searchArticlesByScope(
	rawDbOverride: BunDatabase | undefined,
	scope: ArticleScope,
	query: string,
	limit: number,
	cursor?: string,
): SearchRow[] {
	const ftsQuery = toFtsQuery(query);
	if (!ftsQuery) return [];

	const params: (string | number)[] = [ftsQuery, scope.userId, scope.userId, scope.userId];
	let scopeFilter = 'f.user_id = ?';
	if (scope.feedId) {
		scopeFilter += ' AND f.id = ?';
		params.push(scope.feedId);
	}
	if (scope.categoryId) {
		scopeFilter +=
			' AND f.category_id IN (WITH RECURSIVE category_scope(id) AS (SELECT id FROM categories WHERE id = ? AND user_id = ? UNION ALL SELECT child.id FROM categories child INNER JOIN category_scope parent ON child.parent_category_id = parent.id WHERE child.user_id = ?) SELECT id FROM category_scope)';
		params.push(scope.categoryId, scope.userId, scope.userId);
	}

	const cursorCondition = appendSearchCursor(params, cursor);
	const querySql = `${searchSelectSql()} WHERE ${scopeFilter}${cursorCondition}${searchOrderSql()}`;
	params.push(limit + 1);
	return runSearch(rawDbOverride, querySql, params);
}

function appendSearchCursor(params: (string | number)[], cursor?: string) {
	const decodedCursor = decodeArticleCursor(cursor, 'latest');
	if (decodedCursor?.ftsRank == null) return '';
	params.push(
		decodedCursor.ftsRank,
		decodedCursor.ftsRank,
		decodedCursor.seconds,
		decodedCursor.seconds,
		decodedCursor.id,
	);
	return ' AND (fts.fts_rank > ? OR (fts.fts_rank = ? AND (coalesce(a.published_at, a.fetched_at) < ? OR (coalesce(a.published_at, a.fetched_at) = ? AND a.id < ?))))';
}

function searchSelectSql() {
	return 'WITH fts AS (SELECT article_id, bm25(articles_fts) AS fts_rank FROM articles_fts WHERE articles_fts MATCH ?) SELECT a.id, a.feed_id as feedId, a.canonical_url as canonicalUrl, a.title, a.author, a.excerpt, a.hero_image_url as heroImageUrl, a.published_at as publishedAt, a.fetched_at as fetchedAt, a.content_status as contentStatus, a.content_version as contentVersion, f.title as feedTitle, f.favicon_url as feedFaviconUrl, ar.user_id IS NOT NULL as isRead, article_saves.user_id IS NOT NULL as isSaved, fts.fts_rank as ftsRank FROM articles a INNER JOIN feeds f ON a.feed_id = f.id INNER JOIN fts ON a.id = fts.article_id LEFT JOIN article_reads ar ON a.id = ar.article_id AND ar.user_id = ? LEFT JOIN article_saves ON a.id = article_saves.article_id AND article_saves.user_id = ?';
}

function searchOrderSql() {
	return ' ORDER BY fts.fts_rank ASC, coalesce(a.published_at, a.fetched_at) DESC, a.id DESC LIMIT ?';
}

function runSearch(
	rawDbOverride: BunDatabase | undefined,
	querySql: string,
	params: (string | number)[],
): SearchRow[] {
	const rawDb = rawDbOverride ?? getRawDb();
	if (!rawDb) return [];
	const rows = rawDb.query(querySql).all(...params) as RawSearchRow[];
	return rows.map(mapSearchRow);
}
