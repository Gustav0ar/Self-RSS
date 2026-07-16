import type { FeedWithCounts } from '@self-feed/shared';

export interface FeedHealthIssue {
	detail: string;
	failedAt: string | null;
	warning: string;
}

export function feedHealthIssue(feed: FeedWithCounts): FeedHealthIssue | null {
	if (feed.syncStatus !== 'error' && !feed.lastSyncError) return null;

	const detail = feed.lastSyncError?.trim() || 'The latest feed refresh failed.';
	const failedAt = feed.lastSyncErrorAt ? formatFeedHealthTime(feed.lastSyncErrorAt) : null;
	return {
		detail,
		failedAt,
		warning: `${feed.title} is not updating. ${detail}${failedAt ? ` Last failed at ${failedAt}.` : ''}`,
	};
}

export function feedHealthFingerprint(feeds: FeedWithCounts[]): string {
	return feeds
		.filter((feed) => feedHealthIssue(feed) != null)
		.map((feed) =>
			[feed.id, feed.syncStatus, feed.lastSyncError ?? '', feed.lastSyncErrorAt ?? ''].join(':'),
		)
		.sort()
		.join('|');
}

function formatFeedHealthTime(value: string) {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
