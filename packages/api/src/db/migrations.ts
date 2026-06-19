import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import { type MigrationMeta, readMigrationFiles } from 'drizzle-orm/migrator';
import type { Database } from './client.js';

const DEFAULT_MIGRATIONS_TABLE = '__drizzle_migrations';
const PROTECTED_TABLES = [
	{ name: 'users', keyColumns: ['id'] },
	{ name: 'user_preferences', keyColumns: ['user_id'] },
	{ name: 'categories', keyColumns: ['id'] },
	{ name: 'feeds', keyColumns: ['id'] },
	{ name: 'articles', keyColumns: ['id'] },
	{ name: 'article_media', keyColumns: ['id'] },
	{ name: 'article_reads', keyColumns: ['user_id', 'article_id'] },
	{ name: 'sync_runs', keyColumns: ['id'] },
	{ name: 'user_metrics_daily', keyColumns: ['user_id', 'date'] },
	{ name: 'app_settings', keyColumns: ['id'] },
	{ name: 'audit_logs', keyColumns: ['id'] },
] as const;

interface ApplyMigrationsOptions {
	migrationsFolder: string;
	migrationsTable?: string;
	backupDir?: string;
}

interface DbMigrationRow {
	id: number;
	hash: string;
	created_at: number | string;
}

interface DatabaseListRow {
	seq: number;
	name: string;
	file: string;
}

interface ForeignKeyViolation {
	table: string;
	rowid: number;
	parent: string;
	fkid: number;
}

interface MigrationGuardErrorOptions {
	message: string;
	backupPath: string | null;
}

class MigrationGuardError extends Error {
	constructor({ message, backupPath }: MigrationGuardErrorOptions) {
		super(backupPath ? `${message}. Pre-migration backup: ${backupPath}` : message);
		this.name = 'MigrationGuardError';
	}
}

interface ProtectedTableSnapshot {
	count: number;
	keyColumns: readonly string[];
	snapshotTable: string;
}

type ProtectedSnapshot = Map<string, ProtectedTableSnapshot>;

function quoteSqlString(value: string) {
	return `'${value.replaceAll("'", "''")}'`;
}

function quoteIdentifier(value: string) {
	return `"${value.replaceAll('"', '""')}"`;
}

function tableExists(db: Database, table: string) {
	const rows = db.all<{ name: string }>(
		sql.raw(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${quoteSqlString(table)}`,
		),
	);
	return rows.length > 0;
}

function protectedTableSnapshot(db: Database): ProtectedSnapshot {
	const snapshot: ProtectedSnapshot = new Map();
	for (const [index, table] of PROTECTED_TABLES.entries()) {
		if (!tableExists(db, table.name)) {
			continue;
		}
		const [{ count } = { count: 0 }] = db.all<{ count: number }>(
			sql.raw(`SELECT count(*) AS count FROM ${quoteIdentifier(table.name)}`),
		);

		const quotedKeyColumns = table.keyColumns.map(quoteIdentifier).join(', ');
		const snapshotTable = `migration_guard_${index}_${table.name}`;
		db.run(sql.raw(`DROP TABLE IF EXISTS temp.${quoteIdentifier(snapshotTable)}`));
		db.run(
			sql.raw(
				`CREATE TEMP TABLE ${quoteIdentifier(
					snapshotTable,
				)} AS SELECT ${quotedKeyColumns} FROM ${quoteIdentifier(table.name)}`,
			),
		);

		snapshot.set(table.name, { count, keyColumns: table.keyColumns, snapshotTable });
	}
	return snapshot;
}

function protectedRowKeys(rows: Record<string, unknown>[], keyColumns: readonly string[]) {
	return rows.map((row) =>
		keyColumns
			.map((column) => {
				const value = row[column];
				return value === null || value === undefined ? '' : String(value);
			})
			.join('\u001f'),
	);
}

function protectedTableCount(db: Database, table: string) {
	if (!tableExists(db, table)) {
		return 0;
	}
	const [{ count } = { count: 0 }] = db.all<{ count: number }>(
		sql.raw(`SELECT count(*) AS count FROM ${quoteIdentifier(table)}`),
	);
	return count;
}

function missingProtectedRows(
	db: Database,
	table: string,
	snapshotTable: string,
	keyColumns: readonly string[],
) {
	if (!tableExists(db, table)) {
		const rows = db.all<Record<string, unknown>>(
			sql.raw(`SELECT * FROM temp.${quoteIdentifier(snapshotTable)} LIMIT 20`),
		);
		return protectedRowKeys(rows, keyColumns);
	}

	const existsPredicate = keyColumns
		.map((column) => `current.${quoteIdentifier(column)} IS snapshot.${quoteIdentifier(column)}`)
		.join(' AND ');
	const quotedKeyColumns = keyColumns
		.map((column) => `snapshot.${quoteIdentifier(column)} AS ${quoteIdentifier(column)}`)
		.join(', ');
	const rows = db.all<Record<string, unknown>>(
		sql.raw(
			`SELECT ${quotedKeyColumns} FROM temp.${quoteIdentifier(snapshotTable)} AS snapshot
			 WHERE NOT EXISTS (
				 SELECT 1 FROM ${quoteIdentifier(table)} AS current WHERE ${existsPredicate}
			 )
			 LIMIT 20`,
		),
	);
	return protectedRowKeys(rows, keyColumns);
}

function dropProtectedSnapshotTables(db: Database, snapshot: ProtectedSnapshot) {
	for (const { snapshotTable } of snapshot.values()) {
		db.run(sql.raw(`DROP TABLE IF EXISTS temp.${quoteIdentifier(snapshotTable)}`));
	}
}

function assertNoProtectedDataLoss(db: Database, before: ProtectedSnapshot) {
	const losses: { table: string; before: number; after: number }[] = [];
	const missingRows: { table: string; keys: string[] }[] = [];

	for (const [table, beforeTable] of before) {
		const afterCount = protectedTableCount(db, table);
		if (afterCount < beforeTable.count) {
			losses.push({ table, before: beforeTable.count, after: afterCount });
		}

		const missing = missingProtectedRows(
			db,
			table,
			beforeTable.snapshotTable,
			beforeTable.keyColumns,
		);
		if (missing.length > 0) {
			missingRows.push({ table, keys: missing });
		}
	}

	if (losses.length > 0 || missingRows.length > 0) {
		throw new MigrationGuardError({
			message: `Migration would remove rows from protected tables: ${JSON.stringify({
				losses,
				missingRows,
			})}`,
			backupPath: null,
		});
	}
}

function assertNoForeignKeyViolations(db: Database) {
	const violations = db.all<ForeignKeyViolation>(sql.raw('PRAGMA foreign_key_check;'));
	if (violations.length > 0) {
		throw new MigrationGuardError({
			message: `Migration would leave foreign key violations: ${JSON.stringify(
				violations.slice(0, 20),
			)}`,
			backupPath: null,
		});
	}
}

function getMainDatabasePath(db: Database) {
	const rows = db.all<DatabaseListRow>(sql.raw('PRAGMA database_list;'));
	return rows.find((row) => row.name === 'main')?.file ?? '';
}

function createMigrationBackup(db: Database, backupDir?: string) {
	const databasePath = getMainDatabasePath(db);
	if (!databasePath || databasePath === ':memory:' || !existsSync(databasePath)) {
		return null;
	}

	const resolvedBackupDir = backupDir ?? join(dirname(databasePath), 'backups');
	mkdirSync(resolvedBackupDir, { recursive: true });
	const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
	const backupPath = join(resolvedBackupDir, `self-feed-before-migrate-${timestamp}.db`);
	db.run(sql.raw(`VACUUM INTO ${quoteSqlString(backupPath)};`));
	return backupPath;
}

function createMigrationTable(db: Database, migrationsTable: string) {
	db.run(sql`
		CREATE TABLE IF NOT EXISTS ${sql.identifier(migrationsTable)} (
			id SERIAL PRIMARY KEY,
			hash text NOT NULL,
			created_at numeric
		)
	`);
}

function latestAppliedMigration(db: Database, migrationsTable: string): DbMigrationRow | undefined {
	const rows = db.all<DbMigrationRow>(
		sql`SELECT id, hash, created_at FROM ${sql.identifier(
			migrationsTable,
		)} ORDER BY created_at DESC LIMIT 1`,
	);
	return rows[0];
}

function pendingMigrations(migrations: MigrationMeta[], latest: DbMigrationRow | undefined) {
	const latestCreatedAt = latest ? Number(latest.created_at) : null;
	return migrations.filter(
		(migration) => latestCreatedAt === null || latestCreatedAt < migration.folderMillis,
	);
}

function runMigrationStatements(db: Database, migration: MigrationMeta) {
	for (const statement of migration.sql) {
		const trimmed = statement.trim();
		if (trimmed) {
			db.run(sql.raw(trimmed));
		}
	}
}

function insertMigrationRecord(db: Database, migrationsTable: string, migration: MigrationMeta) {
	db.run(
		sql`INSERT INTO ${sql.identifier(migrationsTable)} ("hash", "created_at") VALUES(${
			migration.hash
		}, ${migration.folderMillis})`,
	);
}

export function applyMigrations(db: Database, options: ApplyMigrationsOptions) {
	const migrationsTable = options.migrationsTable ?? DEFAULT_MIGRATIONS_TABLE;
	const migrations = readMigrationFiles({ migrationsFolder: options.migrationsFolder });

	createMigrationTable(db, migrationsTable);
	const latest = latestAppliedMigration(db, migrationsTable);
	const pending = pendingMigrations(migrations, latest);
	if (pending.length === 0) {
		return;
	}

	const beforeSnapshot = protectedTableSnapshot(db);
	const hasProtectedData = Array.from(beforeSnapshot.values()).some(({ count }) => count > 0);
	const backupPath = hasProtectedData ? createMigrationBackup(db, options.backupDir) : null;

	db.run(sql.raw('PRAGMA foreign_keys = OFF;'));
	db.run(sql.raw('BEGIN;'));
	try {
		for (const migration of pending) {
			runMigrationStatements(db, migration);
			insertMigrationRecord(db, migrationsTable, migration);
		}

		assertNoProtectedDataLoss(db, beforeSnapshot);
		assertNoForeignKeyViolations(db);
		db.run(sql.raw('COMMIT;'));
	} catch (error) {
		db.run(sql.raw('ROLLBACK;'));
		if (error instanceof MigrationGuardError) {
			throw new MigrationGuardError({ message: error.message, backupPath });
		}
		throw error;
	} finally {
		dropProtectedSnapshotTables(db, beforeSnapshot);
		db.run(sql.raw('PRAGMA foreign_keys = ON;'));
	}
}
