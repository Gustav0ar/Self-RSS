import { createHash } from 'node:crypto';
import type { FeedIngestionRepository } from '../repositories/feed-ingestion.repository.js';
import type { NormalizedFeedPayload } from './normalized-feed.types.js';
import { NormalizedFeedParseError, parseNormalizedFeed } from './normalized-feed-parser.js';

function hash(value: string) {
	return createHash('sha256').update(value).digest('hex');
}

export class FeedSnapshotParserService {
	constructor(
		private repository: FeedIngestionRepository,
		private parser: typeof parseNormalizedFeed = parseNormalizedFeed,
	) {}

	async persistRawResponse(input: {
		id: string;
		sourceId: string;
		jobId?: string | null;
		finalUrl: string;
		status: number;
		body: string;
		headers?: Headers;
		fetchedAt?: Date;
	}) {
		const fetchedAt = input.fetchedAt ?? new Date();
		return this.repository.createSnapshot({
			id: input.id,
			sourceId: input.sourceId,
			jobId: input.jobId,
			fetchedAt,
			finalUrl: input.finalUrl,
			httpStatus: input.status,
			contentType: input.headers?.get('content-type'),
			etag: input.headers?.get('etag'),
			lastModified: input.headers?.get('last-modified'),
			rawBody: input.body,
			rawBodyBytes: Buffer.byteLength(input.body),
			rawBodyHash: hash(input.body),
			bodyExpiresAt: new Date(fetchedAt.getTime() + 24 * 60 * 60 * 1_000),
			parseState: 'pending',
			createdAt: fetchedAt,
		});
	}

	async parsePersistedSnapshot(
		snapshotId: string,
		now = new Date(),
	): Promise<NormalizedFeedPayload> {
		const snapshot = await this.repository.findSnapshot(snapshotId);
		if (!snapshot) throw new Error('Feed snapshot was not found');
		if (snapshot.parseState === 'parsed' && snapshot.normalizedPayload) {
			return JSON.parse(snapshot.normalizedPayload) as NormalizedFeedPayload;
		}
		if (snapshot.rawBody == null) {
			throw new Error('Feed snapshot raw body is unavailable for parsing');
		}

		try {
			const headers = new Headers();
			if (snapshot.contentType) headers.set('content-type', snapshot.contentType);
			if (snapshot.etag) headers.set('etag', snapshot.etag);
			if (snapshot.lastModified) headers.set('last-modified', snapshot.lastModified);
			const parsed = await this.parser(snapshot.rawBody, {
				finalUrl: snapshot.finalUrl,
				responseHeaders: headers,
				now,
			});
			await this.repository.markSnapshotParseSucceeded(
				snapshotId,
				{
					normalizedPayload: JSON.stringify(parsed),
					normalizedPayloadHash: parsed.normalizedPayloadHash,
					parserVersion: parsed.parserVersion,
					rawBodyHash: parsed.rawBodyHash,
				},
				now,
			);
			return parsed;
		} catch (error) {
			const code = error instanceof NormalizedFeedParseError ? error.code : 'parse_failed';
			await this.repository.markSnapshotParseFailed(
				snapshotId,
				{
					code,
					details: error instanceof Error ? error.message : String(error),
				},
				now,
			);
			throw error;
		}
	}

	cleanupExpired(now = new Date()) {
		return this.repository.cleanupExpiredSnapshots(now);
	}
}
