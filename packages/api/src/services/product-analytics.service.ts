import type {
	ProductAnalyticsDaily,
	ProductAnalyticsEvent,
	ProductAnalyticsReportResponse,
	ProductRetentionMetric,
} from '@self-feed/shared';
import type Redis from 'ioredis';
import { CacheKeys } from '../db/redis.js';
import type { MetricsRepository } from '../repositories/settings.repository.js';

const EVENT_DEDUP_TTL_SECONDS = 8 * 24 * 60 * 60;
const REPORT_PERIOD_DAYS = 30;

function utcDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function daysBefore(date: Date, days: number): Date {
	return new Date(date.getTime() - days * 24 * 60 * 60 * 1_000);
}

function retention(
	rows: Awaited<ReturnType<MetricsRepository['getProductMetricsSince']>>,
	today: Date,
	windowDays: 7 | 30,
): ProductRetentionMetric {
	const currentStart = utcDate(daysBefore(today, windowDays - 1));
	const previousStart = utcDate(daysBefore(today, windowDays * 2 - 1));
	const previousEnd = utcDate(daysBefore(today, windowDays));
	const eligible = new Set<string>();
	const current = new Set<string>();

	for (const row of rows) {
		if (row.date >= previousStart && row.date <= previousEnd) eligible.add(row.userId);
		if (row.date >= currentStart) current.add(row.userId);
	}

	let returningUsers = 0;
	for (const userId of eligible) {
		if (current.has(userId)) returningUsers += 1;
	}

	return {
		windowDays,
		eligibleUsers: eligible.size,
		returningUsers,
		rate: eligible.size === 0 ? null : returningUsers / eligible.size,
	};
}

export class ProductAnalyticsService {
	constructor(
		private metricsRepo: MetricsRepository,
		private redis: Redis,
		private now: () => Date = () => new Date(),
	) {}

	async recordClientEvents(userId: string, events: ProductAnalyticsEvent[]) {
		const currentTime = this.now();
		const today = utcDate(currentTime);
		const earliestDate = utcDate(daysBefore(currentTime, REPORT_PERIOD_DAYS * 2));
		const groups = new Map<
			string,
			{
				keys: string[];
				counts: { offlineRestores: number; articlesCompleted: number };
			}
		>();

		for (const event of events) {
			if (event.occurredOn < earliestDate || event.occurredOn > today) continue;
			const key = CacheKeys.productAnalyticsEvent(userId, event.id);
			const accepted = await this.redis.set(key, '1', 'EX', EVENT_DEDUP_TTL_SECONDS, 'NX');
			if (accepted !== 'OK') continue;
			const group = groups.get(event.occurredOn) ?? {
				keys: [],
				counts: { offlineRestores: 0, articlesCompleted: 0 },
			};
			group.keys.push(key);
			if (event.type === 'offline_restore') group.counts.offlineRestores += 1;
			if (event.type === 'article_completed') group.counts.articlesCompleted += 1;
			groups.set(event.occurredOn, group);
		}

		const datedGroups = [...groups.entries()];
		if (datedGroups.length === 0) return { accepted: 0 };

		for (const [index, [date, group]] of datedGroups.entries()) {
			try {
				await this.metricsRepo.incrementProductCounts(userId, group.counts, date);
			} catch (error) {
				const unpersistedKeys = datedGroups.slice(index).flatMap(([, entry]) => entry.keys);
				await this.redis.del(...unpersistedKeys).catch(() => undefined);
				throw error;
			}
		}

		return { accepted: datedGroups.reduce((sum, [, group]) => sum + group.keys.length, 0) };
	}

	async getReport(): Promise<ProductAnalyticsReportResponse> {
		const reportEnd = daysBefore(this.now(), 1);
		const earliestDate = utcDate(daysBefore(reportEnd, REPORT_PERIOD_DAYS * 2 - 1));
		const reportStart = utcDate(daysBefore(reportEnd, REPORT_PERIOD_DAYS - 1));
		const rows = await this.metricsRepo.getProductMetricsSince(earliestDate);
		const dailyByDate = new Map<string, ProductAnalyticsDaily & { activeUserIds: Set<string> }>();

		for (let offset = REPORT_PERIOD_DAYS - 1; offset >= 0; offset -= 1) {
			const date = utcDate(daysBefore(reportEnd, offset));
			dailyByDate.set(date, {
				date,
				activeUsers: 0,
				articlesSaved: 0,
				offlineRestores: 0,
				articlesCompleted: 0,
				feedFailures: 0,
				activeUserIds: new Set(),
			});
		}

		for (const row of rows) {
			if (row.date < reportStart) continue;
			const daily = dailyByDate.get(row.date);
			if (!daily) continue;
			daily.activeUserIds.add(row.userId);
			daily.articlesSaved += row.articlesSavedCount;
			daily.offlineRestores += row.offlineRestoresCount;
			daily.articlesCompleted += row.articlesCompletedCount;
			daily.feedFailures += row.feedFailuresCount;
		}

		const activeUserIds = new Set<string>();
		for (const row of rows) {
			if (row.date >= reportStart) activeUserIds.add(row.userId);
		}

		const daily = [...dailyByDate.values()].map(({ activeUserIds: ids, ...entry }) => ({
			...entry,
			activeUsers: ids.size,
		}));
		const totals = daily.reduce<Omit<ProductAnalyticsDaily, 'date'>>(
			(sum, entry) => ({
				activeUsers: activeUserIds.size,
				articlesSaved: sum.articlesSaved + entry.articlesSaved,
				offlineRestores: sum.offlineRestores + entry.offlineRestores,
				articlesCompleted: sum.articlesCompleted + entry.articlesCompleted,
				feedFailures: sum.feedFailures + entry.feedFailures,
			}),
			{
				activeUsers: activeUserIds.size,
				articlesSaved: 0,
				offlineRestores: 0,
				articlesCompleted: 0,
				feedFailures: 0,
			},
		);

		return {
			periodDays: REPORT_PERIOD_DAYS,
			throughDate: utcDate(reportEnd),
			totals,
			daily,
			retention: {
				sevenDay: retention(rows, reportEnd, 7),
				thirtyDay: retention(rows, reportEnd, 30),
			},
		};
	}
}
