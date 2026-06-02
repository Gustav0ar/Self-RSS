import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { userPreferences } from '../db/schema.js';

export class PreferencesRepository {
	constructor(private db: Database) {}

	async findByUserId(userId: string) {
		return this.db.query.userPreferences.findFirst({
			where: eq(userPreferences.userId, userId),
		});
	}

	async upsert(
		userId: string,
		data: Partial<{
			theme: string;
			fontFamily: string;
			textSize: number;
			density: string;
			defaultSort: string;
			hideRead: boolean;
			keyboardShortcutsEnabled: boolean;
			autoMarkReadMode: string;
		}>,
	) {
		const [prefs] = await this.db
			.insert(userPreferences)
			.values({ userId, ...data, updatedAt: new Date() })
			.onConflictDoUpdate({
				target: userPreferences.userId,
				set: { ...data, updatedAt: new Date() },
			})
			.returning();
		return prefs!;
	}
}
