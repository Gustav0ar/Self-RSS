import type { FeedIngestionRepository } from '../repositories/feed-ingestion.repository.js';
import { cancelResponseBody, readResponseTextWithinLimit } from '../utils/bounded-response.js';
import type { DurablePublisherOutcome } from './durable-ingestion-ops.types.js';
import { withLeaseHeartbeat } from './durable-worker-loop.js';
import {
	buildFallbackDiscoveryCandidates,
	discoverFeedsFromHtml,
} from './feed-discovery-parser.js';
import {
	classifyFetchFailure,
	type FetchFailureKind,
	parseRetryAfter,
} from './feed-fetch-outcome-policy.js';
import { computeNextFetchAt } from './feed-next-fetch-policy.js';
import { FeedSnapshotParserService } from './feed-snapshot-parser.service.js';
import { fetchSourceSafely } from './feed-source-request.js';
import type { NormalizedFeedPayload } from './normalized-feed.types.js';
import { NormalizedFeedParseError } from './normalized-feed-parser.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;

class Semaphore {
	private active = 0;
	private waiters: Array<() => void> = [];

	constructor(private readonly limit: number) {}

	async run<T>(operation: () => Promise<T>): Promise<T> {
		if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiters.push(resolve));
		this.active += 1;
		try {
			return await operation();
		} finally {
			this.active -= 1;
			this.waiters.shift()?.();
		}
	}
}

class RawSnapshotPersistedCrash extends Error {
	constructor(readonly original: unknown) {
		super('Worker interrupted after raw snapshot persistence');
	}
}

const parserSemaphore = new Semaphore(1);

type ClaimedFetch = NonNullable<
	Awaited<ReturnType<FeedIngestionRepository['claimEligibleFetchJob']>>
>;

export interface DurableFeedWorkerOptions {
	workerId?: string;
	networkConcurrency?: number;
	leaseSeconds?: number;
	originStartGapSeconds?: number;
	maxBodyBytes?: number;
	requestTimeoutMs?: number;
	maxRedirects?: number;
	allowPrivateHosts?: boolean;
	contact?: string;
	fetch?: typeof fetchSourceSafely;
	now?: () => Date;
	afterRawPersisted?: (snapshotId: string) => void | Promise<void>;
	parseSnapshot?: (snapshotId: string, now: Date) => Promise<NormalizedFeedPayload>;
	handleDiscovery?: (input: {
		jobId: string;
		sourceId: string;
		finalUrl: string;
		candidates: ReturnType<typeof discoverFeedsFromHtml>;
		now: Date;
	}) => Promise<unknown>;
	telemetry?: {
		recordPublisherRequest(): void;
		recordPublisherOutcome(outcome: DurablePublisherOutcome): void;
	};
}

export class DurableFeedWorker {
	private readonly workerId: string;
	private readonly networkConcurrency: number;
	private readonly snapshotParser: FeedSnapshotParserService;

	constructor(
		private repository: FeedIngestionRepository,
		private options: DurableFeedWorkerOptions = {},
	) {
		this.workerId = options.workerId ?? `durable-feed-${crypto.randomUUID()}`;
		this.networkConcurrency = Math.max(1, Math.floor(options.networkConcurrency ?? 4));
		this.snapshotParser = new FeedSnapshotParserService(repository);
	}

	async drainOnce(signal?: AbortSignal) {
		const claims: ClaimedFetch[] = [];
		for (let index = 0; index < this.networkConcurrency; index += 1) {
			signal?.throwIfAborted();
			const claim = await this.repository.claimEligibleFetchJob(
				this.workerId,
				this.options.leaseSeconds ?? 60,
				this.now(),
				this.options.originStartGapSeconds ?? 5,
			);
			if (!claim) break;
			claims.push(claim);
		}
		const leaseSeconds = this.options.leaseSeconds ?? 60;
		await Promise.all(
			claims.map((claim) =>
				withLeaseHeartbeat({
					operation: () => this.processClaim(claim, signal),
					renew: () =>
						this.repository.renewFetchJob(claim.job.id, this.workerId, leaseSeconds, this.now()),
					leaseSeconds,
					signal,
				}),
			),
		);
		return claims.length;
	}

	async processClaim(claim: ClaimedFetch, signal?: AbortSignal) {
		const now = this.now();
		let unconditionalAttempt = false;
		let publisherRequestStarted = false;
		let publisherOutcomeRecorded = false;
		const recordPublisherOutcome = (outcome: DurablePublisherOutcome) => {
			if (!publisherRequestStarted || publisherOutcomeRecorded) return;
			publisherOutcomeRecorded = true;
			try {
				this.options.telemetry?.recordPublisherOutcome(outcome);
			} catch {
				// Telemetry must never alter publisher work.
			}
		};
		const requestController = new AbortController();
		const abortFromCaller = () => requestController.abort(signal?.reason);
		signal?.addEventListener('abort', abortFromCaller, { once: true });
		const requestTimeout = setTimeout(
			() =>
				requestController.abort(new DOMException('Publisher request timed out', 'TimeoutError')),
			Math.max(1, this.options.requestTimeoutMs ?? 30_000),
		);
		try {
			const context = await this.repository.findFetchJobContext(claim.job.id);
			if (!context) throw new Error('Claimed feed fetch job context disappeared');
			if (context.snapshot) {
				if (
					context.snapshot.rawBody &&
					this.isHtml(context.snapshot.contentType, context.snapshot.rawBody) &&
					this.options.handleDiscovery
				) {
					await this.completeDiscovery(
						claim,
						context.snapshot.id,
						context.snapshot.finalUrl,
						context.snapshot.rawBody,
						now,
					);
					return;
				}
				const parsed = await parserSemaphore.run(() =>
					this.parseSnapshot(context.snapshot!.id, now),
				);
				await this.completeParsed(claim, parsed, context.snapshot.httpStatus ?? 200, now, false);
				return;
			}

			const hasValidators = Boolean(claim.source.etag || claim.source.lastModified);
			const forceUnconditional =
				hasValidators &&
				(!claim.source.lastUnconditionalFetchAt ||
					now.getTime() - claim.source.lastUnconditionalFetchAt.getTime() >= WEEK_MS);
			if (forceUnconditional) {
				unconditionalAttempt = true;
				await this.repository.recordUnconditionalFetchAttempt(claim.job.id, this.workerId, now);
			}
			const headers = new Headers();
			if (!forceUnconditional) {
				if (claim.source.etag) headers.set('if-none-match', claim.source.etag);
				if (claim.source.lastModified) headers.set('if-modified-since', claim.source.lastModified);
			}
			if (this.options.contact) {
				headers.set('user-agent', `Self-Feed/1.0; contact=${this.options.contact.trim()}`);
			}
			const fetchImpl = this.options.fetch ?? fetchSourceSafely;
			publisherRequestStarted = true;
			try {
				this.options.telemetry?.recordPublisherRequest();
			} catch {
				// Telemetry must never alter publisher work.
			}
			const response = await fetchImpl(
				claim.source.resolvedUrl ?? claim.source.requestedUrl,
				{ method: 'GET', headers, signal: requestController.signal },
				{
					allowPrivateHosts: this.options.allowPrivateHosts ?? false,
					maxRedirects: this.options.maxRedirects ?? 5,
				},
			);
			if (response.status === 304) {
				recordPublisherOutcome('not_modified');
				cancelResponseBody(response);
				await this.completeUnchanged(claim, response, now, forceUnconditional);
				return;
			}
			if (response.status < 200 || response.status >= 300) {
				recordPublisherOutcome(response.status === 429 ? 'rate_limited' : 'http_error');
				cancelResponseBody(response);
				await this.failClaim(claim, now, {
					status: response.status,
					retryAfter: response.headers.get('retry-after'),
					lastUnconditionalFetchAt: forceUnconditional ? now : undefined,
				});
				return;
			}

			const contentLength = Number(response.headers.get('content-length'));
			if (
				Number.isFinite(contentLength) &&
				contentLength > (this.options.maxBodyBytes ?? 5_242_880)
			) {
				recordPublisherOutcome('oversize');
				cancelResponseBody(response);
				await this.failClaim(claim, now, {
					failureKind: 'oversize',
					lastUnconditionalFetchAt: forceUnconditional ? now : undefined,
				});
				return;
			}
			const body = await readResponseTextWithinLimit(
				response,
				this.options.maxBodyBytes ?? 5_242_880,
				requestController,
			);
			recordPublisherOutcome('success');
			clearTimeout(requestTimeout);
			const snapshotId = crypto.randomUUID();
			await this.snapshotParser.persistRawResponse({
				id: snapshotId,
				sourceId: claim.source.id,
				jobId: claim.job.id,
				finalUrl: response.url || claim.source.requestedUrl,
				status: response.status,
				body,
				headers: response.headers,
				fetchedAt: now,
			});
			try {
				await this.options.afterRawPersisted?.(snapshotId);
			} catch (error) {
				throw new RawSnapshotPersistedCrash(error);
			}
			if (this.isHtml(response.headers.get('content-type'), body) && this.options.handleDiscovery) {
				await this.completeDiscovery(
					claim,
					snapshotId,
					response.url || claim.source.requestedUrl,
					body,
					now,
				);
				return;
			}
			const parsed = await parserSemaphore.run(() => this.parseSnapshot(snapshotId, now));
			await this.completeParsed(claim, parsed, response.status, now, forceUnconditional, response);
		} catch (error) {
			if (publisherRequestStarted && !publisherOutcomeRecorded) {
				recordPublisherOutcome(
					signal?.aborted
						? 'aborted'
						: error instanceof Error && /maximum size/i.test(error.message)
							? 'oversize'
							: 'network_error',
				);
			}
			if (error instanceof RawSnapshotPersistedCrash) throw error.original;
			if (signal?.aborted) {
				await this.repository.releaseFetchJob(claim.job.id, this.workerId, this.now());
				return;
			}
			await this.handleThrownFailure(claim, error, now, unconditionalAttempt);
		} finally {
			clearTimeout(requestTimeout);
			signal?.removeEventListener('abort', abortFromCaller);
		}
	}

	private async completeParsed(
		claim: ClaimedFetch,
		parsed: Awaited<ReturnType<FeedSnapshotParserService['parsePersistedSnapshot']>>,
		status: number,
		now: Date,
		unconditional: boolean,
		response?: Response,
	) {
		const changed = parsed.normalizedPayloadHash !== claim.source.normalizedPayloadHash;
		const unchangedCount = changed ? 0 : claim.source.consecutiveUnchangedCount + 1;
		const observedSeconds =
			changed && claim.source.lastChangeAt
				? Math.max(900, Math.ceil((now.getTime() - claim.source.lastChangeAt.getTime()) / 1_000))
				: null;
		const nextFetchAt = computeNextFetchAt({
			now,
			publisherIntervalSeconds: parsed.publisherHints.effectiveIntervalSeconds,
			observedChangeIntervalSeconds: observedSeconds,
			consecutiveUnchanged: unchangedCount,
		});
		await this.repository.finishFetchJob(
			claim.job.id,
			this.workerId,
			{
				status: 'completed',
				source: {
					resolvedUrl: response?.url || claim.source.resolvedUrl,
					title: parsed.source.title,
					siteUrl: parsed.source.siteUrl,
					description: parsed.source.description,
					language: parsed.source.language,
					imageUrl: parsed.source.imageUrl,
					etag: response?.headers.get('etag') ?? claim.source.etag,
					lastModified: response?.headers.get('last-modified') ?? claim.source.lastModified,
					lastHttpStatus: status,
					lastFetchAt: now,
					lastUnconditionalFetchAt: unconditional ? now : claim.source.lastUnconditionalFetchAt,
					lastSuccessAt: now,
					lastChangeAt: changed ? now : claim.source.lastChangeAt,
					nextFetchAt,
					minIntervalSeconds: parsed.publisherHints.effectiveIntervalSeconds,
					consecutiveFailureCount: 0,
					consecutiveUnchangedCount: unchangedCount,
					backoffUntil: null,
					circuitState: 'closed',
					circuitOpenedAt: null,
					parserVersion: parsed.parserVersion,
					rawBodyHash: parsed.rawBodyHash,
					normalizedPayloadHash: parsed.normalizedPayloadHash,
					publisherHints: { ...parsed.publisherHints },
					state: 'active',
					lastErrorCode: null,
					lastErrorDetails: null,
				},
				origin: {
					consecutiveFailureCount: 0,
					lastSuccessAt: now,
					retryAfterUntil: null,
					blockedUntil: null,
					blockReason: null,
					circuitState: 'closed',
					circuitOpenedAt: null,
				},
			},
			now,
		);
		await this.repository.aggregateRefreshRequestsForJob(claim.job.id, now);
	}

	private async completeUnchanged(
		claim: ClaimedFetch,
		_response: Response,
		now: Date,
		unconditional: boolean,
	) {
		const unchangedCount = claim.source.consecutiveUnchangedCount + 1;
		const publisherInterval = Number(
			(claim.source.publisherHints as { effectiveIntervalSeconds?: number } | null)
				?.effectiveIntervalSeconds,
		);
		const nextFetchAt = computeNextFetchAt({
			now,
			publisherIntervalSeconds: Number.isFinite(publisherInterval) ? publisherInterval : null,
			consecutiveUnchanged: unchangedCount,
		});
		await this.repository.finishFetchJob(
			claim.job.id,
			this.workerId,
			{
				status: 'completed',
				completesWithoutDelivery: true,
				source: {
					lastHttpStatus: 304,
					lastFetchAt: now,
					lastUnconditionalFetchAt: unconditional ? now : claim.source.lastUnconditionalFetchAt,
					lastSuccessAt: now,
					nextFetchAt,
					consecutiveFailureCount: 0,
					consecutiveUnchangedCount: unchangedCount,
					backoffUntil: null,
					circuitState: 'closed',
					state: 'active',
					lastErrorCode: null,
					lastErrorDetails: null,
				},
				origin: { consecutiveFailureCount: 0, lastSuccessAt: now, retryAfterUntil: null },
			},
			now,
		);
		await this.repository.aggregateRefreshRequestsForJob(claim.job.id, now);
	}

	private async completeDiscovery(
		claim: ClaimedFetch,
		snapshotId: string,
		finalUrl: string,
		body: string,
		now: Date,
	) {
		const candidates = [
			...discoverFeedsFromHtml(body, finalUrl),
			...buildFallbackDiscoveryCandidates(finalUrl),
		];
		const unique = [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()];
		await this.options.handleDiscovery?.({
			jobId: claim.job.id,
			sourceId: claim.source.id,
			finalUrl,
			candidates: unique,
			now,
		});
		await this.repository.markSnapshotParseFailed(
			snapshotId,
			{
				code: 'discovery_required',
				details: 'The fetched URL is HTML and requires feed discovery selection',
			},
			now,
		);
		const retryAt = new Date(now.getTime() + WEEK_MS);
		await this.repository.finishFetchJob(
			claim.job.id,
			this.workerId,
			{
				status: 'completed',
				completesWithoutDelivery: true,
				source: {
					state: 'paused',
					nextFetchAt: retryAt,
					backoffUntil: retryAt,
					lastHttpStatus: 200,
					lastFetchAt: now,
					lastErrorCode: 'discovery_required',
					lastErrorDetails: 'The URL is a website; select an advertised feed',
				},
			},
			now,
		);
		await this.repository.updatePendingFeedFailure(
			claim.source.id,
			{
				status: 'discovery_required',
				code: 'discovery_required',
				details: 'The URL is a website; select an advertised feed',
				retryAt,
			},
			now,
		);
		await this.repository.failRefreshItemsForJob(
			claim.job.id,
			{
				code: 'discovery_required',
				details: 'The URL is a website; select an advertised feed',
			},
			now,
		);
	}

	private async handleThrownFailure(
		claim: ClaimedFetch,
		error: unknown,
		now: Date,
		unconditionalAttempt: boolean,
	) {
		const snapshot = await this.repository.findFetchJobContext(claim.job.id);
		const parseError = error instanceof NormalizedFeedParseError;
		if (snapshot?.snapshot && !parseError) {
			const dead = snapshot.job.attempts >= snapshot.job.maxAttempts;
			await this.repository.finishFetchJob(
				claim.job.id,
				this.workerId,
				{
					status: dead ? 'dead' : 'queued',
					availableAt: new Date(now.getTime() + 15 * 60 * 1_000),
					error: {
						code: 'parse_failed',
						details: error instanceof Error ? error.message : String(error),
					},
				},
				now,
			);
			await this.repository.aggregateRefreshRequestsForJob(claim.job.id, now);
			return;
		}
		const failureKind: FetchFailureKind = parseError
			? error.code === 'unsupported_feed'
				? 'unsupported_feed'
				: error.code === 'normalized_payload_too_large'
					? 'oversize'
					: 'invalid_feed'
			: error instanceof Error && /maximum size/i.test(error.message)
				? 'oversize'
				: classifyNetworkError(error);
		await this.failClaim(claim, now, {
			failureKind,
			details: error instanceof Error ? error.message : String(error),
			resumeSnapshot: false,
			lastUnconditionalFetchAt: unconditionalAttempt ? now : undefined,
		});
	}

	private async failClaim(
		claim: ClaimedFetch,
		now: Date,
		input: {
			status?: number;
			failureKind?: FetchFailureKind;
			retryAfter?: string | null;
			details?: string;
			lastUnconditionalFetchAt?: Date;
			resumeSnapshot?: boolean;
		},
	) {
		const failures = claim.source.consecutiveFailureCount + 1;
		const policy = classifyFetchFailure({
			status: input.status,
			failureKind: input.failureKind,
			retryAfter: input.retryAfter,
			consecutiveFailures: failures,
			now,
		});
		const retryAfterSeconds = parseRetryAfter(input.retryAfter, now);
		const retryAfterUntil = retryAfterSeconds
			? new Date(now.getTime() + retryAfterSeconds * 1_000)
			: null;
		const terminalParseFailure =
			input.failureKind === 'invalid_feed' ||
			input.failureKind === 'unsupported_feed' ||
			input.failureKind === 'oversize';
		const status =
			claim.job.attempts >= claim.job.maxAttempts
				? 'dead'
				: terminalParseFailure && !input.resumeSnapshot
					? 'completed'
					: 'queued';
		const errorCode = input.failureKind ?? `http_${input.status ?? 0}`;
		const originFailureCount = claim.origin.consecutiveFailureCount + 1;
		const originWideFailure =
			input.failureKind === 'network' ||
			input.failureKind === 'dns' ||
			input.failureKind === 'tls' ||
			input.status === 429 ||
			input.status === 503;
		const originPolicy = originWideFailure
			? classifyFetchFailure({
					status: input.status,
					failureKind: input.failureKind,
					retryAfter: input.retryAfter,
					consecutiveFailures: originFailureCount,
					now,
				})
			: null;
		await this.repository.finishFetchJob(
			claim.job.id,
			this.workerId,
			{
				status,
				availableAt: policy.nextAttemptAt,
				error: { code: errorCode, details: input.details },
				source: {
					lastHttpStatus: input.status,
					lastFetchAt: now,
					lastUnconditionalFetchAt:
						input.lastUnconditionalFetchAt ?? claim.source.lastUnconditionalFetchAt,
					nextFetchAt: policy.nextAttemptAt,
					consecutiveFailureCount: failures,
					backoffUntil: policy.nextAttemptAt,
					circuitState: policy.circuitOpened ? 'open' : claim.source.circuitState,
					circuitOpenedAt: policy.circuitOpened ? now : claim.source.circuitOpenedAt,
					state: policy.state === 'paused' ? 'paused' : 'active',
					lastErrorCode: errorCode,
					lastErrorDetails: input.details,
				},
				origin: {
					consecutiveFailureCount: originWideFailure
						? originFailureCount
						: claim.origin.consecutiveFailureCount,
					lastFailureAt: originWideFailure ? now : claim.origin.lastFailureAt,
					retryAfterUntil,
					blockedUntil: originPolicy?.nextAttemptAt ?? retryAfterUntil,
					blockReason: originWideFailure ? errorCode : claim.origin.blockReason,
					circuitState: originPolicy?.circuitOpened ? 'open' : claim.origin.circuitState,
					circuitOpenedAt: originPolicy?.circuitOpened ? now : claim.origin.circuitOpenedAt,
				},
			},
			now,
		);
		await this.repository.updatePendingFeedFailure(
			claim.source.id,
			{
				status: policy.state === 'paused' ? 'paused' : 'backoff',
				code: errorCode,
				details: input.details,
				retryAt: policy.nextAttemptAt,
			},
			now,
		);
		if (status === 'completed' && terminalParseFailure) {
			await this.repository.failRefreshItemsForJob(
				claim.job.id,
				{ code: errorCode, details: input.details },
				now,
			);
		} else {
			await this.repository.aggregateRefreshRequestsForJob(claim.job.id, now);
		}
	}

	private now() {
		return this.options.now?.() ?? new Date();
	}

	private parseSnapshot(snapshotId: string, now: Date) {
		return (
			this.options.parseSnapshot?.(snapshotId, now) ??
			this.snapshotParser.parsePersistedSnapshot(snapshotId, now)
		);
	}

	private isHtml(contentType: string | null, body: string) {
		return (
			/text\/html|application\/xhtml/i.test(contentType ?? '') ||
			/<html\b|<!doctype\s+html/i.test(body.slice(0, 2_048))
		);
	}
}

export function classifyNetworkError(error: unknown): FetchFailureKind {
	const values: string[] = [];
	let current: unknown = error;
	for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
		const item = current as { code?: unknown; message?: unknown; cause?: unknown };
		values.push(String(item.code ?? ''), String(item.message ?? ''));
		current = item.cause;
	}
	const description = values.join(' ');
	if (/ENOTFOUND|EAI_AGAIN|DNS|name.*resolv/i.test(description)) return 'dns';
	if (/TLS|CERT|SSL|certificate|handshake/i.test(description)) return 'tls';
	return 'network';
}
