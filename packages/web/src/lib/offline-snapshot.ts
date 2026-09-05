import type { DehydratedState } from '@tanstack/react-query';

export interface OfflineSnapshot {
	pendingCount: number;
	storageAvailable: boolean;
	syncing: boolean;
	rejectedCount: number;
	articleIds: ReadonlySet<string>;
}

export function cachedArticleIds(queries: DehydratedState['queries']) {
	const ids = new Set<string>();
	for (const query of queries) {
		const [root, id] = query.queryKey;
		const data: unknown = query.state.data;
		if (
			root === 'article' &&
			typeof id === 'string' &&
			data &&
			typeof data === 'object' &&
			'id' in data &&
			data.id === id &&
			'contentHtml' in data &&
			typeof data.contentHtml === 'string' &&
			hasReadableHtml(data.contentHtml)
		)
			ids.add(id);
	}
	return ids;
}

function hasReadableHtml(html: string) {
	// Template contents stay inert, so checking cached text never downloads media.
	const template = document.createElement('template');
	template.innerHTML = html;
	for (const element of template.content.querySelectorAll(
		'script, style, iframe, video, audio, object',
	))
		element.remove();
	return Boolean(template.content.textContent?.trim());
}

/** Read both records in one transaction; memory fallbacks cannot promise offline text. */
export function readOfflineRecords(database: IDBDatabase, cacheKey: string, outboxKey: string) {
	return new Promise<{ cache: unknown; outbox: unknown } | null>((resolve) => {
		const finish = (value: { cache: unknown; outbox: unknown } | null) => {
			database.close();
			resolve(value);
		};
		try {
			const transaction = database.transaction('state', 'readonly');
			const store = transaction.objectStore('state');
			const cache = store.get(cacheKey);
			const outbox = store.get(outboxKey);
			transaction.oncomplete = () => finish({ cache: cache.result, outbox: outbox.result });
			transaction.onerror = () => finish(null);
			transaction.onabort = () => finish(null);
		} catch {
			finish(null);
		}
	});
}
