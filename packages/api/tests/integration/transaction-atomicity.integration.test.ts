import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { ArticleRepository } from '../../src/repositories/article.repository.js';
import { replaceArticleEnrichedContent } from '../../src/repositories/article-enrichment.persistence.js';
import { CategoryRepository } from '../../src/repositories/category.repository.js';
import { FeedRepository } from '../../src/repositories/feed.repository.js';
import { UserRepository } from '../../src/repositories/user.repository.js';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
const tempDirs: string[] = [];
const databases: Database[] = [];

afterEach(() => {
	for (const database of databases.splice(0)) database.close(false);
	for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function setupDatabase() {
	const directory = await mkdtemp(join(tmpdir(), 'transaction-atomicity-'));
	tempDirs.push(directory);
	const sqlite = new Database(join(directory, 'rss.db'));
	databases.push(sqlite);
	sqlite.exec('PRAGMA foreign_keys = ON;');
	for (const filename of readdirSync(migrationsFolder)
		.filter((file) => file.endsWith('.sql'))
		.sort()) {
		const migration = readFileSync(join(migrationsFolder, filename), 'utf8');
		for (const statement of migration.split('--> statement-breakpoint')) {
			if (statement.trim()) sqlite.exec(statement.trim());
		}
	}
	return { sqlite, db: drizzle(sqlite, { schema }) };
}

function seedArticleGraph(sqlite: Database) {
	const now = 1_700_000_000;
	sqlite
		.query(
			`INSERT INTO users (id, email, password_hash, role, is_active, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.run('user-1', 'reader@example.com', 'hash', 'user', 1, now, now);
	sqlite
		.query(
			`INSERT INTO categories (id, user_id, name, slug, sort_order, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.run('category-1', 'user-1', 'News', 'news', 0, now, now);
	sqlite
		.query(
			`INSERT INTO feeds (id, user_id, category_id, title, feed_url, polling_interval_minutes,
			 next_sync_at, sync_status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			'feed-1',
			'user-1',
			'category-1',
			'News',
			'https://example.com/feed.xml',
			60,
			now,
			'idle',
			now,
			now,
		);
	sqlite
		.query(
			`INSERT INTO articles (id, feed_id, guid, title, content_html, fetched_at, hash)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.run('article-1', 'feed-1', 'guid-1', 'Article', '<p>Old</p>', now, 'old-hash');
	sqlite
		.query(
			`INSERT INTO article_media (id, article_id, type, provider, url, position)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		)
		.run('media-old', 'article-1', 'image', 'unknown', 'https://example.com/old.jpg', 0);
}

describe('Bun SQLite repository transaction atomicity', () => {
	it('orders and deduplicates offline article-state mutations', async () => {
		const { sqlite, db } = await setupDatabase();
		seedArticleGraph(sqlite);
		const repository = new ArticleRepository(db);
		const firstId = '550e8400-e29b-41d4-a716-446655440001';
		const secondId = '550e8400-e29b-41d4-a716-446655440002';

		const first = repository.setReadState('user-1', 'article-1', true, 'manual', {
			mutationId: firstId,
			baseRevision: 0,
		});
		const second = repository.setReadState('user-1', 'article-1', false, 'manual', {
			mutationId: secondId,
			baseRevision: 1,
		});
		const delayedRetry = repository.setReadState('user-1', 'article-1', true, 'manual', {
			mutationId: firstId,
			baseRevision: 0,
		});
		const stale = repository.setReadState('user-1', 'article-1', true, 'manual', {
			mutationId: '550e8400-e29b-41d4-a716-446655440003',
			baseRevision: 1,
		});
		const reusedWithDifferentPayload = repository.setReadState(
			'user-1',
			'article-1',
			false,
			'manual',
			{ mutationId: firstId, baseRevision: 2 },
		);

		expect(first).toMatchObject({ state: true, revision: 1, applied: true });
		expect(second).toMatchObject({ state: false, revision: 2, applied: true });
		expect(delayedRetry).toMatchObject({
			state: true,
			revision: 1,
			duplicate: true,
			applied: true,
		});
		expect(stale).toMatchObject({ state: false, revision: 2, conflict: true, applied: false });
		expect(reusedWithDifferentPayload).toMatchObject({
			state: false,
			revision: 2,
			conflict: true,
			duplicate: true,
		});
		expect(
			sqlite.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM article_reads').get()
				?.count,
		).toBe(0);
		sqlite.exec('UPDATE article_state_mutations SET created_at = 1');
		expect(repository.cleanupStateMutationHistory(new Date(), 2)).toBe(2);
		expect(
			sqlite
				.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM article_state_mutations')
				.get()?.count,
		).toBe(1);
	});

	it('rolls back article state when its idempotency ledger cannot commit', async () => {
		const { sqlite, db } = await setupDatabase();
		seedArticleGraph(sqlite);
		sqlite.exec(`
			CREATE TRIGGER reject_article_state_ledger
			BEFORE INSERT ON article_state_mutations
			BEGIN
				SELECT RAISE(ABORT, 'ledger rejected');
			END;
		`);
		const repository = new ArticleRepository(db);

		expect(() =>
			repository.setReadState('user-1', 'article-1', true, 'manual', {
				mutationId: '550e8400-e29b-41d4-a716-446655440004',
				baseRevision: 0,
			}),
		).toThrow('ledger rejected');
		expect(
			sqlite.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM article_reads').get()
				?.count,
		).toBe(0);
		expect(
			sqlite.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM article_user_states').get()
				?.count,
		).toBe(0);
	});
	it('rolls back the user insert when default preference creation fails', async () => {
		const { sqlite, db } = await setupDatabase();
		sqlite.exec(`
			CREATE TRIGGER reject_user_preferences
			BEFORE INSERT ON user_preferences
			BEGIN
				SELECT RAISE(ABORT, 'preference insert rejected');
			END;
		`);

		const repository = new UserRepository(db);
		await expect(
			repository.createWithPreferences({
				email: 'rollback@example.com',
				passwordHash: 'hash',
			}),
		).rejects.toThrow('preference insert rejected');

		expect(
			sqlite.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM users').get()?.count,
		).toBe(0);
	});

	it('rolls back public registration when default preference creation fails', async () => {
		const { sqlite, db } = await setupDatabase();
		sqlite.exec(`
			CREATE TRIGGER reject_registered_user_preferences
			BEFORE INSERT ON user_preferences
			BEGIN
				SELECT RAISE(ABORT, 'registered preference rejected');
			END;
		`);

		const repository = new UserRepository(db);
		await expect(
			repository.registerUser({
				email: 'register-rollback@example.com',
				passwordHash: 'hash',
				registrationLocked: false,
			}),
		).rejects.toThrow('registered preference rejected');

		expect(
			sqlite.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM users').get()?.count,
		).toBe(0);
	});

	it('rolls back earlier categories when a later hierarchical insert fails', async () => {
		const { sqlite, db } = await setupDatabase();
		seedArticleGraph(sqlite);
		sqlite.exec(`
			CREATE TRIGGER reject_second_category
			BEFORE INSERT ON categories
			WHEN NEW.name = 'Reject me'
			BEGIN
				SELECT RAISE(ABORT, 'category rejected');
			END;
		`);

		const repository = new CategoryRepository(db);
		await expect(
			repository.createManyInTransaction([
				{ userId: 'user-1', name: 'First', slug: 'first' },
				{
					userId: 'user-1',
					name: 'Reject me',
					slug: 'reject-me',
					parentCategoryId: '__pending__:0',
				},
			]),
		).rejects.toThrow('category rejected');

		const names = sqlite
			.query<{ name: string }, []>("SELECT name FROM categories WHERE id != 'category-1'")
			.all();
		expect(names).toEqual([]);
	});

	it('atomically rejects a bulk feed insert and returns successful inserted rows', async () => {
		const { sqlite, db } = await setupDatabase();
		seedArticleGraph(sqlite);
		const repository = new FeedRepository(db);
		const inserted = await repository.createMany([
			{
				userId: 'user-1',
				categoryId: 'category-1',
				title: 'First import',
				feedUrl: 'https://example.com/first.xml',
			},
		]);
		expect(inserted).toHaveLength(1);
		expect(inserted[0]?.nextSyncAt).toBeInstanceOf(Date);

		sqlite.exec(`
			CREATE TRIGGER reject_bulk_feed
			BEFORE INSERT ON feeds
			WHEN NEW.title = 'Reject me'
			BEGIN
				SELECT RAISE(ABORT, 'feed rejected');
			END;
		`);
		await expect(
			repository.createMany([
				{
					userId: 'user-1',
					categoryId: 'category-1',
					title: 'Would otherwise persist',
					feedUrl: 'https://example.com/would-persist.xml',
				},
				{
					userId: 'user-1',
					categoryId: 'category-1',
					title: 'Reject me',
					feedUrl: 'https://example.com/reject.xml',
				},
			]),
		).rejects.toThrow('feed rejected');

		expect(
			sqlite
				.query<{ count: number }, []>(
					"SELECT COUNT(*) AS count FROM feeds WHERE title = 'Would otherwise persist'",
				)
				.get()?.count,
		).toBe(0);
	});

	it('restores existing media when replacement insertion fails', async () => {
		const { sqlite, db } = await setupDatabase();
		seedArticleGraph(sqlite);
		sqlite.exec(`
			CREATE TRIGGER reject_replacement_media
			BEFORE INSERT ON article_media
			WHEN NEW.url = 'https://example.com/fail.jpg'
			BEGIN
				SELECT RAISE(ABORT, 'replacement media rejected');
			END;
		`);

		const repository = new ArticleRepository(db, sqlite);
		await expect(
			repository.replaceMedia('article-1', [
				{
					articleId: 'article-1',
					type: 'image',
					provider: 'unknown',
					url: 'https://example.com/fail.jpg',
					position: 0,
				},
			]),
		).rejects.toThrow('replacement media rejected');

		const media = sqlite
			.query<{ url: string }, [string]>('SELECT url FROM article_media WHERE article_id = ?')
			.get('article-1');
		expect(media?.url).toBe('https://example.com/old.jpg');
	});

	it('rolls back synchronized article content and media replacement as one batch', async () => {
		const { sqlite, db } = await setupDatabase();
		seedArticleGraph(sqlite);
		sqlite.exec(`
			CREATE TRIGGER reject_sync_media
			BEFORE INSERT ON article_media
			WHEN NEW.url = 'https://example.com/sync-fail.jpg'
			BEGIN
				SELECT RAISE(ABORT, 'sync media rejected');
			END;
		`);

		const repository = new ArticleRepository(db, sqlite);
		await expect(
			repository.persistSyncResults({
				articlesToInsert: [],
				articlesToUpdate: [
					{
						id: 'article-1',
						contentHtml: '<p>New</p>',
						contentText: 'New',
						excerpt: 'New',
						heroImageUrl: 'https://example.com/sync-fail.jpg',
						hash: 'new-hash',
					},
				],
				mediaByGuid: new Map(),
				updatedMediaByArticleId: new Map([
					[
						'article-1',
						[
							{
								articleId: 'article-1',
								type: 'image',
								provider: 'unknown',
								url: 'https://example.com/sync-fail.jpg',
								position: 0,
							},
						],
					],
				]),
			}),
		).rejects.toThrow('sync media rejected');

		const article = sqlite
			.query<{ contentHtml: string; hash: string }, [string]>(
				'SELECT content_html AS contentHtml, hash FROM articles WHERE id = ?',
			)
			.get('article-1');
		expect(article).toEqual({ contentHtml: '<p>Old</p>', hash: 'old-hash' });
		expect(
			sqlite
				.query<{ url: string }, [string]>('SELECT url FROM article_media WHERE article_id = ?')
				.get('article-1')?.url,
		).toBe('https://example.com/old.jpg');
	});

	it('rolls back enriched article fields when enriched media insertion fails', async () => {
		const { sqlite, db } = await setupDatabase();
		seedArticleGraph(sqlite);
		sqlite.exec(`
			CREATE TRIGGER reject_enriched_media
			BEFORE INSERT ON article_media
			WHEN NEW.url = 'https://example.com/enriched-fail.jpg'
			BEGIN
				SELECT RAISE(ABORT, 'enriched media rejected');
			END;
		`);

		expect(() =>
			replaceArticleEnrichedContent(db, 'article-1', {
				contentHtml: '<p>Enriched</p>',
				contentText: 'Enriched',
				excerpt: 'Enriched',
				heroImageUrl: 'https://example.com/enriched-fail.jpg',
				hash: 'enriched-hash',
				enrichedAt: new Date(),
				media: [
					{
						articleId: 'article-1',
						type: 'image',
						provider: 'unknown',
						url: 'https://example.com/enriched-fail.jpg',
						position: 0,
					},
				],
			}),
		).toThrow('enriched media rejected');

		const article = sqlite
			.query<{ contentHtml: string; hash: string; contentVersion: number }, [string]>(
				`SELECT content_html AS contentHtml, hash, content_version AS contentVersion
				 FROM articles WHERE id = ?`,
			)
			.get('article-1');
		expect(article).toEqual({ contentHtml: '<p>Old</p>', hash: 'old-hash', contentVersion: 1 });
		expect(
			sqlite
				.query<{ url: string }, [string]>('SELECT url FROM article_media WHERE article_id = ?')
				.get('article-1')?.url,
		).toBe('https://example.com/old.jpg');
	});
});
