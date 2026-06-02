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
		const feeds = await this.feedRepo.findAllByUser(userId);
		const feedIds = feeds.map((f) => f.id);
		const categories = await this.categoryRepo.findAllByUser(userId);
		const [totalArticles, totalRead] = await Promise.all([
			this.articleRepo.countByFeeds(feedIds),
			this.articleRepo.countReadByFeeds(userId, feedIds),
		]);
		const totalUnread = Math.max(0, totalArticles - totalRead);

		const recentSyncRuns = await this.syncRunRepo.findRecentByUser(userId, 10);
		const dailyMetrics = await this.metricsRepo.getDailyMetrics(userId, 30);

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
