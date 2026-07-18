import type { FeedWithCounts } from '@self-feed/shared';

export type FeedLifecycleTone = 'neutral' | 'info' | 'warning' | 'error';

export interface FeedLifecyclePresentation {
	status: string;
	title: string;
	detail: string;
	tone: FeedLifecycleTone;
	refreshBlocked: boolean;
	refreshGuidance: string | null;
	canCancelReplacement: boolean;
	discoveryRequired: boolean;
}

export function presentFeedLifecycle(
	feed: FeedWithCounts,
	now = Date.now(),
): FeedLifecyclePresentation | null {
	const status = feed.lifecycleStatus ?? feed.syncStatus;
	const nextEligible = parseDate(feed.nextEligibleFetchAt);
	const eligibleLater = nextEligible != null && nextEligible > now;
	const eligibleLabel = eligibleLater ? new Date(nextEligible).toLocaleString() : null;
	const sourceDetail = feed.sourceErrorDetails?.trim() || feed.lastSyncError?.trim();

	switch (status) {
		case 'pending':
			return {
				status,
				title: 'Feed validation queued',
				detail:
					'SelfFeed is validating this source. Articles will appear after the first successful fetch.',
				tone: 'info',
				refreshBlocked: true,
				refreshGuidance: 'Validation is already queued.',
				canCancelReplacement: false,
				discoveryRequired: false,
			};
		case 'replacement_pending':
			return {
				status,
				title: 'Replacement source is being validated',
				detail:
					'Existing articles remain available until the new source succeeds. You can cancel this replacement safely.',
				tone: 'info',
				refreshBlocked: true,
				refreshGuidance: 'Replacement validation is already queued.',
				canCancelReplacement: true,
				discoveryRequired: false,
			};
		case 'discovery_required':
			return {
				status,
				title: 'Choose a feed from this site',
				detail:
					'This address is a website rather than a direct feed. Select the source you want; SelfFeed will not guess or repeatedly fetch the site.',
				tone: 'warning',
				refreshBlocked: true,
				refreshGuidance: 'Select a discovered feed before refreshing.',
				canCancelReplacement: Boolean(feed.sourceId && feed.pendingSourceId),
				discoveryRequired: true,
			};
		case 'backoff':
			return {
				status,
				title: 'Publisher cooldown active',
				detail: eligibleLabel
					? `The publisher can be checked again after ${eligibleLabel}. Existing articles remain available.`
					: 'SelfFeed is waiting before contacting this publisher again.',
				tone: 'warning',
				refreshBlocked: eligibleLater,
				refreshGuidance: eligibleLabel ? `Available after ${eligibleLabel}.` : null,
				canCancelReplacement: Boolean(feed.pendingSourceId),
				discoveryRequired: false,
			};
		case 'paused':
			return {
				status,
				title: 'Feed requires attention',
				detail: sourceDetail
					? `${sourceDetail} Review the source URL before trying again.`
					: 'Repeated or permanent source failures paused automatic fetching. Review the source URL before trying again.',
				tone: 'error',
				refreshBlocked: true,
				refreshGuidance: 'Edit the feed URL to resume validation safely.',
				canCancelReplacement: Boolean(feed.pendingSourceId),
				discoveryRequired: false,
			};
		case 'error':
			return {
				status,
				title: 'Latest refresh failed',
				detail: sourceDetail || 'The publisher could not be reached during the latest attempt.',
				tone: 'error',
				refreshBlocked: eligibleLater,
				refreshGuidance: eligibleLabel ? `Available after ${eligibleLabel}.` : null,
				canCancelReplacement: Boolean(feed.pendingSourceId),
				discoveryRequired: false,
			};
		case 'active':
		case 'idle':
			return null;
		default:
			return feed.lastSyncError
				? {
						status,
						title: 'Feed source warning',
						detail: feed.lastSyncError,
						tone: 'warning',
						refreshBlocked: eligibleLater,
						refreshGuidance: eligibleLabel ? `Available after ${eligibleLabel}.` : null,
						canCancelReplacement: Boolean(feed.pendingSourceId),
						discoveryRequired: false,
					}
				: null;
	}
}

export function isFeedRefreshBlocked(feed: FeedWithCounts | undefined, now = Date.now()) {
	return feed ? (presentFeedLifecycle(feed, now)?.refreshBlocked ?? false) : false;
}

function parseDate(value?: string | null) {
	if (!value) return null;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : null;
}
