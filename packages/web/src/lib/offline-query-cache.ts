import type { DehydratedState } from '@tanstack/react-query';

const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PERSISTED_QUERIES = 600;
const MAX_PERSISTED_BYTES = 10 * 1024 * 1024;

function byteSize(value: unknown) {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function boundedState(state: DehydratedState): DehydratedState {
	const cutoff = Date.now() - MAX_CACHE_AGE_MS;
	const candidates = state.queries
		.filter((query) => query.state.dataUpdatedAt >= cutoff)
		.sort((left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt)
		.slice(0, MAX_PERSISTED_QUERIES);
	const queries: DehydratedState['queries'] = [];
	let bytes = 0;
	for (const query of candidates) {
		const queryBytes = byteSize(query);
		if (queryBytes > MAX_PERSISTED_BYTES || bytes + queryBytes > MAX_PERSISTED_BYTES) continue;
		queries.push(query);
		bytes += queryBytes;
	}
	return { mutations: [], queries };
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
