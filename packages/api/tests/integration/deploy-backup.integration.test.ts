import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = readFileSync(
	resolve(import.meta.dirname, '../../../../scripts/deploy-vps.sh'),
	'utf8',
);
const backupStart = script.indexOf('backup_existing_database() {');
const backupEnd = script.indexOf('\nensure_data_permissions() {', backupStart);
if (backupStart < 0 || backupEnd < 0) throw new Error('Backup function is missing');
const backupFunction = script.slice(backupStart, backupEnd);

function withDatabase(run: (dir: string, db: Database) => void) {
	const dir = mkdtempSync(join(tmpdir(), 'self-feed-deploy-backup-'));
	mkdirSync(join(dir, 'data/backups'), { recursive: true });
	const db = new Database(join(dir, 'data/self-feed.db'));
	try {
		db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE saved (id TEXT);');
		db.query('INSERT INTO saved VALUES (?)').run('committed-in-wal');
		writeFileSync(join(dir, 'data/backups/self-feed-previous.db'), 'previous backup');
		writeFileSync(
			join(dir, 'container'),
			`#!/usr/bin/env bun
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync('commands.jsonl', JSON.stringify(args) + '\\n');
if (args[0] === 'inspect') {
  console.log(args[2].includes('State.Status') ? process.env.API_STATUS : 'existing-api-image');
  process.exit(0);
}
if (args[0] === 'image') process.exit(process.env.BACKUP_MODE === 'missing-image' ? 1 : 0);
if (process.env.BACKUP_MODE === 'failed') process.exit(1);
const env = { ...process.env };
let program;
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '-e') continue;
  const value = args[++i];
  if (value.startsWith('SELF_FEED_BACKUP_')) {
    const split = value.indexOf('=');
    env[value.slice(0, split)] = value.slice(split + 1);
  } else program = value;
}
if (!program) throw new Error('SQLite program was not supplied');
const result = Bun.spawnSync([process.execPath, '--no-env-file', '-e', program.replaceAll('/app/data', process.cwd() + '/data')], { env });
process.stderr.write(result.stderr);
process.exit(result.exitCode);
`,
			{ mode: 0o700 },
		);
		run(dir, db);
	} finally {
		db.close();
		rmSync(dir, { recursive: true, force: true });
	}
}

function runBackup(dir: string, status: string, mode = 'success') {
	return Bun.spawnSync(
		['bash', '-c', `set -euo pipefail\n${backupFunction}\nbackup_existing_database`],
		{
			cwd: dir,
			env: {
				...process.env,
				PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
				CONTAINER_CLI: join(dir, 'container'),
				API_STATUS: status,
				API_IMAGE: 'target-api-image',
				BACKUP_MODE: mode,
				HEAD_SHA_SHORT: 'testsha',
				APP_UID: String(process.getuid?.()),
				APP_GID: String(process.getgid?.()),
			},
		},
	);
}

describe('deployment SQLite backups', () => {
	it.each(['running', 'exited'])('backs up committed WAL writes when the API is %s', (status) => {
		withDatabase((dir, db) => {
			expect(readFileSync(join(dir, 'data/self-feed.db-wal')).length).toBeGreaterThan(0);
			const result = runBackup(dir, status);
			expect(result.exitCode, result.stderr.toString()).toBe(0);
			const file = readdirSync(join(dir, 'data/backups')).find((name) => name.includes('testsha'));
			if (!file) throw new Error('Backup was not created');
			db.query('INSERT INTO saved VALUES (?)').run('after-backup');
			const backup = new Database(join(dir, 'data/backups', file), { readonly: true });
			try {
				expect(backup.query('SELECT * FROM saved').all()).toEqual([{ id: 'committed-in-wal' }]);
				expect(backup.query('PRAGMA integrity_check').values()).toEqual([['ok']]);
			} finally {
				backup.close();
			}
			if (status === 'exited') {
				const commands = readFileSync(join(dir, 'commands.jsonl'), 'utf8');
				expect(commands).toContain('"--network","none"');
				expect(commands).toContain('"--entrypoint","bun"');
				expect(commands).toContain('"existing-api-image"');
			}
		});
	});

	it.each([
		['running', 'failed'],
		['exited', 'failed'],
		['exited', 'missing-image'],
	])('stops without a file-copy fallback when %s backup is %s', (status, mode) => {
		withDatabase((dir, db) => {
			const result = runBackup(dir, status, mode);
			expect(result.exitCode).not.toBe(0);
			expect(result.stdout.toString()).toContain('deployment stopped');
			expect(readdirSync(join(dir, 'data/backups'))).toEqual(['self-feed-previous.db']);
			expect(readFileSync(join(dir, 'data/backups/self-feed-previous.db'), 'utf8')).toBe(
				'previous backup',
			);
			expect(db.query('SELECT * FROM saved').all()).toEqual([{ id: 'committed-in-wal' }]);
		});
	});
});
