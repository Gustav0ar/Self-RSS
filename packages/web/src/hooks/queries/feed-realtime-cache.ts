import type { FeedHealthUpdatedEvent, RealtimeEvent } from '@self-feed/shared';
import type { QueryClient } from '@tanstack/react-query';
import { type FeedSyncAllStatus, mergeFeedSyncStatus } from '@/lib/feed-sync-status';
import { invalidateReaderQueries } from './cache-query-helpers';

const articleRefreshTimers = new WeakMap<QueryClient, ReturnType<typeof setTimeout>>();

export function applyFeedRealtimeEvent(qc: QueryClient, event: RealtimeEvent) {
	if (event.type === 'feed.sync.progress') {
		const active = event.phase === 'queued' || event.phase === 'running';
		const incoming: FeedSyncAllStatus = {
			queued: event.phase === 'queued',
			running: event.phase === 'running',
			active,
			stale: false,
			queuedAt: event.queuedAt,
			startedAt: event.startedAt,
			heartbeatAt: event.updatedAt,
			totalFeeds: event.totalFeeds,
			completedFeeds: event.completedFeeds,
			syncedFeeds: event.syncedFeeds,
			failedFeeds: event.failedFeeds,
			skippedFeeds: event.skippedFeeds,
			newArticles: event.newArticles,
			jobId: event.jobId,
			scope: event.scope,
			phase: event.phase,
			error: event.error,
		};
		const previous = qc.getQueryData<FeedSyncAllStatus>(['feeds', 'sync', 'status']);
		const merged = mergeFeedSyncStatus(previous, incoming);
		qc.setQueryData(['feeds', 'sync', 'status'], merged);
		if (!active && previous?.active !== false && merged === incoming) {
			invalidateReaderQueries(qc);
		}
		return true;
	}

	if (event.type === 'feed.health.updated') {
		qc.setQueriesData({ queryKey: ['feeds'] }, (value) => updateFeedHealth(value, event));
		qc.setQueriesData({ queryKey: ['categories'] }, (value) => updateFeedHealth(value, event));
		return true;
	}

	if (event.type === 'articles.new') {
		qc.invalidateQueries({ queryKey: ['articles'], refetchType: 'none' });
		scheduleArticleRefresh(qc);
		qc.invalidateQueries({ queryKey: ['feeds'], refetchType: 'none' });
		qc.invalidateQueries({ queryKey: ['categories'], refetchType: 'none' });
		qc.invalidateQueries({ queryKey: ['stats'], refetchType: 'none' });
		return true;
	}

	return false;
}

function scheduleArticleRefresh(qc: QueryClient) {
	if (articleRefreshTimers.has(qc)) return;
	const timer = globalThis.setTimeout(() => {
		articleRefreshTimers.delete(qc);
		void qc.refetchQueries({ queryKey: ['articles'], type: 'active' });
	}, 250);
	articleRefreshTimers.set(qc, timer);
}

function updateFeedHealth(value: unknown, event: FeedHealthUpdatedEvent): unknown {
	if (Array.isArray(value)) return value.map((item) => updateFeedHealth(item, event));
	if (!value || typeof value !== 'object') return value;

	const record = value as Record<string, unknown>;
	const next: Record<string, unknown> =
		record.id === event.feedId && typeof record.feedUrl === 'string'
			? {
					...record,
					syncStatus: event.syncStatus,
					lastSyncedAt: event.lastSyncedAt,
					lastSyncError: event.lastSyncError,
					lastSyncErrorAt: event.lastSyncErrorAt,
					updatedAt: event.updatedAt,
				}
			: { ...record };

	if (Array.isArray(next.feeds)) next.feeds = updateFeedHealth(next.feeds, event);
	if (Array.isArray(next.children)) next.children = updateFeedHealth(next.children, event);
	return next;
}
