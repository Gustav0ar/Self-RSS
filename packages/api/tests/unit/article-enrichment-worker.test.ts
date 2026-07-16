import { describe, expect, it, vi } from 'vitest';
import { FeedSyncService } from '../../src/services/feed-sync.service.js';

function pendingJob(attempts = 0) {
	return {
		articleId: 'article-1',
		userId: 'user-1',
		feedId: 'feed-1',
		canonicalUrl: 'https://example.com/article-1',
		contentHtml: '<p>Feed fallback</p>',
		heroImageUrl: null,
		fetchedAt: new Date('2026-01-01T00:00:00.000Z'),
		enrichmentQueuedAt: new Date('2026-01-01T00:00:00.000Z'),
		enrichmentAttempts: attempts,
		contentVersion: 1,
	};
}

function serviceFor(articleRepo: Record<string, unknown>) {
	return new FeedSyncService(
		{} as never,
		articleRepo as never,
		{} as never,
		{} as never,
		{} as never,
		{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 1, allowPrivateHosts: false },
	);
}

describe('durable article enrichment worker', () => {
	it('processes memory-intensive page extraction one article at a time', async () => {
		const jobs = Array.from({ length: 4 }, (_, index) => ({
			...pendingJob(),
			articleId: `article-${index + 1}`,
			canonicalUrl: `https://example.com/article-${index + 1}`,
		}));
		const articleRepo = {
			findPendingEnrichments: vi.fn(async () => jobs),
			markEnrichmentAttempt: vi.fn(async () => undefined),
			markEnrichmentRetry: vi.fn(async () => undefined),
		};
		const service = serviceFor(articleRepo);
		let active = 0;
		let maximumActive = 0;
		vi.spyOn(
			service as unknown as { enrichSingleArticle: () => Promise<boolean> },
			'enrichSingleArticle',
		).mockImplementation(async () => {
			active++;
			maximumActive = Math.max(maximumActive, active);
			await new Promise((resolve) => setTimeout(resolve, 1));
			active--;
			return true;
		});

		const result = await service.processPendingArticleEnrichments(4);

		expect(maximumActive).toBe(1);
		expect(result).toEqual({ processed: 4, succeeded: 4, failed: 0 });
	});

	it('claims due database work before enriching it', async () => {
		const articleRepo = {
			findPendingEnrichments: vi.fn(async () => [pendingJob()]),
			markEnrichmentAttempt: vi.fn(async () => undefined),
			markEnrichmentRetry: vi.fn(async () => undefined),
		};
		const service = serviceFor(articleRepo);
		vi.spyOn(
			service as unknown as { enrichSingleArticle: () => Promise<boolean> },
			'enrichSingleArticle',
		).mockResolvedValue(true);

		const result = await service.processPendingArticleEnrichments();

		expect(articleRepo.markEnrichmentAttempt).toHaveBeenCalledWith('article-1');
		expect(articleRepo.markEnrichmentRetry).not.toHaveBeenCalled();
		expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
	});

	it('persists retry state with backoff when canonical extraction fails', async () => {
		const articleRepo = {
			findPendingEnrichments: vi.fn(async () => [pendingJob(1)]),
			markEnrichmentAttempt: vi.fn(async () => undefined),
			markEnrichmentRetry: vi.fn(async () => undefined),
		};
		const service = serviceFor(articleRepo);
		vi.spyOn(
			service as unknown as { enrichSingleArticle: () => Promise<boolean> },
			'enrichSingleArticle',
		).mockRejectedValue(new Error('publisher unavailable'));

		const result = await service.processPendingArticleEnrichments();

		expect(articleRepo.markEnrichmentRetry).toHaveBeenCalledWith(
			'article-1',
			expect.objectContaining({
				failed: false,
				error: 'publisher unavailable',
				nextEnrichmentAt: expect.any(Date),
			}),
		);
		expect(result).toEqual({ processed: 1, succeeded: 0, failed: 1 });
	});

	it('invalidates and publishes the terminal failed content version', async () => {
		const articleRepo = {
			findPendingEnrichments: vi.fn(async () => [pendingJob(4)]),
			markEnrichmentAttempt: vi.fn(async () => undefined),
			markEnrichmentRetry: vi.fn(async () => ({ feedId: 'feed-1', contentVersion: 2 })),
		};
		const redis = { del: vi.fn(async () => 1) };
		const realtime = { publishEvent: vi.fn(async () => undefined) };
		const service = new FeedSyncService(
			{} as never,
			articleRepo as never,
			{} as never,
			{} as never,
			redis as never,
			{ timeoutMs: 5_000, maxContentLength: 1_000_000, concurrency: 1, allowPrivateHosts: false },
			undefined,
			realtime as never,
		);
		vi.spyOn(
			service as unknown as { enrichSingleArticle: () => Promise<boolean> },
			'enrichSingleArticle',
		).mockRejectedValue(new Error('publisher unavailable'));

		await service.processPendingArticleEnrichments();

		expect(redis.del).toHaveBeenCalled();
		expect(realtime.publishEvent).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({
				type: 'article.updated',
				contentStatus: 'failed',
				contentVersion: 2,
			}),
		);
	});
});
