import { MIN_SOURCE_INTERVAL_SECONDS } from './feed-publisher-hints.js';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
/** Retry-After values beyond one leap year are treated as invalid publisher input. */
export const MAX_RETRY_AFTER_SECONDS = 366 * DAY;

export type FetchFailureKind =
	| 'network'
	| 'dns'
	| 'tls'
	| 'invalid_feed'
	| 'unsupported_feed'
	| 'oversize';

export interface FetchOutcomeInput {
	status?: number;
	failureKind?: FetchFailureKind;
	retryAfter?: string | null;
	consecutiveFailures: number;
	now?: Date;
	jitter?: () => number;
	sourceBlockedUntil?: Date | null;
	originBlockedUntil?: Date | null;
}

export interface FetchOutcomePolicy {
	failureClass: 'transient' | 'permanent';
	state: 'active' | 'paused' | 'circuit_open';
	delaySeconds: number;
	nextAttemptAt: Date;
	circuitOpened: boolean;
}

function validRetryAfterSeconds(seconds: number, now: Date) {
	const nowMs = now.getTime();
	const nextAttemptMs = nowMs + seconds * 1_000;
	if (
		!Number.isSafeInteger(seconds) ||
		seconds < 0 ||
		seconds > MAX_RETRY_AFTER_SECONDS ||
		!Number.isFinite(nowMs) ||
		!Number.isFinite(nextAttemptMs) ||
		Number.isNaN(new Date(nextAttemptMs).getTime())
	) {
		return null;
	}
	return seconds;
}

export function parseRetryAfter(value: string | null | undefined, now = new Date()) {
	if (!value?.trim()) return null;
	const trimmed = value.trim();
	if (/^\d+$/.test(trimmed)) return validRetryAfterSeconds(Number(trimmed), now);
	const parsed = Date.parse(trimmed);
	if (!Number.isFinite(parsed) || parsed <= now.getTime()) return null;
	return validRetryAfterSeconds(Math.ceil((parsed - now.getTime()) / 1_000), now);
}

function schedule(sequence: number[], failures: number) {
	return sequence[Math.min(Math.max(1, failures), sequence.length) - 1]!;
}

function positiveJitter(baseSeconds: number, random: (() => number) | undefined) {
	if (!random) return 0;
	const sample = Math.max(0, Math.min(1, random()));
	return Math.ceil(sample * Math.min(baseSeconds * 0.1, MIN_SOURCE_INTERVAL_SECONDS));
}

export function classifyFetchFailure(input: FetchOutcomeInput): FetchOutcomePolicy {
	const now = input.now ?? new Date();
	const failures = Math.max(1, input.consecutiveFailures);
	const status = input.status;
	let failureClass: 'transient' | 'permanent' = 'transient';
	let state: FetchOutcomePolicy['state'] = 'active';
	let baseSeconds: number;

	if (status === 410) {
		failureClass = 'permanent';
		state = 'paused';
		baseSeconds = WEEK;
	} else if (status === 401 || status === 403 || status === 404) {
		failureClass = 'permanent';
		baseSeconds = schedule([DAY, 3 * DAY, WEEK], failures);
		if (failures >= 3) state = 'paused';
	} else if (
		input.failureKind === 'invalid_feed' ||
		input.failureKind === 'unsupported_feed' ||
		input.failureKind === 'oversize'
	) {
		failureClass = 'permanent';
		baseSeconds = schedule([6 * HOUR, DAY, WEEK], failures);
		if (failures >= 3) state = 'paused';
	} else if (status === 429) {
		baseSeconds =
			parseRetryAfter(input.retryAfter, now) ?? schedule([HOUR, 2 * HOUR, 4 * HOUR, DAY], failures);
	} else if (status === 503 && parseRetryAfter(input.retryAfter, now) != null) {
		baseSeconds = parseRetryAfter(input.retryAfter, now)!;
	} else if (input.failureKind === 'dns' || input.failureKind === 'tls') {
		baseSeconds = schedule([6 * HOUR, DAY], failures);
	} else {
		baseSeconds = schedule([15 * 60, 30 * 60, HOUR, 2 * HOUR, 6 * HOUR], failures);
	}

	const circuitThreshold = failureClass === 'permanent' ? 3 : 8;
	const circuitOpened = failures >= circuitThreshold;
	if (circuitOpened) {
		state = state === 'paused' ? 'paused' : 'circuit_open';
		baseSeconds = Math.max(baseSeconds, WEEK);
	}
	baseSeconds = Math.max(MIN_SOURCE_INTERVAL_SECONDS, baseSeconds);
	const jitterSeconds = positiveJitter(baseSeconds, input.jitter);
	let nextAttemptAt = new Date(now.getTime() + (baseSeconds + jitterSeconds) * 1_000);
	for (const block of [input.sourceBlockedUntil, input.originBlockedUntil]) {
		if (block && block > nextAttemptAt) nextAttemptAt = block;
	}
	return {
		failureClass,
		state,
		delaySeconds: Math.ceil((nextAttemptAt.getTime() - now.getTime()) / 1_000),
		nextAttemptAt,
		circuitOpened,
	};
}

export function classifyFetchSuccess(status: number, changed: boolean) {
	return {
		changed: status === 304 ? false : changed,
		unchanged: status === 304 || !changed,
		consecutiveFailures: 0,
		circuitState: 'closed' as const,
		backoffUntil: null,
	};
}
