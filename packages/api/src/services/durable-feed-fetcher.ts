import {
	type FeedFetchRelayConfig,
	fetchFeedWithRelayFallback,
} from '../utils/feed-fetch-relay.js';
import type { fetchSourceSafely } from './feed-source-request.js';

export function createDurableFeedFetcher(
	relay: FeedFetchRelayConfig = {},
	deps: {
		directFetch?: typeof fetchSourceSafely;
		relayFetch?: typeof fetch;
	} = {},
): typeof fetchSourceSafely {
	return (input, init, securityOptions) =>
		fetchFeedWithRelayFallback(input, init, securityOptions, relay, {
			directFetch: deps.directFetch,
			fetchImpl: deps.relayFetch,
		});
}
