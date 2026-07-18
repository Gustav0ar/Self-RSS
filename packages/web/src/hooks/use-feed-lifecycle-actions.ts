import type { FeedWithCounts } from '@self-feed/shared';
import { useState } from 'react';
import { useCancelFeedReplacement, useSelectFeedDiscoveryCandidate } from '@/hooks/queries';
import { presentFeedLifecycle } from '@/lib/feed-lifecycle';

export function useFeedLifecycleActions(feed: FeedWithCounts | null) {
	const [error, setError] = useState<string | null>(null);
	const selectCandidate = useSelectFeedDiscoveryCandidate();
	const cancelReplacement = useCancelFeedReplacement();
	const lifecycle = feed ? presentFeedLifecycle(feed) : null;

	async function handleSelectCandidate(candidateId: string) {
		setError(null);
		try {
			await selectCandidate.mutateAsync(candidateId);
		} catch (actionError) {
			setError(actionError instanceof Error ? actionError.message : 'Unable to select this feed');
		}
	}

	async function handleCancelReplacement() {
		if (!feed) return;
		setError(null);
		try {
			await cancelReplacement.mutateAsync(feed.id);
		} catch (actionError) {
			setError(actionError instanceof Error ? actionError.message : 'Unable to cancel replacement');
		}
	}

	return {
		error,
		lifecycle,
		isPending: selectCandidate.isPending || cancelReplacement.isPending,
		handleSelectCandidate,
		handleCancelReplacement,
	};
}
