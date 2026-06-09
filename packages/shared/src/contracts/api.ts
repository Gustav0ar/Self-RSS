import type {
	AppSettings,
	Article,
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
	refreshToken: string;
	expiresIn: number;
}

export interface LoginResponse {
	user: User;
	tokens: AuthTokens;
}

export interface RegisterResponse {
	user: User;
	tokens: AuthTokens;
}

// Categories
export interface CategoryWithCounts extends Category {
	feedCount: number;
	unreadCount: number;
	children?: CategoryWithCounts[];
}

export type CategoryTreeResponse = CategoryWithCounts[];

// Feeds
export interface FeedWithCounts extends Feed {
	unreadCount: number;
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
	title: string;
	author: string | null;
	excerpt: string | null;
	heroImageUrl: string | null;
	publishedAt: string | null;
	displayedAt: string;
	isRead: boolean;
}

export interface ArticleDetail extends Article {
	feedTitle: string;
	feedFaviconUrl: string | null;
	feedSiteUrl: string | null;
	media: ArticleMedia[];
	isRead: boolean;
	isEnriched: boolean;
}

export interface ArticleReadStateChangedEvent {
	type: 'article.read_state_changed';
	eventId: string;
	articleId: string;
	feedId: string;
	isRead: boolean;
	source: string;
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

export type ReadStateSyncEvent = ArticleReadStateChangedEvent | ArticlesMarkedReadEvent;

// Stats
export interface StatsResponse {
	totalUnread: number;
	totalRead: number;
	totalFeeds: number;
	totalCategories: number;
	recentSyncRuns: SyncRun[];
	dailyMetrics: UserMetricsDaily[];
}

// Preferences
export type PreferencesResponse = UserPreferences;

// Admin
export type AppSettingsResponse = AppSettings;

export interface RegistrationStatusResponse {
	registrationEnabled: boolean;
}
