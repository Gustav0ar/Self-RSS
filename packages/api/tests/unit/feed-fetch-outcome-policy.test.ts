import { describe, expect, it } from 'vitest';
import {
	classifyFetchFailure,
	classifyFetchSuccess,
	MAX_RETRY_AFTER_SECONDS,
	parseRetryAfter,
} from '../../src/services/feed-fetch-outcome-policy.js';
import {
	computeNextFetchAt,
	PAUSED_SOURCE_PROBE_SECONDS,
} from '../../src/services/feed-next-fetch-policy.js';

const now = new Date('2026-07-18T00:00:00Z');
const delay = (input: Parameters<typeof classifyFetchFailure>[0]) =>
	classifyFetchFailure({ ...input, now }).delaySeconds;

describe('feed fetch outcome policy', () => {
	it.each([
		['120', 120],
		['Sat, 18 Jul 2026 02:00:00 GMT', 7200],
		['invalid', null],
		['Fri, 17 Jul 2026 00:00:00 GMT', null],
	] as const)('parses Retry-After %s', (value, seconds) => {
		expect(parseRetryAfter(value, now)).toBe(seconds);
	});

	it('rejects overflow and accepts only finite representable Retry-After boundaries', () => {
		expect(parseRetryAfter('9'.repeat(400), now)).toBeNull();
		expect(parseRetryAfter('-1', now)).toBeNull();
		expect(parseRetryAfter(String(MAX_RETRY_AFTER_SECONDS), now)).toBe(MAX_RETRY_AFTER_SECONDS);
		expect(parseRetryAfter(String(MAX_RETRY_AFTER_SECONDS + 1), now)).toBeNull();
		expect(parseRetryAfter('1', new Date(8_640_000_000_000_000))).toBeNull();

		const fallback = classifyFetchFailure({
			status: 429,
			retryAfter: '9'.repeat(400),
			consecutiveFailures: 1,
			now,
		});
		expect(fallback.delaySeconds).toBe(3600);
		expect(Number.isFinite(fallback.nextAttemptAt.getTime())).toBe(true);
	});

	it.each([
		[{ status: 429, consecutiveFailures: 1 }, 3600, 'transient', 'active'],
		[{ status: 429, consecutiveFailures: 2 }, 7200, 'transient', 'active'],
		[{ status: 429, consecutiveFailures: 3 }, 14400, 'transient', 'active'],
		[{ status: 429, consecutiveFailures: 4 }, 86400, 'transient', 'active'],
		[{ status: 503, consecutiveFailures: 1 }, 900, 'transient', 'active'],
		[{ status: 500, consecutiveFailures: 2 }, 1800, 'transient', 'active'],
		[{ failureKind: 'network', consecutiveFailures: 5 }, 21600, 'transient', 'active'],
		[{ failureKind: 'dns', consecutiveFailures: 1 }, 21600, 'transient', 'active'],
		[{ failureKind: 'tls', consecutiveFailures: 2 }, 86400, 'transient', 'active'],
		[{ status: 403, consecutiveFailures: 1 }, 86400, 'permanent', 'active'],
		[{ status: 403, consecutiveFailures: 2 }, 259200, 'permanent', 'active'],
		[{ status: 403, consecutiveFailures: 3 }, 604800, 'permanent', 'paused'],
		[{ status: 404, consecutiveFailures: 3 }, 604800, 'permanent', 'paused'],
		[{ status: 410, consecutiveFailures: 1 }, 604800, 'permanent', 'paused'],
		[{ failureKind: 'invalid_feed', consecutiveFailures: 1 }, 21600, 'permanent', 'active'],
		[{ failureKind: 'oversize', consecutiveFailures: 2 }, 86400, 'permanent', 'active'],
		[{ failureKind: 'unsupported_feed', consecutiveFailures: 3 }, 604800, 'permanent', 'paused'],
	] as const)('classifies %#', (input, seconds, failureClass, state) => {
		const result = classifyFetchFailure({ ...input, now });
		expect(result).toMatchObject({ delaySeconds: seconds, failureClass, state });
	});

	it('honors Retry-After, opens transient circuits at eight failures, and never bypasses blocks', () => {
		expect(delay({ status: 429, retryAfter: '7200', consecutiveFailures: 1 })).toBe(7200);
		expect(delay({ status: 503, retryAfter: '10800', consecutiveFailures: 1 })).toBe(10800);
		const blockedUntil = new Date('2026-07-20T00:00:00Z');
		const result = classifyFetchFailure({
			status: 500,
			consecutiveFailures: 8,
			now,
			originBlockedUntil: blockedUntil,
		});
		expect(result).toMatchObject({ circuitOpened: true, state: 'circuit_open' });
		expect(result.nextAttemptAt).toEqual(new Date('2026-07-25T00:00:00Z'));
	});

	it('adds only positive jitter and resets state on changed, unchanged, and 304 success', () => {
		const base = classifyFetchFailure({ status: 500, consecutiveFailures: 1, now });
		const jittered = classifyFetchFailure({
			status: 500,
			consecutiveFailures: 1,
			now,
			jitter: () => 1,
		});
		expect(jittered.nextAttemptAt > base.nextAttemptAt).toBe(true);
		expect(classifyFetchSuccess(200, true)).toMatchObject({
			changed: true,
			unchanged: false,
			consecutiveFailures: 0,
			circuitState: 'closed',
		});
		expect(classifyFetchSuccess(304, true)).toMatchObject({ changed: false, unchanged: true });
	});
});

describe('fixed next fetch policy', () => {
	it('keeps healthy sources on a fixed 15-minute cadence', () => {
		expect(computeNextFetchAt({ now })).toEqual(new Date('2026-07-18T00:15:00Z'));
	});

	it('jitters weekly probes while keeping active feeds exact and respecting hard blocks', () => {
		const active = computeNextFetchAt({ now, jitter: () => 1 });
		expect(active).toEqual(new Date('2026-07-18T00:15:00Z'));
		const paused = computeNextFetchAt({
			now,
			state: 'paused',
			jitter: () => 1,
		});
		expect(paused.getTime() - now.getTime()).toBe((PAUSED_SOURCE_PROBE_SECONDS + 900) * 1_000);
		const blocked = new Date('2026-08-01T00:00:00Z');
		expect(
			computeNextFetchAt({
				now,
				state: 'circuit_open',
				originBlockedUntil: blocked,
			}),
		).toEqual(blocked);
	});
});
