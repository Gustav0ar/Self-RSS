import { getEnv } from '../config/index.js';
import { UserRepository } from '../repositories/user.repository.js';
import { createLogger } from '../utils/logger.js';
import { hashPassword } from '../utils/password.js';
import { closeDb, getDb } from './client.js';

const logger = createLogger();

async function seed() {
	const env = getEnv();
	if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
		throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required for db:seed');
	}

	const db = getDb(env.DATABASE_URL);
	const userRepo = new UserRepository(db);

	try {
		const existing = await userRepo.findByEmail(env.ADMIN_EMAIL);
		if (existing) {
			logger.info('Admin seed skipped because the user already exists', {
				email: env.ADMIN_EMAIL,
			});
			return;
		}

		const passwordHash = await hashPassword(env.ADMIN_PASSWORD);
		const user = await userRepo.createWithPreferences({
			email: env.ADMIN_EMAIL,
			passwordHash,
			role: 'admin',
		});
		logger.info('Admin user seeded', { userId: user.id, email: user.email });
	} finally {
		await closeDb();
	}
}

await seed();
