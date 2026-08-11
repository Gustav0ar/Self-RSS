import type { ApiListResponse, ArticleDetail, ArticleListItem } from '@self-feed/shared';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { updateArticleQueries } from './article-cache-updates';
import { type ArticleQueryParams, articleQueryKey } from './cache-query-helpers';

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
	qc.setQueryData<ArticleDetail>(articleQueryKey(articleId), (article) =>
		article ? { ...article, isSaved: saved } : article,
	);
	updateArticleQueries(qc, (queryKey, value) =>
		updateArticleSavedStateInCachedQuery(
			value,
			articleId,
			saved,
			isSavedOnlyArticlesQuery(queryKey),
		),
	);
	qc.setQueriesData({ queryKey: ['search'] }, (value) =>
		updateArticleSavedStateInCachedQuery(value, articleId, saved),
	);
}
