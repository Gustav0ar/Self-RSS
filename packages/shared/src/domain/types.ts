import type {
	AutoMarkReadMode,
	DisplayDensity,
	MediaProvider,
	MediaType,
	ReadSource,
	SortOrder,
	SyncRunStatus,
	SyncStatus,
	Theme,
	UserRole,
} from './enums.js';

export interface User {
	id: string;
	email: string;
	role: UserRole;
	isActive: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface UserPreferences {
	userId: string;
	theme: Theme;
	fontFamily: string;
	textSize: number;
	density: DisplayDensity;
	defaultSort: SortOrder;
	hideRead: boolean;
	keyboardShortcutsEnabled: boolean;
	autoMarkReadMode: AutoMarkReadMode;
	createdAt: string;
	updatedAt: string;
}

export interface Category {
	id: string;
	userId: string;
	parentCategoryId: string | null;
	name: string;
	slug: string;
	sortOrder: number;
	createdAt: string;
	updatedAt: string;
}

export interface Feed {
	id: string;
	userId: string;
	categoryId: string;
	title: string;
	siteUrl: string | null;
	feedUrl: string;
	faviconUrl: string | null;
	description: string | null;
	pollingIntervalMinutes: number;
	lastSyncedAt: string | null;
	syncStatus: SyncStatus;
	createdAt: string;
	updatedAt: string;
}

export interface Article {
	id: string;
	feedId: string;
	guid: string;
	canonicalUrl: string | null;
	title: string;
	author: string | null;
	excerpt: string | null;
	contentHtml: string | null;
	contentText: string | null;
	heroImageUrl: string | null;
	publishedAt: string | null;
	fetchedAt: string;
	hash: string;
}

export interface ArticleMedia {
	id: string;
	articleId: string;
	type: MediaType;
	provider: MediaProvider;
	url: string;
	embedUrl: string | null;
	width: number | null;
	height: number | null;
	position: number;
}

export interface ArticleRead {
	userId: string;
	articleId: string;
	readAt: string;
	source: ReadSource;
}

export interface SyncRun {
	id: string;
	feedId: string;
	startedAt: string;
	finishedAt: string | null;
	status: SyncRunStatus;
	httpStatus: number | null;
	itemCount: number;
	errorMessage: string | null;
}

export interface UserMetricsDaily {
	userId: string;
	date: string;
	articlesReadCount: number;
	feedsSyncedCount: number;
	searchCount: number;
}

export interface AppSettings {
	registrationLocked: boolean;
}
