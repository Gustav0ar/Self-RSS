import { RefreshCw } from 'lucide-react';
import type { AllFeedsRefreshActivity, FeedSyncAllStatus } from '@/lib/feed-sync-status';
import { cn } from '@/lib/utils';

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
	const showStatus = feedId
		? isRefreshingCurrentSelection
		: allFeedsRefreshActivity.shouldShowStatus;
	if (!showStatus) {
		return null;
	}

	const isLongBackgroundSync = !feedId && allFeedsRefreshActivity.isTakingLonger;
	const animateStatus = !isLongBackgroundSync;
	const title = feedId
		? 'Loading new articles'
		: isLongBackgroundSync
			? 'Still syncing in background'
			: allFeedsSyncStatus?.queued
				? 'Refresh queued'
				: 'Loading new articles';
	const detail = feedId
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
					{animateStatus ? (
						<span className="absolute h-8 w-8 animate-ping rounded-full bg-primary/20" />
					) : null}
					<RefreshCw className={cn('relative h-4 w-4', animateStatus && 'animate-spin')} />
				</div>
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-medium text-foreground">{title}</p>
					<p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>
				</div>
			</div>
			<div className="mt-3 h-1 overflow-hidden rounded-full bg-background/60">
				<div
					className={cn(
						'h-full w-full rounded-full bg-primary/70',
						animateStatus && 'animate-pulse',
					)}
				/>
			</div>
		</div>
	);
}
