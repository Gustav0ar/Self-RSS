import { CacheKeys } from '../db/redis.js';
import type { ArticleRepository } from '../repositories/article.repository.js';
import { encodeArticleCursor } from '../utils/article-cursor.js';
import type { MetricsService } from './metrics.service.js';

// Users see recent articles first, so cache only the hot initial page window.
export const CACHED_ARTICLE_LIMIT = 100;

export interface CachedArticleList {
	articles: CachedArticle[];
	cursor: string | null;
	hasMore: boolean;
	meta: ArticleListCacheMeta;
}

export interface CachedArticle {
	id: string;
	feedId: string;
	feedTitle: string;
	feedFaviconUrl: string | null;
	title: string;
	author: string | null;
	excerpt: string | null;
	heroImageUrl: string | null;
	publishedAt: string | null;
	displayedAt: string;
	isRead: boolean;
}

export interface ArticleListCacheMeta {
	syncedAt: string;
	newArticlesCount: number;
	scope?: string;
	generation: number;
}

export type CacheMetrics = Pick<MetricsService, 'recordCacheHit' | 'recordCacheMiss'>;

export function isArticleListCacheKey(userId: string, key: string): boolean {
	return key === CacheKeys.articleListCache(userId) || key.startsWith(`articles:list:${userId}:`);
}

export function cacheMetricType(options: { feedId?: string; categoryId?: string }): string {
	if (options.feedId) return 'article_list_feed';
	if (options.categoryId) return 'article_list_category';
	return 'article_list';
}

export function cacheableArticleRows(
	result: Awaited<ReturnType<ArticleRepository['findByFeeds']>>,
): {
	articles: CachedArticle[];
	cursor: string | null;
	hasMore: boolean;
	rows: typeof result;
} {
	const hasMore = result.length > CACHED_ARTICLE_LIMIT;
	const rows = result.slice(0, CACHED_ARTICLE_LIMIT);
	return {
		rows,
		articles: rows.map((article) => ({
			id: article.id,
			feedId: article.feedId,
			feedTitle: article.feedTitle,
			feedFaviconUrl: article.feedFaviconUrl,
			title: article.title,
			author: article.author,
			excerpt: article.excerpt,
			heroImageUrl: article.heroImageUrl,
			publishedAt: article.publishedAt?.toISOString() ?? null,
			displayedAt: (article.publishedAt ?? article.fetchedAt).toISOString(),
			isRead: article.isRead,
		})),
		cursor: hasMore ? encodeArticleCursor(rows[rows.length - 1] ?? null, 'latest') : null,
		hasMore,
	};
}
