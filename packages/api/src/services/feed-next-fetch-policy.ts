import { MIN_SOURCE_INTERVAL_SECONDS } from './feed-publisher-hints.js';

const DAY_SECONDS = 24 * 60 * 60;
export const PAUSED_SOURCE_PROBE_SECONDS = 7 * DAY_SECONDS;

export interface NextFetchInput {
	now?: Date;
	state?: 'active' | 'paused' | 'circuit_open';
	jitter?: () => number;
	sourceBlockedUntil?: Date | null;
	originBlockedUntil?: Date | null;
}

/**
 * Active sources are fetched on a fixed 15-minute cadence. Publisher hints and
 * unchanged responses remain diagnostic data, but never make a healthy feed
 * slower. Failed sources use the separate outcome/backoff policy.
 */
export function computeNextFetchAt(input: NextFetchInput) {
	const now = input.now ?? new Date();
	if (input.state === 'paused' || input.state === 'circuit_open') {
		const sample = Math.max(0, Math.min(1, input.jitter?.() ?? 0));
		const jitterSeconds = Math.ceil(sample * MIN_SOURCE_INTERVAL_SECONDS);
		let probeAt = new Date(now.getTime() + (PAUSED_SOURCE_PROBE_SECONDS + jitterSeconds) * 1_000);
		for (const block of [input.sourceBlockedUntil, input.originBlockedUntil]) {
			if (block && block > probeAt) probeAt = block;
		}
		return probeAt;
	}

	let next = new Date(now.getTime() + MIN_SOURCE_INTERVAL_SECONDS * 1_000);
	for (const block of [input.sourceBlockedUntil, input.originBlockedUntil]) {
		if (block && block > next) next = block;
	}
	return next;
}
