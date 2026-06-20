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
import { encodeArticleCursor } from '../../src/utils/article-cursor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, '../../drizzle');

const tempDirs: string[] = [];
const openDatabases: Database[] = [];

afterEach(() => {
	for (const sqlite of openDatabases.splice(0)) {
		sqlite.close(false);
	}
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function applySqlFile(sqlite: Database, filename: string) {
	const contents = readFileSync(join(migrationsFolder, filename), 'utf8');
	for (const statement of contents.split('--> statement-breakpoint')) {
		const trimmed = statement.trim();
		if (trimmed) {
			sqlite.exec(trimmed);
		}
	}
}

function applyAllMigrations(sqlite: Database) {
	const files = readdirSync(migrationsFolder)
		.filter((filename) => filename.endsWith('.sql'))
		.sort();
	for (const filename of files) {
		applySqlFile(sqlite, filename);
	}
}

async function setupTestDatabase() {
	const tempDir = await mkdtemp(join(tmpdir(), 'fts-test-'));
	tempDirs.push(tempDir);

	const sqlite = new Database(join(tempDir, 'rss.db'));
	openDatabases.push(sqlite);
	sqlite.exec('PRAGMA foreign_keys = ON;');
	applyAllMigrations(sqlite);

	const now = 1_700_000_000;
	sqlite
		.query(
			`INSERT INTO users (id, email, password_hash, role, is_active, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.run('user-1', 'test@example.com', 'hash', 'user', 1, now, now);

	sqlite
		.query(
			`INSERT INTO categories (id, user_id, parent_category_id, name, slug, sort_order, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run('cat-root', 'user-1', null, 'Root', 'root', 0, now, now);

	sqlite
		.query(
			`INSERT INTO feeds (id, user_id, category_id, title, site_url, feed_url, favicon_url, description,
			 polling_interval_minutes, last_synced_at, next_sync_at, sync_status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			'feed-1',
			'user-1',
			'cat-root',
			'Test Feed',
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

	const db = drizzle(sqlite, { schema });
	return { sqlite, repo: new ArticleRepository(db, sqlite), now };
}

function insertArticle(
	sqlite: Database,
	data: {
		id: string;
		feedId?: string;
		title: string;
		contentText: string;
		publishedAt: number;
	},
) {
	sqlite
		.query(
			`INSERT INTO articles (id, feed_id, guid, canonical_url, title, author, excerpt, content_html, content_text,
			 hero_image_url, published_at, fetched_at, hash)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			data.id,
			data.feedId ?? 'feed-1',
			`guid-${data.id}`,
			`https://example.com/${data.id}`,
			data.title,
			null,
			'Excerpt',
			`<p>${data.contentText}</p>`,
			data.contentText,
			null,
			data.publishedAt,
			data.publishedAt,
			`hash-${data.id}`,
		);
}

describe('ArticleRepository FTS search ranking', () => {
	it('orders by bm25 relevance before recency', async () => {
		const { sqlite, repo, now } = await setupTestDatabase();

		insertArticle(sqlite, {
			id: 'a0000000-0000-0000-0000-000000000001',
			title: 'JavaScript JavaScript JavaScript',
			contentText: 'javascript programming javascript examples javascript',
			publishedAt: now - 86_400,
		});
		insertArticle(sqlite, {
			id: 'a0000000-0000-0000-0000-000000000002',
			title: 'JavaScript',
			contentText: 'short note',
			publishedAt: now,
		});

		const results = await repo.search('user-1', 'javascript', ['feed-1'], 10);

		expect(results.map((result) => result.id)).toEqual([
			'a0000000-0000-0000-0000-000000000001',
			'a0000000-0000-0000-0000-000000000002',
		]);
		expect(results[0]?.ftsRank).toBeLessThanOrEqual(results[1]?.ftsRank ?? 0);
		expect(results[0]?.fetchedAt).toBeInstanceOf(Date);
	});

	it('uses timestamp and id as deterministic tie-breakers for equal ranks', async () => {
		const { sqlite, repo, now } = await setupTestDatabase();
		const articleIds = [
			'b0000000-0000-0000-0000-000000000001',
			'b0000000-0000-0000-0000-000000000002',
			'b0000000-0000-0000-0000-000000000003',
		];

		for (let i = 0; i < articleIds.length; i += 1) {
			insertArticle(sqlite, {
				id: articleIds[i]!,
				title: 'Python Tutorial',
				contentText: 'Python basics',
				publishedAt: now + i * 100,
			});
		}

		const results = await repo.search('user-1', 'python', ['feed-1'], 10);

		expect(results.map((result) => result.id)).toEqual([
			'b0000000-0000-0000-0000-000000000003',
			'b0000000-0000-0000-0000-000000000002',
			'b0000000-0000-0000-0000-000000000001',
		]);
	});

	it('returns limit plus one row for hasMore detection', async () => {
		const { sqlite, repo, now } = await setupTestDatabase();

		for (let i = 0; i < 5; i += 1) {
			insertArticle(sqlite, {
				id: `c0000000-0000-0000-0000-00000000000${i}`,
				title: 'SQLite Database Guide',
				contentText: 'SQLite content',
				publishedAt: now + i,
			});
		}

		const results = await repo.search('user-1', 'sqlite', ['feed-1'], 2);

		expect(results).toHaveLength(3);
	});
});

describe('ArticleRepository FTS search pagination', () => {
	it('returns stable pagination without duplicate rows', async () => {
		const { sqlite, repo, now } = await setupTestDatabase();
		const articles = [
			{
				id: 'd0000000-0000-0000-0000-000000000001',
				title: 'JavaScript Advanced Patterns',
				contentText: 'programming patterns',
			},
			{
				id: 'd0000000-0000-0000-0000-000000000002',
				title: 'Python Basics',
				contentText: 'Python programming intro with javascript examples',
			},
			{
				id: 'd0000000-0000-0000-0000-000000000003',
				title: 'JavaScript Tutorial Complete Guide',
				contentText: 'JavaScript tutorial for beginners',
			},
			{
				id: 'd0000000-0000-0000-0000-000000000004',
				title: 'Introduction to Code',
				contentText: 'javascript basics',
			},
		];

		for (let i = 0; i < articles.length; i += 1) {
			insertArticle(sqlite, { ...articles[i]!, publishedAt: now - i * 100 });
		}

		const page1 = await repo.search('user-1', 'javascript', ['feed-1'], 2);
		const lastItem = page1[1];
		expect(lastItem).toBeDefined();
		const cursor = encodeArticleCursor(lastItem ?? null, 'latest');

		const page2 = await repo.search('user-1', 'javascript', ['feed-1'], 2, cursor ?? undefined);

		expect(page1).toHaveLength(3);
		expect(page2.length).toBeGreaterThan(0);
		const page1Ids = new Set(page1.slice(0, 2).map((result) => result.id));
		const page2Ids = new Set(page2.map((result) => result.id));
		for (const id of page1Ids) {
			expect(page2Ids.has(id)).toBe(false);
		}
	});
});

describe('ArticleRepository searchByScope with FTS', () => {
	it('includes descendant category feeds and excludes unrelated categories', async () => {
		const { sqlite, repo, now } = await setupTestDatabase();

		sqlite
			.query(
				`INSERT INTO categories (id, user_id, parent_category_id, name, slug, sort_order, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run('cat-child', 'user-1', 'cat-root', 'Child', 'child', 0, now, now);
		sqlite
			.query(
				`INSERT INTO categories (id, user_id, parent_category_id, name, slug, sort_order, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run('cat-other', 'user-1', null, 'Other', 'other', 0, now, now);
		sqlite
			.query(
				`INSERT INTO feeds (id, user_id, category_id, title, site_url, feed_url, favicon_url, description,
				 polling_interval_minutes, last_synced_at, next_sync_at, sync_status, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				'feed-child',
				'user-1',
				'cat-child',
				'Child Feed',
				'https://child.example.com',
				'https://child.example.com/feed.xml',
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
				`INSERT INTO feeds (id, user_id, category_id, title, site_url, feed_url, favicon_url, description,
				 polling_interval_minutes, last_synced_at, next_sync_at, sync_status, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				'feed-other',
				'user-1',
				'cat-other',
				'Other Feed',
				'https://other.example.com',
				'https://other.example.com/feed.xml',
				null,
				null,
				60,
				now,
				now,
				'idle',
				now,
				now,
			);

		insertArticle(sqlite, {
			id: 'e0000000-0000-0000-0000-000000000001',
			feedId: 'feed-child',
			title: 'Rust Programming',
			contentText: 'Rust language',
			publishedAt: now,
		});
		insertArticle(sqlite, {
			id: 'e0000000-0000-0000-0000-000000000002',
			feedId: 'feed-other',
			title: 'Rust Tutorial',
			contentText: 'Rust basics',
			publishedAt: now,
		});

		const results = await repo.searchByScope(
			{ userId: 'user-1', categoryId: 'cat-root' },
			'rust',
			10,
		);

		expect(results.map((result) => result.id)).toEqual(['e0000000-0000-0000-0000-000000000001']);
	});
});
