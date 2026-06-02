import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { closeDb, getDb } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
	console.log('Running migrations...');
	const db = getDb();
	const migrationsFolder = resolve(__dirname, '../../drizzle');

	try {
		migrate(db, { migrationsFolder });
		console.log('Migrations completed successfully.');
	} catch (error) {
		console.error('Migration failed:', error);
		process.exit(1);
	} finally {
		await closeDb();
	}
}

main();
