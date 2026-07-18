import { MIN_SOURCE_INTERVAL_SECONDS } from './feed-publisher-hints.js';

const ACTIVE_MAX_SECONDS = 24 * 60 * 60;
export const PAUSED_SOURCE_PROBE_SECONDS = 7 * ACTIVE_MAX_SECONDS;

export interface NextFetchInput {
	now?: Date;
	publisherIntervalSeconds?: number | null;
	observedChangeIntervalSeconds?: number | null;
	consecutiveUnchanged: number;
	state?: 'active' | 'paused' | 'circuit_open';
	jitter?: () => number;
	sourceBlockedUntil?: Date | null;
	originBlockedUntil?: Date | null;
}

/** Computes a safe source schedule; manual callers use the same block-aware result. */
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

	const quietMultiplier = Math.min(
		96,
		2 ** Math.floor(Math.max(0, input.consecutiveUnchanged) / 3),
	);
	const observed = input.observedChangeIntervalSeconds
		? Math.ceil(input.observedChangeIntervalSeconds * 0.75)
		: 0;
	const base = Math.min(
		ACTIVE_MAX_SECONDS,
		Math.max(
			MIN_SOURCE_INTERVAL_SECONDS,
			input.publisherIntervalSeconds ?? 0,
			observed,
			MIN_SOURCE_INTERVAL_SECONDS * quietMultiplier,
		),
	);
	const sample = Math.max(0, Math.min(1, input.jitter?.() ?? 0));
	const positiveJitter = Math.ceil(sample * Math.min(base * 0.1, MIN_SOURCE_INTERVAL_SECONDS));
	const delay = Math.min(ACTIVE_MAX_SECONDS, base + positiveJitter);
	let next = new Date(now.getTime() + delay * 1_000);
	for (const block of [input.sourceBlockedUntil, input.originBlockedUntil]) {
		if (block && block > next) next = block;
	}
	return next;
}
