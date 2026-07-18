import { Database as BunDatabase } from 'bun:sqlite';
import { rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../../src/db/migrations.js';
import * as schema from '../../src/db/schema.js';
import { FeedIngestionRepository } from '../../src/repositories/feed-ingestion.repository.js';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
const tempDirs: string[] = [];
const databases: BunDatabase[] = [];

afterEach(() => {
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

describe('durable feed ingestion persistence', () => {
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
});
