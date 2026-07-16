import type { FeedWithCounts } from '@self-feed/shared';

export interface FeedHealthIssue {
	detail: string;
	failedAt: string | null;
	severity: 'warning' | 'error';
	title: string;
	warning: string;
}

export function feedHealthIssue(feed: FeedWithCounts): FeedHealthIssue | null {
	if (feed.syncStatus !== 'error' && !feed.lastSyncError) return null;

	const detail = formatFeedSourceDetail(
		feed.lastSyncError?.trim() || 'The latest feed refresh failed.',
	);
	const failedAt = feed.lastSyncErrorAt ? formatFeedHealthTime(feed.lastSyncErrorAt) : null;
	const severity = feed.syncStatus === 'error' ? 'error' : 'warning';
	const summary =
		severity === 'error'
			? `${feed.title} is not updating.`
			: `${feed.title} updated with a warning.`;
	return {
		detail,
		failedAt,
		severity,
		title: severity === 'error' ? 'Feed source unavailable' : 'Feed source warning',
		warning: `${summary} ${detail}${failedAt ? ` Last checked at ${failedAt}.` : ''}`,
	};
}

export function formatFeedSourceDetail(detail: string) {
	const rejectedStatus = detail.match(/HTTP (?:401|403)(?:: [^)]+)?/i)?.[0];
	if (rejectedStatus) {
		return `The publisher rejected this feed server's request (${rejectedStatus}). Your SelfFeed account is not blocked.`;
	}
	return detail;
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
