import type Redis from 'ioredis';
import type { Database } from '../db/client.js';
import { ArticleRepository } from '../repositories/article.repository.js';
import { CategoryRepository } from '../repositories/category.repository.js';
import { FeedRepository } from '../repositories/feed.repository.js';
import { PreferencesRepository } from '../repositories/preferences.repository.js';
import {
	AppSettingsRepository,
	AuditLogRepository,
	MetricsRepository,
	SyncRunRepository,
} from '../repositories/settings.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import { ArticleService } from '../services/article.service.js';
import { AuthService } from '../services/auth.service.js';
import { CategoryService } from '../services/category.service.js';
import { FeedService } from '../services/feed.service.js';
import { FeedSyncService } from '../services/feed-sync.service.js';
import { OpmlExportService } from '../services/opml-export.service.js';
import { OpmlImportService } from '../services/opml-import.service.js';
import { PreferencesService } from '../services/preferences.service.js';
import { StatsService } from '../services/stats.service.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import type { TokenUtils } from '../utils/tokens.js';

export interface AppDeps {
	db: Database;
	redis: Redis;
	repos: {
		user: UserRepository;
		category: CategoryRepository;
		feed: FeedRepository;
		article: ArticleRepository;
		settings: AppSettingsRepository;
		auditLog: AuditLogRepository;
		syncRun: SyncRunRepository;
		metrics: MetricsRepository;
		preferences: PreferencesRepository;
	};
	services: {
		auth: AuthService;
		category: CategoryService;
		feed: FeedService;
		feedSync: FeedSyncService;
		opmlExport: OpmlExportService;
		opmlImport: OpmlImportService;
		article: ArticleService;
		preferences: PreferencesService;
		stats: StatsService;
	};
	rateLimiter: RateLimiter;
}

export function createDeps(
	db: Database,
	redis: Redis,
	tokenUtils: TokenUtils,
	syncConfig?: {
		timeoutMs: number;
		maxContentLength: number;
		concurrency: number;
		allowPrivateHosts: boolean;
	},
): AppDeps {
	const repos = {
		user: new UserRepository(db),
		category: new CategoryRepository(db),
		feed: new FeedRepository(db),
		article: new ArticleRepository(db),
		settings: new AppSettingsRepository(db),
		auditLog: new AuditLogRepository(db),
		syncRun: new SyncRunRepository(db),
		metrics: new MetricsRepository(db),
		preferences: new PreferencesRepository(db),
	};

	const services = {
		auth: new AuthService(repos.user, repos.settings, tokenUtils, redis),
		category: new CategoryService(repos.category, repos.feed, repos.article),
		feed: new FeedService(
			repos.feed,
			repos.category,
			repos.article,
			syncConfig ?? {
				timeoutMs: 30000,
				maxContentLength: 5242880,
				concurrency: 5,
				allowPrivateHosts: false,
			},
		),
		feedSync: new FeedSyncService(
			repos.feed,
			repos.article,
			repos.syncRun,
			repos.metrics,
			redis,
			syncConfig ?? {
				timeoutMs: 30000,
				maxContentLength: 5242880,
				concurrency: 5,
				allowPrivateHosts: false,
			},
		),
		opmlExport: new OpmlExportService(repos.category, repos.feed),
		opmlImport: null as unknown as OpmlImportService,
		article: null as unknown as ArticleService,
		preferences: new PreferencesService(repos.preferences),
		stats: new StatsService(
			repos.article,
			repos.feed,
			repos.category,
			repos.syncRun,
			repos.metrics,
		),
	};

	services.opmlImport = new OpmlImportService(repos.category, repos.feed, services.feed);
	services.article = new ArticleService(
		repos.article,
		repos.feed,
		repos.metrics,
		redis,
		services.feedSync,
	);

	const rateLimiter = new RateLimiter(redis);

	return { db, redis, repos, services, rateLimiter };
}
