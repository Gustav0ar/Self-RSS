const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;
const rejectedCounts = new Map<string, number>();

export function offlineRejectionCount(userId: string) {
	return rejectedCounts.get(userId) ?? 0;
}

export function reportOfflineRejection(userId: string) {
	rejectedCounts.set(userId, offlineRejectionCount(userId) + 1);
	for (const listener of listeners) listener();
	channel?.postMessage({ kind: 'rejected', userId });
}

export function dismissOfflineRejections(userId: string) {
	rejectedCounts.delete(userId);
	for (const listener of listeners) listener();
	channel?.postMessage({ kind: 'dismissed', userId });
}

/** Notify readers after a storage transaction settles, including other open tabs. */
export function notifyOfflineChange() {
	for (const listener of listeners) listener();
	channel?.postMessage('changed');
}

export function subscribeOfflineChanges(listener: () => void) {
	listeners.add(listener);
	if (!channel && typeof BroadcastChannel !== 'undefined') {
		channel = new BroadcastChannel('self-feed-offline-status');
		channel.onmessage = (event: MessageEvent<unknown>) => {
			const data = event.data;
			if (
				data &&
				typeof data === 'object' &&
				'userId' in data &&
				typeof data.userId === 'string' &&
				'kind' in data
			) {
				if (data.kind === 'rejected')
					rejectedCounts.set(data.userId, offlineRejectionCount(data.userId) + 1);
				else if (data.kind === 'dismissed') rejectedCounts.delete(data.userId);
				else return;
			} else if (data !== 'changed') return;
			for (const notify of listeners) notify();
		};
	}
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) {
			channel?.close();
			channel = null;
		}
	};
}
