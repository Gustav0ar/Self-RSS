import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { applyReadStateSyncEvent } from '@/hooks/queries';
import { getClientId } from '@/lib/api';
import { streamReadStateEvents } from '@/lib/read-state-events';

const MIN_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export function getReadStateReconnectDelay(attempt: number) {
	return Math.min(MAX_RECONNECT_DELAY_MS, MIN_RECONNECT_DELAY_MS * 2 ** attempt);
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
