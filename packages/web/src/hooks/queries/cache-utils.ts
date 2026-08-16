import type { RealtimeEvent } from '@self-feed/shared';
import type { QueryClient } from '@tanstack/react-query';
import {
	applyArticleReadState,
	findCachedArticleSnapshot,
	isUnreadOnlyArticlesQuery,
	updateArticleQueries,
	updateFeedArticlesReadStateInCachedQuery,
	updateOpenArticleByFeed,
} from './article-cache-updates';
import { applyArticleSavedState } from './article-saved-cache-updates';
import { applyFeedRealtimeEvent } from './feed-realtime-cache';
import {
	applyStatsDelta,
	applyUnreadCountDelta,
	cachedUnreadCountForFeed,
	setFeedUnreadCount,
	updateCategoryTreeFeedUnreadCount,
} from './unread-count-cache';

export * from './article-cache-updates';
export * from './article-saved-cache-updates';
export * from './cache-query-helpers';
export * from './unread-count-cache';

export function applyReadStateSyncEvent(
	qc: QueryClient,
	event: RealtimeEvent,
	options: { clientId: string },
) {
	if (
		event.type === 'feed.sync.progress' ||
		event.type === 'feed.health.updated' ||
		event.type === 'articles.new'
	) {
		applyFeedRealtimeEvent(qc, event);
		return;
	}
	if (event.type === 'article.updated') {
		qc.invalidateQueries({ queryKey: ['article', event.articleId] });
		qc.invalidateQueries({ queryKey: ['articles'], refetchType: 'none' });
		qc.invalidateQueries({ queryKey: ['search'], refetchType: 'none' });
		return;
	}

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
	if (event.type === 'article.saved_state_changed') {
		applyArticleSavedState(qc, event.articleId, event.isSaved);
		qc.invalidateQueries({ queryKey: ['articles'], refetchType: 'none' });
		qc.invalidateQueries({ queryKey: ['search'], refetchType: 'none' });
		return;
	}

	// Handle articles.marked_read event. Earlier branches narrow the union.
	const feedIds = new Set(event.feedIds);
	const feedUnreadCounts = event.feedIds.map((feedId: string) => ({
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
