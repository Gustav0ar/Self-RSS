import { Database as BunDatabase } from 'bun:sqlite';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/bun-sqlite';
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

	sqlite.exec(`
		CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
			id SERIAL PRIMARY KEY,
			hash text NOT NULL,
			created_at numeric
		);
	`);
	sqlite
		.query('INSERT INTO "__drizzle_migrations" ("id", "hash", "created_at") VALUES (?, ?, ?)')
		.run(4, 'test-migration-0004', migration0004.when);
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
	writeFileSync(
		join(metaFolder, '_journal.json'),
		JSON.stringify({
			version: '7',
			dialect: 'sqlite',
			entries: [
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

describe('SQLite migrations', () => {
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
});
