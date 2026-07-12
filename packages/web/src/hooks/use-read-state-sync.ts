import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { applyReadStateSyncEvent } from '@/hooks/queries';
import { getClientId } from '@/lib/api';
import { REFRESH_INTERVALS } from '@/lib/constants';
import { streamReadStateEvents } from '@/lib/read-state-events';

export function getReadStateReconnectDelay(attempt: number) {
	return Math.min(
		REFRESH_INTERVALS.RECONNECT_MAX_MS,
		REFRESH_INTERVALS.RECONNECT_MIN_MS * 2 ** attempt,
	);
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

		const connect = () => {
			if (stopped) {
				return;
			}

			controller = new AbortController();
			void streamReadStateEvents({
				signal: controller.signal,
				onConnected: () => {
					reconnectAttempt = 0;
					// Redis Pub/Sub is intentionally ephemeral. Reconcile every active
					// cache family after reconnect so events lost while offline cannot
					// leave the reader or counts stale.
					qc.invalidateQueries({ queryKey: ['articles'] });
					qc.invalidateQueries({ queryKey: ['article'] });
					qc.invalidateQueries({ queryKey: ['search'] });
					qc.invalidateQueries({ queryKey: ['feeds'] });
					qc.invalidateQueries({ queryKey: ['categories'] });
					qc.invalidateQueries({ queryKey: ['stats'] });
				},
				onEvent: (event) => {
					reconnectAttempt = 0;
					applyReadStateSyncEvent(qc, event, { clientId });
				},
			})
				.catch(() => {
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
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
			}
			controller?.abort();
		};
	}, [enabled, qc]);
}
