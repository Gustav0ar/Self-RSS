import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { applyReadStateSyncEvent } from '@/hooks/queries';
import { getClientId } from '@/lib/api';
import { REFRESH_INTERVALS } from '@/lib/constants';
import { hasPendingArticleStateMutation } from '@/lib/offline-store';
import { streamRealtimeEvents } from '@/lib/read-state-events';

export function getReadStateReconnectDelay(attempt: number) {
	return Math.min(
		REFRESH_INTERVALS.RECONNECT_MAX_MS,
		REFRESH_INTERVALS.RECONNECT_MIN_MS * 2 ** attempt,
	);
}

const RECONNECT_QUERY_KEYS = [
	['articles'],
	['article'],
	['search'],
	['categories'],
	['stats'],
	['feeds', 'sync', 'status'],
] as const;

export function reconcileRealtimeQueries(qc: QueryClient) {
	const options = { cancelRefetch: false };
	for (const queryKey of RECONNECT_QUERY_KEYS) {
		void qc.invalidateQueries({ queryKey }, options);
	}
	// A broad ['feeds'] invalidation also matches ['feeds', 'sync', 'status'].
	// Keeping feed collections separate prevents the status snapshot from being
	// invalidated twice, which used to abort the first refetch in DevTools.
	void qc.invalidateQueries(
		{
			predicate: (query) =>
				query.queryKey[0] === 'feeds' &&
				!(query.queryKey[1] === 'sync' && query.queryKey[2] === 'status'),
		},
		options,
	);
}

export function createRealtimeConnectedHandler(qc: QueryClient) {
	let hasConnected = false;
	return () => {
		qc.setQueryData(['realtime', 'connected'], true);
		if (!hasConnected) {
			hasConnected = true;
			return;
		}
		reconcileRealtimeQueries(qc);
	};
}

export function useReadStateSync(enabled: boolean) {
	const qc = useQueryClient();

	useEffect(() => {
		if (!enabled) {
			return;
		}

		let stopped = false;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
		let controller: AbortController | null = null;
		let reconnectAttempt = 0;
		const clientId = getClientId();
		const handleConnected = createRealtimeConnectedHandler(qc);

		const connect = () => {
			if (stopped) {
				return;
			}

			controller = new AbortController();
			void streamRealtimeEvents({
				signal: controller.signal,
				onConnected: () => {
					reconnectAttempt = 0;
					handleConnected();
				},
				onEvent: (event) => {
					reconnectAttempt = 0;
					if (
						event.type === 'article.read_state_changed' ||
						event.type === 'article.saved_state_changed'
					) {
						const articleStateEvent = event;
						const mutationKind =
							articleStateEvent.type === 'article.read_state_changed' ? 'read' : 'saved';
						void hasPendingArticleStateMutation(articleStateEvent.articleId, mutationKind).then(
							(pending) => {
								if (!pending) applyReadStateSyncEvent(qc, articleStateEvent, { clientId });
							},
						);
					} else {
						applyReadStateSyncEvent(qc, event, { clientId });
					}
				},
			})
				.catch(() => {
					qc.setQueryData(['realtime', 'connected'], false);
					// Reconnect below unless this was an intentional shutdown.
				})
				.finally(() => {
					if (stopped) {
						return;
					}
					const delay = getReadStateReconnectDelay(reconnectAttempt);
					reconnectAttempt += 1;
					reconnectTimer = setTimeout(connect, delay);
				});
		};

		connect();

		return () => {
			stopped = true;
			qc.setQueryData(['realtime', 'connected'], false);
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
			}
			controller?.abort();
		};
	}, [enabled, qc]);
}
