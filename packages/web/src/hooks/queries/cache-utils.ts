import type {
	ApiListResponse,
	ArticleDetail,
	ArticleListItem,
	CategoryWithCounts,
	FeedWithCounts,
	ReadStateSyncEvent,
	StatsResponse,
} from '@self-feed/shared';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

export interface FeedSyncAllStatus {
	queued: boolean;
	running: boolean;
	active: boolean;
}

export interface ArticleQueryParams {
	feedId?: string;
	categoryId?: string;
	unreadOnly?: boolean;
	sort?: 'latest' | 'oldest';
	limit?: number;
	cursor?: string;
}

// Type guards
export function isFeedWithCounts(obj: unknown): obj is FeedWithCounts {
	return typeof obj === 'object' && obj !== null && 'id' in obj && 'unreadCount' in obj;
}

export function isCategoryWithCounts(obj: unknown): obj is CategoryWithCounts {
	return typeof obj === 'object' && obj !== null && 'id' in obj && 'unreadCount' in obj;
}

// Core cache query key helpers
export function invalidateReaderQueries(qc: QueryClient) {
	qc.invalidateQueries({ queryKey: ['articles'] });
	qc.invalidateQueries({ queryKey: ['article'] });
	qc.invalidateQueries({ queryKey: ['feeds'] });
	qc.invalidateQueries({ queryKey: ['categories'] });
	qc.invalidateQueries({ queryKey: ['stats'] });
	qc.invalidateQueries({ queryKey: ['search'] });
}

/**
 * Return the first cached query key under `prefix` that is currently in
 * flight. Used by optimistic mutations to cancel only the scope the user is
 * interacting with, instead of every query under a broad prefix.
 */
export function findActiveQueryKey(qc: QueryClient, prefix: readonly unknown[]): QueryKey | null {
	const cache = qc.getQueryCache();
	const queries = cache.findAll({ queryKey: prefix });
	for (const query of queries) {
		if (query.state.fetchStatus === 'fetching') {
			return query.queryKey;
		}
	}
	return null;
}

export function buildArticleSearchParams(params: ArticleQueryParams, cursor?: string | null) {
	const searchParams = new URLSearchParams();
	if (params.feedId) searchParams.set('feedId', params.feedId);
	if (params.categoryId) searchParams.set('categoryId', params.categoryId);
	if (params.unreadOnly) searchParams.set('unreadOnly', 'true');
	if (params.sort) searchParams.set('sort', params.sort);
	if (params.limit) searchParams.set('limit', String(params.limit));
	if (cursor) searchParams.set('cursor', cursor);
	return searchParams.toString();
}

export const articleQueryKey = (articleId: string) => ['article', articleId] as const;

// Article read state cache operations
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

// Feed unread count cache operations
export function updateFeedUnreadCount(value: unknown, feedId: string, delta: number): unknown {
	if (!Array.isArray(value)) {
		return value;
	}

	let changed = false;
	const feeds = value.map((feed) => {
		if (!isFeedWithCounts(feed) || feed.id !== feedId) {
			return feed;
		}

		changed = true;
		const unreadCount = Math.max(0, Number(feed.unreadCount ?? 0) + delta);
		return { ...feed, unreadCount };
	});

	return changed ? feeds : value;
}

export function setFeedUnreadCount(value: unknown, feedId: string, unreadCount: number): unknown {
	if (!Array.isArray(value)) {
		return value;
	}

	let changed = false;
	const feeds = value.map((feed) => {
		if (!feed || typeof feed !== 'object' || !('id' in feed) || feed.id !== feedId) {
			return feed;
		}

		changed = true;
		return { ...feed, unreadCount };
	});

	return changed ? feeds : value;
}

export function updateCategoryTreeFeedUnreadCount(
	value: unknown,
	feedId: string,
	updater: (current: number) => number,
): unknown {
	if (!Array.isArray(value)) {
		return value;
	}

	let changed = false;
	const updateCategory = (category: unknown): unknown => {
		if (!isCategoryWithCounts(category)) {
			return category;
		}

		const node = category;
		let feedsChanged = false;
		const feeds = Array.isArray(node.feeds)
			? node.feeds.map((feed) => {
					if (!feed || typeof feed !== 'object' || feed.id !== feedId) {
						return feed;
					}

					feedsChanged = true;
					const unreadCount = Math.max(0, updater(Number(feed.unreadCount ?? 0)));
					return { ...feed, unreadCount };
				})
			: node.feeds;

		let childChanged = false;
		const children = Array.isArray(node.children)
			? node.children.map((child) => {
					const nextChild = updateCategory(child);
					if (nextChild !== child) childChanged = true;
					return nextChild;
				})
			: node.children;

		if (!feedsChanged && !childChanged) {
			return category;
		}

		changed = true;
		return { ...node, feeds, children };
	};

	const categories = value.map((category) => updateCategory(category));
	return changed ? categories : value;
}

export function findCachedFeed(qc: QueryClient, feedId: string): { categoryId: string } | null {
	for (const [, data] of qc.getQueriesData({ queryKey: ['feeds'] })) {
		if (!Array.isArray(data)) {
			continue;
		}
		const feed = data.find(
			(item): item is FeedWithCounts =>
				item && typeof item === 'object' && 'id' in item && item.id === feedId,
		);
		if (feed) {
			return { categoryId: feed.categoryId };
		}
	}

	const findInCategories = (categories: unknown): { categoryId: string } | null => {
		if (!Array.isArray(categories)) {
			return null;
		}

		for (const category of categories) {
			if (!isCategoryWithCounts(category)) {
				continue;
			}
			const node = category;
			const feed = node.feeds?.find((item) => item.id === feedId);
			if (feed) {
				return { categoryId: feed.categoryId };
			}
			const nested = findInCategories(node.children);
			if (nested) {
				return nested;
			}
		}

		return null;
	};

	for (const [, data] of qc.getQueriesData({ queryKey: ['categories'] })) {
		const feed = findInCategories(data);
		if (feed) {
			return feed;
		}
	}
	return null;
}

export function updateCategoryUnreadCount(
	value: unknown,
	categoryId: string,
	delta: number,
): unknown {
	if (!Array.isArray(value)) {
		return value;
	}

	let changed = false;
	const updateCategory = (category: unknown): unknown => {
		if (!isCategoryWithCounts(category)) {
			return category;
		}

		const node = category;
		let childChanged = false;
		const children = Array.isArray(node.children)
			? node.children.map((child) => {
					const nextChild = updateCategory(child);
					if (nextChild !== child) childChanged = true;
					return nextChild;
				})
			: node.children;
		const isTarget = node.id === categoryId;

		if (!isTarget && !childChanged) {
			return category;
		}

		changed = true;
		const unreadCount = Math.max(0, Number(node.unreadCount ?? 0) + delta);
		return { ...node, children, unreadCount };
	};

	const categories = value.map((category) => updateCategory(category));

	return changed ? categories : value;
}

// Higher-level cache operations
export function applyUnreadCountDelta(qc: QueryClient, feedId: string, delta: number) {
	const feed = findCachedFeed(qc, feedId);

	qc.setQueriesData({ queryKey: ['feeds'] }, (value) =>
		updateFeedUnreadCount(value, feedId, delta),
	);
	qc.setQueriesData({ queryKey: ['categories'] }, (value) =>
		updateCategoryTreeFeedUnreadCount(value, feedId, (current) => current + delta),
	);

	if (feed) {
		qc.setQueriesData({ queryKey: ['categories'] }, (value) =>
			updateCategoryUnreadCount(value, feed.categoryId, delta),
		);
	}
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

export function applyStatsDelta(qc: QueryClient, unreadDelta: number, readDelta: number) {
	qc.setQueryData<StatsResponse>(['stats'], (stats) =>
		stats
			? {
					...stats,
					totalUnread: Math.max(0, stats.totalUnread + unreadDelta),
					totalRead: Math.max(0, stats.totalRead + readDelta),
				}
			: stats,
	);
}

export function updateOpenArticleByFeed(qc: QueryClient, feedIds: Set<string>) {
	for (const [queryKey, value] of qc.getQueriesData<ArticleDetail>({ queryKey: ['article'] })) {
		if (value?.feedId && feedIds.has(value.feedId) && !value.isRead) {
			qc.setQueryData<ArticleDetail>(queryKey, { ...value, isRead: true });
		}
	}
}

export function cachedUnreadCountForFeed(qc: QueryClient, feedId: string) {
	for (const [, value] of qc.getQueriesData({ queryKey: ['feeds'] })) {
		if (!Array.isArray(value)) {
			continue;
		}
		const feed = value.find(
			(item): item is FeedWithCounts =>
				item && typeof item === 'object' && 'id' in item && item.id === feedId,
		);
		if (feed) {
			return Math.max(0, Number(feed.unreadCount ?? 0));
		}
	}

	const findInCategories = (categories: unknown): number | null => {
		if (!Array.isArray(categories)) {
			return null;
		}

		for (const category of categories) {
			if (!isCategoryWithCounts(category)) {
				continue;
			}

			const node = category;
			const feed = node.feeds?.find((item) => item.id === feedId);
			if (feed) {
				return Math.max(0, Number(feed.unreadCount ?? 0));
			}

			const nested = findInCategories(node.children);
			if (nested != null) {
				return nested;
			}
		}

		return null;
	};

	for (const [, value] of qc.getQueriesData({ queryKey: ['categories'] })) {
		const unreadCount = findInCategories(value);
		if (unreadCount != null) {
			return unreadCount;
		}
	}
	return 0;
}

export function applyReadStateSyncEvent(
	qc: QueryClient,
	event: ReadStateSyncEvent,
	options: { clientId: string },
) {
	if (event.clientId && event.clientId === options.clientId) {
		return;
	}

	if (event.type === 'article.read_state_changed') {
		const snapshot = findCachedArticleSnapshot(qc, event.articleId);
		applyArticleReadState(qc, event.articleId, event.isRead);

		const shouldUpdateCounts = snapshot ? snapshot.isRead !== event.isRead : true;
		if (shouldUpdateCounts) {
			applyUnreadCountDelta(qc, event.feedId, event.isRead ? -1 : 1);
			applyStatsDelta(qc, event.isRead ? -1 : 1, event.isRead ? 1 : -1);
		}

		if (!event.isRead) {
			qc.invalidateQueries({ queryKey: ['articles'] });
		}
		qc.invalidateQueries({ queryKey: ['feeds'], refetchType: 'none' });
		qc.invalidateQueries({ queryKey: ['categories'], refetchType: 'none' });
		qc.invalidateQueries({ queryKey: ['stats'], refetchType: 'none' });
		return;
	}

	const feedIds = new Set(event.feedIds);
	const feedUnreadCounts = event.feedIds.map((feedId) => ({
		feedId,
		unreadCount: cachedUnreadCountForFeed(qc, feedId),
	}));

	updateOpenArticleByFeed(qc, feedIds);
	updateArticleQueries(qc, (queryKey, value) =>
		updateFeedArticlesReadStateInCachedQuery(value, feedIds, isUnreadOnlyArticlesQuery(queryKey)),
	);
	qc.setQueriesData({ queryKey: ['search'] }, (value) =>
		updateFeedArticlesReadStateInCachedQuery(value, feedIds),
	);

	for (const { feedId, unreadCount } of feedUnreadCounts) {
		if (unreadCount > 0) {
			applyUnreadCountDelta(qc, feedId, -unreadCount);
		}
		qc.setQueriesData({ queryKey: ['feeds'] }, (value) => setFeedUnreadCount(value, feedId, 0));
		qc.setQueriesData({ queryKey: ['categories'] }, (value) =>
			updateCategoryTreeFeedUnreadCount(value, feedId, () => 0),
		);
	}
	applyStatsDelta(qc, -event.markedCount, event.markedCount);

	qc.invalidateQueries({ queryKey: ['articles'], refetchType: 'none' });
	qc.invalidateQueries({ queryKey: ['search'], refetchType: 'none' });
	qc.invalidateQueries({ queryKey: ['feeds'], refetchType: 'none' });
	qc.invalidateQueries({ queryKey: ['categories'], refetchType: 'none' });
	qc.invalidateQueries({ queryKey: ['stats'], refetchType: 'none' });
}
