import type { ApiListResponse, ArticleDetail, ArticleListItem } from '@self-feed/shared';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { type ArticleQueryParams, articleQueryKey } from './cache-query-helpers';

export function updateArticleListResponseReadState(
	response: ApiListResponse<ArticleListItem>,
	articleId: string,
	read: boolean,
): ApiListResponse<ArticleListItem> {
	let changed = false;
	const data = response.data.map((article) => {
		if (article.id !== articleId || article.isRead === read) {
			return article;
		}
		changed = true;
		return { ...article, isRead: read };
	});

	return changed ? { ...response, data } : response;
}

export function updateArticleReadStateInCachedQuery(
	value: unknown,
	articleId: string,
	read: boolean,
): unknown {
	if (!value || typeof value !== 'object') {
		return value;
	}

	if ('pages' in value && Array.isArray(value.pages)) {
		return {
			...value,
			pages: value.pages.map((page) => {
				if (page && typeof page === 'object' && 'data' in page && Array.isArray(page.data)) {
					return updateArticleListResponseReadState(
						page as ApiListResponse<ArticleListItem>,
						articleId,
						read,
					);
				}
				return page;
			}),
		};
	}

	if ('data' in value && Array.isArray(value.data)) {
		return updateArticleListResponseReadState(
			value as ApiListResponse<ArticleListItem>,
			articleId,
			read,
		);
	}

	return value;
}

export function updateFeedArticlesReadStateInCachedQuery(
	value: unknown,
	feedIds: Set<string>,
	removeReadArticles = false,
): unknown {
	if (!value || typeof value !== 'object') {
		return value;
	}

	if ('pages' in value && Array.isArray(value.pages)) {
		return {
			...value,
			pages: value.pages.map((page) =>
				updateFeedArticlesReadStateInCachedQuery(page, feedIds, removeReadArticles),
			),
		};
	}

	if ('data' in value && Array.isArray(value.data)) {
		let changed = false;
		const data = value.data.flatMap((article) => {
			if (
				!article ||
				typeof article !== 'object' ||
				!('feedId' in article) ||
				!feedIds.has(String(article.feedId))
			) {
				return [article];
			}

			if (removeReadArticles) {
				changed = true;
				return [];
			}

			if ('isRead' in article && article.isRead === true) {
				return [article];
			}

			changed = true;
			return [{ ...article, isRead: true }];
		});

		return changed ? { ...value, data } : value;
	}

	return value;
}

export function articleSnapshotFromCachedQuery(
	value: unknown,
	articleId: string,
): { feedId: string; isRead: boolean } | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	if ('id' in value && value.id === articleId && 'feedId' in value && 'isRead' in value) {
		return { feedId: String(value.feedId), isRead: Boolean(value.isRead) };
	}

	if ('pages' in value && Array.isArray(value.pages)) {
		for (const page of value.pages) {
			const snapshot = articleSnapshotFromCachedQuery(page, articleId);
			if (snapshot) {
				return snapshot;
			}
		}
	}

	if ('data' in value && Array.isArray(value.data)) {
		const article = value.data.find(
			(item): item is ArticleListItem =>
				item && typeof item === 'object' && 'id' in item && item.id === articleId,
		);
		if (article) {
			return { feedId: article.feedId, isRead: article.isRead };
		}
	}

	return null;
}

export function findCachedArticleSnapshot(
	qc: QueryClient,
	articleId: string,
): { feedId: string; isRead: boolean } | null {
	const detailSnapshot = articleSnapshotFromCachedQuery(
		qc.getQueryData(articleQueryKey(articleId)),
		articleId,
	);
	if (detailSnapshot) {
		return detailSnapshot;
	}

	for (const [, data] of qc.getQueriesData({ queryKey: ['articles'] })) {
		const snapshot = articleSnapshotFromCachedQuery(data, articleId);
		if (snapshot) {
			return snapshot;
		}
	}

	for (const [, data] of qc.getQueriesData({ queryKey: ['search'] })) {
		const snapshot = articleSnapshotFromCachedQuery(data, articleId);
		if (snapshot) {
			return snapshot;
		}
	}

	return null;
}

export function isUnreadOnlyArticlesQuery(queryKey: QueryKey) {
	if (queryKey[0] !== 'articles') {
		return false;
	}

	const params = queryKey[1];
	if (params && typeof params === 'object' && !Array.isArray(params)) {
		return Boolean((params as ArticleQueryParams).unreadOnly);
	}

	return queryKey[3] === true;
}

export function updateArticleQueries(
	qc: QueryClient,
	updater: (queryKey: QueryKey, value: unknown) => unknown,
) {
	for (const [queryKey, value] of qc.getQueriesData({ queryKey: ['articles'] })) {
		qc.setQueryData(queryKey, updater(queryKey, value));
	}
}

export function applyArticleReadState(qc: QueryClient, articleId: string, read: boolean) {
	qc.setQueryData<ArticleDetail>(articleQueryKey(articleId), (article) =>
		article ? { ...article, isRead: read } : article,
	);
	updateArticleQueries(qc, (_queryKey, value) =>
		updateArticleReadStateInCachedQuery(value, articleId, read),
	);
	qc.setQueriesData({ queryKey: ['search'] }, (value) =>
		updateArticleReadStateInCachedQuery(value, articleId, read),
	);
}

export function updateOpenArticleByFeed(qc: QueryClient, feedIds: Set<string>) {
	for (const [queryKey, value] of qc.getQueriesData<ArticleDetail>({ queryKey: ['article'] })) {
		if (value?.feedId && feedIds.has(value.feedId) && !value.isRead) {
			qc.setQueryData<ArticleDetail>(queryKey, { ...value, isRead: true });
		}
	}
}
