import type { ArticleRepository } from '../repositories/article.repository.js';
import type { FeedSyncService } from '../services/feed-sync.service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger();

export function startSyncScheduler(
	syncService: FeedSyncService,
	intervalMs: number = 5 * 60 * 1000,
) {
	logger.info('Feed sync scheduler started', { intervalMs });
	let isRunning = false;

	const interval = setInterval(async () => {
		if (isRunning) {
			logger.warn('Skipping sync cycle because the previous one is still running');
			return;
		}
		isRunning = true;
		try {
			const result = await syncService.syncDueFeeds();
			if (result.total > 0) {
				logger.info('Sync cycle complete', result);
			}
		} catch (err) {
			logger.error('Sync scheduler error', {
				error: err instanceof Error ? err.message : String(err),
			});
		} finally {
			isRunning = false;
		}
	}, intervalMs);

	return () => clearInterval(interval);
}

export function startRetentionCleanup(
	articleRepo: ArticleRepository,
	retentionDays = 90,
	intervalMs: number = 24 * 60 * 60 * 1000,
) {
	logger.info('Retention cleanup scheduled', { retentionDays, intervalMs });
	let isRunning = false;

	const interval = setInterval(async () => {
		if (isRunning) {
			logger.warn('Skipping retention cleanup because the previous run is still active');
			return;
		}
		isRunning = true;
		try {
			const deleted = await articleRepo.deleteOlderThan(retentionDays);
			if (deleted > 0) {
				logger.info('Retention cleanup', { deleted, retentionDays });
			}
		} catch (err) {
			logger.error('Retention cleanup error', {
				error: err instanceof Error ? err.message : String(err),
			});
		} finally {
			isRunning = false;
		}
	}, intervalMs);

	return () => clearInterval(interval);
}
