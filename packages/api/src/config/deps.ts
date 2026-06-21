import type Redis from 'ioredis';
import type { Database } from '../db/client.js';
import { ArticleRepository } from '../repositories/article.repository.js';
import { AuthSessionRepository } from '../repositories/auth-session.repository.js';
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
import { ArticleCacheService } from '../services/article-cache.service.js';
import { AuthService } from '../services/auth.service.js';
import { CategoryService } from '../services/category.service.js';
import { FeedService } from '../services/feed.service.js';
import { FeedSyncService } from '../services/feed-sync.service.js';
import { getMetricsService, type MetricsService } from '../services/metrics.service.js';
import { OpmlExportService } from '../services/opml-export.service.js';
import { OpmlImportService } from '../services/opml-import.service.js';
import { PreferencesService } from '../services/preferences.service.js';
import { RealtimeService } from '../services/realtime.service.js';
import { StatsService } from '../services/stats.service.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import type { TokenUtils } from '../utils/tokens.js';

export interface AppDeps {
	db: Database;
	redis: Redis;
	repos: {
		user: UserRepository;
		authSession: AuthSessionRepository;
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
		articleCache: ArticleCacheService;
		metrics: MetricsService;
		preferences: PreferencesService;
		realtime: RealtimeService;
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
		authSession: new AuthSessionRepository(db),
		category: new CategoryRepository(db),
		feed: new FeedRepository(db),
		article: new ArticleRepository(db),
		settings: new AppSettingsRepository(db),
		auditLog: new AuditLogRepository(db),
		syncRun: new SyncRunRepository(db),
		metrics: new MetricsRepository(db),
		preferences: new PreferencesRepository(db),
	};

	const resolvedSyncConfig = syncConfig ?? {
		timeoutMs: 30000,
		maxContentLength: 5242880,
		concurrency: 5,
		allowPrivateHosts: false,
	};

	// Build dependencies in topological order: caches first, then services that
	// depend on them. The final `services` object is assembled in one place so
	// every property is defined at construction time and the type system stays
	// honest.
	const metrics = getMetricsService();
	const articleCache = new ArticleCacheService(repos.article, repos.feed, redis, metrics);

	const realtime = new RealtimeService(redis, metrics);
	const feedSync = new FeedSyncService(
		repos.feed,
		repos.article,
		repos.syncRun,
		repos.metrics,
		redis,
		resolvedSyncConfig,
		articleCache,
	);
	const opmlImport = new OpmlImportService(repos.category, repos.feed, {
		allowPrivateHosts: resolvedSyncConfig.allowPrivateHosts,
	});

	const services: AppDeps['services'] = {
		auth: new AuthService(repos.user, repos.authSession, repos.settings, tokenUtils, redis),
		category: new CategoryService(repos.category, repos.feed, repos.article),
		feed: new FeedService(repos.feed, repos.category, repos.article, resolvedSyncConfig),
		opmlExport: new OpmlExportService(repos.category, repos.feed),
		opmlImport,
		preferences: new PreferencesService(repos.preferences),
		realtime,
		metrics,
		stats: new StatsService(
			repos.article,
			repos.feed,
			repos.category,
			repos.syncRun,
			repos.metrics,
		),
		articleCache,
		feedSync,
		article: new ArticleService(
			repos.article,
			repos.feed,
			repos.metrics,
			redis,
			feedSync,
			realtime,
			articleCache,
			repos.category,
			metrics,
		),
	};

	const rateLimiter = new RateLimiter(redis);

	return { db, redis, repos, services, rateLimiter };
}
