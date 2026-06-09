import type { ReadStateSyncEvent } from '@self-feed/shared';
import { getAccessToken, getClientId, refreshAccessToken } from './api';

const API_BASE = '/api/v1';

export type SseMessageHandler = (eventName: string, data: string) => void;

export function createSseParser(onMessage: SseMessageHandler) {
	let buffer = '';
	let eventName = 'message';
	let dataLines: string[] = [];

	function dispatch() {
		if (dataLines.length > 0) {
			onMessage(eventName, dataLines.join('\n'));
		}
		eventName = 'message';
		dataLines = [];
	}

	function processLine(input: string) {
		const line = input.endsWith('\r') ? input.slice(0, -1) : input;
		if (line === '') {
			dispatch();
			return;
		}
		if (line.startsWith(':')) {
			return;
		}

		const colonIndex = line.indexOf(':');
		const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
		const rawValue = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
		const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

		if (field === 'event') {
			eventName = value || 'message';
		} else if (field === 'data') {
			dataLines.push(value);
		}
	}

	return {
		push(chunk: string) {
			buffer += chunk;
			let newlineIndex = buffer.indexOf('\n');
			while (newlineIndex >= 0) {
				const line = buffer.slice(0, newlineIndex);
				buffer = buffer.slice(newlineIndex + 1);
				processLine(line);
				newlineIndex = buffer.indexOf('\n');
			}
		},
		flush() {
			if (buffer) {
				processLine(buffer);
				buffer = '';
			}
			dispatch();
		},
	};
}

function isReadStateSyncEvent(value: unknown): value is ReadStateSyncEvent {
	if (!value || typeof value !== 'object' || !('type' in value)) {
		return false;
	}

	if (value.type === 'article.read_state_changed') {
		return (
			'articleId' in value &&
			typeof value.articleId === 'string' &&
			'feedId' in value &&
			typeof value.feedId === 'string' &&
			'isRead' in value &&
			typeof value.isRead === 'boolean'
		);
	}

	if (value.type === 'articles.marked_read') {
		return (
			'feedIds' in value &&
			Array.isArray(value.feedIds) &&
			value.feedIds.every((feedId) => typeof feedId === 'string') &&
			'markedCount' in value &&
			typeof value.markedCount === 'number'
		);
	}

	return false;
}

async function fetchReadStateStream(signal: AbortSignal) {
	if (!getAccessToken()) {
		await refreshAccessToken();
	}

	const headers = new Headers({
		Accept: 'text/event-stream',
		'X-Self-Feed-Client-Id': getClientId(),
	});
	const token = getAccessToken();
	if (token) {
		headers.set('Authorization', `Bearer ${token}`);
	}

	let response = await fetch(`${API_BASE}/events/read-state`, {
		headers,
		credentials: 'include',
		signal,
	});

	if (response.status === 401 && (await refreshAccessToken())) {
		const refreshedToken = getAccessToken();
		if (refreshedToken) {
			headers.set('Authorization', `Bearer ${refreshedToken}`);
		}
		response = await fetch(`${API_BASE}/events/read-state`, {
			headers,
			credentials: 'include',
			signal,
		});
	}

	if (!response.ok || !response.body) {
		throw new Error(`Read-state stream failed: ${response.status}`);
	}

	return response.body;
}

export async function streamReadStateEvents({
	signal,
	onEvent,
}: {
	signal: AbortSignal;
	onEvent: (event: ReadStateSyncEvent) => void;
}) {
	const body = await fetchReadStateStream(signal);
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const parser = createSseParser((eventName, data) => {
		if (eventName !== 'read-state') {
			return;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(data);
		} catch {
			return;
		}

		if (isReadStateSyncEvent(parsed)) {
			onEvent(parsed);
		}
	});

	try {
		while (!signal.aborted) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			parser.push(decoder.decode(value, { stream: true }));
		}
		parser.push(decoder.decode());
		parser.flush();
	} finally {
		reader.releaseLock();
	}
}
