import { AlertTriangle, Check, RefreshCw } from 'lucide-react';
import type { AllFeedsRefreshActivity, FeedSyncAllStatus } from '@/lib/feed-sync-status';

interface FeedRefreshStatusBannerProps {
	feedId?: string;
	allFeedsRefreshActivity: AllFeedsRefreshActivity;
	allFeedsSyncStatus: FeedSyncAllStatus | undefined;
	isRefreshingCurrentSelection: boolean;
}

export function FeedRefreshStatusBanner({
	feedId,
	allFeedsRefreshActivity,
	allFeedsSyncStatus,
	isRefreshingCurrentSelection,
}: FeedRefreshStatusBannerProps) {
	const isDurableTerminal = Boolean(allFeedsSyncStatus?.requestId && !allFeedsSyncStatus.active);
	const showStatus = feedId
		? isRefreshingCurrentSelection ||
			(isDurableTerminal && allFeedsSyncStatus?.scope?.feedId === feedId)
		: allFeedsRefreshActivity.shouldShowStatus ||
			(isDurableTerminal && !allFeedsSyncStatus?.scope?.feedId);
	if (!showStatus) {
		return null;
	}

	const isLongBackgroundSync = !feedId && allFeedsRefreshActivity.isTakingLonger;
	const completedWithErrors = (allFeedsSyncStatus?.failedFeeds ?? 0) > 0;
	const title = isDurableTerminal
		? completedWithErrors
			? 'Refresh completed with issues'
			: 'Refresh complete'
		: feedId
			? 'Loading new articles'
			: isLongBackgroundSync
				? 'Still syncing in background'
				: allFeedsSyncStatus?.queued
					? 'Refresh queued'
					: 'Loading new articles';
	const counts = buildRefreshCounts(allFeedsSyncStatus);
	const nextEligible = nextEligibleLabel(allFeedsSyncStatus);
	const detail = isDurableTerminal
		? counts || 'Feeds are up to date'
		: feedId
			? 'Checking this feed now'
			: isLongBackgroundSync
				? 'Articles will update as new stories arrive'
				: allFeedsSyncStatus?.queued
					? 'Waiting for the background worker'
					: 'Checking feeds and pulling in new stories';

	return (
		<div
			aria-live="polite"
			className="mt-2.5 overflow-hidden rounded-xl border border-primary/20 bg-primary/10 px-3 py-2"
		>
			<div className="flex min-w-0 items-center gap-3">
				<div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
					{isDurableTerminal ? (
						completedWithErrors ? (
							<AlertTriangle className="h-4 w-4" />
						) : (
							<Check className="h-4 w-4" />
						)
					) : (
						<>
							<span className="absolute h-8 w-8 motion-safe:animate-ping rounded-full bg-primary/20" />
							<RefreshCw className="relative h-4 w-4 motion-safe:animate-spin" />
						</>
					)}
				</div>
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-medium text-foreground">{title}</p>
					<p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>
					{nextEligible ? (
						<p className="mt-0.5 text-xs text-muted-foreground">
							Next publisher check: {nextEligible}
						</p>
					) : null}
				</div>
			</div>
			{!isDurableTerminal ? (
				<div className="mt-3 h-1 overflow-hidden rounded-full bg-background/60">
					<div className="h-full w-full motion-safe:animate-pulse rounded-full bg-primary/70" />
				</div>
			) : null}
		</div>
	);
}

function buildRefreshCounts(status: FeedSyncAllStatus | undefined) {
	if (!status) return '';
	const parts = [
		status.totalFeeds != null ? `${status.completedFeeds ?? 0}/${status.totalFeeds} checked` : null,
		status.newArticles ? `${status.newArticles} new` : null,
		status.failedFeeds ? `${status.failedFeeds} failed` : null,
		status.skippedFeeds ? `${status.skippedFeeds} deferred` : null,
	];
	return parts.filter(Boolean).join(' · ');
}

function nextEligibleLabel(status: FeedSyncAllStatus | undefined) {
	const timestamps = status?.items
		?.map((item) => item.nextEligibleAt && Date.parse(item.nextEligibleAt))
		.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
	if (!timestamps?.length) return null;
	return new Date(Math.min(...timestamps)).toLocaleString();
}
