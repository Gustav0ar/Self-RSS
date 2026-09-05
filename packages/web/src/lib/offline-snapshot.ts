export interface OfflineSnapshot {
	pendingCount: number;
	storageAvailable: boolean;
	syncing: boolean;
	rejectedCount: number;
	articleIds: ReadonlySet<string>;
}

/** Read both records in one transaction; memory fallbacks cannot promise offline text. */
export function readOfflineRecords(
	database: IDBDatabase,
	cacheKey: string | null,
	outboxKey: string,
) {
	return new Promise<{ cache: unknown; outbox: unknown } | null>((resolve) => {
		const finish = (value: { cache: unknown; outbox: unknown } | null) => {
			database.close();
			resolve(value);
		};
		try {
			const transaction = database.transaction('state', 'readonly');
			const store = transaction.objectStore('state');
			const cache = cacheKey ? store.get(cacheKey) : null;
			const outbox = store.get(outboxKey);
			transaction.oncomplete = () => finish({ cache: cache?.result, outbox: outbox.result });
			transaction.onerror = () => finish(null);
			transaction.onabort = () => finish(null);
		} catch {
			finish(null);
		}
	});
}
