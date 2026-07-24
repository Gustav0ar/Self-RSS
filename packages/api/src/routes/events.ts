import { randomUUID } from 'node:crypto';
import type { RealtimeEvent } from '@self-feed/shared';
import { type Context, Hono } from 'hono';
import type { RealtimeService } from '../services/realtime.service.js';
import { sseRegistry } from '../utils/sse-registry.js';

const HEARTBEAT_INTERVAL_MS = 25_000;

function encodeSse(event: string, data: unknown) {
	const payload = typeof data === 'string' ? data : JSON.stringify(data);
	const eventId =
		typeof data === 'object' && data !== null && 'eventId' in data
			? String((data as { eventId: unknown }).eventId)
			: null;
	return `${eventId ? `id: ${eventId}\n` : ''}event: ${event}\ndata: ${payload}\n\n`;
}

export function createEventRoutes(realtimeService: RealtimeService) {
	const routes = new Hono();

	const stream = (eventName: 'realtime' | 'read-state') => (c: Context) => {
		const userId = c.get('userId');
		const encoder = new TextEncoder();
		let cleanup: (() => void) | null = null;
		let heartbeat: ReturnType<typeof setInterval> | null = null;
		let abortHandler: (() => void) | null = null;
		let closed = false;

		// Register this SSE connection for graceful shutdown tracking
		const connectionId = randomUUID();
		const unregister = sseRegistry.register({
			id: connectionId,
			startedAt: Date.now(),
			userId,
		});
		const cleanupConnection = () => {
			if (heartbeat) {
				clearInterval(heartbeat);
				heartbeat = null;
			}
			cleanup?.();
			cleanup = null;
			if (abortHandler) {
				c.req.raw.signal.removeEventListener('abort', abortHandler);
				abortHandler = null;
			}
			unregister();
		};

		const stream = new ReadableStream({
			async start(controller) {
				const enqueue = (chunk: string) => {
					if (!closed) {
						controller.enqueue(encoder.encode(chunk));
					}
				};
				const close = () => {
					if (closed) {
						return;
					}
					closed = true;
					cleanupConnection();
					try {
						controller.close();
					} catch {
						// The stream may already be closed by the runtime.
					}
				};

				abortHandler = close;
				c.req.raw.signal.addEventListener('abort', abortHandler, { once: true });
				try {
					const unsubscribe = await realtimeService.subscribeToEvents(
						userId,
						(event: RealtimeEvent) => {
							enqueue(encodeSse(eventName, event));
						},
					);
					if (closed) {
						unsubscribe();
						return;
					}
					cleanup = unsubscribe;
				} catch {
					if (!closed) {
						// A rejected subscription is an expected connection-level
						// failure (for example, the per-user limit). Ending the
						// SSE body cleanly avoids surfacing it as an unhandled
						// ReadableStream rejection in the server runtime.
						enqueue(
							encodeSse(`${eventName}.error`, {
								code: 'CONNECTION_UNAVAILABLE',
								message: 'Realtime updates are temporarily unavailable',
							}),
						);
						close();
					}
					return;
				}
				enqueue(
					encodeSse(`${eventName}.connected`, {
						connected: true,
						updatedAt: new Date().toISOString(),
					}),
				);
				heartbeat = setInterval(() => {
					enqueue(': keepalive\n\n');
				}, HEARTBEAT_INTERVAL_MS);
			},
			cancel() {
				if (closed) {
					return;
				}
				closed = true;
				cleanupConnection();
			},
		});

		return c.body(stream, 200, {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no',
		});
	};

	routes.get('/stream', stream('realtime'));
	// Backward-compatible endpoint for Android and older web deployments.
	routes.get('/read-state', stream('read-state'));

	return routes;
}
