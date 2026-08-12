import { Database as BunDatabase } from 'bun:sqlite';
import {
	copyFileSync,
	cpSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../../src/db/migrations.js';
import * as schema from '../../src/db/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, '../../drizzle');
const migrationsBeforeCategoryRebuild = [
	'0000_large_silver_fox.sql',
	'0001_articles_fts.sql',
	'0002_default_auto_mark_on_navigate.sql',
	'0003_dazzling_firedrake.sql',
	'0004_user_accent_color.sql',
];

let tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tempDirs = [];
});

function applySqlFile(sqlite: BunDatabase, filename: string) {
	const contents = readFileSync(join(migrationsFolder, filename), 'utf8');
	for (const statement of contents.split('--> statement-breakpoint')) {
		const trimmed = statement.trim();
		if (trimmed) {
			sqlite.exec(trimmed);
		}
	}
}

function markMigratedThrough0004(sqlite: BunDatabase) {
	const journal = JSON.parse(
		readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
	) as {
		entries: { idx: number; when: number }[];
	};
	const migration0004 = journal.entries.find((entry) => entry.idx === 4);
	if (!migration0004) {
		throw new Error('Could not find migration 0004 journal entry');
	}
	const migrationMeta = readMigrationFiles({ migrationsFolder }).find(
		(migration) => migration.folderMillis === migration0004.when,
	);
	if (!migrationMeta) {
		throw new Error('Could not read migration 0004 metadata');
	}

	sqlite.exec(`
		CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
			id SERIAL PRIMARY KEY,
			hash text NOT NULL,
			created_at numeric
		);
	`);
	sqlite
		.query('INSERT INTO "__drizzle_migrations" ("id", "hash", "created_at") VALUES (?, ?, ?)')
		.run(4, migrationMeta.hash, migration0004.when);
	return migration0004.when;
}

function countRows(sqlite: BunDatabase, table: string) {
	return (sqlite.query(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function seedDatabaseBeforeCategoryRebuild(sqlite: BunDatabase) {
	for (const filename of migrationsBeforeCategoryRebuild) {
		applySqlFile(sqlite, filename);
	}
	const migratedThrough = markMigratedThrough0004(sqlite);

	const now = 1_700_000_000;
	sqlite
		.query(
			`INSERT INTO users
				(id, email, password_hash, role, is_active, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.run('user-1', 'reader@example.com', 'hash', 'user', 1, now, now);
	sqlite
		.query(
			`INSERT INTO categories
				(id, user_id, parent_category_id, name, slug, sort_order, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run('cat-1', 'user-1', null, 'Technology', 'technology', 0, now, now);
	sqlite
		.query(
			`INSERT INTO feeds
				(id, user_id, category_id, title, site_url, feed_url, favicon_url, description,
				 polling_interval_minutes, last_synced_at, next_sync_at, sync_status, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			'feed-1',
			'user-1',
			'cat-1',
			'Example Feed',
			'https://example.com',
			'https://example.com/feed.xml',
			null,
			null,
			60,
			now,
			now,
			'idle',
			now,
			now,
		);
	sqlite
		.query(
			`INSERT INTO articles
				(id, feed_id, guid, canonical_url, title, author, excerpt, content_html, content_text,
				 hero_image_url, published_at, fetched_at, hash)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			'article-1',
			'feed-1',
			'guid-1',
			'https://example.com/article',
			'Example Article',
			null,
			'Excerpt',
			'<p>Body</p>',
			'Body',
			null,
			now,
			now,
			'hash-1',
		);

	return migratedThrough;
}

function createDangerousMigrationFolder(baseDir: string, migratedThrough: number) {
	const folder = join(baseDir, 'dangerous-drizzle');
	const metaFolder = join(folder, 'meta');
	mkdirSync(metaFolder, { recursive: true });
	const sourceJournal = JSON.parse(
		readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
	) as {
		version: string;
		dialect: string;
		entries: {
			idx: number;
			version: string;
			when: number;
			tag: string;
			breakpoints: boolean;
		}[];
	};
	const priorEntries = sourceJournal.entries.filter((entry) => entry.when <= migratedThrough);
	for (const entry of priorEntries) {
		copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
	}
	writeFileSync(
		join(metaFolder, '_journal.json'),
		JSON.stringify({
			version: sourceJournal.version,
			dialect: sourceJournal.dialect,
			entries: [
				...priorEntries,
				{
					idx: 5,
					version: '6',
					when: migratedThrough + 1,
					tag: '0005_delete_feeds',
					breakpoints: true,
				},
			],
		}),
	);
	writeFileSync(join(folder, '0005_delete_feeds.sql'), 'DELETE FROM `feeds`;');
	return folder;
}

function copyMigrationFolder(baseDir: string) {
	const folder = join(baseDir, 'copied-drizzle');
	cpSync(migrationsFolder, folder, { recursive: true });
	return folder;
}

function copyMigrationsBeforeDurableIngestion(baseDir: string) {
	const folder = join(baseDir, 'pre-durable-drizzle');
	cpSync(migrationsFolder, folder, { recursive: true });
	const journalPath = join(folder, 'meta/_journal.json');
	const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
		version: string;
		dialect: string;
		entries: { tag: string }[];
	};
	journal.entries = journal.entries.filter(
		(entry) =>
			entry.tag !== '0017_smiling_naoko' &&
			entry.tag !== '0018_nifty_dragon_man' &&
			entry.tag !== '0019_tidy_wong' &&
			entry.tag !== '0020_fixed_feed_refresh_interval' &&
			entry.tag !== '0021_saved_articles' &&
			entry.tag !== '0022_product_analytics',
	);
	writeFileSync(journalPath, JSON.stringify(journal));
	return folder;
}

function copyMigrationsBeforeAuthSessionExpiry(baseDir: string) {
	const folder = join(baseDir, 'pre-auth-session-expiry-drizzle');
	cpSync(migrationsFolder, folder, { recursive: true });
	const journalPath = join(folder, 'meta/_journal.json');
	const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
		version: string;
		dialect: string;
		entries: { tag: string }[];
	};
	journal.entries = journal.entries.filter(
		(entry) =>
			entry.tag !== '0019_tidy_wong' &&
			entry.tag !== '0020_fixed_feed_refresh_interval' &&
			entry.tag !== '0021_saved_articles' &&
			entry.tag !== '0022_product_analytics',
	);
	writeFileSync(journalPath, JSON.stringify(journal));
	return folder;
}

function copyMigrationsBeforeFixedFeedRefresh(baseDir: string) {
	const folder = join(baseDir, 'pre-fixed-feed-refresh-drizzle');
	cpSync(migrationsFolder, folder, { recursive: true });
	const journalPath = join(folder, 'meta/_journal.json');
	const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
		version: string;
		dialect: string;
		entries: { tag: string }[];
	};
	journal.entries = journal.entries.filter(
		(entry) =>
			entry.tag !== '0020_fixed_feed_refresh_interval' &&
			entry.tag !== '0021_saved_articles' &&
			entry.tag !== '0022_product_analytics',
	);
	writeFileSync(journalPath, JSON.stringify(journal));
	return folder;
}

describe('SQLite migrations', () => {
	it('backfills auth session expiry on an existing database', async () => {
		const tempDir = await mkdtemp(join(tmpdir(), 'self-feed-auth-session-migration-'));
		tempDirs.push(tempDir);
		const sqlite = new BunDatabase(join(tempDir, 'rss.db'));
		sqlite.exec('PRAGMA foreign_keys = ON;');

		try {
			const db = drizzle(sqlite, { schema });
			applyMigrations(db, {
				migrationsFolder: copyMigrationsBeforeAuthSessionExpiry(tempDir),
			});
			const createdAt = 1_700_000_000;
			sqlite
				.query(
					`INSERT INTO users
					 (id, email, password_hash, role, is_active, created_at, updated_at)
					 VALUES ('user-1', 'reader@example.com', 'hash', 'user', 1, ?, ?)`,
				)
				.run(createdAt, createdAt);
			sqlite
				.query(
					`INSERT INTO auth_sessions
					 (id, user_id, refresh_token_hash, created_at, last_seen_at, rotated_at)
					 VALUES ('session-1', 'user-1', 'refresh-hash', ?, ?, ?)`,
				)
				.run(createdAt, createdAt, createdAt);

			expect(() => applyMigrations(db, { migrationsFolder })).not.toThrow();
			expect(
				sqlite
					.query<{ expires_at: number }, [string]>(
						'SELECT expires_at FROM auth_sessions WHERE id = ?',
					)
					.get('session-1'),
			).toEqual({ expires_at: createdAt + 34_560_000 });
			expect(
				sqlite
					.query(
						`SELECT name FROM sqlite_master
						 WHERE type = 'index' AND name = 'auth_sessions_expires_at_idx'`,
					)
					.get(),
			).toEqual({ name: 'auth_sessions_expires_at_idx' });
		} finally {
			sqlite.close();
		}
	});

	it('backfills shared source identity without changing subscriptions, articles, or reads', async () => {
		const tempDir = await mkdtemp(join(tmpdir(), 'self-feed-durable-migration-'));
		tempDirs.push(tempDir);
		const sqlite = new BunDatabase(join(tempDir, 'rss.db'));
		sqlite.exec('PRAGMA foreign_keys = ON;');

		try {
			const db = drizzle(sqlite, { schema });
			applyMigrations(db, {
				migrationsFolder: copyMigrationsBeforeDurableIngestion(tempDir),
			});
			const now = 1_700_000_000;
			for (const [id, email] of [
				['user-1', 'migration-reader-1@example.com'],
				['user-2', 'migration-reader-2@example.com'],
			] as const) {
				sqlite
					.query(
						`INSERT INTO users
						 (id, email, password_hash, role, is_active, created_at, updated_at)
						 VALUES (?, ?, 'hash', 'user', 1, ?, ?)`,
					)
					.run(id, email, now, now);
				sqlite
					.query(
						`INSERT INTO categories
						 (id, user_id, name, slug, sort_order, created_at, updated_at)
						 VALUES (?, ?, 'News', 'news', 0, ?, ?)`,
					)
					.run(`category-${id}`, id, now, now);
			}
			const legacyUrl = '  HTTPS://Example.COM/feed.xml  ';
			sqlite
				.query(
					`INSERT INTO feeds
					 (id, user_id, category_id, title, feed_url, polling_interval_minutes,
					  last_synced_at, next_sync_at, sync_status, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?)`,
				)
				.run(
					'feed-user-1',
					'user-1',
					'category-user-1',
					'Reader one title',
					legacyUrl,
					5,
					now - 60,
					now,
					now,
					now,
				);
			sqlite
				.query(
					`INSERT INTO feeds
					 (id, user_id, category_id, title, feed_url, polling_interval_minutes,
					  last_sync_error, last_sync_error_at, next_sync_at, sync_status, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'error', ?, ?)`,
				)
				.run(
					'feed-user-2',
					'user-2',
					'category-user-2',
					'Reader two title',
					legacyUrl.trim(),
					10,
					'Legacy publisher failure',
					now - 30,
					now,
					now,
					now,
				);
			sqlite
				.query(
					`INSERT INTO articles
					 (id, feed_id, guid, title, fetched_at, hash)
					 VALUES ('article-legacy', 'feed-user-1', 'guid-legacy', 'Preserved', ?, 'hash')`,
				)
				.run(now);
			sqlite
				.query(
					`INSERT INTO article_reads (user_id, article_id, read_at, source)
					 VALUES ('user-1', 'article-legacy', ?, 'manual')`,
				)
				.run(now);

			applyMigrations(db, { migrationsFolder });
			applyMigrations(db, { migrationsFolder });

			expect(countRows(sqlite, 'feeds')).toBe(2);
			expect(countRows(sqlite, 'feed_sources')).toBe(1);
			expect(countRows(sqlite, 'feed_origins')).toBe(1);
			expect(sqlite.query('SELECT scheme, host, port FROM feed_origins').get()).toEqual({
				scheme: 'https',
				host: 'example.com',
				port: 443,
			});
			expect(countRows(sqlite, 'articles')).toBe(1);
			expect(countRows(sqlite, 'article_reads')).toBe(1);
			const feedRows = sqlite
				.query<{ id: string; source_id: string; custom_title: string }, []>(
					'SELECT id, source_id, custom_title FROM feeds ORDER BY id',
				)
				.all();
			expect(feedRows).toEqual([
				{
					id: 'feed-user-1',
					source_id: 'source:feed-user-1',
					custom_title: 'Reader one title',
				},
				{
					id: 'feed-user-2',
					source_id: 'source:feed-user-1',
					custom_title: 'Reader two title',
				},
			]);
			expect(
				sqlite
					.query(
						`SELECT normalized_url, min_interval_seconds, consecutive_failure_count,
						 last_unconditional_fetch_at,
						 last_error_code, last_error_details
						 FROM feed_sources`,
					)
					.get(),
			).toMatchObject({
				normalized_url: legacyUrl.trim(),
				min_interval_seconds: 900,
				consecutive_failure_count: 1,
				last_unconditional_fetch_at: null,
				last_error_code: 'legacy_sync_error',
				last_error_details: 'Legacy publisher failure',
			});
			expect(sqlite.query('PRAGMA foreign_key_check').all()).toEqual([]);

			sqlite.query('DELETE FROM feed_sources WHERE id = ?').run('source:feed-user-1');
			expect(countRows(sqlite, 'feeds')).toBe(2);
			expect(countRows(sqlite, 'articles')).toBe(1);
			expect(
				sqlite
					.query<{ count: number }, []>(
						'SELECT count(*) AS count FROM feeds WHERE source_id IS NULL',
					)
					.get()?.count,
			).toBe(2);
		} finally {
			sqlite.close();
		}
	});

	it('resets healthy sources to a fixed 15-minute refresh interval', async () => {
		const tempDir = await mkdtemp(join(tmpdir(), 'self-feed-fixed-refresh-migration-'));
		tempDirs.push(tempDir);
		const sqlite = new BunDatabase(join(tempDir, 'rss.db'));
		sqlite.exec('PRAGMA foreign_keys = ON;');

		try {
			const db = drizzle(sqlite, { schema });
			applyMigrations(db, {
				migrationsFolder: copyMigrationsBeforeFixedFeedRefresh(tempDir),
			});
			const now = Math.floor(Date.now() / 1_000);
			sqlite
				.query(
					`INSERT INTO feed_origins
					 (id, scheme, host, port, created_at, updated_at)
					 VALUES ('origin-fixed', 'https', 'fixed.example.com', 443, ?, ?)`,
				)
				.run(now, now);
			sqlite
				.query(
					`INSERT INTO feed_sources
					 (id, normalized_url, requested_url, origin_id, next_fetch_at,
					  min_interval_seconds, state, created_at, updated_at)
					 VALUES ('source-fixed', 'https://fixed.example.com/feed.xml',
					  'https://fixed.example.com/feed.xml', 'origin-fixed', ?, 86400, 'active', ?, ?)`,
				)
				.run(now + 86_400, now, now);

			applyMigrations(db, { migrationsFolder });

			const migrated = sqlite
				.query<{ min_interval_seconds: number; next_fetch_at: number }, []>(
					`SELECT min_interval_seconds, next_fetch_at
					 FROM feed_sources WHERE id = 'source-fixed'`,
				)
				.get();
			expect(migrated?.min_interval_seconds).toBe(900);
			expect(migrated?.next_fetch_at).toBeGreaterThanOrEqual(now);
			expect(migrated?.next_fetch_at).toBeLessThanOrEqual(now + 901);
		} finally {
			sqlite.close();
		}
	});

	it('preserves feeds and articles when applying the category self-reference migration', async () => {
		const tempDir = await mkdtemp(join(tmpdir(), 'self-feed-migration-'));
		tempDirs.push(tempDir);
		const sqlite = new BunDatabase(join(tempDir, 'rss.db'));
		sqlite.exec('PRAGMA foreign_keys = ON;');

		try {
			seedDatabaseBeforeCategoryRebuild(sqlite);

			expect(countRows(sqlite, 'categories')).toBe(1);
			expect(countRows(sqlite, 'feeds')).toBe(1);
			expect(countRows(sqlite, 'articles')).toBe(1);

			const db = drizzle(sqlite, { schema });
			applyMigrations(db, { migrationsFolder });

			expect(countRows(sqlite, 'categories')).toBe(1);
			expect(countRows(sqlite, 'feeds')).toBe(1);
			expect(countRows(sqlite, 'articles')).toBe(1);
			expect(sqlite.query('PRAGMA foreign_key_check').all()).toEqual([]);
			expect(
				sqlite
					.query(
						`SELECT name FROM sqlite_master
						 WHERE type = 'index' AND name = 'articles_fetched_at_idx'`,
					)
					.get(),
			).toMatchObject({ name: 'articles_fetched_at_idx' });
			expect(
				sqlite
					.query('PRAGMA foreign_key_list(categories)')
					.all()
					.some(
						(fk) =>
							(fk as { table: string; on_delete: string }).table === 'categories' &&
							(fk as { table: string; on_delete: string }).on_delete.toLowerCase() === 'restrict',
					),
			).toBe(true);
		} finally {
			sqlite.close();
		}
	});

	it('rolls back pending migrations that would remove protected data', async () => {
		const tempDir = await mkdtemp(join(tmpdir(), 'self-feed-migration-'));
		tempDirs.push(tempDir);
		const sqlite = new BunDatabase(join(tempDir, 'rss.db'));
		sqlite.exec('PRAGMA foreign_keys = ON;');

		try {
			const migratedThrough = seedDatabaseBeforeCategoryRebuild(sqlite);
			const dangerousMigrationsFolder = createDangerousMigrationFolder(tempDir, migratedThrough);
			const db = drizzle(sqlite, { schema });

			expect(() => applyMigrations(db, { migrationsFolder: dangerousMigrationsFolder })).toThrow(
				/protected tables/,
			);

			expect(countRows(sqlite, 'categories')).toBe(1);
			expect(countRows(sqlite, 'feeds')).toBe(1);
			expect(countRows(sqlite, 'articles')).toBe(1);
			expect(sqlite.query('PRAGMA foreign_key_check').all()).toEqual([]);
			expect(readdirSync(join(tempDir, 'backups')).some((file) => file.endsWith('.db'))).toBe(true);
		} finally {
			sqlite.close();
		}
	});

	it('baselines legacy ledger hash mismatches and rejects later ledger changes', async () => {
		const tempDir = await mkdtemp(join(tmpdir(), 'self-feed-migration-'));
		tempDirs.push(tempDir);
		const sqlite = new BunDatabase(join(tempDir, 'rss.db'));
		sqlite.exec('PRAGMA foreign_keys = ON;');

		try {
			const migratedThrough = seedDatabaseBeforeCategoryRebuild(sqlite);
			sqlite
				.query('UPDATE "__drizzle_migrations" SET "hash" = ? WHERE "id" = ?')
				.run('legacy-migration-hash', 4);
			const db = drizzle(sqlite, { schema });

			expect(() => applyMigrations(db, { migrationsFolder })).not.toThrow();
			expect(
				sqlite
					.query(
						`SELECT local_hash, ledger_hash
						 FROM "__self_feed_migration_guard"
						 WHERE created_at = ?`,
					)
					.get(migratedThrough),
			).toMatchObject({
				ledger_hash: 'legacy-migration-hash',
			});

			sqlite
				.query('UPDATE "__drizzle_migrations" SET "hash" = ? WHERE "id" = ?')
				.run('tampered-migration-hash', 4);

			expect(() => applyMigrations(db, { migrationsFolder })).toThrow(/ledger hash changed/);
			expect(countRows(sqlite, 'categories')).toBe(1);
			expect(countRows(sqlite, 'feeds')).toBe(1);
			expect(countRows(sqlite, 'articles')).toBe(1);
		} finally {
			sqlite.close();
		}
	});

	it('rejects local migration file changes after the guard baseline exists', async () => {
		const tempDir = await mkdtemp(join(tmpdir(), 'self-feed-migration-'));
		tempDirs.push(tempDir);
		const sqlite = new BunDatabase(join(tempDir, 'rss.db'));
		sqlite.exec('PRAGMA foreign_keys = ON;');

		try {
			seedDatabaseBeforeCategoryRebuild(sqlite);
			const db = drizzle(sqlite, { schema });

			applyMigrations(db, { migrationsFolder });

			const copiedMigrations = copyMigrationFolder(tempDir);
			const migrationPath = join(copiedMigrations, '0004_user_accent_color.sql');
			writeFileSync(
				migrationPath,
				`${readFileSync(migrationPath, 'utf8')}\n-- accidental edit after production baseline\n`,
			);

			expect(() => applyMigrations(db, { migrationsFolder: copiedMigrations })).toThrow(
				/local migration hash changed/i,
			);
		} finally {
			sqlite.close();
		}
	});
});
