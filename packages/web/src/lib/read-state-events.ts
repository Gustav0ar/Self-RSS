import { type RealtimeEvent, realtimeEventSchema } from '@self-feed/shared';
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

async function fetchRealtimeStream(signal: AbortSignal) {
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

	let response = await fetch(`${API_BASE}/events/stream`, {
		headers,
		credentials: 'include',
		signal,
	});

	if (response.status === 401 && (await refreshAccessToken())) {
		const refreshedToken = getAccessToken();
		if (refreshedToken) {
			headers.set('Authorization', `Bearer ${refreshedToken}`);
		}
		response = await fetch(`${API_BASE}/events/stream`, {
			headers,
			credentials: 'include',
			signal,
		});
	}

	if (!response.ok || !response.body) {
		throw new Error(`Realtime stream failed: ${response.status}`);
	}

	return response.body;
}

export async function streamRealtimeEvents({
	signal,
	onEvent,
	onConnected,
}: {
	signal: AbortSignal;
	onEvent: (event: RealtimeEvent) => void;
	onConnected?: () => void;
}) {
	const body = await fetchRealtimeStream(signal);
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const parser = createSseParser((eventName, data) => {
		if (eventName === 'realtime.connected') {
			onConnected?.();
			return;
		}
		if (eventName !== 'realtime') {
			return;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(data);
		} catch {
			return;
		}

		const result = realtimeEventSchema.safeParse(parsed);
		if (result.success) {
			onEvent(result.data);
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

/** @deprecated Use streamRealtimeEvents. */
export const streamReadStateEvents = streamRealtimeEvents;
