import type { ApiListResponse, ArticleDetail, ArticleListItem } from '@self-feed/shared';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { updateArticleQueries } from './article-cache-updates';
import { type ArticleQueryParams, articleQueryKey } from './cache-query-helpers';

function articleListItemFromValue(value: unknown, articleId: string): ArticleListItem | null {
	if (!value || typeof value !== 'object') return null;
	if ('pages' in value && Array.isArray(value.pages)) {
		for (const page of value.pages) {
			const article = articleListItemFromValue(page, articleId);
			if (article) return article;
		}
	}
	if ('data' in value && Array.isArray(value.data)) {
		const article = value.data.find(
			(item): item is ArticleListItem =>
				!!item && typeof item === 'object' && 'id' in item && item.id === articleId,
		);
		if (article) return article;
	}
	return null;
}

function findCachedArticleListItem(qc: QueryClient, articleId: string): ArticleListItem | null {
	const detail = qc.getQueryData<ArticleDetail>(articleQueryKey(articleId));
	if (detail) {
		return {
			id: detail.id,
			feedId: detail.feedId,
			feedTitle: detail.feedTitle,
			feedFaviconUrl: detail.feedFaviconUrl,
			canonicalUrl: detail.canonicalUrl,
			title: detail.title,
			author: detail.author,
			excerpt: detail.excerpt,
			heroImageUrl: detail.heroImageUrl,
			publishedAt: detail.publishedAt,
			displayedAt: detail.publishedAt ?? detail.fetchedAt,
			isRead: detail.isRead,
			isSaved: detail.isSaved,
			contentStatus: detail.contentStatus,
			contentVersion: detail.contentVersion,
		};
	}
	for (const root of ['articles', 'search'] as const) {
		for (const [, value] of qc.getQueriesData({ queryKey: [root] })) {
			const article = articleListItemFromValue(value, articleId);
			if (article) return article;
		}
	}
	return null;
}

function savedQueryAcceptsArticle(queryKey: QueryKey, article: ArticleListItem) {
	const params = queryKey[1];
	if (params && typeof params === 'object' && !Array.isArray(params)) {
		const query = params as ArticleQueryParams;
		return (
			!query.categoryId &&
			(!query.feedId || query.feedId === article.feedId) &&
			(!query.unreadOnly || !article.isRead)
		);
	}
	return (
		!queryKey[2] &&
		(!queryKey[1] || queryKey[1] === article.feedId) &&
		(queryKey[3] !== true || !article.isRead)
	);
}

function insertIntoSavedQuery(value: unknown, article: ArticleListItem, sort: unknown): unknown {
	if (!value || typeof value !== 'object') return value;
	if ('pages' in value && Array.isArray(value.pages)) {
		if (articleListItemFromValue(value, article.id)) return value;
		const [first, ...rest] = value.pages;
		return {
			...value,
			pages: [insertIntoSavedQuery(first, article, sort), ...rest],
		};
	}
	if ('data' in value && Array.isArray(value.data)) {
		if (articleListItemFromValue(value, article.id)) return value;
		const direction = sort === 'oldest' ? 1 : -1;
		return {
			...value,
			data: [...value.data, { ...article, isSaved: true }].sort(
				(left: ArticleListItem, right: ArticleListItem) =>
					direction * left.displayedAt.localeCompare(right.displayedAt),
			),
		};
	}
	return value;
}

export function updateArticleListResponseSavedState(
	response: ApiListResponse<ArticleListItem>,
	articleId: string,
	saved: boolean,
	removeWhenUnsaved = false,
): ApiListResponse<ArticleListItem> {
	let changed = false;
	const data = response.data.flatMap((article) => {
		if (article.id !== articleId) return [article];
		if (!saved && removeWhenUnsaved) {
			changed = true;
			return [];
		}
		if (article.isSaved === saved) return [article];
		changed = true;
		return [{ ...article, isSaved: saved }];
	});

	return changed ? { ...response, data } : response;
}

export function updateArticleSavedStateInCachedQuery(
	value: unknown,
	articleId: string,
	saved: boolean,
	removeWhenUnsaved = false,
): unknown {
	if (!value || typeof value !== 'object') return value;
	if ('pages' in value && Array.isArray(value.pages)) {
		return {
			...value,
			pages: value.pages.map((page) =>
				updateArticleSavedStateInCachedQuery(page, articleId, saved, removeWhenUnsaved),
			),
		};
	}
	if ('data' in value && Array.isArray(value.data)) {
		return updateArticleListResponseSavedState(
			value as ApiListResponse<ArticleListItem>,
			articleId,
			saved,
			removeWhenUnsaved,
		);
	}
	return value;
}

export function isSavedOnlyArticlesQuery(queryKey: QueryKey) {
	if (queryKey[0] !== 'articles') return false;
	const params = queryKey[1];
	if (params && typeof params === 'object' && !Array.isArray(params)) {
		return Boolean((params as ArticleQueryParams).savedOnly);
	}
	return queryKey[4] === true;
}

export function applyArticleSavedState(qc: QueryClient, articleId: string, saved: boolean) {
	const snapshot = saved ? findCachedArticleListItem(qc, articleId) : null;
	qc.setQueryData<ArticleDetail>(articleQueryKey(articleId), (article) =>
		article ? { ...article, isSaved: saved } : article,
	);
	updateArticleQueries(qc, (queryKey, value) => {
		const updated = updateArticleSavedStateInCachedQuery(
			value,
			articleId,
			saved,
			isSavedOnlyArticlesQuery(queryKey),
		);
		if (
			!saved ||
			!snapshot ||
			!isSavedOnlyArticlesQuery(queryKey) ||
			!savedQueryAcceptsArticle(queryKey, snapshot)
		) {
			return updated;
		}
		const params = queryKey[1];
		const sort =
			params && typeof params === 'object' && !Array.isArray(params)
				? (params as ArticleQueryParams).sort
				: queryKey[5];
		return insertIntoSavedQuery(updated, snapshot, sort);
	});
	qc.setQueriesData({ queryKey: ['search'] }, (value) =>
		updateArticleSavedStateInCachedQuery(value, articleId, saved),
	);
}
