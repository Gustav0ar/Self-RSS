import type { ReadStateSyncEvent } from '@self-feed/shared';
import type { QueryClient } from '@tanstack/react-query';
import {
	applyArticleReadState,
	findCachedArticleSnapshot,
	isUnreadOnlyArticlesQuery,
	updateArticleQueries,
	updateFeedArticlesReadStateInCachedQuery,
	updateOpenArticleByFeed,
} from './article-cache-updates';
import {
	applyStatsDelta,
	applyUnreadCountDelta,
	cachedUnreadCountForFeed,
	setFeedUnreadCount,
	updateCategoryTreeFeedUnreadCount,
} from './unread-count-cache';

export * from './article-cache-updates';
export * from './cache-query-helpers';
export * from './unread-count-cache';

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
