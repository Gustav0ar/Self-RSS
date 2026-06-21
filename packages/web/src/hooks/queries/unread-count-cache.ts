import type { CategoryWithCounts, FeedWithCounts, StatsResponse } from '@self-feed/shared';
import type { QueryClient } from '@tanstack/react-query';

export function isFeedWithCounts(obj: unknown): obj is FeedWithCounts {
	return typeof obj === 'object' && obj !== null && 'id' in obj && 'unreadCount' in obj;
}

export function isCategoryWithCounts(obj: unknown): obj is CategoryWithCounts {
	return typeof obj === 'object' && obj !== null && 'id' in obj && 'unreadCount' in obj;
}

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
