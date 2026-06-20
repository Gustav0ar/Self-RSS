import type { ArticleRepository } from '../repositories/article.repository.js';
import type { CategoryRepository } from '../repositories/category.repository.js';
import type { FeedRepository } from '../repositories/feed.repository.js';
import type { MetricsRepository, SyncRunRepository } from '../repositories/settings.repository.js';

export class StatsService {
	constructor(
		private articleRepo: ArticleRepository,
		private feedRepo: FeedRepository,
		private categoryRepo: CategoryRepository,
		private syncRunRepo: SyncRunRepository,
		private metricsRepo: MetricsRepository,
	) {}

	async getStats(userId: string) {
		const [feeds, categories, totalArticles, totalRead, recentSyncRuns, dailyMetrics] =
			await Promise.all([
				this.feedRepo.findAllByUser(userId),
				this.categoryRepo.findAllByUser(userId),
				this.articleRepo.countByScope({ userId }),
				this.articleRepo.countReadByScope({ userId }),
				this.syncRunRepo.findRecentByUser(userId, 10),
				this.metricsRepo.getDailyMetrics(userId, 30),
			]);
		const totalUnread = Math.max(0, totalArticles - totalRead);

		return {
			totalUnread,
			totalRead,
			totalFeeds: feeds.length,
			totalCategories: categories.length,
			recentSyncRuns,
			dailyMetrics,
		};
	}
}
