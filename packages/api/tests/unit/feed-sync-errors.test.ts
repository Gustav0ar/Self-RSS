import { describe, expect, it, vi } from 'vitest';
import { getSyncErrorDetails, nextFailedSyncRetryAt } from '../../src/services/feed-sync-errors.js';

describe('feed sync failure policy', () => {
	it('identifies publisher rejection without implying that the user is forbidden', () => {
		expect(
			getSyncErrorDetails(new Response(null, { status: 403, statusText: 'Forbidden' })),
		).toMatchObject({
			status: 403,
			error: "The feed publisher rejected this server's fetch request (HTTP 403: Forbidden)",
		});
	});

	it('backs off hard publisher failures while retrying transient failures promptly', () => {
		vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-07-16T12:00:00.000Z').getTime());

		expect(nextFailedSyncRetryAt(15, 403).toISOString()).toBe('2026-07-16T18:00:00.000Z');
		expect(nextFailedSyncRetryAt(15, 429).toISOString()).toBe('2026-07-16T13:00:00.000Z');
		expect(nextFailedSyncRetryAt(15, 404).toISOString()).toBe('2026-07-17T12:00:00.000Z');
		expect(nextFailedSyncRetryAt(15, 502).toISOString()).toBe('2026-07-16T12:15:00.000Z');

		vi.restoreAllMocks();
	});
});
