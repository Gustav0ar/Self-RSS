import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startRetentionCleanup } from '../../src/jobs/scheduler.js';
import type { ArticleRepository } from '../../src/repositories/article.repository.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

describe('startRetentionCleanup', () => {
	let mockArticleRepo: Partial<ArticleRepository>;
	let clearIntervalSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		mockArticleRepo = {
			deleteOlderThan: vi.fn().mockResolvedValue(0),
		};
		vi.useFakeTimers();
		clearIntervalSpy = vi.spyOn(global, 'clearInterval');
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe('safety defaults', () => {
		it('DISABLED by default - no deletion occurs', async () => {
			const stop = startRetentionCleanup(mockArticleRepo as ArticleRepository);

			// Advance timers to trigger cleanup
			vi.advanceTimersByTime(24 * 60 * 60 * 1000);

			// Verify deleteOlderThan was NEVER called
			expect(mockArticleRepo.deleteOlderThan).not.toHaveBeenCalled();

			stop();
		});

		it('requires explicit RETENTION_DELETION_ENABLED=true to enable deletion', () => {
			const stop = startRetentionCleanup(mockArticleRepo as ArticleRepository, {
				retentionDays: 90,
				enabled: false, // Explicitly disabled (this is the default)
				dryRun: false,
			});

			vi.advanceTimersByTime(24 * 60 * 60 * 1000);

			// Should NOT have called delete
			expect(mockArticleRepo.deleteOlderThan).not.toHaveBeenCalled();

			stop();
		});

		it('requires explicit RETENTION_DELETION_ENABLED=true even with positive retentionDays', () => {
			const stop = startRetentionCleanup(mockArticleRepo as ArticleRepository, {
				retentionDays: 30,
				enabled: false,
				dryRun: false,
			});

			vi.advanceTimersByTime(24 * 60 * 60 * 1000);

			// Should NOT have called delete even with custom retentionDays
			expect(mockArticleRepo.deleteOlderThan).not.toHaveBeenCalled();

			stop();
		});
	});

	describe('deletion enabled', () => {
		it('calls deleteOlderThan when enabled is true', async () => {
			const stop = startRetentionCleanup(mockArticleRepo as ArticleRepository, {
				retentionDays: 60,
				enabled: true,
				dryRun: false,
			});

			vi.advanceTimersByTime(24 * 60 * 60 * 1000);

			expect(mockArticleRepo.deleteOlderThan).toHaveBeenCalledWith(60, false);

			stop();
		});

		it('respects custom retention days when enabled', async () => {
			const stop = startRetentionCleanup(mockArticleRepo as ArticleRepository, {
				retentionDays: 45,
				enabled: true,
				dryRun: false,
			});

			vi.advanceTimersByTime(24 * 60 * 60 * 1000);

			expect(mockArticleRepo.deleteOlderThan).toHaveBeenCalledWith(45, false);

			stop();
		});
	});

	describe('dry-run mode', () => {
		it('calls deleteOlderThan with dryRun=true in dry-run mode', async () => {
			const stop = startRetentionCleanup(mockArticleRepo as ArticleRepository, {
				retentionDays: 90,
				enabled: true,
				dryRun: true,
			});

			vi.advanceTimersByTime(24 * 60 * 60 * 1000);

			expect(mockArticleRepo.deleteOlderThan).toHaveBeenCalledWith(90, true);

			stop();
		});

		it('still performs database query even in dry-run to count candidates', async () => {
			(mockArticleRepo.deleteOlderThan as ReturnType<typeof vi.fn>).mockResolvedValue(5);

			const stop = startRetentionCleanup(mockArticleRepo as ArticleRepository, {
				retentionDays: 90,
				enabled: true,
				dryRun: true,
			});

			vi.advanceTimersByTime(24 * 60 * 60 * 1000);

			// dryRun=true means the actual DELETE was skipped, but query ran
			expect(mockArticleRepo.deleteOlderThan).toHaveBeenCalledWith(90, true);

			stop();
		});
	});

	describe('concurrent run prevention', () => {
		it('skips cleanup if previous run is still active', async () => {
			let resolveDelete: () => void;
			const deletePromise = new Promise<void>((resolve) => {
				resolveDelete = resolve;
			});

			(mockArticleRepo.deleteOlderThan as ReturnType<typeof vi.fn>).mockImplementation(async () => {
				await deletePromise;
				return 1;
			});

			const stop = startRetentionCleanup(mockArticleRepo as ArticleRepository, {
				retentionDays: 90,
				enabled: true,
				dryRun: false,
			});

			// First trigger
			vi.advanceTimersByTime(24 * 60 * 60 * 1000);

			// Second trigger while first is still running
			vi.advanceTimersByTime(24 * 60 * 60 * 1000);

			expect(mockArticleRepo.deleteOlderThan).toHaveBeenCalledTimes(1);

			resolveDelete!();
			stop();
		});
	});

	describe('interval behavior', () => {
		it('runs cleanup on the configured interval', async () => {
			const stop = startRetentionCleanup(mockArticleRepo as ArticleRepository, {
				retentionDays: 90,
				enabled: true,
				dryRun: false,
				intervalMs: 60 * 60 * 1000, // 1 hour
			});

			// Trigger first run
			await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
			expect(mockArticleRepo.deleteOlderThan).toHaveBeenCalledTimes(1);

			// Trigger second run (advance another hour)
			await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
			expect(mockArticleRepo.deleteOlderThan).toHaveBeenCalledTimes(2);

			stop();
		});
	});

	describe('legacy backward compatibility', () => {
		it('works with number argument (backward compatible)', async () => {
			const stop = startRetentionCleanup(mockArticleRepo as ArticleRepository, 30);

			vi.advanceTimersByTime(24 * 60 * 60 * 1000);

			// When called with a number, it should behave like the old API
			// The legacy behavior assumed intentional enabling
			expect(mockArticleRepo.deleteOlderThan).toHaveBeenCalledWith(30, false);

			stop();
		});
	});

	describe('cleanup function', () => {
		it('returns a function that stops the interval', () => {
			const stop = startRetentionCleanup(mockArticleRepo as ArticleRepository, {
				retentionDays: 90,
				enabled: true,
				dryRun: false,
			});

			stop();

			expect(clearIntervalSpy).toHaveBeenCalled();
		});
	});
});
