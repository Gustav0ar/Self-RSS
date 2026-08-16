import type {
	AppSettings,
	Article,
	ArticleContentStatus,
	ArticleMedia,
	Category,
	Feed,
	SyncRun,
	User,
	UserMetricsDaily,
	UserPreferences,
} from '../domain/types.js';

// Stable API response wrapper
export interface ApiResponse<T> {
	data: T;
}

export interface ApiListResponse<T> {
	data: T[];
	cursor: string | null;
	hasMore: boolean;
}

export interface ApiErrorResponse {
	error: {
		code: string;
		message: string;
		details?: unknown;
	};
}

// Auth
export interface AuthTokens {
	accessToken: string;
	refreshToken?: string;
	expiresIn?: number;
}

export interface LoginResponse {
	user: User;
	tokens: AuthTokens;
}

export interface RegisterResponse {
	user: User;
	tokens: AuthTokens;
}

export interface AuthSession {
	id: string;
	deviceName: string;
	clientId: string | null;
	ipAddress: string | null;
	userAgent: string | null;
	createdAt: string;
	lastSeenAt: string;
	current: boolean;
}

export interface AuthSessionsResponse {
	sessions: AuthSession[];
}

// Categories
export interface CategoryWithCounts extends Category {
	feedCount: number;
	unreadCount: number;
	feeds?: FeedWithCounts[];
	children?: CategoryWithCounts[];
}

export interface CategoryTreeResponse {
	categories: CategoryWithCounts[];
	totalUnread: number;
}

export interface ReorderCategoriesResponse {
	updatedCount: number;
}

// Feeds
export interface FeedWithCounts extends Feed {
	unreadCount: number;
}

export interface DurableFeedRefreshItemStatus {
	feedId: string | null;
	sourceId: string | null;
	jobId: string | null;
	status: string;
	feedTitle: string | null;
	errorCode: string | null;
	errorDetails: string | null;
	nextEligibleAt: string | null;
	publisherRequestStarted: boolean;
	lastFetchAt: string | null;
}

export interface DurableFeedRefreshStatus {
	requestId: string | null;
	status: 'pending' | 'running' | 'completed' | 'completed_with_errors';
	queued: boolean;
	running: boolean;
	active: boolean;
	stale: boolean;
	queuedAt: string | null;
	startedAt: string | null;
	heartbeatAt: string | null;
	totalFeeds: number;
	completedFeeds: number;
	syncedFeeds: number;
	failedFeeds: number;
	skippedFeeds: number;
	pendingFeeds: number;
	runningFeeds: number;
	deadFeeds: number;
	newArticles: number;
	articleRevision: number;
	jobId: string | null;
	scope: { feedId?: string; categoryId?: string };
	items: DurableFeedRefreshItemStatus[];
}

export interface OpmlImportWarning {
	code: string;
	message: string;
	feedUrl?: string;
	categoryPath?: string[];
}

export interface OpmlImportSummary {
	createdCategories: number;
	createdFeeds: number;
	skippedDuplicates: number;
	invalidEntries: number;
	warnings: OpmlImportWarning[];
}

// Articles
export interface ArticleListItem {
	id: string;
	feedId: string;
	feedTitle: string;
	feedFaviconUrl: string | null;
	canonicalUrl: string | null;
	title: string;
	author: string | null;
	excerpt: string | null;
	heroImageUrl: string | null;
	publishedAt: string | null;
	displayedAt: string;
	isRead: boolean;
	isSaved: boolean;
	contentStatus: ArticleContentStatus;
	contentVersion: number;
}

export interface ArticleDetail extends Article {
	feedTitle: string;
	feedFaviconUrl: string | null;
	feedSiteUrl: string | null;
	media: ArticleMedia[];
	isRead: boolean;
	isSaved: boolean;
	isEnriched: boolean;
}

export interface MarkAllReadResponse {
	markedCount: number;
	feedIds: string[];
}

export interface ArticleReadStateChangedEvent {
	type: 'article.read_state_changed';
	eventId: string;
	articleId: string;
	feedId: string;
	isRead: boolean;
	revision?: number;
	source: string;
	clientId: string | null;
	updatedAt: string;
}

export interface ArticleSavedStateChangedEvent {
	type: 'article.saved_state_changed';
	eventId: string;
	articleId: string;
	feedId: string;
	isSaved: boolean;
	revision?: number;
	clientId: string | null;
	updatedAt: string;
}

export interface ArticlesMarkedReadEvent {
	type: 'articles.marked_read';
	eventId: string;
	feedIds: string[];
	scope: {
		feedId?: string;
		categoryId?: string;
	};
	markedCount: number;
	clientId: string | null;
	updatedAt: string;
}

export interface ArticlesNewEvent {
	type: 'articles.new';
	eventId: string;
	feedId: string;
	articleIds: string[];
	count: number;
	updatedAt: string;
}

export interface ArticleUpdatedEvent {
	type: 'article.updated';
	eventId: string;
	articleId: string;
	feedId: string;
	contentStatus: ArticleContentStatus;
	contentVersion: number;
	updatedAt: string;
}

export interface FeedSyncScope {
	feedId?: string;
	categoryId?: string;
}

export interface FeedSyncProgressEvent {
	type: 'feed.sync.progress';
	eventId: string;
	jobId: string;
	phase: 'queued' | 'running' | 'completed' | 'failed';
	scope: FeedSyncScope;
	totalFeeds: number;
	completedFeeds: number;
	syncedFeeds: number;
	failedFeeds: number;
	skippedFeeds: number;
	newArticles: number;
	queuedAt: string | null;
	startedAt: string | null;
	error: string | null;
	updatedAt: string;
}

export interface FeedHealthUpdatedEvent {
	type: 'feed.health.updated';
	eventId: string;
	feedId: string;
	severity: 'healthy' | 'warning' | 'error';
	syncStatus: 'idle' | 'syncing' | 'error';
	lastSyncedAt: string | null;
	lastSyncError: string | null;
	lastSyncErrorAt: string | null;
	updatedAt: string;
}

export type RealtimeEvent =
	| ArticleReadStateChangedEvent
	| ArticleSavedStateChangedEvent
	| ArticlesMarkedReadEvent
	| ArticlesNewEvent
	| ArticleUpdatedEvent
	| FeedSyncProgressEvent
	| FeedHealthUpdatedEvent;

/** @deprecated Use RealtimeEvent. Kept for existing clients. */
export type ReadStateSyncEvent = RealtimeEvent;

// Stats
export interface StatsResponse {
	totalUnread: number;
	totalRead: number;
	totalFeeds: number;
	totalCategories: number;
	recentSyncRuns: SyncRun[];
	dailyMetrics: UserMetricsDaily[];
}

export interface RecordProductAnalyticsEventsResponse {
	accepted: number;
}

export interface ProductAnalyticsDaily {
	date: string;
	activeUsers: number;
	articlesSaved: number;
	offlineRestores: number;
	articlesCompleted: number;
	feedFailures: number;
}

export interface ProductRetentionMetric {
	windowDays: 7 | 30;
	eligibleUsers: number;
	returningUsers: number;
	rate: number | null;
}

export interface ProductAnalyticsReportResponse {
	periodDays: number;
	throughDate: string;
	totals: Omit<ProductAnalyticsDaily, 'date'>;
	daily: ProductAnalyticsDaily[];
	retention: {
		sevenDay: ProductRetentionMetric;
		thirtyDay: ProductRetentionMetric;
	};
}

export interface FeedSyncHistoryResponse {
	runs: SyncRun[];
	cursor: string | null;
	hasMore: boolean;
}

// Preferences
export type PreferencesResponse = UserPreferences;

// Admin
export type AppSettingsResponse = AppSettings;

export interface AdminUsersResponse {
	users: User[];
	cursor: string | null;
	hasMore: boolean;
}

export interface RegistrationStatusResponse {
	registrationEnabled: boolean;
}
