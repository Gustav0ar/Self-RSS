import { Database as BunDatabase } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema.js';

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;
let sqliteClient: BunDatabase | null = null;

export function getDb(databaseUrl?: string) {
	if (dbInstance) return dbInstance;

	const path = databaseUrl ?? process.env.DATABASE_URL ?? 'data/rss.db';
	// Normalize path if it starts with sqlite:// or file:
	const normalizedPath = path.replace(/^sqlite:\/\//, '').replace(/^file:/, '');

	try {
		mkdirSync(dirname(normalizedPath), { recursive: true });
	} catch {
		// Ignore if directory exists or in-memory
	}

	sqliteClient = new BunDatabase(normalizedPath);
	sqliteClient.exec('PRAGMA journal_mode = WAL;');
	sqliteClient.exec('PRAGMA foreign_keys = ON;');
	sqliteClient.exec('PRAGMA busy_timeout = 5000;');

	dbInstance = drizzle(sqliteClient, { schema });
	return dbInstance;
}

export function getRawDb(): BunDatabase | null {
	return sqliteClient;
}

export async function closeDb() {
	if (sqliteClient) {
		sqliteClient.close();
		sqliteClient = null;
		dbInstance = null;
	}
}

export type Database = ReturnType<typeof getDb>;
