import type Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import type { MetricsRepository } from '../../src/repositories/settings.repository.js';
import { ProductAnalyticsService } from '../../src/services/product-analytics.service.js';

describe('ProductAnalyticsService', () => {
	it('deduplicates retried client events before updating daily aggregates', async () => {
		const seen = new Set<string>();
		const redis = {
			set: vi.fn(async (key: string) => {
				if (seen.has(key)) return null;
				seen.add(key);
				return 'OK';
			}),
			del: vi.fn(async () => 1),
		} as unknown as Redis;
		const metricsRepo = {
			incrementProductCounts: vi.fn(async () => undefined),
		} as unknown as MetricsRepository;
		const service = new ProductAnalyticsService(
			metricsRepo,
			redis,
			() => new Date('2026-08-12T12:00:00.000Z'),
		);
		const events = [
			{
				id: '4a207bd7-b703-43b3-93a5-d68a4a44c8a4',
				type: 'app_opened' as const,
				occurredOn: '2026-08-11',
			},
			{
				id: '7129b131-f481-4187-83ce-1665a372f7c6',
				type: 'offline_restore' as const,
				occurredOn: '2026-08-11',
			},
			{
				id: '3f2fa74a-371a-49bb-9759-05c5f74fb087',
				type: 'article_completed' as const,
				occurredOn: '2026-08-11',
			},
		];

		expect(await service.recordClientEvents('user-1', events)).toEqual({ accepted: 3 });
		expect(await service.recordClientEvents('user-1', events)).toEqual({ accepted: 0 });
		expect(metricsRepo.incrementProductCounts).toHaveBeenCalledOnce();
		expect(metricsRepo.incrementProductCounts).toHaveBeenCalledWith(
			'user-1',
			{
				offlineRestores: 1,
				articlesCompleted: 1,
			},
			'2026-08-11',
		);
	});

	it('releases idempotency markers when aggregate persistence fails', async () => {
		const redis = {
			set: vi.fn(async () => 'OK'),
			del: vi.fn(async () => 1),
		} as unknown as Redis;
		const metricsRepo = {
			incrementProductCounts: vi.fn(async () => {
				throw new Error('database unavailable');
			}),
		} as unknown as MetricsRepository;
		const service = new ProductAnalyticsService(
			metricsRepo,
			redis,
			() => new Date('2026-08-12T12:00:00.000Z'),
		);

		await expect(
			service.recordClientEvents('user-1', [
				{
					id: '4a207bd7-b703-43b3-93a5-d68a4a44c8a4',
					type: 'offline_restore',
					occurredOn: '2026-08-12',
				},
			]),
		).rejects.toThrow('database unavailable');
		expect(redis.del).toHaveBeenCalledWith(
			'analytics:event:user-1:4a207bd7-b703-43b3-93a5-d68a4a44c8a4',
		);
	});

	it('returns 30 daily buckets and rolling 7/30-day returning-user rates', async () => {
		const metricsRepo = {
			getProductMetricsSince: vi.fn(async () => [
				{
					userId: 'returning-user',
					date: '2026-07-10',
					articlesSavedCount: 1,
					offlineRestoresCount: 0,
					articlesCompletedCount: 0,
					feedFailuresCount: 0,
				},
				{
					userId: 'returning-user',
					date: '2026-08-08',
					articlesSavedCount: 2,
					offlineRestoresCount: 1,
					articlesCompletedCount: 3,
					feedFailuresCount: 1,
				},
				{
					userId: 'churned-user',
					date: '2026-08-01',
					articlesSavedCount: 1,
					offlineRestoresCount: 0,
					articlesCompletedCount: 1,
					feedFailuresCount: 0,
				},
				{
					userId: 'returning-user',
					date: '2026-08-03',
					articlesSavedCount: 0,
					offlineRestoresCount: 0,
					articlesCompletedCount: 0,
					feedFailuresCount: 0,
				},
			]),
		} as unknown as MetricsRepository;
		const service = new ProductAnalyticsService(
			metricsRepo,
			{} as Redis,
			() => new Date('2026-08-12T12:00:00.000Z'),
		);

		const report = await service.getReport();

		expect(report.daily).toHaveLength(30);
		expect(report.throughDate).toBe('2026-08-11');
		expect(report.daily.at(-1)?.date).toBe('2026-08-11');
		expect(report.totals).toEqual({
			activeUsers: 2,
			articlesSaved: 3,
			offlineRestores: 1,
			articlesCompleted: 4,
			feedFailures: 1,
		});
		expect(report.retention.sevenDay).toEqual({
			windowDays: 7,
			eligibleUsers: 2,
			returningUsers: 1,
			rate: 0.5,
		});
		expect(report.retention.thirtyDay).toEqual({
			windowDays: 30,
			eligibleUsers: 1,
			returningUsers: 1,
			rate: 1,
		});
	});
});
