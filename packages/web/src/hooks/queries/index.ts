// Main entry point for hooks - re-exports everything from modular files
// This maintains backward compatibility with existing imports from './queries'

// Re-export search from search-queries
export { useSearch } from '../search-queries';
export {
	useAdminSettings,
	useAdminUsers,
	useCreateAdminUser,
	useResetAdminPassword,
	useUpdateAdminSettings,
	useUpdateAdminUser,
} from './admin-hooks';
// Re-export article hooks
export {
	useArticle,
	useArticles,
	useEnrichArticle,
	useInfiniteArticles,
	useMarkAllRead,
	useMarkRead,
	usePrefetchArticle,
	useWarmNextArticles,
	useWarmVisibleArticles,
} from './article-hooks';
// Re-export cache utilities
export {
	type ArticleQueryParams,
	applyArticleReadState,
	applyReadStateSyncEvent,
	applyStatsDelta,
	applyUnreadCountDelta,
	articleQueryKey,
	articleSnapshotFromCachedQuery,
	buildArticleSearchParams,
	cachedUnreadCountForFeed,
	type FeedSyncAllStatus,
	findActiveQueryKey,
	findCachedArticleSnapshot,
	findCachedFeed,
	invalidateReaderQueries,
	isCategoryWithCounts,
	isFeedWithCounts,
	isUnreadOnlyArticlesQuery,
	setFeedUnreadCount,
	updateArticleListResponseReadState,
	updateArticleQueries,
	updateArticleReadStateInCachedQuery,
	updateCategoryTreeFeedUnreadCount,
	updateCategoryUnreadCount,
	updateFeedArticlesReadStateInCachedQuery,
	updateFeedUnreadCount,
	updateOpenArticleByFeed,
} from './cache-utils';
// Re-export category hooks
export {
	useCategories,
	useCreateCategory,
	useDeleteCategory,
	useReorderCategories,
	useUpdateCategory,
} from './category-hooks';
// Re-export feed hooks
export {
	useCancelFeedReplacement,
	useCreateFeed,
	useDeleteFeed,
	useExportOpml,
	useFeedSyncHistory,
	useFeeds,
	useImportOpml,
	useQueryClient,
	useSelectFeedDiscoveryCandidate,
	useSyncAllFeeds,
	useSyncAllFeedsStatus,
	useSyncFeed,
	useUpdateFeed,
} from './feed-hooks';
// Re-export preferences hooks
export {
	type AuthSession,
	type Preferences,
	useAuthSessions,
	usePreferences,
	useRevokeAuthSession,
	useUpdatePreferences,
} from './preferences-hooks';
// Re-export stats hooks
export { type Stats, useStats } from './stats-hooks';
