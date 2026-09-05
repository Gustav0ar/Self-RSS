import { Database as BunDatabase } from 'bun:sqlite';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { describe, expect, it } from 'vitest';
import journal from '../../drizzle/meta/_journal.json';
import { applyMigrations } from '../../src/db/migrations.js';
import * as schema from '../../src/db/schema.js';

const migrationsFolder = resolve(import.meta.dirname, '../../drizzle');
const stateTables = [
	'auth_sessions',
	'article_saves',
	'article_user_states',
	'article_state_mutations',
] as const;

function withPopulatedState(run: (sqlite: BunDatabase, nextFolder: string) => void) {
	const tempDir = mkdtempSync(join(tmpdir(), 'self-feed-state-guards-'));
	const sqlite = new BunDatabase(':memory:');
	try {
		sqlite.exec('PRAGMA foreign_keys = ON');
		const db = drizzle(sqlite, { schema });
		applyMigrations(db, { migrationsFolder });
		db.insert(schema.users)
			.values({ id: 'user', email: 'reader@example.com', passwordHash: 'test-hash' })
			.run();
		db.insert(schema.categories)
			.values({ id: 'category', userId: 'user', name: 'Feeds', slug: 'feeds' })
			.run();
		db.insert(schema.feeds)
			.values({
				id: 'feed',
				userId: 'user',
				categoryId: 'category',
				title: 'Feed',
				feedUrl: 'https://example.com/feed',
			})
			.run();
		db.insert(schema.articles)
			.values({ id: 'article', feedId: 'feed', guid: 'guid', title: 'Article', hash: 'hash' })
			.run();
		db.insert(schema.authSessions)
			.values({ id: 'session', userId: 'user', refreshTokenHash: 'test-token-hash' })
			.run();
		db.insert(schema.articleSaves).values({ userId: 'user', articleId: 'article' }).run();
		db.insert(schema.articleUserStates)
			.values({ userId: 'user', articleId: 'article', readRevision: 4, savedRevision: 2 })
			.run();
		db.insert(schema.articleStateMutations)
			.values({
				userId: 'user',
				articleId: 'article',
				mutationId: 'mutation',
				kind: 'saved',
				desiredState: true,
				resultingState: true,
				resultingRevision: 2,
				applied: true,
			})
			.run();
		const nextFolder = join(tempDir, 'drizzle');
		cpSync(migrationsFolder, nextFolder, { recursive: true });
		const latest = journal.entries.at(-1);
		if (!latest) throw new Error('The migration journal is empty');
		writeFileSync(
			join(nextFolder, 'meta/_journal.json'),
			JSON.stringify({
				...journal,
				entries: [
					...journal.entries,
					{ ...latest, idx: latest.idx + 1, when: latest.when + 1, tag: 'test_state_guard' },
				],
			}),
		);
		run(sqlite, nextFolder);
	} finally {
		sqlite.close();
		rmSync(tempDir, { recursive: true, force: true });
	}
}

describe('migration protection for sessions and article state', () => {
	it.each(stateTables)('rolls back a forward migration that deletes %s', (table) => {
		withPopulatedState((sqlite, nextFolder) => {
			const before = stateTables.map((name) => sqlite.query(`SELECT * FROM "${name}"`).all());
			const ledger = sqlite.query('SELECT * FROM __drizzle_migrations').all();
			writeFileSync(join(nextFolder, 'test_state_guard.sql'), `DELETE FROM "${table}";`);
			expect(() =>
				applyMigrations(drizzle(sqlite, { schema }), { migrationsFolder: nextFolder }),
			).toThrow(/protected tables/);
			expect(stateTables.map((name) => sqlite.query(`SELECT * FROM "${name}"`).all())).toEqual(
				before,
			);
			expect(sqlite.query('SELECT * FROM __drizzle_migrations').all()).toEqual(ledger);
			expect(sqlite.query('PRAGMA foreign_key_check').all()).toEqual([]);
		});
	});

	it('preserves every state row through a non-destructive forward migration', () => {
		withPopulatedState((sqlite, nextFolder) => {
			const before = stateTables.map((name) => sqlite.query(`SELECT * FROM "${name}"`).all());
			writeFileSync(
				join(nextFolder, 'test_state_guard.sql'),
				'CREATE TABLE test_addition (id TEXT PRIMARY KEY);',
			);
			expect(() =>
				applyMigrations(drizzle(sqlite, { schema }), { migrationsFolder: nextFolder }),
			).not.toThrow();
			expect(stateTables.map((name) => sqlite.query(`SELECT * FROM "${name}"`).all())).toEqual(
				before,
			);
			expect(sqlite.query('PRAGMA foreign_key_check').all()).toEqual([]);
		});
	});
});
