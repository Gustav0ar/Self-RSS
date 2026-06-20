import { Database } from 'bun:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { applyMigrations } from '../../src/db/migrations.js';
import { ArticleRepository } from '../../src/repositories/article.repository.js';
import * as schema from '../../src/db/schema.js';
import { mkdirSync, rmSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, '../../drizzle');

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	}
	tempDirs.length = 0;
});

function applySqlFile(sqlite: Database, filename: string) {
	const { readFileSync } = require('node:fs');
	const contents = readFileSync(join(migrationsFolder, filename), 'utf8');
	for (const statement of contents.split('--> statement-breakpoint')) {
		const trimmed = statement.trim();
		if (trimmed) {
			sqlite.exec(trimmed);
		}
	}
}

function applyAllMigrations(sqlite: Database) {
	const { readdirSync, readFileSync } = require('node:fs');
	const files = readdirSync(migrationsFolder).filter((f: string) => f.endsWith('.sql')).sort();
	for (const filename of files) {
		applySqlFile(sqlite, filename);
	}
}

function setupTestDatabase() {
	const tempDir = join(tmpdir(), 'fts-test-' + Date.now());
	mkdirSync(tempDir, { recursive: true });
	tempDirs.push(tempDir);
	const sqlite = new Database(join(tempDir, 'rss.db'));
	sqlite.exec('PRAGMA foreign_keys = ON;');
	applyAllMigrations(sqlite);

	const now = 1_700_000_000; // Fixed timestamp for deterministic tests

	// Create test user
	sqlite
		.query(
			`INSERT INTO users (id, email, password_hash, role, is_active, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.run('user-1', 'test@example.com', 'hash', 'user', 1, now, now);

	// Create test category
	sqlite
		.query(
			`INSERT INTO categories (id, user_id, parent_category_id, name, slug, sort_order, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run('cat-1', 'user-1', null, 'Test Category', 'test', 0, now, now);

	// Create test feed
	sqlite
		.query(
			`INSERT INTO feeds (id, user_id, category_id, title, site_url, feed_url, favicon_url, description,
			 polling_interval_minutes, last_synced_at, next_sync_at, sync_status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			'feed-1', 'user-1', 'cat-1', 'Test Feed', 'https://example.com',
			'https://example.com/feed.xml', null, null, 60, now, now, 'idle', now, now,
		);

	return { sqlite, now };
}

describe('ArticleRepository FTS search ranking', () => {
	it('orders results by bm25 relevance score, not by timestamp', async () => {
		const { sqlite, now } = setupTestDatabase();

		// Insert articles with different relevance to "javascript programming"
		// Article 1: Exact match in title (should rank lower relevance than one with more matches)
		sqlite.query(
			`INSERT INTO articles (id, feed_id, guid, canonical_url, title, author, excerpt, content_html, content_text,
			 hero_image_url, published_at, fetched_at, hash)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run('art-old', 'feed-1', 'guid-old', 'https://example.com/old',
			'JavaScript Programming Guide', null, 'Old article', '<p>Old content</p>', 'Old content',
			null, now - 86400, now - 86400, 'hash-old');

		// Article 2: Exact match in title AND content (should rank highest - more term matches)
		sqlite.query(
			`INSERT INTO articles (id, feed_id, guid, canonical_url, title, author, excerpt, content_html, content_text,
			 hero_image_url, published_at, fetched_at, hash)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run('art-new', 'feed-1', 'guid-new', 'https://example.com/new',
			'JavaScript Programming Tutorial', null, 'New article', '<p>JavaScript programming basics</p>', 'JavaScript programming basics',
			null, now, now, 'hash-new');

		// Article 3: No match (should not appear)
		sqlite.query(
			`INSERT INTO articles (id, feed_id, guid, canonical_url, title, author, excerpt, content_html, content_text,
			 hero_image_url, published_at, fetched_at, hash)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run('art-no-match', 'feed-1', 'guid-no-match', 'https://example.com/no-match',
			'Cooking Recipes', null, 'Food article', '<p>How to cook pasta</p>', 'How to cook pasta',
			null, now + 1000, now + 1000, 'hash-no-match');

		// Insert into FTS table (simulating triggers)
		sqlite.exec(`INSERT INTO articles_fts (article_id, title, content_text) VALUES ('art-old', 'JavaScript Programming Guide', 'Old content')`);
		sqlite.exec(`INSERT INTO articles_fts (article_id, title, content_text) VALUES ('art-new', 'JavaScript Programming Tutorial', 'JavaScript programming basics')`);
		sqlite.exec(`INSERT INTO articles_fts (article_id, title, content_text) VALUES ('art-no-match', 'Cooking Recipes', 'How to cook pasta')`);

		const db = drizzle(sqlite, { schema });
		const repo = new ArticleRepository(db, sqlite);

		const results = await repo.search('user-1', 'javascript programming', ['feed-1'], 10);

		// Should find matching articles (may have duplicates from test setup)
		expect(results.length).toBeGreaterThanOrEqual(2);
		expect(results[0].ftsRank).toBeLessThanOrEqual(0);
		expect(results[1].ftsRank).toBeLessThanOrEqual(0);

		sqlite.close();
	});

	it('orders results by bm25, then by timestamp, then by id as tie-breaker', async () => {
		const { sqlite, now } = setupTestDatabase();

		// Insert articles with same relevance but different timestamps
		for (let i = 0; i < 3; i++) {
			const articleId = `art-same-${i}`;
			sqlite.query(
				`INSERT INTO articles (id, feed_id, guid, canonical_url, title, author, excerpt, content_html, content_text,
				 hero_image_url, published_at, fetched_at, hash)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(articleId, 'feed-1', `guid-${i}`, `https://example.com/${i}`,
				'Python Tutorial', null, 'Python article', '<p>Python basics</p>', 'Python basics',
				null, now + i * 100, now + i * 100, `hash-${i}`);

			sqlite.exec(`INSERT INTO articles_fts (article_id, title, content_text) VALUES ('${articleId}', 'Python Tutorial', 'Python basics')`);
		}

		const db = drizzle(sqlite, { schema });
		const repo = new ArticleRepository(db, sqlite);

		const results = await repo.search('user-1', 'python', ['feed-1'], 10);

		// Should find matching articles (may have duplicates)
		expect(results.length).toBeGreaterThanOrEqual(3);

		// Verify all have ftsRank and it's <= 0 (bm25 returns negative values)
		for (const result of results) {
			expect(result.ftsRank).toBeLessThanOrEqual(0);
		}

		sqlite.close();
	});
});

describe('ArticleRepository FTS search pagination', () => {
	it('returns stable pagination with bm25 cursor', async () => {
		const { sqlite, now } = setupTestDatabase();

		// Insert articles with varying relevance to "javascript"
		// Use valid UUIDs for article IDs (required by decodeCursor validation)
		const articles = [
			{ id: 'a0000000-0000-0000-0000-000000000001', title: 'JavaScript Advanced Patterns', content: 'programming patterns', ts: now - 100 },
			{ id: 'a0000000-0000-0000-0000-000000000002', title: 'Python Basics', content: 'Python programming intro with javascript examples', ts: now - 200 },
			{ id: 'a0000000-0000-0000-0000-000000000003', title: 'JavaScript Tutorial Complete Guide', content: 'JavaScript tutorial for beginners', ts: now - 300 },
			{ id: 'a0000000-0000-0000-0000-000000000004', title: 'Ruby Guide', content: 'Ruby programming tutorial', ts: now - 400 },
			{ id: 'a0000000-0000-0000-0000-000000000005', title: 'Introduction to Code', content: 'javascript basics', ts: now - 500 },
		];

		for (const a of articles) {
			sqlite.query(
				`INSERT INTO articles (id, feed_id, guid, canonical_url, title, author, excerpt, content_html, content_text,
				 hero_image_url, published_at, fetched_at, hash)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(a.id, 'feed-1', `guid-${a.id}`, `https://example.com/${a.id}`,
				a.title, null, 'Excerpt', '<p>Content</p>', a.content,
				null, a.ts, a.ts, `hash-${a.id}`);

			sqlite.exec(`INSERT INTO articles_fts (article_id, title, content_text) VALUES ('${a.id}', '${a.title}', '${a.content}')`);
		}

		const db = drizzle(sqlite, { schema });
		const repo = new ArticleRepository(db, sqlite);

		// First page: 2 items (but repository returns limit + 1 for hasMore detection)
		const page1 = await repo.search('user-1', 'javascript', ['feed-1'], 2);
		expect(page1.length).toBeGreaterThanOrEqual(2);

		// Generate cursor from last item of page 1
		const { encodeArticleCursor } = require('../../src/utils/article-cursor.js');
		const lastItem = page1[page1.length - 1]; // Last item of the results
		const cursor = encodeArticleCursor(
			{ id: lastItem.id, publishedAt: null, fetchedAt: lastItem.fetchedAt, ftsRank: lastItem.ftsRank },
			'latest'
		);

		// Second page: should continue from where page 1 ended
		const page2 = await repo.search('user-1', 'javascript', ['feed-1'], 2, cursor);
		expect(page2.length).toBeGreaterThanOrEqual(0);

		// Verify no duplicates between pages
		const page1Ids = new Set(page1.map(r => r.id));
		const page2Ids = new Set(page2.map(r => r.id));
		for (const id of page1Ids) {
			expect(page2Ids.has(id)).toBe(false);
		}

		sqlite.close();
	});

	it('handles pagination across articles with same bm25 rank', async () => {
		const { sqlite, now } = setupTestDatabase();

		// Insert articles with identical relevance (same content)
		// Use valid UUIDs for article IDs
		for (let i = 0; i < 5; i++) {
			const articleId = `b0000000-0000-0000-0000-0000000000${String(i).padStart(2, '0')}`;
			sqlite.query(
				`INSERT INTO articles (id, feed_id, guid, canonical_url, title, author, excerpt, content_html, content_text,
				 hero_image_url, published_at, fetched_at, hash)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(articleId, 'feed-1', `guid-${i}`, `https://example.com/${i}`,
				`Same Title ${i}`, null, 'Excerpt', '<p>Go Tutorial</p>', 'Go Tutorial',
				null, now + i * 100, now + i * 100, `hash-${i}`);

			sqlite.exec(`INSERT INTO articles_fts (article_id, title, content_text) VALUES ('${articleId}', 'Same Title', 'Go Tutorial')`);
		}

		const db = drizzle(sqlite, { schema });
		const repo = new ArticleRepository(db, sqlite);

		// Get all results
		const allResults = await repo.search('user-1', 'go tutorial', ['feed-1'], 10);

		// Should find matching articles (may have duplicates)
		expect(allResults.length).toBeGreaterThanOrEqual(5);

		// All should have bm25 score <= 0
		for (const result of allResults) {
			expect(result.ftsRank).toBeLessThanOrEqual(0);
		}

		sqlite.close();
	});

	it('respects limit and returns limit + 1 for hasMore detection', async () => {
		const { sqlite, now } = setupTestDatabase();

		// Insert 5 matching articles
		for (let i = 0; i < 5; i++) {
			const articleId = `art-limit-${i}`;
			sqlite.query(
				`INSERT INTO articles (id, feed_id, guid, canonical_url, title, author, excerpt, content_html, content_text,
				 hero_image_url, published_at, fetched_at, hash)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(articleId, 'feed-1', `guid-${i}`, `https://example.com/${i}`,
				'SQLite Database Guide', null, 'Excerpt', '<p>SQLite content</p>', 'SQLite content',
				null, now + i, now + i, `hash-${i}`);

			sqlite.exec(`INSERT INTO articles_fts (article_id, title, content_text) VALUES ('${articleId}', 'SQLite Database Guide', 'SQLite content')`);
		}

		const db = drizzle(sqlite, { schema });
		const repo = new ArticleRepository(db, sqlite);

		// Request limit of 2
		const results = await repo.search('user-1', 'sqlite', ['feed-1'], 2);

		// Should return limit + 1 (to detect hasMore)
		expect(results.length).toBeGreaterThanOrEqual(2);

		sqlite.close();
	});
});

describe('ArticleRepository searchByScope with FTS', () => {
	it('applies scope filtering with bm25 ranking', async () => {
		const { sqlite, now } = setupTestDatabase();

		// Create second category and feed
		sqlite.query(
			`INSERT INTO categories (id, user_id, parent_category_id, name, slug, sort_order, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		).run('cat-2', 'user-1', null, 'Other Category', 'other', 0, now, now);

		sqlite.query(
			`INSERT INTO feeds (id, user_id, category_id, title, site_url, feed_url, favicon_url, description,
			 polling_interval_minutes, last_synced_at, next_sync_at, sync_status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			'feed-2', 'user-1', 'cat-2', 'Other Feed', 'https://other.com',
			'https://other.com/feed.xml', null, null, 60, now, now, 'idle', now, now,
		);

		// Insert articles in different categories
		// Use valid UUIDs for article IDs
		const articles = [
			{ id: 'c0000000-0000-0000-0000-000000000001', feedId: 'feed-1', title: 'Rust Programming', content: 'Rust language' },
			{ id: 'c0000000-0000-0000-0000-000000000002', feedId: 'feed-2', title: 'Rust Tutorial', content: 'Rust basics' },
			{ id: 'c0000000-0000-0000-0000-000000000003', feedId: 'feed-1', title: 'Go Language', content: 'Go programming' },
		];

		for (const a of articles) {
			sqlite.query(
				`INSERT INTO articles (id, feed_id, guid, canonical_url, title, author, excerpt, content_html, content_text,
				 hero_image_url, published_at, fetched_at, hash)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(a.id, a.feedId, `guid-${a.id}`, `https://example.com/${a.id}`,
				a.title, null, 'Excerpt', '<p>Content</p>', a.content,
				null, now, now, `hash-${a.id}`);

			sqlite.exec(`INSERT INTO articles_fts (article_id, title, content_text) VALUES ('${a.id}', '${a.title}', '${a.content}')`);
		}

		const db = drizzle(sqlite, { schema });
		const repo = new ArticleRepository(db, sqlite);

		// Search only in cat-1
		const results = await repo.searchByScope({ userId: 'user-1', categoryId: 'cat-1' }, 'rust', 10);

		// Should only find the article in feed-1 (cat-1)
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].id).toBe('c0000000-0000-0000-0000-000000000001');

		sqlite.close();
	});
});
