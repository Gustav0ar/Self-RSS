import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { appSettings, auditLogs, feeds, syncRuns, userMetricsDaily } from '../db/schema.js';

export class AppSettingsRepository {
	constructor(private db: Database) {}

	async get() {
		const settings = await this.db.query.appSettings.findFirst({
			where: eq(appSettings.id, 1),
		});
		return settings ?? { id: 1, registrationLocked: false, updatedAt: new Date() };
	}

	async update(data: { registrationLocked?: boolean }) {
		const [settings] = await this.db
			.insert(appSettings)
			.values({ id: 1, ...data, updatedAt: new Date() })
			.onConflictDoUpdate({
				target: appSettings.id,
				set: { ...data, updatedAt: new Date() },
			})
			.returning();
		return settings!;
	}
}

export class SyncRunRepository {
	constructor(private db: Database) {}

	async create(feedId: string) {
		const [run] = await this.db.insert(syncRuns).values({ feedId }).returning();
		return run!;
	}

	async complete(
		id: string,
		data: { status: string; httpStatus?: number; itemCount: number; errorMessage?: string },
	) {
		const [run] = await this.db
			.update(syncRuns)
			.set({ ...data, finishedAt: new Date() })
			.where(eq(syncRuns.id, id))
			.returning();
		return run;
	}

	async findRecentByUser(userId: string, limit: number) {
		const result = await this.db
			.select({
				id: syncRuns.id,
				feedId: syncRuns.feedId,
				startedAt: syncRuns.startedAt,
				finishedAt: syncRuns.finishedAt,
				status: syncRuns.status,
				httpStatus: syncRuns.httpStatus,
				itemCount: syncRuns.itemCount,
				errorMessage: syncRuns.errorMessage,
			})
			.from(syncRuns)
			.innerJoin(feeds, eq(syncRuns.feedId, feeds.id))
			.where(eq(feeds.userId, userId))
			.orderBy(desc(syncRuns.startedAt))
			.limit(limit);

		return result;
	}
}

export class MetricsRepository {
	constructor(private db: Database) {}

	async incrementReadCount(userId: string, amount = 1) {
		const today = new Date().toISOString().split('T')[0]!;
		await this.db
			.insert(userMetricsDaily)
			.values({ userId, date: today, articlesReadCount: amount })
			.onConflictDoUpdate({
				target: [userMetricsDaily.userId, userMetricsDaily.date],
				set: {
					articlesReadCount: sql`${userMetricsDaily.articlesReadCount} + ${amount}`,
				},
			});
	}

	async incrementSyncCount(userId: string) {
		const today = new Date().toISOString().split('T')[0]!;
		await this.db
			.insert(userMetricsDaily)
			.values({ userId, date: today, feedsSyncedCount: 1 })
			.onConflictDoUpdate({
				target: [userMetricsDaily.userId, userMetricsDaily.date],
				set: {
					feedsSyncedCount: sql`${userMetricsDaily.feedsSyncedCount} + 1`,
				},
			});
	}

	async incrementSearchCount(userId: string) {
		const today = new Date().toISOString().split('T')[0]!;
		await this.db
			.insert(userMetricsDaily)
			.values({ userId, date: today, searchCount: 1 })
			.onConflictDoUpdate({
				target: [userMetricsDaily.userId, userMetricsDaily.date],
				set: {
					searchCount: sql`${userMetricsDaily.searchCount} + 1`,
				},
			});
	}

	async getDailyMetrics(userId: string, days: number) {
		return this.db.query.userMetricsDaily.findMany({
			where: and(
				eq(userMetricsDaily.userId, userId),
				sql`${userMetricsDaily.date} >= date('now', '-' || ${days} || ' day')`,
			),
			orderBy: [userMetricsDaily.date],
		});
	}
}

export class AuditLogRepository {
	constructor(private db: Database) {}

	async create(data: {
		adminUserId: string;
		action: string;
		resource: string;
		details?: Record<string, unknown>;
	}) {
		const [entry] = await this.db.insert(auditLogs).values(data).returning();
		return entry!;
	}
}
