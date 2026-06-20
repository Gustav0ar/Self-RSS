import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventRoutes } from '../../src/routes/events.js';
import { sseRegistry } from '../../src/utils/sse-registry.js';

describe('event routes', () => {
	afterEach(() => {
		sseRegistry.forceClose();
	});

	it('unregisters the SSE connection when read-state subscription setup fails', async () => {
		const realtimeService = {
			subscribeToReadStateEvents: vi.fn(async () => {
				throw new Error('redis subscriber unavailable');
			}),
		};
		const app = new Hono();
		app.route('/events', createEventRoutes(realtimeService as never));

		const response = await app.request('/events/read-state');
		await response.text().catch(() => undefined);

		expect(realtimeService.subscribeToReadStateEvents).toHaveBeenCalledTimes(1);
		expect(sseRegistry.count).toBe(0);
	});
});
