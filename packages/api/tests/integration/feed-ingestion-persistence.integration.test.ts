import { Database as BunDatabase } from 'bun:sqlite';
import { rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations } from '../../src/db/migrations.js';
import * as schema from '../../src/db/schema.js';
import { ArticleRepository } from '../../src/repositories/article.repository.js';
import { CategoryRepository } from '../../src/repositories/category.repository.js';
import { FeedRepository } from '../../src/repositories/feed.repository.js';
import { FeedIngestionRepository } from '../../src/repositories/feed-ingestion.repository.js';
import { DurableFeedFacadeService } from '../../src/services/durable-feed-facade.service.js';
import { DurableFeedScheduler } from '../../src/services/durable-feed-scheduler.js';
import {
	DurableFeedWorker,
	type DurableFeedWorkerOptions,
} from '../../src/services/durable-feed-worker.js';
import { FeedSnapshotDeliveryService } from '../../src/services/feed-snapshot-delivery.service.js';
import { FeedSnapshotParserService } from '../../src/services/feed-snapshot-parser.service.js';
import { parseNormalizedFeed } from '../../src/services/normalized-feed-parser.js';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
const tempDirs: string[] = [];
const databases: BunDatabase[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true);
	for (const database of databases.splice(0)) database.close(false);
	for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function setupDatabase() {
	const directory = await mkdtemp(join(tmpdir(), 'feed-ingestion-persistence-'));
	tempDirs.push(directory);
	const sqlite = new BunDatabase(join(directory, 'rss.db'));
	databases.push(sqlite);
	sqlite.exec('PRAGMA foreign_keys = ON;');
	const db = drizzle(sqlite, { schema });
	applyMigrations(db, { migrationsFolder });
	const now = 1_700_000_000;
	sqlite.exec(`
		INSERT INTO users (id, email, password_hash, role, is_active, created_at, updated_at)
		VALUES ('user-1', 'ingestion@example.com', 'hash', 'user', 1, ${now}, ${now});
		INSERT INTO categories (id, user_id, name, slug, sort_order, created_at, updated_at)
		VALUES ('category-1', 'user-1', 'News', 'news', 0, ${now}, ${now});
	`);
	return { sqlite, db, repository: new FeedIngestionRepository(db) };
}

async function setupReplacementFacade() {
	const setup = await setupDatabase();
	const now = new Date('2026-07-18T00:00:00Z');
	const origin = await setup.repository.upsertOrigin({
		id: 'replacement-retry-origin',
		scheme: 'https',
		host: 'replacement-old.example.com',
		port: 443,
	});
	const source = await setup.repository.upsertSource({
		id: 'replacement-retry-source',
		normalizedUrl: 'https://replacement-old.example.com/feed.xml',
		requestedUrl: 'https://replacement-old.example.com/feed.xml',
		originId: origin.id,
		nextFetchAt: now,
	});
	await setup.db.insert(schema.feeds).values({
		id: 'replacement-retry-feed',
		userId: 'user-1',
		categoryId: 'category-1',
		title: 'Replacement retry feed',
		feedUrl: source.normalizedUrl,
		sourceId: source.id,
		nextSyncAt: now,
		createdAt: now,
		updatedAt: now,
	});
	return {
		...setup,
		facade: new DurableFeedFacadeService(
			setup.db,
			new FeedRepository(setup.db),
			new CategoryRepository(setup.db),
			setup.repository,
		),
	};
}

describe('durable feed ingestion persistence', () => {
	it('reports queue, staleness, backoff, and circuit state from SQLite truth', async () => {
		const { sqlite, repository } = await setupDatabase();
		const now = new Date('2033-05-18T03:33:20Z');
		const nowSeconds = Math.floor(now.getTime() / 1_000);
		sqlite.exec(`
			INSERT INTO feed_origins
				(id, scheme, host, port, blocked_until, circuit_state, created_at, updated_at)
			VALUES
				('metrics-origin', 'https', 'metrics.example.com', 443, ${nowSeconds + 60}, 'open', ${nowSeconds}, ${nowSeconds});
			INSERT INTO feed_sources
				(id, normalized_url, requested_url, origin_id, next_fetch_at, backoff_until, state, created_at, updated_at)
			VALUES
				('metrics-source-due', 'https://metrics.example.com/due', 'https://metrics.example.com/due', 'metrics-origin', ${nowSeconds - 30}, NULL, 'active', ${nowSeconds - 1_000}, ${nowSeconds}),
				('metrics-source-delayed', 'https://metrics.example.com/delayed', 'https://metrics.example.com/delayed', 'metrics-origin', ${nowSeconds + 300}, ${nowSeconds + 300}, 'active', ${nowSeconds - 2_000}, ${nowSeconds}),
				('metrics-source-running', 'https://metrics.example.com/running', 'https://metrics.example.com/running', 'metrics-origin', ${nowSeconds}, NULL, 'active', ${nowSeconds}, ${nowSeconds}),
				('metrics-source-paused', 'https://metrics.example.com/paused', 'https://metrics.example.com/paused', 'metrics-origin', ${nowSeconds}, NULL, 'paused', ${nowSeconds}, ${nowSeconds});
			INSERT INTO feeds
				(id, user_id, category_id, title, feed_url, source_id, next_sync_at, created_at, updated_at)
			VALUES
				('metrics-feed', 'user-1', 'category-1', 'Metrics', 'https://metrics.example.com/due', 'metrics-source-due', ${nowSeconds}, ${nowSeconds}, ${nowSeconds});
			INSERT INTO feed_fetch_jobs
				(id, source_id, origin_id, status, available_at, created_at, updated_at)
			VALUES
				('metrics-job-due', 'metrics-source-due', 'metrics-origin', 'queued', ${nowSeconds - 120}, ${nowSeconds - 300}, ${nowSeconds}),
				('metrics-job-delayed', 'metrics-source-delayed', 'metrics-origin', 'queued', ${nowSeconds + 120}, ${nowSeconds - 600}, ${nowSeconds}),
				('metrics-job-running', 'metrics-source-running', 'metrics-origin', 'running', ${nowSeconds}, ${nowSeconds}, ${nowSeconds}),
				('metrics-job-dead', 'metrics-source-paused', 'metrics-origin', 'dead', ${nowSeconds}, ${nowSeconds}, ${nowSeconds});
			INSERT INTO feed_fetch_snapshots
				(id, source_id, fetched_at, final_url, raw_body, raw_body_bytes, parse_state, created_at)
			VALUES
				('metrics-snapshot-parse', 'metrics-source-due', ${nowSeconds}, 'https://metrics.example.com/due', '<rss/>', 6, 'failed', ${nowSeconds}),
				('metrics-snapshot-pending-delivery', 'metrics-source-due', ${nowSeconds}, 'https://metrics.example.com/due', NULL, 0, 'parsed', ${nowSeconds}),
				('metrics-snapshot-running-delivery', 'metrics-source-due', ${nowSeconds}, 'https://metrics.example.com/due', NULL, 0, 'parsed', ${nowSeconds}),
				('metrics-snapshot-dead-delivery', 'metrics-source-due', ${nowSeconds}, 'https://metrics.example.com/due', NULL, 0, 'parsed', ${nowSeconds});
			INSERT INTO feed_snapshot_deliveries
				(id, snapshot_id, feed_id, status, available_at, created_at, updated_at)
			VALUES
				('metrics-delivery-pending', 'metrics-snapshot-pending-delivery', 'metrics-feed', 'pending', ${nowSeconds - 90}, ${nowSeconds}, ${nowSeconds}),
				('metrics-delivery-running', 'metrics-snapshot-running-delivery', 'metrics-feed', 'running', ${nowSeconds}, ${nowSeconds}, ${nowSeconds}),
				('metrics-delivery-dead', 'metrics-snapshot-dead-delivery', 'metrics-feed', 'dead', ${nowSeconds}, ${nowSeconds}, ${nowSeconds});
			INSERT INTO feed_refresh_requests
				(id, user_id, status, requested_at, created_at, updated_at)
			VALUES
				('metrics-request-active', 'user-1', 'running', ${nowSeconds}, ${nowSeconds}, ${nowSeconds}),
				('metrics-request-error', 'user-1', 'completed_with_errors', ${nowSeconds}, ${nowSeconds}, ${nowSeconds});
		`);

		expect(await repository.getOperationalSnapshot(now)).toEqual({
			fetchJobs: {
				queued: 2,
				running: 1,
				dead: 1,
				due: 0,
				oldestDueAgeSeconds: 0,
				oldestQueuedAgeSeconds: 600,
			},
			parseBacklog: 1,
			deliveries: { pending: 1, running: 1, failed: 1, oldestDueAgeSeconds: 90 },
			refreshRequests: { active: 1, error: 1 },
			sources: { active: 2, backoff: 1, paused: 1 },
			origins: { blocked: 1, circuitOpen: 1 },
		});
	});

	it('cleans terminal history in bounded batches without deleting active or retained work', async () => {
		const { sqlite, repository } = await setupDatabase();
		const now = new Date('2026-07-18T00:00:00Z');
		const nowSeconds = Math.floor(now.getTime() / 1_000);
		const old = nowSeconds - 30 * 24 * 60 * 60;
		const recent = nowSeconds - 24 * 60 * 60;
		sqlite.exec(`
			INSERT INTO feed_origins (id, scheme, host, port, circuit_state, created_at, updated_at)
			VALUES ('cleanup-origin', 'https', 'cleanup.example.com', 443, 'closed', ${old}, ${old});
			INSERT INTO feed_sources
				(id, normalized_url, requested_url, origin_id, next_fetch_at, state, created_at, updated_at)
			VALUES ('cleanup-source', 'https://cleanup.example.com/feed', 'https://cleanup.example.com/feed', 'cleanup-origin', ${nowSeconds}, 'active', ${old}, ${old});
			INSERT INTO feeds
				(id, user_id, category_id, title, feed_url, source_id, next_sync_at, created_at, updated_at)
			VALUES ('cleanup-feed', 'user-1', 'category-1', 'Cleanup', 'https://cleanup.example.com/feed', 'cleanup-source', ${nowSeconds}, ${old}, ${old});
			INSERT INTO feed_refresh_requests
				(id, user_id, status, requested_at, completed_at, created_at, updated_at)
			VALUES
				('cleanup-request-a', 'user-1', 'completed', ${old}, ${old}, ${old}, ${old}),
				('cleanup-request-b', 'user-1', 'completed_with_errors', ${old}, ${old}, ${old}, ${old}),
				('cleanup-request-protected', 'user-1', 'completed', ${old}, ${old}, ${old}, ${old});
			INSERT INTO feed_fetch_jobs
				(id, source_id, origin_id, status, available_at, created_at, updated_at, completed_at)
			VALUES
				('cleanup-job-a', 'cleanup-source', 'cleanup-origin', 'completed', ${old}, ${old}, ${old}, ${old}),
				('cleanup-job-b', 'cleanup-source', 'cleanup-origin', 'completed', ${old}, ${old}, ${old}, ${old}),
				('cleanup-job-protected', 'cleanup-source', 'cleanup-origin', 'completed', ${old}, ${old}, ${old}, ${old});
			INSERT INTO feed_refresh_request_items
				(id, request_id, feed_id, source_id, job_id, status, created_at, updated_at)
			VALUES ('cleanup-item-protected', 'cleanup-request-protected', 'cleanup-feed', 'cleanup-source', 'cleanup-job-protected', 'pending', ${old}, ${old});
			INSERT INTO feed_fetch_snapshots
				(id, source_id, job_id, fetched_at, final_url, raw_body, raw_body_bytes, body_expires_at, parse_state, retain_until, cleanup_after, created_at)
			VALUES
				('cleanup-snapshot-delete', 'cleanup-source', 'cleanup-job-a', ${old}, 'https://cleanup.example.com/feed', NULL, 0, NULL, 'parsed', ${old}, ${old}, ${old}),
				('cleanup-snapshot-retained', 'cleanup-source', 'cleanup-job-b', ${old}, 'https://cleanup.example.com/feed', NULL, 0, NULL, 'parsed', ${nowSeconds + 86_400}, ${old}, ${old}),
				('cleanup-snapshot-active', 'cleanup-source', NULL, ${old}, 'https://cleanup.example.com/feed', NULL, 0, NULL, 'parsed', ${old}, ${old}, ${old}),
				('cleanup-snapshot-recent', 'cleanup-source', NULL, ${old}, 'https://cleanup.example.com/feed', NULL, 0, NULL, 'parsed', ${old}, ${old}, ${old}),
				('cleanup-snapshot-expiring', 'cleanup-source', NULL, ${old}, 'https://cleanup.example.com/feed', '<rss/>', 6, ${old}, 'failed', NULL, NULL, ${old});
			UPDATE feed_fetch_jobs SET snapshot_id = 'cleanup-snapshot-delete' WHERE id = 'cleanup-job-a';
			UPDATE feed_fetch_jobs SET snapshot_id = 'cleanup-snapshot-retained' WHERE id = 'cleanup-job-b';
			INSERT INTO feed_snapshot_deliveries
				(id, snapshot_id, feed_id, status, available_at, created_at, updated_at, completed_at)
			VALUES
				('cleanup-delivery-old', 'cleanup-snapshot-delete', 'cleanup-feed', 'completed', ${old}, ${old}, ${old}, ${old}),
				('cleanup-delivery-active', 'cleanup-snapshot-active', 'cleanup-feed', 'pending', ${old}, ${old}, ${old}, NULL),
				('cleanup-delivery-recent', 'cleanup-snapshot-recent', 'cleanup-feed', 'completed', ${recent}, ${recent}, ${recent}, ${recent});
			INSERT INTO feed_discovery_candidates
				(id, request_id, user_id, input_url, candidate_url, normalized_candidate_url, expires_at, created_at, updated_at)
			VALUES
				('cleanup-discovery-a', 'cleanup-discovery-request-a', 'user-1', 'https://cleanup.example.com', 'https://cleanup.example.com/a', 'https://cleanup.example.com/a', ${old}, ${old}, ${old}),
				('cleanup-discovery-b', 'cleanup-discovery-request-b', 'user-1', 'https://cleanup.example.com', 'https://cleanup.example.com/b', 'https://cleanup.example.com/b', ${old}, ${old}, ${old});
		`);

		const result = await repository.cleanupOperationalHistory({
			now,
			retentionDays: 14,
			batchSize: 1,
		});
		expect(result).toEqual({
			expiredSnapshotBodies: 1,
			refreshRequests: 1,
			fetchJobs: 1,
			deliveries: 0,
			snapshots: 1,
			discoveryCandidates: 1,
		});
		for (const count of Object.values(result)) expect(count).toBeLessThanOrEqual(1);

		const remainingIds = (table: string) =>
			sqlite.query(`SELECT id FROM ${table} ORDER BY id`).all() as Array<{ id: string }>;
		expect(remainingIds('feed_refresh_requests').map(({ id }) => id)).toContain(
			'cleanup-request-protected',
		);
		expect(remainingIds('feed_fetch_jobs').map(({ id }) => id)).toContain('cleanup-job-protected');
		expect(remainingIds('feed_fetch_snapshots').map(({ id }) => id)).toEqual(
			expect.arrayContaining([
				'cleanup-snapshot-active',
				'cleanup-snapshot-expiring',
				'cleanup-snapshot-recent',
				'cleanup-snapshot-retained',
			]),
		);
		const expiring = sqlite
			.query(
				`SELECT raw_body, raw_body_bytes, parse_state, cleanup_after FROM feed_fetch_snapshots WHERE id = 'cleanup-snapshot-expiring'`,
			)
			.get() as {
			raw_body: string | null;
			raw_body_bytes: number;
			parse_state: string;
			cleanup_after: number;
		};
		expect(expiring).toMatchObject({ raw_body: null, raw_body_bytes: 0, parse_state: 'expired' });
		expect(expiring.cleanup_after).toBeGreaterThan(nowSeconds);
		expect(sqlite.query('PRAGMA foreign_key_check').all()).toEqual([]);
	});

	it('upserts identities, clamps intervals, deduplicates active work, and recovers leases', async () => {
		const { sqlite, repository } = await setupDatabase();
		const originA = await repository.upsertOrigin({
			id: 'origin-a',
			scheme: 'https',
			host: 'a.example.com',
			port: 443,
		});
		const repeatedOrigin = await repository.upsertOrigin({
			id: 'ignored-origin-id',
			scheme: 'https',
			host: 'a.example.com',
			port: 443,
			nextAllowedRequestAt: new Date('2026-07-18T01:00:00Z'),
		});
		expect(repeatedOrigin.id).toBe(originA.id);

		const originB = await repository.upsertOrigin({
			id: 'origin-b',
			scheme: 'https',
			host: 'b.example.com',
			port: 443,
		});
		const originC = await repository.upsertOrigin({
			id: 'origin-c',
			scheme: 'https',
			host: 'c.example.com',
			port: 443,
		});
		const originD = await repository.upsertOrigin({
			id: 'origin-d',
			scheme: 'https',
			host: 'd.example.com',
			port: 443,
		});
		const sourceA = await repository.upsertSource({
			id: 'source-a',
			normalizedUrl: 'https://a.example.com/feed.xml',
			requestedUrl: 'https://a.example.com/feed.xml',
			originId: originA.id,
			minIntervalSeconds: 60,
		});
		expect(sourceA.minIntervalSeconds).toBe(900);
		const repeatedSource = await repository.upsertSource({
			id: 'ignored-source-id',
			normalizedUrl: sourceA.normalizedUrl,
			requestedUrl: sourceA.requestedUrl,
			originId: originA.id,
			minIntervalSeconds: 300,
		});
		expect(repeatedSource.id).toBe(sourceA.id);
		expect(repeatedSource.minIntervalSeconds).toBe(900);

		const sourceB = await repository.upsertSource({
			id: 'source-b',
			normalizedUrl: 'https://b.example.com/feed.xml',
			requestedUrl: 'https://b.example.com/feed.xml',
			originId: originB.id,
		});
		const sourceC = await repository.upsertSource({
			id: 'source-c',
			normalizedUrl: 'https://c.example.com/feed.xml',
			requestedUrl: 'https://c.example.com/feed.xml',
			originId: originC.id,
		});
		const sourceD = await repository.upsertSource({
			id: 'source-d',
			normalizedUrl: 'https://d.example.com/feed.xml',
			requestedUrl: 'https://d.example.com/feed.xml',
			originId: originD.id,
		});

		const now = new Date('2026-07-18T00:00:00Z');
		const low = await repository.enqueueJob({
			id: 'job-low',
			sourceId: sourceA.id,
			originId: originA.id,
			kind: 'manual',
			priority: 1,
			availableAt: new Date(now.getTime() - 2_000),
			createdAt: new Date(now.getTime() - 10_000),
			updatedAt: now,
		});
		expect(low.created).toBe(true);
		const duplicate = await repository.enqueueJob({
			id: 'job-low-duplicate',
			sourceId: sourceA.id,
			originId: originA.id,
			kind: 'scheduled',
			priority: 99,
			availableAt: now,
			createdAt: now,
			updatedAt: now,
		});
		expect(duplicate).toMatchObject({ created: false, job: { id: 'job-low' } });
		expect(
			sqlite
				.query<{ count: number }, []>(
					"SELECT count(*) AS count FROM feed_fetch_jobs WHERE source_id = 'source-a'",
				)
				.get()?.count,
		).toBe(1);

		await repository.enqueueJob({
			id: 'job-high',
			sourceId: sourceB.id,
			originId: originB.id,
			kind: 'scheduled',
			priority: 10,
			availableAt: new Date(now.getTime() - 1_000),
			createdAt: new Date(now.getTime() - 5_000),
			updatedAt: now,
		});
		await repository.enqueueJob({
			id: 'job-high-older',
			sourceId: sourceD.id,
			originId: originD.id,
			kind: 'scheduled',
			priority: 10,
			availableAt: new Date(now.getTime() - 4_000),
			createdAt: new Date(now.getTime() - 3_000),
			updatedAt: now,
		});
		await repository.enqueueJob({
			id: 'job-expired',
			sourceId: sourceC.id,
			originId: originC.id,
			kind: 'manual',
			priority: 5,
			status: 'running',
			attempts: 1,
			leaseOwner: 'dead-worker',
			leaseExpiresAt: new Date(now.getTime() - 1_000),
			availableAt: new Date(now.getTime() - 3_000),
			createdAt: new Date(now.getTime() - 8_000),
			updatedAt: now,
		});

		const firstClaim = await repository.claimNextJob('worker-1', 60, now);
		expect(firstClaim).toMatchObject({
			id: 'job-high-older',
			status: 'running',
			leaseOwner: 'worker-1',
			attempts: 1,
		});
		sqlite.exec("UPDATE feed_fetch_jobs SET status = 'completed' WHERE id = 'job-high-older'");
		const secondClaim = await repository.claimNextJob('worker-2', 60, now);
		expect(secondClaim).toMatchObject({ id: 'job-high', attempts: 1 });
		sqlite.exec("UPDATE feed_fetch_jobs SET status = 'completed' WHERE id = 'job-high'");
		const recovered = await repository.claimNextJob('worker-3', 60, now);
		expect(recovered).toMatchObject({
			id: 'job-expired',
			status: 'running',
			leaseOwner: 'worker-3',
			attempts: 2,
		});
	});

	it('persists circular snapshot references, unique deliveries, refresh aggregates, and FK policy', async () => {
		const { sqlite, db, repository } = await setupDatabase();
		const origin = await repository.upsertOrigin({
			id: 'origin-1',
			scheme: 'https',
			host: 'feeds.example.com',
			port: 443,
		});
		const source = await repository.upsertSource({
			id: 'source-1',
			normalizedUrl: 'https://feeds.example.com/rss',
			requestedUrl: 'https://feeds.example.com/rss',
			originId: origin.id,
		});
		const now = new Date('2026-07-18T00:00:00Z');
		await db.insert(schema.feeds).values([
			{
				id: 'feed-1',
				userId: 'user-1',
				categoryId: 'category-1',
				title: 'Feed one',
				feedUrl: source.requestedUrl,
				sourceId: source.id,
				nextSyncAt: now,
				createdAt: now,
				updatedAt: now,
			},
			{
				id: 'feed-2',
				userId: 'user-1',
				categoryId: 'category-1',
				title: 'Feed two',
				feedUrl: `${source.requestedUrl}?reader=2`,
				sourceId: source.id,
				nextSyncAt: now,
				createdAt: now,
				updatedAt: now,
			},
		]);
		await repository.enqueueJob({
			id: 'job-1',
			sourceId: source.id,
			originId: origin.id,
			kind: 'manual',
			availableAt: now,
			createdAt: now,
			updatedAt: now,
		});
		const snapshot = await repository.createSnapshot({
			id: 'snapshot-1',
			sourceId: source.id,
			jobId: 'job-1',
			fetchedAt: now,
			finalUrl: source.requestedUrl,
			httpStatus: 200,
			rawBody: '<rss />',
			rawBodyBytes: 7,
			bodyExpiresAt: new Date(now.getTime() + 86_400_000),
			cleanupAfter: new Date(now.getTime() + 86_400_000),
			createdAt: now,
		});
		expect(snapshot.id).toBe('snapshot-1');
		expect(
			sqlite
				.query<{ snapshot_id: string }, []>(
					"SELECT snapshot_id FROM feed_fetch_jobs WHERE id = 'job-1'",
				)
				.get(),
		).toEqual({ snapshot_id: 'snapshot-1' });
		expect(
			await db.query.feedFetchJobs.findFirst({
				where: (job, { eq }) => eq(job.id, 'job-1'),
				with: { snapshot: true },
			}),
		).toMatchObject({ id: 'job-1', snapshot: { id: 'snapshot-1', jobId: 'job-1' } });
		expect(sqlite.query('PRAGMA foreign_key_check').all()).toEqual([]);

		const delivery = await repository.createSnapshotDelivery({
			id: 'delivery-1',
			snapshotId: snapshot.id,
			feedId: 'feed-1',
			availableAt: now,
			createdAt: now,
			updatedAt: now,
		});
		const duplicateDelivery = await repository.createSnapshotDelivery({
			id: 'delivery-duplicate',
			snapshotId: snapshot.id,
			feedId: 'feed-1',
			availableAt: now,
			createdAt: now,
			updatedAt: now,
		});
		expect(delivery.created).toBe(true);
		expect(duplicateDelivery).toMatchObject({ created: false, delivery: { id: 'delivery-1' } });

		const request = await repository.createRefreshRequest(
			{
				id: 'refresh-1',
				userId: 'user-1',
				idempotencyKey: 'manual-click-1',
				scopeType: 'all',
				requestedAt: now,
				createdAt: now,
				updatedAt: now,
			},
			[
				{ feedId: 'feed-1', sourceId: source.id, jobId: 'job-1' },
				{ feedId: 'feed-2', sourceId: source.id },
			],
		);
		expect(request).toMatchObject({ totalItems: 2, pendingItems: 2 });
		const items = await db.query.feedRefreshRequestItems.findMany({
			where: (item, { eq }) => eq(item.requestId, request.id),
			orderBy: (item, { asc }) => [asc(item.feedId)],
		});
		await repository.updateRefreshItemStatus(items[0]!.id, 'completed');
		await repository.updateRefreshItemStatus(items[1]!.id, 'failed', {
			code: 'publisher_timeout',
			details: 'Timed out before headers',
		});
		const aggregate = await repository.aggregateRefreshRequest(request.id, now);
		expect(aggregate).toMatchObject({
			status: 'completed_with_errors',
			totalItems: 2,
			pendingItems: 0,
			completedItems: 1,
			failedItems: 1,
		});

		expect(() => sqlite.exec("DELETE FROM feed_origins WHERE id = 'origin-1'")).toThrow();
		expect(() => sqlite.exec("DELETE FROM feed_sources WHERE id = 'source-1'")).toThrow();
		sqlite.exec("DELETE FROM feed_fetch_snapshots WHERE id = 'snapshot-1'");
		expect(
			sqlite
				.query<{ count: number }, []>('SELECT count(*) AS count FROM feed_snapshot_deliveries')
				.get()?.count,
		).toBe(0);
		expect(
			sqlite
				.query<{ snapshot_id: string | null }, []>(
					"SELECT snapshot_id FROM feed_fetch_jobs WHERE id = 'job-1'",
				)
				.get(),
		).toEqual({ snapshot_id: null });
		expect(sqlite.query('PRAGMA foreign_key_check').all()).toEqual([]);
	});

	it('stores raw before parsing, retries without fetch, fans out once, and bounds retention', async () => {
		const { sqlite, db, repository } = await setupDatabase();
		const origin = await repository.upsertOrigin({
			id: 'snapshot-origin',
			scheme: 'https',
			host: 'snapshot.example.com',
			port: 443,
		});
		const source = await repository.upsertSource({
			id: 'snapshot-source',
			normalizedUrl: 'https://snapshot.example.com/feed.xml',
			requestedUrl: 'https://snapshot.example.com/feed.xml',
			originId: origin.id,
		});
		const now = new Date('2026-07-18T00:00:00Z');
		await db.insert(schema.feeds).values([
			{
				id: 'snapshot-feed-1',
				userId: 'user-1',
				categoryId: 'category-1',
				title: 'One',
				feedUrl: source.requestedUrl,
				sourceId: source.id,
				nextSyncAt: now,
				createdAt: now,
				updatedAt: now,
			},
			{
				id: 'snapshot-feed-2',
				userId: 'user-1',
				categoryId: 'category-1',
				title: 'Two',
				feedUrl: `${source.requestedUrl}?two`,
				sourceId: source.id,
				nextSyncAt: now,
				createdAt: now,
				updatedAt: now,
			},
		]);
		await repository.enqueueJob({
			id: 'snapshot-job',
			sourceId: source.id,
			originId: origin.id,
			kind: 'scheduled',
			availableAt: now,
			createdAt: now,
			updatedAt: now,
		});
		const raw =
			'<rss version="2.0"><channel><title>Stored</title><link>https://snapshot.example.com</link><item><guid>one</guid><title>One</title></item></channel></rss>';
		let parserAttempts = 0;
		const parser = vi.fn(async (...args: Parameters<typeof parseNormalizedFeed>) => {
			parserAttempts += 1;
			if (parserAttempts === 1) throw new Error('simulated parser crash');
			return parseNormalizedFeed(...args);
		});
		const service = new FeedSnapshotParserService(repository, parser);
		const fetchMock = vi.fn();
		await service.persistRawResponse({
			id: 'snapshot-retry',
			sourceId: source.id,
			jobId: 'snapshot-job',
			finalUrl: source.requestedUrl,
			status: 200,
			body: raw,
			fetchedAt: now,
			headers: new Headers({
				etag: '"v1"',
				'content-type': 'application/rss+xml',
				'cache-control': 'public, max-age=7200',
				expires: 'Sat, 18 Jul 2026 04:00:00 GMT',
			}),
		});
		expect(await repository.findSnapshot('snapshot-retry')).toMatchObject({
			parseState: 'pending',
			rawBody: raw,
			rawBodyBytes: Buffer.byteLength(raw),
			etag: '"v1"',
			cacheControl: 'public, max-age=7200',
			expires: 'Sat, 18 Jul 2026 04:00:00 GMT',
		});
		await expect(service.parsePersistedSnapshot('snapshot-retry', now)).rejects.toThrow(
			'simulated parser crash',
		);
		expect(await repository.findSnapshot('snapshot-retry')).toMatchObject({
			parseState: 'failed',
			rawBody: raw,
		});
		const parsed = await service.parsePersistedSnapshot(
			'snapshot-retry',
			new Date(now.getTime() + 60_000),
		);
		expect(parsed.source.title).toBe('Stored');
		expect(parsed.publisherHints).toMatchObject({
			httpMaxAgeSeconds: 7200,
			httpExpiresSeconds: 14_340,
		});
		expect(await repository.findSnapshot('snapshot-retry')).toMatchObject({
			parseState: 'parsed',
			rawBody: null,
			rawBodyBytes: 0,
			parserVersion: parsed.parserVersion,
			normalizedPayloadHash: parsed.normalizedPayloadHash,
		});
		expect(
			sqlite
				.query<{ count: number }, []>(
					"SELECT count(*) AS count FROM feed_snapshot_deliveries WHERE snapshot_id = 'snapshot-retry'",
				)
				.get()?.count,
		).toBe(2);
		await service.parsePersistedSnapshot('snapshot-retry', new Date(now.getTime() + 120_000));
		expect(parser).toHaveBeenCalledTimes(2);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(
			(await service.cleanupExpired(new Date(now.getTime() + 23 * 60 * 60_000))).deleted,
		).toEqual([]);
		expect(
			(await service.cleanupExpired(new Date(now.getTime() + 25 * 60 * 60_000))).deleted,
		).toEqual([{ id: 'snapshot-retry' }]);

		const failingService = new FeedSnapshotParserService(repository);
		const expiringSnapshot = await failingService.persistRawResponse({
			id: 'snapshot-expiring',
			sourceId: source.id,
			finalUrl: source.requestedUrl,
			status: 200,
			body: 'garbage',
			fetchedAt: now,
		});
		const duplicateSnapshot = await failingService.persistRawResponse({
			id: 'snapshot-expiring',
			sourceId: source.id,
			finalUrl: source.requestedUrl,
			status: 200,
			body: 'garbage',
			fetchedAt: now,
		});
		expect(duplicateSnapshot.id).toBe(expiringSnapshot.id);
		expect(
			sqlite
				.query<{ count: number }, []>(
					"SELECT count(*) AS count FROM feed_fetch_snapshots WHERE id = 'snapshot-expiring'",
				)
				.get()?.count,
		).toBe(1);
		await expect(
			failingService.parsePersistedSnapshot('snapshot-expiring', now),
		).rejects.toBeTruthy();
		await failingService.cleanupExpired(new Date(now.getTime() + 23 * 60 * 60_000));
		expect(await repository.findSnapshot('snapshot-expiring')).toMatchObject({
			rawBody: 'garbage',
		});
		const expiration = await failingService.cleanupExpired(
			new Date(now.getTime() + 25 * 60 * 60_000),
		);
		expect(expiration.expiredBodies).toEqual([{ id: 'snapshot-expiring' }]);
		expect(await repository.findSnapshot('snapshot-expiring')).toMatchObject({
			parseState: 'expired',
			rawBody: null,
			rawBodyBytes: 0,
		});
		expect(
			(await failingService.cleanupExpired(new Date(now.getTime() + 50 * 60 * 60_000))).deleted,
		).toEqual([{ id: 'snapshot-expiring' }]);
	});

	it('schedules gradually and claims with source/origin eligibility, leases, and a start gap', async () => {
		const { db, repository } = await setupDatabase();
		const now = new Date('2026-07-18T00:00:00Z');
		const origin = await repository.upsertOrigin({
			id: 'claim-origin',
			scheme: 'https',
			host: 'claim.example.com',
			port: 443,
		});
		for (let index = 0; index < 7; index += 1) {
			await repository.upsertSource({
				id: `claim-source-${index}`,
				normalizedUrl: `https://claim.example.com/feed-${index}.xml`,
				requestedUrl: `https://claim.example.com/feed-${index}.xml`,
				originId: origin.id,
				nextFetchAt: now,
			});
		}
		const scheduler = new DurableFeedScheduler(repository, { batchSize: 3, jitter: () => 0 });
		expect(await scheduler.tick(now)).toHaveLength(3);
		expect(await scheduler.tick(now)).toHaveLength(3);
		expect(await scheduler.tick(now)).toHaveLength(1);
		expect(await scheduler.tick(now)).toHaveLength(0);

		const first = await repository.claimEligibleFetchJob('claim-worker-1', 30, now, 5);
		expect(first).not.toBeNull();
		expect(await repository.claimEligibleFetchJob('claim-worker-2', 30, now, 5)).toBeNull();
		await repository.finishFetchJob(
			first!.job.id,
			'claim-worker-1',
			{
				status: 'completed',
				source: { nextFetchAt: new Date(now.getTime() + 86_400_000) },
			},
			now,
		);
		expect(
			await repository.claimEligibleFetchJob(
				'claim-worker-2',
				30,
				new Date(now.getTime() + 4_000),
				5,
			),
		).toBeNull();
		expect(
			await repository.claimEligibleFetchJob(
				'claim-worker-2',
				1,
				new Date(now.getTime() + 5_000),
				5,
			),
		).not.toBeNull();

		const running = await db.query.feedFetchJobs.findFirst({
			where: (job, { eq }) => eq(job.leaseOwner, 'claim-worker-2'),
		});
		expect(running).toMatchObject({ status: 'running', attempts: 1 });
		expect(
			await repository.claimEligibleFetchJob(
				'claim-worker-3',
				30,
				new Date(now.getTime() + 7_000),
				0,
			),
		).toBeNull();
		expect(
			await repository.claimEligibleFetchJob(
				'claim-worker-3',
				30,
				new Date(now.getTime() + 10_000),
				0,
			),
		).not.toBeNull();
		expect(
			await repository.claimEligibleFetchJob(
				'claim-worker-4',
				30,
				new Date(now.getTime() + 40_000),
				0,
			),
		).not.toBeNull();
	});

	it('bounds publisher concurrency at four and serializes parsing across many origins', async () => {
		const { repository } = await setupDatabase();
		const now = new Date('2026-07-18T00:00:00Z');
		for (let index = 0; index < 20; index += 1) {
			const origin = await repository.upsertOrigin({
				id: `parallel-origin-${index}`,
				scheme: 'https',
				host: `parallel-${index}.example.com`,
				port: 443,
			});
			await repository.upsertSource({
				id: `parallel-source-${index}`,
				normalizedUrl: `https://parallel-${index}.example.com/feed.xml`,
				requestedUrl: `https://parallel-${index}.example.com/feed.xml`,
				originId: origin.id,
				nextFetchAt: now,
			});
		}
		await new DurableFeedScheduler(repository, { batchSize: 100 }).tick(now);
		let activeNetwork = 0;
		let maxNetwork = 0;
		let activeParsers = 0;
		let maxParsers = 0;
		let requests = 0;
		const publisherOutcomes: string[] = [];
		let recordedPublisherRequests = 0;
		const parser = new FeedSnapshotParserService(repository);
		const worker = new DurableFeedWorker(repository, {
			workerId: 'parallel-worker',
			networkConcurrency: 4,
			originStartGapSeconds: 0,
			now: () => now,
			telemetry: {
				recordPublisherRequest: () => {
					recordedPublisherRequests += 1;
				},
				recordPublisherOutcome: (outcome) => publisherOutcomes.push(outcome),
			},
			fetch: async () => {
				requests += 1;
				activeNetwork += 1;
				maxNetwork = Math.max(maxNetwork, activeNetwork);
				await new Promise((resolve) => setTimeout(resolve, 5));
				activeNetwork -= 1;
				return new Response(
					'<rss version="2.0"><channel><title>Parallel</title><item><guid>one</guid><title>One</title></item></channel></rss>',
					{ headers: { 'content-type': 'application/rss+xml' } },
				);
			},
			parseSnapshot: async (snapshotId, parseNow) => {
				activeParsers += 1;
				maxParsers = Math.max(maxParsers, activeParsers);
				await new Promise((resolve) => setTimeout(resolve, 2));
				try {
					return await parser.parsePersistedSnapshot(snapshotId, parseNow);
				} finally {
					activeParsers -= 1;
				}
			},
		});
		let processed = 0;
		do {
			processed = await worker.drainOnce();
		} while (processed > 0);
		expect(requests).toBe(20);
		expect(recordedPublisherRequests).toBe(20);
		expect(publisherOutcomes).toEqual(Array.from({ length: 20 }, () => 'success'));
		expect(maxNetwork).toBe(4);
		expect(maxParsers).toBe(1);
	});

	it('reconciles refresh parents when final-attempt leases expire', async () => {
		const { db, repository } = await setupDatabase();
		const now = new Date('2026-07-18T00:00:00Z');
		const expiredAt = new Date(now.getTime() - 1_000);
		const origin = await repository.upsertOrigin({
			id: 'exhausted-origin',
			scheme: 'https',
			host: 'exhausted.example.com',
			port: 443,
		});
		const source = await repository.upsertSource({
			id: 'exhausted-source',
			normalizedUrl: 'https://exhausted.example.com/feed.xml',
			requestedUrl: 'https://exhausted.example.com/feed.xml',
			originId: origin.id,
			nextFetchAt: now,
		});
		await db.insert(schema.feeds).values({
			id: 'exhausted-feed',
			userId: 'user-1',
			categoryId: 'category-1',
			title: 'Exhausted delivery',
			feedUrl: source.requestedUrl,
			sourceId: source.id,
			nextSyncAt: now,
			createdAt: now,
			updatedAt: now,
		});
		const fetchJob = await repository.enqueueJob({
			id: 'exhausted-fetch-job',
			sourceId: source.id,
			originId: origin.id,
			kind: 'manual',
			availableAt: now,
			createdAt: now,
			updatedAt: now,
		});
		await db
			.update(schema.feedFetchJobs)
			.set({
				status: 'running',
				attempts: 3,
				maxAttempts: 3,
				leaseOwner: 'lost-fetch-worker',
				leaseExpiresAt: expiredAt,
			})
			.where(eq(schema.feedFetchJobs.id, fetchJob.job.id));
		const fetchRefresh = await repository.createRefreshRequest(
			{
				id: 'exhausted-fetch-refresh',
				userId: 'user-1',
				scopeType: 'all',
				requestedAt: now,
				createdAt: now,
				updatedAt: now,
			},
			[{ feedId: 'exhausted-feed', sourceId: source.id, jobId: fetchJob.job.id }],
		);
		expect(await repository.claimEligibleFetchJob('cleanup-worker', 30, now, 0)).toBeNull();
		expect(
			await db.query.feedRefreshRequests.findFirst({
				where: (request, { eq }) => eq(request.id, fetchRefresh.id),
			}),
		).toMatchObject({
			status: 'completed_with_errors',
			pendingItems: 0,
			deadItems: 1,
		});

		const deliveryJob = await repository.enqueueJob({
			id: 'exhausted-delivery-job',
			sourceId: source.id,
			originId: origin.id,
			kind: 'manual',
			availableAt: now,
			createdAt: now,
			updatedAt: now,
		});
		const snapshot = await repository.createSnapshot({
			id: 'exhausted-delivery-snapshot',
			sourceId: source.id,
			jobId: deliveryJob.job.id,
			fetchedAt: now,
			finalUrl: source.requestedUrl,
			httpStatus: 200,
			parseState: 'parsed',
			normalizedPayload: '{}',
			createdAt: now,
		});
		await repository.createSnapshotDelivery({
			id: 'exhausted-delivery',
			snapshotId: snapshot.id,
			feedId: 'exhausted-feed',
			status: 'running',
			attempts: 3,
			maxAttempts: 3,
			leaseOwner: 'lost-delivery-worker',
			leaseExpiresAt: expiredAt,
			availableAt: now,
			createdAt: now,
			updatedAt: now,
		});
		const deliveryRefresh = await repository.createRefreshRequest(
			{
				id: 'exhausted-delivery-refresh',
				userId: 'user-1',
				scopeType: 'feed',
				scopeFeedId: 'exhausted-feed',
				requestedAt: now,
				createdAt: now,
				updatedAt: now,
			},
			[{ feedId: 'exhausted-feed', sourceId: source.id, jobId: deliveryJob.job.id }],
		);
		expect(await repository.claimNextDelivery('delivery-cleanup-worker', 30, now)).toBeNull();
		expect(
			await db.query.feedRefreshRequests.findFirst({
				where: (request, { eq }) => eq(request.id, deliveryRefresh.id),
			}),
		).toMatchObject({
			status: 'completed_with_errors',
			pendingItems: 0,
			deadItems: 1,
		});
	});

	it('fetches a shared source once, delivers per subscription, and preserves reads/enriched content', async () => {
		const { sqlite, db, repository } = await setupDatabase();
		const now = new Date('2026-07-18T00:00:00Z');
		sqlite.exec(`
			INSERT INTO users (id, email, password_hash, role, is_active, created_at, updated_at)
			VALUES ('user-2', 'second@example.com', 'hash', 'user', 1, 1700000000, 1700000000);
			INSERT INTO categories (id, user_id, name, slug, sort_order, created_at, updated_at)
			VALUES ('category-2', 'user-2', 'News', 'news', 0, 1700000000, 1700000000);
		`);
		let publisherRequests = 0;
		const server = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch() {
				publisherRequests += 1;
				return new Response(
					'<rss version="2.0"><channel><title>Shared</title><link>https://publisher.example</link><item><guid>shared-1</guid><title>Shared one</title><description><![CDATA[<p>Thin body</p>]]></description></item></channel></rss>',
					{ headers: { etag: '"shared-v1"', 'content-type': 'application/rss+xml' } },
				);
			},
		});
		servers.push(server);
		const sourceUrl = new URL('/feed.xml', server.url).toString();
		const parsedUrl = new URL(sourceUrl);
		const origin = await repository.upsertOrigin({
			id: 'shared-origin',
			scheme: 'http',
			host: parsedUrl.hostname,
			port: Number(parsedUrl.port),
		});
		const source = await repository.upsertSource({
			id: 'shared-source',
			normalizedUrl: sourceUrl,
			requestedUrl: sourceUrl,
			originId: origin.id,
			nextFetchAt: now,
		});
		await db.insert(schema.feeds).values([
			{
				id: 'shared-feed-1',
				userId: 'user-1',
				categoryId: 'category-1',
				title: 'Original one',
				customTitle: 'Custom one',
				feedUrl: sourceUrl,
				sourceId: source.id,
				nextSyncAt: now,
				createdAt: now,
				updatedAt: now,
			},
			{
				id: 'shared-feed-2',
				userId: 'user-2',
				categoryId: 'category-2',
				title: 'Original two',
				feedUrl: `${sourceUrl}?reader=2`,
				sourceId: source.id,
				nextSyncAt: now,
				createdAt: now,
				updatedAt: now,
			},
		]);
		await new DurableFeedScheduler(repository).tick(now);
		const worker = new DurableFeedWorker(repository, {
			workerId: 'shared-fetch-worker',
			allowPrivateHosts: true,
			originStartGapSeconds: 0,
			now: () => now,
		});
		expect(await worker.drainOnce()).toBe(1);
		expect(publisherRequests).toBe(1);
		expect(await db.select().from(schema.feedSnapshotDeliveries)).toHaveLength(2);

		const committed: string[] = [];
		const deliveries = new FeedSnapshotDeliveryService(repository, new ArticleRepository(db), {
			afterCommit: ({ feedId }) => {
				committed.push(feedId);
			},
		});
		expect(await deliveries.drainOnce('delivery-worker', { limit: 10, now })).toBe(2);
		const articles = await db.select().from(schema.articles);
		expect(articles).toHaveLength(2);
		expect(new Set(articles.map((article) => article.feedId))).toEqual(
			new Set(['shared-feed-1', 'shared-feed-2']),
		);
		expect(committed.sort()).toEqual(['shared-feed-1', 'shared-feed-2']);
		expect(
			await db.query.feeds.findFirst({ where: (feed, { eq }) => eq(feed.id, 'shared-feed-1') }),
		).toMatchObject({ title: 'Custom one', customTitle: 'Custom one' });

		const firstArticle = articles.find((article) => article.feedId === 'shared-feed-1')!;
		await db.insert(schema.articleReads).values({
			userId: 'user-1',
			articleId: firstArticle.id,
			readAt: now,
		});
		await db
			.update(schema.articles)
			.set({
				contentHtml: `<p>${'enriched '.repeat(100)}</p>`,
				contentText: 'enriched '.repeat(100),
				hash: 'enriched-hash',
				contentStatus: 'full_ready',
			})
			.where(eq(schema.articles.id, firstArticle.id));
		const firstDelivery = await db.query.feedSnapshotDeliveries.findFirst({
			where: (delivery, { eq }) => eq(delivery.feedId, 'shared-feed-1'),
		});
		await db
			.update(schema.feedSnapshotDeliveries)
			.set({ status: 'pending', availableAt: now, completedAt: null, attempts: 0 })
			.where(eq(schema.feedSnapshotDeliveries.id, firstDelivery!.id));
		await deliveries.drainOnce('delivery-replay', { limit: 1, now });
		expect(
			await db.query.articles.findFirst({
				where: (article, { eq }) => eq(article.id, firstArticle.id),
			}),
		).toMatchObject({ id: firstArticle.id, hash: 'enriched-hash', contentStatus: 'full_ready' });
		expect(await db.select().from(schema.articleReads)).toHaveLength(1);
		expect(publisherRequests).toBe(1);

		const secondDelivery = await db.query.feedSnapshotDeliveries.findFirst({
			where: (delivery, { eq }) => eq(delivery.feedId, 'shared-feed-2'),
		});
		await db
			.update(schema.feedSnapshotDeliveries)
			.set({ status: 'pending', availableAt: now, completedAt: null, attempts: 0 })
			.where(eq(schema.feedSnapshotDeliveries.id, secondDelivery!.id));
		let failLocally = true;
		const locallyFailing = new FeedSnapshotDeliveryService(repository, new ArticleRepository(db), {
			beforePersist() {
				if (failLocally) {
					failLocally = false;
					throw new Error('local database fault');
				}
			},
		});
		expect(await locallyFailing.drainOnce('delivery-local-failure', { limit: 1, now })).toBe(1);
		expect(
			await db.query.feedSnapshotDeliveries.findFirst({
				where: (delivery, { eq }) => eq(delivery.id, secondDelivery!.id),
			}),
		).toMatchObject({ status: 'pending', attempts: 1 });
		expect(
			await locallyFailing.drainOnce('delivery-local-retry', {
				limit: 1,
				now: new Date(now.getTime() + 61_000),
			}),
		).toBe(1);
		expect(publisherRequests).toBe(1);

		await db
			.update(schema.feedSnapshotDeliveries)
			.set({ status: 'pending', availableAt: now, completedAt: null, attempts: 0 })
			.where(eq(schema.feedSnapshotDeliveries.id, secondDelivery!.id));
		const callbackFailure = new FeedSnapshotDeliveryService(repository, new ArticleRepository(db), {
			afterCommit() {
				throw new Error('cache unavailable');
			},
		});
		await expect(
			callbackFailure.drainOnce('delivery-callback-failure', { limit: 1, now }),
		).rejects.toThrow('cache unavailable');
		expect(
			await db.query.feedSnapshotDeliveries.findFirst({
				where: (delivery, { eq }) => eq(delivery.id, secondDelivery!.id),
			}),
		).toMatchObject({ status: 'completed' });
		expect(publisherRequests).toBe(1);
	});

	it('deduplicates active manual refresh scopes without relying on client headers', async () => {
		const { db, facade } = await setupReplacementFacade();

		const [first, duplicate] = await Promise.all([
			facade.queueRefresh('user-1', {}),
			facade.queueRefresh('user-1', {}),
		]);

		expect(duplicate.requestId).toBe(first.requestId);
		expect(duplicate.jobIds).toEqual(first.jobIds);
		expect(duplicate.alreadyQueued).toBe(true);
		expect(await db.select().from(schema.feedRefreshRequests)).toHaveLength(1);
		expect(await db.select().from(schema.feedRefreshRequestItems)).toHaveLength(1);
	});

	it('lets manual refresh bypass scheduled cadence after the publisher safety interval', async () => {
		const { db, facade, repository } = await setupReplacementFacade();
		const now = new Date();
		await db
			.update(schema.feedSources)
			.set({
				lastFetchAt: new Date(now.getTime() - 60 * 60_000),
				nextFetchAt: new Date(now.getTime() + 24 * 60 * 60_000),
			})
			.where(eq(schema.feedSources.id, 'replacement-retry-source'));

		const queued = await facade.queueRefresh('user-1', {});
		const claim = await repository.claimEligibleFetchJob(
			'manual-worker',
			60,
			new Date(now.getTime() + 1_000),
			0,
		);

		expect(queued.status).toMatchObject({ active: true, pendingFeeds: 1 });
		expect(claim?.job).toMatchObject({ id: queued.jobIds[0], kind: 'manual', status: 'running' });
	});

	it('defers manual refresh inside the publisher safety interval without queuing a fetch', async () => {
		const { db, facade } = await setupReplacementFacade();
		const now = new Date();
		await db
			.update(schema.feedSources)
			.set({
				lastFetchAt: new Date(now.getTime() - 5 * 60_000),
				nextFetchAt: new Date(now.getTime() + 24 * 60 * 60_000),
			})
			.where(eq(schema.feedSources.id, 'replacement-retry-source'));

		const queued = await facade.queueRefresh('user-1', {});

		expect(queued.jobIds).toEqual([]);
		expect(queued.status).toMatchObject({
			active: false,
			status: 'completed',
			syncedFeeds: 0,
			skippedFeeds: 1,
		});
		expect(await db.select().from(schema.feedFetchJobs)).toHaveLength(0);
		expect(await db.select().from(schema.feedRefreshRequestItems)).toEqual([
			expect.objectContaining({
				status: 'completed',
				jobId: null,
				lastErrorCode: 'manual_refresh_deferred',
			}),
		]);
	});

	it('ends manual refresh tracking after five minutes while preserving queued publisher work', async () => {
		const { db, facade, repository } = await setupReplacementFacade();
		const queued = await facade.queueRefresh('user-1', {});
		const now = new Date();
		await db
			.update(schema.feedRefreshRequests)
			.set({ requestedAt: new Date(now.getTime() - 6 * 60_000) })
			.where(eq(schema.feedRefreshRequests.id, queued.requestId));

		await new DurableFeedScheduler(repository, { jitter: () => 0 }).tick(now);

		expect(await facade.getRefreshStatus('user-1', queued.requestId)).toMatchObject({
			active: false,
			status: 'completed',
			syncedFeeds: 0,
			skippedFeeds: 1,
		});
		expect(await db.select().from(schema.feedFetchJobs)).toEqual([
			expect.objectContaining({ status: 'queued', kind: 'manual' }),
		]);
		expect(await db.select().from(schema.feedRefreshRequestItems)).toEqual([
			expect.objectContaining({
				status: 'completed',
				jobId: null,
				lastErrorCode: 'manual_refresh_deadline_exceeded',
			}),
		]);
	});

	it('reports an overlong running publisher job as stale without refreshing progress time', async () => {
		const { db, facade } = await setupReplacementFacade();
		const queued = await facade.queueRefresh('user-1', {});
		const before = await db.query.feedRefreshRequests.findFirst({
			where: (request, { eq }) => eq(request.id, queued.requestId),
		});
		const now = new Date();
		await db
			.update(schema.feedFetchJobs)
			.set({
				status: 'running',
				startedAt: new Date(now.getTime() - 3 * 60_000),
				leaseOwner: 'stalled-worker',
				leaseExpiresAt: new Date(now.getTime() + 60_000),
				attempts: 1,
			})
			.where(eq(schema.feedFetchJobs.id, queued.jobIds[0]!));

		const status = await facade.getRefreshStatus('user-1', queued.requestId);
		const after = await db.query.feedRefreshRequests.findFirst({
			where: (request, { eq }) => eq(request.id, queued.requestId),
		});

		expect(status).toMatchObject({ active: true, stale: true });
		expect(after?.updatedAt).toEqual(before?.updatedAt);
	});

	it('retries the same replacement URL after a terminal failure with fresh durable work', async () => {
		const { db, facade, repository } = await setupReplacementFacade();
		const targetUrl = 'https://replacement-new.example.com/feed.xml';
		const first = await facade.requestReplacement('user-1', 'replacement-retry-feed', targetUrl);
		await db
			.update(schema.feedFetchJobs)
			.set({ status: 'dead', deadAt: new Date(), updatedAt: new Date() })
			.where(eq(schema.feedFetchJobs.id, first.jobId!));
		await repository.failRefreshItemsForJob(first.jobId!, {
			code: 'parse_permanent',
			details: 'Terminal replacement failure',
		});

		const retry = await facade.requestReplacement('user-1', 'replacement-retry-feed', targetUrl);
		expect(retry.requestId).not.toBe(first.requestId);
		expect(retry.jobId).not.toBe(first.jobId);
		expect(retry.feed).toMatchObject({
			pendingSourceId: first.feed.pendingSourceId,
			syncStatus: 'replacement_pending',
		});
		expect(
			await db.query.feedRefreshRequests.findFirst({
				where: (request, { eq }) => eq(request.id, first.requestId!),
			}),
		).toMatchObject({ status: 'completed_with_errors', idempotencyKey: null });
		expect(
			await db.query.feedRefreshRequests.findFirst({
				where: (request, { eq }) => eq(request.id, retry.requestId!),
			}),
		).toMatchObject({ status: 'pending' });
	});

	it('terminalizes cancellation without stopping shared work and permits immediate retry', async () => {
		const { db, facade } = await setupReplacementFacade();
		const targetUrl = 'https://replacement-new.example.com/feed.xml';
		const first = await facade.requestReplacement('user-1', 'replacement-retry-feed', targetUrl);
		const cancelled = await facade.cancelReplacement('user-1', 'replacement-retry-feed');
		expect(cancelled).toMatchObject({ pendingSourceId: null, syncStatus: 'idle' });
		expect(
			await db.query.feedRefreshRequests.findFirst({
				where: (request, { eq }) => eq(request.id, first.requestId!),
			}),
		).toMatchObject({
			status: 'completed_with_errors',
			idempotencyKey: null,
			pendingItems: 0,
			failedItems: 1,
		});
		expect(
			await db.query.feedRefreshRequestItems.findFirst({
				where: (item, { eq }) => eq(item.requestId, first.requestId!),
			}),
		).toMatchObject({ status: 'failed', lastErrorCode: 'replacement_cancelled', jobId: null });
		expect(
			await db.query.feedFetchJobs.findFirst({
				where: (job, { eq }) => eq(job.id, first.jobId!),
			}),
		).toMatchObject({ status: 'queued' });

		const retry = await facade.requestReplacement('user-1', 'replacement-retry-feed', targetUrl);
		expect(retry.requestId).not.toBe(first.requestId);
		expect(retry.jobId).toBe(first.jobId);
		expect(retry.feed).toMatchObject({
			pendingSourceId: first.feed.pendingSourceId,
			syncStatus: 'replacement_pending',
		});
		expect(
			await db.query.feedRefreshRequests.findFirst({
				where: (request, { eq }) => eq(request.id, retry.requestId!),
			}),
		).toMatchObject({ status: 'pending' });
	});

	it('deduplicates concurrent identical active replacements transactionally', async () => {
		const { db, facade } = await setupReplacementFacade();
		const targetUrl = 'https://replacement-new.example.com/feed.xml';
		const [first, duplicate] = await Promise.all([
			facade.requestReplacement('user-1', 'replacement-retry-feed', targetUrl),
			facade.requestReplacement('user-1', 'replacement-retry-feed', targetUrl),
		]);
		expect(duplicate.requestId).toBe(first.requestId);
		expect(duplicate.jobId).toBe(first.jobId);
		expect(await db.select().from(schema.feedRefreshRequests)).toHaveLength(1);
		expect(await db.select().from(schema.feedRefreshRequestItems)).toHaveLength(1);
		expect(await db.select().from(schema.feedFetchJobs)).toHaveLength(1);
		expect(duplicate.feed).toMatchObject({
			pendingSourceId: first.feed.pendingSourceId,
			syncStatus: 'replacement_pending',
		});
	});

	it('stages replacements atomically, rejects duplicate pending targets, and reconciles parsed recovery without refetch', async () => {
		const { db, repository } = await setupDatabase();
		const facade = new DurableFeedFacadeService(
			db,
			new FeedRepository(db),
			new CategoryRepository(db),
			repository,
		);
		const now = new Date('2026-07-18T00:00:00Z');
		const oldOrigin = await repository.upsertOrigin({
			id: 'replacement-old-origin',
			scheme: 'https',
			host: 'old.example.com',
			port: 443,
		});
		const oldSource = await repository.upsertSource({
			id: 'replacement-old-source',
			normalizedUrl: 'https://old.example.com/feed.xml',
			requestedUrl: 'https://old.example.com/feed.xml',
			originId: oldOrigin.id,
			nextFetchAt: now,
		});
		await db.insert(schema.feeds).values([
			{
				id: 'replacement-feed-1',
				userId: 'user-1',
				categoryId: 'category-1',
				title: 'Old feed one',
				feedUrl: oldSource.normalizedUrl,
				sourceId: oldSource.id,
				nextSyncAt: now,
				createdAt: now,
				updatedAt: now,
			},
			{
				id: 'replacement-feed-2',
				userId: 'user-1',
				categoryId: 'category-1',
				title: 'Old feed two',
				feedUrl: 'https://old.example.com/second.xml',
				sourceId: oldSource.id,
				nextSyncAt: now,
				createdAt: now,
				updatedAt: now,
			},
		]);
		await db.insert(schema.articles).values({
			id: 'replacement-old-article',
			feedId: 'replacement-feed-1',
			guid: 'old-guid',
			title: 'Old article',
			fetchedAt: now,
			hash: 'old-hash',
		});
		await db.insert(schema.articleReads).values({
			userId: 'user-1',
			articleId: 'replacement-old-article',
			readAt: now,
		});

		const replacement = await facade.requestReplacement(
			'user-1',
			'replacement-feed-1',
			'https://new.example.com/feed.xml',
		);
		expect(replacement.feed).toMatchObject({
			feedUrl: oldSource.normalizedUrl,
			sourceId: oldSource.id,
			syncStatus: 'replacement_pending',
		});
		expect(await db.select().from(schema.articles)).toHaveLength(1);
		expect(await db.select().from(schema.articleReads)).toHaveLength(1);
		await expect(
			facade.requestReplacement('user-1', 'replacement-feed-2', 'https://new.example.com/feed.xml'),
		).rejects.toMatchObject({ code: 'CONFLICT' });

		const job = await db.query.feedFetchJobs.findFirst({
			where: (row, { eq }) => eq(row.id, replacement.jobId!),
		});
		const parser = new FeedSnapshotParserService(repository);
		const snapshot = await parser.persistRawResponse({
			id: 'replacement-parsed-snapshot',
			sourceId: job!.sourceId,
			jobId: job!.id,
			finalUrl: 'https://new.example.com/feed.xml',
			status: 200,
			body: '<rss version="2.0"><channel><title>New feed</title><item><guid>new-guid</guid><title>New article</title></item></channel></rss>',
			fetchedAt: now,
		});
		await parser.parsePersistedSnapshot(snapshot.id, now);
		expect(
			await db.query.feeds.findFirst({
				where: (feed, { eq }) => eq(feed.id, 'replacement-feed-1'),
			}),
		).toMatchObject({
			sourceId: job!.sourceId,
			pendingSourceId: null,
			feedUrl: 'https://new.example.com/feed.xml',
		});
		expect(await db.select().from(schema.articles)).toHaveLength(0);
		expect(await db.select().from(schema.articleReads)).toHaveLength(0);

		await db
			.update(schema.feedFetchJobs)
			.set({
				status: 'running',
				leaseOwner: 'crashed-after-parse',
				leaseExpiresAt: new Date(now.getTime() - 1_000),
				attempts: 1,
			})
			.where(eq(schema.feedFetchJobs.id, job!.id));
		await db
			.update(schema.feedOrigins)
			.set({ blockedUntil: new Date(now.getTime() + 24 * 60 * 60_000) })
			.where(eq(schema.feedOrigins.id, job!.originId));
		let refetches = 0;
		const recovery = new DurableFeedWorker(repository, {
			workerId: 'parsed-recovery-worker',
			originStartGapSeconds: 5,
			now: () => now,
			fetch: async () => {
				refetches += 1;
				throw new Error('Parsed recovery must not fetch');
			},
		});
		expect(await recovery.drainOnce()).toBe(1);
		expect(refetches).toBe(0);
		expect(
			await db.query.feedFetchJobs.findFirst({ where: (row, { eq }) => eq(row.id, job!.id) }),
		).toMatchObject({ status: 'completed' });
		expect(await db.select().from(schema.feedSnapshotDeliveries)).toHaveLength(1);

		await db.insert(schema.articles).values({
			id: 'replacement-preserved-article',
			feedId: 'replacement-feed-2',
			guid: 'preserved-guid',
			title: 'Preserved article',
			fetchedAt: now,
			hash: 'preserved-hash',
		});
		await db.insert(schema.articleReads).values({
			userId: 'user-1',
			articleId: 'replacement-preserved-article',
			readAt: now,
		});
		const failedReplacement = await facade.requestReplacement(
			'user-1',
			'replacement-feed-2',
			'https://failed.example.com/feed.xml',
		);
		await db
			.update(schema.feedSources)
			.set({ nextFetchAt: now })
			.where(eq(schema.feedSources.id, failedReplacement.feed.pendingSourceId!));
		await db
			.update(schema.feedFetchJobs)
			.set({ availableAt: now })
			.where(eq(schema.feedFetchJobs.id, failedReplacement.jobId!));
		const failingWorker = new DurableFeedWorker(repository, {
			workerId: 'failed-replacement-worker',
			originStartGapSeconds: 0,
			now: () => now,
			fetch: async () =>
				new Response('publisher unavailable', {
					status: 503,
					headers: { 'retry-after': '3600' },
				}),
		});
		expect(await failingWorker.drainOnce()).toBe(1);
		expect(
			await db.query.feeds.findFirst({
				where: (feed, { eq }) => eq(feed.id, 'replacement-feed-2'),
			}),
		).toMatchObject({
			sourceId: oldSource.id,
			pendingSourceId: failedReplacement.feed.pendingSourceId,
			syncStatus: 'backoff',
		});
		expect(
			await db.query.articles.findFirst({
				where: (article, { eq }) => eq(article.id, 'replacement-preserved-article'),
			}),
		).not.toBeNull();
		expect(await db.select().from(schema.articleReads)).toHaveLength(1);
	});

	it('uses validators until the weekly unconditional boundary and completes 304 refreshes', async () => {
		const { db, repository } = await setupDatabase();
		let clock = new Date('2026-07-18T00:00:00Z');
		const origin = await repository.upsertOrigin({
			id: 'validator-origin',
			scheme: 'https',
			host: 'validator.example.com',
			port: 443,
		});
		const source = await repository.upsertSource({
			id: 'validator-source',
			normalizedUrl: 'https://validator.example.com/feed.xml',
			requestedUrl: 'https://validator.example.com/feed.xml',
			originId: origin.id,
			etag: '"validator-v1"',
			lastModified: 'Fri, 17 Jul 2026 00:00:00 GMT',
			lastUnconditionalFetchAt: new Date(clock.getTime() - 6 * 24 * 60 * 60_000),
			nextFetchAt: clock,
		});
		await db.insert(schema.feeds).values({
			id: 'validator-feed',
			userId: 'user-1',
			categoryId: 'category-1',
			title: 'Validator',
			feedUrl: source.requestedUrl,
			sourceId: source.id,
			nextSyncAt: clock,
			createdAt: clock,
			updatedAt: clock,
		});
		const refresh = await repository.createRefreshRequest(
			{
				id: 'validator-refresh',
				userId: 'user-1',
				idempotencyKey: 'validator-refresh-key',
				scopeType: 'feed',
				scopeFeedId: 'validator-feed',
				requestedAt: clock,
				createdAt: clock,
				updatedAt: clock,
			},
			[{ feedId: 'validator-feed', sourceId: source.id }],
		);
		const firstJob = await repository.enqueueJob({
			id: 'validator-job-1',
			sourceId: source.id,
			originId: origin.id,
			refreshRequestId: refresh.id,
			kind: 'manual',
			priority: 100,
			availableAt: clock,
			createdAt: clock,
			updatedAt: clock,
		});
		await repository.linkRefreshItemsToJob(source.id, firstJob.job.id, clock);
		const requestHeaders: Headers[] = [];
		const worker = new DurableFeedWorker(repository, {
			workerId: 'validator-worker',
			originStartGapSeconds: 0,
			now: () => clock,
			fetch: async (_url, init) => {
				requestHeaders.push(new Headers(init.headers));
				return new Response(null, { status: 304 });
			},
		});
		expect(await worker.drainOnce()).toBe(1);
		expect(requestHeaders[0]?.get('if-none-match')).toBe('"validator-v1"');
		expect(await db.select().from(schema.feedSnapshotDeliveries)).toHaveLength(0);
		expect(await repository.aggregateRefreshRequest(refresh.id, clock)).toMatchObject({
			status: 'completed',
			completedItems: 1,
			pendingItems: 0,
		});

		clock = new Date(clock.getTime() + 24 * 60 * 60_000);
		await db
			.update(schema.feedSources)
			.set({ nextFetchAt: clock, backoffUntil: null })
			.where(eq(schema.feedSources.id, source.id));
		await new DurableFeedScheduler(repository).tick(clock);
		expect(await worker.drainOnce()).toBe(1);
		expect(requestHeaders[1]?.has('if-none-match')).toBe(false);
		expect(
			await db.query.feedSources.findFirst({ where: (row, { eq }) => eq(row.id, source.id) }),
		).toMatchObject({ lastUnconditionalFetchAt: clock });
	});

	it('persists user-scoped HTML discovery choices and queues selection without probing inline', async () => {
		const { db, repository } = await setupDatabase();
		const facade = new DurableFeedFacadeService(
			db,
			new FeedRepository(db),
			new CategoryRepository(db),
			repository,
		);
		// Discovery candidates expire relative to wall-clock time, so a fixed past
		// date makes this test start failing as soon as that date ages out.
		const now = new Date();
		const pending = await facade.createPendingFeed('user-1', {
			categoryId: 'category-1',
			feedUrl: 'https://site.example.com/',
		});
		await db
			.update(schema.feedSources)
			.set({ nextFetchAt: now })
			.where(eq(schema.feedSources.id, pending.feed.pendingSourceId!));
		await db
			.update(schema.feedFetchJobs)
			.set({ availableAt: now })
			.where(eq(schema.feedFetchJobs.id, pending.jobId));
		let publisherRequests = 0;
		const discoveryWorker = new DurableFeedWorker(repository, {
			workerId: 'discovery-worker',
			originStartGapSeconds: 0,
			now: () => now,
			fetch: async () => {
				publisherRequests += 1;
				return new Response(
					'<html><head><link rel="alternate" type="application/rss+xml" href="/news.xml" title="News"><link rel="alternate" type="application/atom+xml" href="/atom.xml"></head></html>',
					{ headers: { 'content-type': 'text/html; charset=utf-8' } },
				);
			},
			handleDiscovery: (input) => facade.persistDiscoveryCandidates(input),
		});
		expect(await discoveryWorker.drainOnce()).toBe(1);
		expect(publisherRequests).toBe(1);
		const candidates = await facade.listDiscoveryCandidates('user-1', pending.requestId);
		expect(candidates.length).toBeGreaterThan(1);
		expect(await facade.listDiscoveryCandidates('another-user', pending.requestId)).toEqual([]);
		expect(
			await db.query.feeds.findFirst({ where: (feed, { eq }) => eq(feed.id, pending.feed.id) }),
		).toMatchObject({ syncStatus: 'discovery_required', sourceId: null });

		const advertised = candidates.find(
			(candidate) => candidate.normalizedCandidateUrl === 'https://site.example.com/news.xml',
		)!;
		const selected = await facade.selectDiscoveryCandidate('user-1', advertised.id);
		expect(selected.feedId).toBe(pending.feed.id);
		expect(publisherRequests).toBe(1);
		expect(
			await db.query.feeds.findFirst({ where: (feed, { eq }) => eq(feed.id, pending.feed.id) }),
		).toMatchObject({ syncStatus: 'pending', sourceId: null });
		expect(
			(await db.select().from(schema.feedFetchJobs)).filter((job) => job.status === 'queued'),
		).toHaveLength(1);
	});

	it('blocks an origin on 429 without inline retry and manual priority cannot bypass it', async () => {
		const { db, repository } = await setupDatabase();
		const now = new Date('2026-07-18T00:00:00Z');
		const origin = await repository.upsertOrigin({
			id: 'rate-origin',
			scheme: 'https',
			host: 'rate.example.com',
			port: 443,
		});
		for (let index = 0; index < 2; index += 1) {
			const source = await repository.upsertSource({
				id: `rate-source-${index}`,
				normalizedUrl: `https://rate.example.com/feed-${index}.xml`,
				requestedUrl: `https://rate.example.com/feed-${index}.xml`,
				originId: origin.id,
				nextFetchAt: now,
			});
			await repository.enqueueJob({
				id: `rate-job-${index}`,
				sourceId: source.id,
				originId: origin.id,
				kind: index === 1 ? 'manual' : 'scheduled',
				priority: index === 1 ? 100 : 0,
				availableAt: now,
				createdAt: now,
				updatedAt: now,
			});
		}
		let requests = 0;
		const worker = new DurableFeedWorker(repository, {
			workerId: 'rate-worker',
			networkConcurrency: 4,
			originStartGapSeconds: 0,
			now: () => now,
			fetch: async () => {
				requests += 1;
				return new Response('slow down', { status: 429, headers: { 'retry-after': '3600' } });
			},
		});
		expect(await worker.drainOnce()).toBe(1);
		expect(requests).toBe(1);
		expect(await worker.drainOnce()).toBe(0);
		expect(requests).toBe(1);
		expect(
			await db.query.feedOrigins.findFirst({ where: (row, { eq }) => eq(row.id, origin.id) }),
		).toMatchObject({
			retryAfterUntil: new Date(now.getTime() + 3_600_000),
			blockedUntil: new Date(now.getTime() + 3_600_000),
		});
		expect(
			await repository.claimEligibleFetchJob(
				'bypass-worker',
				60,
				new Date(now.getTime() + 30_000),
				0,
			),
		).toBeNull();
	});

	it('recovers a raw snapshot after lease expiry without another publisher request', async () => {
		const { db, repository } = await setupDatabase();
		let clock = new Date('2026-07-18T00:00:00Z');
		const origin = await repository.upsertOrigin({
			id: 'crash-origin',
			scheme: 'https',
			host: 'crash.example.com',
			port: 443,
		});
		const source = await repository.upsertSource({
			id: 'crash-source',
			normalizedUrl: 'https://crash.example.com/feed.xml',
			requestedUrl: 'https://crash.example.com/feed.xml',
			originId: origin.id,
			etag: '"crash-v1"',
			lastUnconditionalFetchAt: new Date(clock.getTime() - 8 * 24 * 60 * 60_000),
			nextFetchAt: clock,
		});
		await db.insert(schema.feeds).values({
			id: 'crash-feed',
			userId: 'user-1',
			categoryId: 'category-1',
			title: 'Crash',
			feedUrl: source.requestedUrl,
			sourceId: source.id,
			nextSyncAt: clock,
			createdAt: clock,
			updatedAt: clock,
		});
		await new DurableFeedScheduler(repository).tick(clock);
		let requests = 0;
		const fetchImpl: NonNullable<DurableFeedWorkerOptions['fetch']> = async () => {
			requests += 1;
			return new Response(
				'<rss version="2.0"><channel><title>Crash</title><item><guid>crash-one</guid><title>One</title></item></channel></rss>',
				{ headers: { 'content-type': 'application/rss+xml' } },
			);
		};
		const crashing = new DurableFeedWorker(repository, {
			workerId: 'crashing-worker',
			leaseSeconds: 1,
			originStartGapSeconds: 5,
			now: () => clock,
			fetch: fetchImpl,
			afterRawPersisted() {
				throw new Error('simulated process crash');
			},
		});
		await expect(crashing.drainOnce()).rejects.toThrow('simulated process crash');
		expect(requests).toBe(1);
		expect(await db.select().from(schema.feedFetchSnapshots)).toHaveLength(1);
		expect(await db.query.feedFetchJobs.findFirst()).toMatchObject({ status: 'running' });
		expect(
			await db.query.feedSources.findFirst({ where: (row, { eq }) => eq(row.id, source.id) }),
		).toMatchObject({ lastUnconditionalFetchAt: clock });

		clock = new Date(clock.getTime() + 2_000);
		const recovered = new DurableFeedWorker(repository, {
			workerId: 'recovery-worker',
			leaseSeconds: 30,
			originStartGapSeconds: 5,
			now: () => clock,
			fetch: fetchImpl,
		});
		expect(await recovered.drainOnce()).toBe(1);
		expect(requests).toBe(1);
		expect(await db.select().from(schema.feedSnapshotDeliveries)).toHaveLength(1);
		expect(await db.query.feedFetchJobs.findFirst()).toMatchObject({ status: 'completed' });
	});

	it('releases caller-aborted work without consuming attempts or counting a publisher failure', async () => {
		const { db, repository } = await setupDatabase();
		const now = new Date('2026-07-18T00:00:00Z');
		const origin = await repository.upsertOrigin({
			id: 'abort-origin',
			scheme: 'https',
			host: 'abort.example.com',
			port: 443,
		});
		const source = await repository.upsertSource({
			id: 'abort-source',
			normalizedUrl: 'https://abort.example.com/feed.xml',
			requestedUrl: 'https://abort.example.com/feed.xml',
			originId: origin.id,
			nextFetchAt: now,
		});
		await repository.enqueueJob({
			id: 'abort-job',
			sourceId: source.id,
			originId: origin.id,
			availableAt: now,
			createdAt: now,
			updatedAt: now,
		});
		const controller = new AbortController();
		const publisherOutcomes: string[] = [];
		let publisherRequests = 0;
		const worker = new DurableFeedWorker(repository, {
			workerId: 'abort-worker',
			originStartGapSeconds: 0,
			now: () => now,
			telemetry: {
				recordPublisherRequest: () => {
					publisherRequests += 1;
				},
				recordPublisherOutcome: (outcome) => publisherOutcomes.push(outcome),
			},
			fetch: async (_url, init) =>
				new Promise<Response>((_resolve, reject) => {
					const requestSignal = init.signal!;
					requestSignal.addEventListener('abort', () => reject(requestSignal.reason), {
						once: true,
					});
				}),
		});
		const draining = worker.drainOnce(controller.signal);
		setTimeout(() => controller.abort(new Error('deploy stop')), 5);
		expect(await draining).toBe(1);
		expect(publisherRequests).toBe(1);
		expect(publisherOutcomes).toEqual(['aborted']);
		expect(await db.query.feedFetchJobs.findFirst()).toMatchObject({
			status: 'queued',
			attempts: 0,
			leaseOwner: null,
			availableAt: new Date(now.getTime() + 15 * 60_000),
		});
		expect(
			await db.query.feedSources.findFirst({ where: (row, { eq }) => eq(row.id, source.id) }),
		).toMatchObject({ consecutiveFailureCount: 0 });
		expect(
			await db.query.feedOrigins.findFirst({ where: (row, { eq }) => eq(row.id, origin.id) }),
		).toMatchObject({ consecutiveFailureCount: 0 });
	});

	it('bounds stalled publisher requests and applies one transport failure without inline retry', async () => {
		const { db, repository } = await setupDatabase();
		const now = new Date('2026-07-18T00:00:00Z');
		const origin = await repository.upsertOrigin({
			id: 'timeout-origin',
			scheme: 'https',
			host: 'timeout.example.com',
			port: 443,
		});
		const source = await repository.upsertSource({
			id: 'timeout-source',
			normalizedUrl: 'https://timeout.example.com/feed.xml',
			requestedUrl: 'https://timeout.example.com/feed.xml',
			originId: origin.id,
			nextFetchAt: now,
		});
		await repository.enqueueJob({
			id: 'timeout-job',
			sourceId: source.id,
			originId: origin.id,
			availableAt: now,
			createdAt: now,
			updatedAt: now,
		});
		await db.insert(schema.feeds).values({
			id: 'timeout-feed',
			userId: 'user-1',
			categoryId: 'category-1',
			title: 'Timeout feed',
			feedUrl: source.normalizedUrl,
			sourceId: source.id,
			nextSyncAt: now,
			createdAt: now,
			updatedAt: now,
		});
		const refresh = await repository.createRefreshRequest(
			{
				id: 'timeout-refresh',
				userId: 'user-1',
				idempotencyKey: null,
				scopeType: 'manual',
				requestedAt: now,
				createdAt: now,
				updatedAt: now,
			},
			[{ feedId: 'timeout-feed', sourceId: source.id, jobId: 'timeout-job' }],
		);
		let requests = 0;
		const worker = new DurableFeedWorker(repository, {
			workerId: 'timeout-worker',
			originStartGapSeconds: 0,
			requestTimeoutMs: 10,
			now: () => now,
			fetch: async () => {
				requests += 1;
				// Reproduce a network implementation that ignores AbortSignal. The
				// worker deadline must still settle and release the rest of the queue.
				return new Promise<Response>(() => undefined);
			},
		});
		expect(await worker.drainOnce()).toBe(1);
		expect(requests).toBe(1);
		expect(await db.query.feedFetchJobs.findFirst()).toMatchObject({
			status: 'queued',
			attempts: 1,
		});
		expect(
			await db.query.feedSources.findFirst({ where: (row, { eq }) => eq(row.id, source.id) }),
		).toMatchObject({ consecutiveFailureCount: 1, lastErrorCode: 'network' });
		expect(
			await db.query.feedOrigins.findFirst({ where: (row, { eq }) => eq(row.id, origin.id) }),
		).toMatchObject({
			consecutiveFailureCount: 1,
			blockedUntil: new Date(now.getTime() + 15 * 60_000),
		});
		expect(await repository.aggregateRefreshRequest(refresh.id, now)).toMatchObject({
			status: 'completed_with_errors',
			pendingItems: 0,
			failedItems: 1,
		});
	});

	it('tracks changed and unchanged hashes without slowing the 15-minute cadence', async () => {
		const { db, repository } = await setupDatabase();
		let clock = new Date('2026-07-18T00:00:00Z');
		const origin = await repository.upsertOrigin({
			id: 'hash-origin',
			scheme: 'https',
			host: 'hash.example.com',
			port: 443,
		});
		const source = await repository.upsertSource({
			id: 'hash-source',
			normalizedUrl: 'https://hash.example.com/feed.xml',
			requestedUrl: 'https://hash.example.com/feed.xml',
			originId: origin.id,
			nextFetchAt: clock,
		});
		let title = 'Version one';
		const worker = new DurableFeedWorker(repository, {
			workerId: 'hash-worker',
			originStartGapSeconds: 0,
			now: () => clock,
			fetch: async () =>
				new Response(
					`<rss version="2.0"><channel><title>Hash</title><item><guid>one</guid><title>${title}</title></item></channel></rss>`,
					{ headers: { 'content-type': 'application/rss+xml' } },
				),
		});
		await new DurableFeedScheduler(repository).tick(clock);
		await worker.drainOnce();
		const first = await db.query.feedSources.findFirst({
			where: (row, { eq }) => eq(row.id, source.id),
		});
		expect(first).toMatchObject({
			consecutiveUnchangedCount: 0,
			lastChangeAt: clock,
			minIntervalSeconds: 900,
			nextFetchAt: new Date(clock.getTime() + 15 * 60_000),
		});

		clock = new Date(clock.getTime() + 15 * 60_000);
		await db
			.update(schema.feedSources)
			.set({ nextFetchAt: clock })
			.where(eq(schema.feedSources.id, source.id));
		await new DurableFeedScheduler(repository).tick(clock);
		await worker.drainOnce();
		const unchanged = await db.query.feedSources.findFirst({
			where: (row, { eq }) => eq(row.id, source.id),
		});
		expect(unchanged).toMatchObject({
			consecutiveUnchangedCount: 1,
			lastChangeAt: first!.lastChangeAt,
			normalizedPayloadHash: first!.normalizedPayloadHash,
			minIntervalSeconds: 900,
			nextFetchAt: new Date(clock.getTime() + 15 * 60_000),
		});

		title = 'Version two';
		clock = new Date(clock.getTime() + 15 * 60_000);
		await db
			.update(schema.feedSources)
			.set({ nextFetchAt: clock })
			.where(eq(schema.feedSources.id, source.id));
		await new DurableFeedScheduler(repository).tick(clock);
		await worker.drainOnce();
		const changed = await db.query.feedSources.findFirst({
			where: (row, { eq }) => eq(row.id, source.id),
		});
		expect(changed).toMatchObject({
			consecutiveUnchangedCount: 0,
			lastChangeAt: clock,
			minIntervalSeconds: 900,
			nextFetchAt: new Date(clock.getTime() + 15 * 60_000),
		});
		expect(changed?.normalizedPayloadHash).not.toBe(first?.normalizedPayloadHash);
	});

	it('reuses a retained parsed snapshot when a user resubscribes without refetching', async () => {
		const { db, repository } = await setupDatabase();
		const facade = new DurableFeedFacadeService(
			db,
			new FeedRepository(db),
			new CategoryRepository(db),
			repository,
		);
		const articleRepository = new ArticleRepository(db);
		let publisherRequests = 0;
		const first = await facade.createPendingFeed('user-1', {
			categoryId: 'category-1',
			feedUrl: 'https://reuse.example.com/feed.xml',
		});
		const now = new Date();
		const worker = new DurableFeedWorker(repository, {
			workerId: 'snapshot-reuse-fetch',
			originStartGapSeconds: 0,
			now: () => now,
			fetch: async () => {
				publisherRequests += 1;
				return new Response(
					'<rss version="2.0"><channel><title>Reusable source</title><item><guid>one</guid><title>Reusable article</title></item></channel></rss>',
					{ headers: { 'content-type': 'application/rss+xml' } },
				);
			},
		});
		expect(await worker.drainOnce()).toBe(1);
		const delivery = new FeedSnapshotDeliveryService(repository, articleRepository);
		expect(await delivery.drainOnce('snapshot-reuse-first', { now, limit: 10 })).toBe(1);
		expect(publisherRequests).toBe(1);
		await db.delete(schema.feeds).where(eq(schema.feeds.id, first.feed.id));
		expect(await db.select().from(schema.articles)).toHaveLength(0);

		const second = await facade.createPendingFeed('user-1', {
			categoryId: 'category-1',
			feedUrl: 'https://reuse.example.com/feed.xml',
		});
		expect(second.feed).toMatchObject({
			title: 'Reusable source',
			sourceId: first.feed.pendingSourceId,
			pendingSourceId: null,
			syncStatus: 'idle',
		});
		expect(second.jobId).toBe(first.jobId);
		expect(await db.select().from(schema.feedFetchJobs)).toHaveLength(1);
		expect(await worker.drainOnce()).toBe(0);
		expect(publisherRequests).toBe(1);

		const secondDelivery = await db.query.feedSnapshotDeliveries.findFirst({
			where: (row, { eq }) => eq(row.feedId, second.feed.id),
		});
		expect(secondDelivery).not.toBeNull();
		expect(
			await delivery.drainOnce('snapshot-reuse-second', {
				now: secondDelivery!.availableAt,
				limit: 10,
			}),
		).toBe(1);
		expect(
			await db.query.articles.findFirst({
				where: (article, { eq }) => eq(article.feedId, second.feed.id),
			}),
		).toMatchObject({ title: 'Reusable article' });
		expect(
			await db.query.feedRefreshRequests.findFirst({
				where: (request, { eq }) => eq(request.id, second.requestId),
			}),
		).toMatchObject({ status: 'completed', completedItems: 1, pendingItems: 0 });
		expect(publisherRequests).toBe(1);
	});

	it('keeps relayed snapshots and relative links based on the publisher URL', async () => {
		const { db, repository } = await setupDatabase();
		const now = new Date('2026-07-18T00:00:00Z');
		const relayToken = 'relay-token-with-more-than-thirty-two-characters';
		const publisherServer = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch: () => new Response('Publisher blocked this address', { status: 403 }),
		});
		servers.push(publisherServer);
		let relayAuthorization: string | null = null;
		let relayTarget: string | null = null;
		const relayServer = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch: (request) => {
				relayAuthorization = request.headers.get('authorization');
				relayTarget = request.headers.get('x-self-feed-target');
				return new Response(
					'<rss version="2.0"><channel><title>Relayed publisher</title><link>/home</link><item><guid>one</guid><title>One</title><link>/articles/one</link></item></channel></rss>',
					{
						headers: {
							'content-type': 'application/rss+xml',
							'x-self-feed-relay': 'generic',
						},
					},
				);
			},
		});
		servers.push(relayServer);
		const publisherPort = publisherServer.port;
		const relayPort = relayServer.port;
		if (!publisherPort || !relayPort) throw new Error('Relay test servers did not start');
		const publisherUrl = `http://127.0.0.1:${publisherPort}/feeds/main.xml`;
		const relayUrl = `http://127.0.0.1:${relayPort}/feed`;
		const origin = await repository.upsertOrigin({
			id: 'relay-origin',
			scheme: 'http',
			host: '127.0.0.1',
			port: publisherPort,
		});
		const source = await repository.upsertSource({
			id: 'relay-source',
			normalizedUrl: publisherUrl,
			requestedUrl: publisherUrl,
			originId: origin.id,
			nextFetchAt: now,
		});
		await repository.enqueueJob({
			id: 'relay-job',
			sourceId: source.id,
			originId: origin.id,
			availableAt: now,
			createdAt: now,
			updatedAt: now,
		});

		const worker = new DurableFeedWorker(repository, {
			workerId: 'relay-worker',
			originStartGapSeconds: 0,
			allowPrivateHosts: true,
			now: () => now,
			relay: { relayUrl, relayToken },
		});
		expect(await worker.drainOnce()).toBe(1);

		const snapshot = await db.query.feedFetchSnapshots.findFirst({
			where: (row, { eq }) => eq(row.sourceId, source.id),
		});
		expect(snapshot?.finalUrl).toBe(publisherUrl);
		expect(snapshot?.finalUrl).not.toBe(relayUrl);
		const normalized = JSON.parse(snapshot!.normalizedPayload!) as {
			source: { siteUrl: string | null };
			items: Array<{ canonicalUrl: string | null }>;
		};
		expect(normalized.source.siteUrl).toBe(`http://127.0.0.1:${publisherPort}/home`);
		expect(normalized.items[0]?.canonicalUrl).toBe(
			`http://127.0.0.1:${publisherPort}/articles/one`,
		);
		expect(
			await db.query.feedSources.findFirst({ where: (row, { eq }) => eq(row.id, source.id) }),
		).toMatchObject({ resolvedUrl: publisherUrl });
		expect(relayAuthorization).toBe(`Bearer ${relayToken}`);
		expect(relayTarget).toBe(publisherUrl);
	});

	it('pauses and opens the source circuit on a permanent parse threshold without penalizing origin', async () => {
		const { db, repository } = await setupDatabase();
		const now = new Date('2026-07-18T00:00:00Z');
		const origin = await repository.upsertOrigin({
			id: 'permanent-origin',
			scheme: 'https',
			host: 'permanent.example.com',
			port: 443,
		});
		const source = await repository.upsertSource({
			id: 'permanent-source',
			normalizedUrl: 'https://permanent.example.com/feed.xml',
			requestedUrl: 'https://permanent.example.com/feed.xml',
			originId: origin.id,
			consecutiveFailureCount: 2,
			nextFetchAt: now,
		});
		await repository.enqueueJob({
			id: 'permanent-job',
			sourceId: source.id,
			originId: origin.id,
			availableAt: now,
			createdAt: now,
			updatedAt: now,
		});
		const worker = new DurableFeedWorker(repository, {
			workerId: 'permanent-worker',
			originStartGapSeconds: 0,
			now: () => now,
			fetch: async () => new Response('not a feed', { status: 200 }),
		});
		expect(await worker.drainOnce()).toBe(1);
		expect(
			await db.query.feedSources.findFirst({ where: (row, { eq }) => eq(row.id, source.id) }),
		).toMatchObject({
			state: 'paused',
			circuitState: 'open',
			consecutiveFailureCount: 3,
			nextFetchAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000),
		});
		expect(
			await db.query.feedOrigins.findFirst({ where: (row, { eq }) => eq(row.id, origin.id) }),
		).toMatchObject({ consecutiveFailureCount: 0, circuitState: 'closed' });
		expect(await db.query.feedFetchJobs.findFirst()).toMatchObject({ status: 'completed' });
	});
});
