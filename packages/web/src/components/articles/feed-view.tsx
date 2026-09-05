import type { SortOrder } from '@self-feed/shared';
import { Filter, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArticleList } from '@/components/articles/article-list';
import { ExternalShortcutStatus } from '@/components/articles/external-shortcut-status';
import { FeedHealthBanner } from '@/components/articles/feed-health-banner';
import { FeedListHeader } from '@/components/articles/feed-list-header';
import { FeedListToolbar } from '@/components/articles/feed-list-toolbar';
import { FeedQueryState } from '@/components/articles/feed-query-state';
import { FeedRefreshStatusBanner } from '@/components/articles/feed-refresh-status-banner';
import { FeedToolbarButton as ToolbarButton } from '@/components/articles/feed-toolbar-button';
import {
	buildFeedViewModel,
	dedupeArticlePages,
	resolveEffectiveArticleId,
} from '@/components/articles/feed-view-model';
import { MarkAllReadDialog } from '@/components/articles/mark-all-read-dialog';
import { ReaderPane } from '@/components/articles/reader-pane';
import { useRetainedReadArticles } from '@/components/articles/use-retained-read-articles';
import {
	useCategories,
	useInfiniteArticles,
	useMarkRead,
	usePreferences,
	usePrefetchArticle,
	useSearch,
	useSetArticleSaved,
	useUpdatePreferences,
	useWarmNextArticles,
	useWarmVisibleArticles,
} from '@/hooks/queries';
import { useFeedLifecycleActions } from '@/hooks/use-feed-lifecycle-actions';
import { useFeedRefresh } from '@/hooks/use-feed-refresh';
import { useKeyboardNav } from '@/hooks/use-keyboard-nav';
import { useSilentArticleRefresh } from '@/hooks/use-silent-article-refresh';
import {
	normalizeAutoMarkReadPreference,
	normalizeDensityPreference,
	normalizeSortPreference,
} from '@/lib/preferences';
import { useAppState } from '@/providers/app-state';
import { useAuth } from '@/providers/auth';

interface FeedViewProps {
	feedId?: string;
	categoryId?: string;
	savedOnly?: boolean;
	selectedArticleId: string | null;
	fromDeepLink?: boolean;
	searchQuery?: string;
	searchScope?: 'all' | 'category';
	onSelectArticle: (id: string | null) => void;
}
const EMPTY_CATEGORY_TREE = [] as const;
export function FeedView({
	feedId,
	categoryId,
	savedOnly = false,
	selectedArticleId,
	fromDeepLink = false,
	searchQuery = '',
	searchScope = 'all',
	onSelectArticle,
}: FeedViewProps) {
	const [unreadOnlyOverride, setUnreadOnly] = useState<boolean | null>(null);
	const [sortOverride, setSort] = useState<SortOrder | null>(null);
	const [markAllDialogOpen, setMarkAllDialogOpen] = useState(false);
	const [externalShortcutStatus, setExternalShortcutStatus] = useState<string | null>(null);
	const preferencesQuery = usePreferences();
	const { data: prefs } = preferencesQuery;
	const preferencesReady = prefs != null;
	const unreadOnly = unreadOnlyOverride ?? prefs?.hideRead ?? false;
	const sort = sortOverride ?? normalizeSortPreference(prefs?.defaultSort);
	const updatePrefs = useUpdatePreferences();
	const setArticleSaved = useSetArticleSaved();
	const { isOffline } = useAuth();
	const { feedSyncError } = useAppState();
	const {
		allFeedsRefreshActivity,
		allFeedsSyncStatus,
		isRefreshingAllFeeds,
		isRefreshingFeed,
		isRefreshBlockedByActiveRequest,
		refreshFeed,
	} = useFeedRefresh();
	const isSyncingSelectedFeed = isRefreshingFeed(feedId);
	const isRefreshingCurrentSelection = feedId ? isSyncingSelectedFeed : isRefreshingAllFeeds;
	const prefetchArticle = usePrefetchArticle();
	const warmNextArticles = useWarmNextArticles();
	const warmVisibleArticles = useWarmVisibleArticles();
	const categoriesQuery = useCategories();
	const { data: categories } = categoriesQuery;

	const articlesQuery = useInfiniteArticles(
		{
			feedId,
			categoryId,
			unreadOnly,
			savedOnly,
			sort,
			limit: 30,
		},
		{ enabled: preferencesReady },
	);
	const { data, isFetching, isFetchingNextPage, isLoading, fetchNextPage, hasNextPage } =
		articlesQuery;
	const { data: searchData } = useSearch(
		searchQuery,
		searchScope === 'category' ? categoryId : undefined,
	);

	useSilentArticleRefresh(
		{ feedId, categoryId, unreadOnly, savedOnly, sort, limit: 30 },
		{ enabled: preferencesReady },
	);

	const markRead = useMarkRead();
	const markReadMutate = markRead.mutate;
	const fetchedArticles = useMemo(() => dedupeArticlePages(data?.pages), [data?.pages]);
	const categoryTree = categories ?? EMPTY_CATEGORY_TREE;
	const { emptyState, scopeUnreadCount, selectedFeed, selectedFeedHealth, viewTitle } = useMemo(
		() => buildFeedViewModel({ categoryId, categoryTree, feedId, unreadOnly }),
		[categoryId, categoryTree, feedId, unreadOnly],
	);
	const displayedTitle = savedOnly ? 'Saved' : viewTitle;
	const displayedEmptyState = savedOnly
		? {
				title: 'No saved articles yet',
				description: 'Save articles from the list or reader to keep them here.',
			}
		: emptyState;
	const {
		error: lifecycleActionError,
		lifecycle: selectedLifecycle,
		isPending: lifecycleActionPending,
		handleSelectCandidate,
		handleCancelReplacement,
	} = useFeedLifecycleActions(selectedFeed);
	const refreshBlocked = selectedLifecycle?.refreshBlocked ?? false;
	const refreshActionBlocked =
		refreshBlocked || (isRefreshBlockedByActiveRequest?.(feedId, categoryId) ?? false);
	const { articles, resetRetainedReadArticles, retainReadArticle } = useRetainedReadArticles({
		categoryId,
		feedId,
		fetchedArticles,
		sort,
		unreadOnly,
	});
	const searchArticles = useMemo(
		() => searchData?.pages.flatMap((page) => page.data) ?? [],
		[searchData?.pages],
	);
	const readingQueue =
		searchQuery.trim().length >= 2 && searchArticles.length > 0 ? searchArticles : articles;
	const articleIds = useMemo(() => readingQueue.map((a) => a.id), [readingQueue]);
	const listArticleIds = useMemo(() => articles.map((a) => a.id), [articles]);
	// Keep deep-linked article ids while their surrounding list resolves.
	const articleIdsSet = useMemo(() => new Set(listArticleIds), [listArticleIds]);
	const articleIsInLoadedList = selectedArticleId ? articleIdsSet.has(selectedArticleId) : false;
	// On a deep link (`/articles/:id`) we must keep the article id even
	// when the surrounding list is empty or hasn't loaded it yet. In the
	// list-view case (`/`) the absence from the loaded list is what
	// triggers the effect below to clear the selection.
	const effectiveArticleId = resolveEffectiveArticleId({
		articleIds: articleIdsSet,
		fromDeepLink,
		selectedArticleId,
	});
	const loadedUnreadCount = articles.reduce(
		(count, article) => count + (article.isRead ? 0 : 1),
		0,
	);
	const density = normalizeDensityPreference(prefs?.density);
	const keyboardShortcutsEnabled = prefs?.keyboardShortcutsEnabled ?? true;
	const autoMarkReadMode = normalizeAutoMarkReadPreference(prefs?.autoMarkReadMode);
	const handleLoadMore = useCallback(() => {
		void fetchNextPage();
	}, [fetchNextPage]);
	const handleToggleSaved = useCallback(
		(articleId: string, saved: boolean) => {
			setArticleSaved.mutate({ articleId, saved });
		},
		[setArticleSaved],
	);

	useEffect(() => {
		if (!feedId || isLoading || isRefreshingCurrentSelection || feedSyncError) {
			return;
		}

		void refreshFeed(feedId);
	}, [feedId, feedSyncError, isLoading, isRefreshingCurrentSelection, refreshFeed]);

	// Clear a list selection when its article leaves the loaded list.
	// Deep links stay open even when their article is outside that list.
	// Wait for loading to finish before changing the URL.
	useEffect(() => {
		if (isLoading) return;
		if (fromDeepLink) return;
		if (!selectedArticleId) return;
		if (articleIsInLoadedList) return;
		// Either the list is empty or the article isn't in it. Drop
		// the user back to the list view at the current scope.
		onSelectArticle(null);
	}, [articleIsInLoadedList, fromDeepLink, isLoading, onSelectArticle, selectedArticleId]);

	useEffect(() => {
		if (articleIds.length === 0) {
			return;
		}

		const selectedIndex = selectedArticleId ? articleIds.indexOf(selectedArticleId) : -1;
		const idsToWarm =
			selectedIndex >= 0
				? articleIds.slice(selectedIndex + 1, selectedIndex + 6)
				: articleIds.slice(0, 5);
		warmNextArticles(idsToWarm);
	}, [articleIds, selectedArticleId, warmNextArticles]);

	useEffect(() => {
		if (!unreadOnly || !selectedArticleId) {
			return;
		}

		const selectedIndex = fetchedArticles.findIndex((article) => article.id === selectedArticleId);
		const selectedArticle = selectedIndex >= 0 ? fetchedArticles[selectedIndex] : null;
		if (selectedArticle?.isRead) {
			retainReadArticle(selectedArticle, selectedIndex);
		}
	}, [fetchedArticles, retainReadArticle, selectedArticleId, unreadOnly]);

	const handleSelectArticle = useCallback(
		(id: string) => {
			if (autoMarkReadMode === 'on_navigate' && selectedArticleId !== id) {
				const nextArticleIndex = readingQueue.findIndex((article) => article.id === id);
				const nextArticle = nextArticleIndex >= 0 ? readingQueue[nextArticleIndex] : null;
				if (nextArticle && !nextArticle.isRead) {
					retainReadArticle(nextArticle, nextArticleIndex);
					markReadMutate({ articleId: nextArticle.id, read: true });
				}
			}

			onSelectArticle(id);
		},
		[
			autoMarkReadMode,
			selectedArticleId,
			readingQueue,
			retainReadArticle,
			markReadMutate,
			onSelectArticle,
		],
	);

	useKeyboardNav({
		articleIds,
		selectedId: effectiveArticleId,
		onSelect: handleSelectArticle,
		onToggleRead: (id) => {
			const article = readingQueue.find((a) => a.id === id);
			if (article) {
				markReadMutate({ articleId: id, read: !article.isRead });
			}
		},
		onOpenExternal: (id) => {
			const article = readingQueue.find((a) => a.id === id);
			if (article?.canonicalUrl) {
				const target = URL.parse(article.canonicalUrl);
				if (target && (target.protocol === 'https:' || target.protocol === 'http:')) {
					window.open(target.href, '_blank', 'noopener,noreferrer');
					return;
				}
			}
			setExternalShortcutStatus('The original publisher link is unavailable for this article.');
		},
		onRefresh: () => {
			if (!isRefreshingCurrentSelection) {
				handleRefresh();
			}
		},
		enabled: keyboardShortcutsEnabled,
	});

	function handleMarkAllRead() {
		setMarkAllDialogOpen(true);
	}

	function handleRefresh() {
		if (refreshActionBlocked) return;
		resetRetainedReadArticles();
		if (feedId) {
			void refreshFeed(feedId, { force: true });
		} else {
			void refreshFeed(undefined, { force: true, categoryId });
		}
	}

	const showListLoader =
		isLoading ||
		(isFetching && articles.length === 0) ||
		(isRefreshingCurrentSelection && articles.length === 0);
	const unreadBadgeCount = savedOnly
		? loadedUnreadCount
		: Math.max(scopeUnreadCount, loadedUnreadCount);

	function handleUnreadOnlyToggle() {
		const nextUnreadOnly = !unreadOnly;
		resetRetainedReadArticles();
		setUnreadOnly(nextUnreadOnly);
		updatePrefs.mutate({ hideRead: nextUnreadOnly });
	}

	function handleSortToggle() {
		const nextSort: SortOrder = sort === 'latest' ? 'oldest' : 'latest';
		setSort(nextSort);
		updatePrefs.mutate({ defaultSort: nextSort });
	}

	return (
		<div
			data-article-selected={Boolean(effectiveArticleId)}
			className="reading-layout flex h-full min-h-0 flex-col lg:flex-row"
		>
			<div className="article-list-pane flex min-h-0 w-full shrink-0 flex-col border-b border-border/70 lg:w-[clamp(23rem,28vw,33rem)] lg:border-b-0 lg:border-r">
				<FeedHealthBanner
					appError={lifecycleActionError ?? feedSyncError}
					sourceIssue={selectedFeedHealth}
					feed={selectedFeed}
					onSelectCandidate={(candidateId) => void handleSelectCandidate(candidateId)}
					onCancelReplacement={() => void handleCancelReplacement()}
					isActionPending={lifecycleActionPending}
				/>
				<ExternalShortcutStatus message={externalShortcutStatus} />
				<div className="panel-divider sticky top-0 z-20 bg-card/95 px-3 pb-2.5 pt-3 backdrop-blur-xl">
					<FeedListHeader
						title={displayedTitle}
						loadedCount={articles.length}
						unreadCount={unreadBadgeCount}
					/>

					<FeedListToolbar
						unreadOnly={unreadOnly}
						savedOnly={savedOnly}
						sort={sort}
						refreshBlocked={refreshBlocked}
						refreshing={isRefreshingCurrentSelection}
						refreshActionBlocked={refreshActionBlocked}
						markAllReadBlocked={isOffline}
						refreshGuidance={selectedLifecycle?.refreshGuidance ?? undefined}
						onUnreadToggle={handleUnreadOnlyToggle}
						onSortToggle={handleSortToggle}
						onMarkAllRead={handleMarkAllRead}
						onRefresh={handleRefresh}
					/>

					<FeedRefreshStatusBanner
						feedId={feedId}
						allFeedsRefreshActivity={allFeedsRefreshActivity}
						allFeedsSyncStatus={allFeedsSyncStatus}
						isRefreshingCurrentSelection={isRefreshingCurrentSelection}
					/>
				</div>

				<FeedQueryState
					categories={categoriesQuery}
					preferences={preferencesQuery}
					articles={articlesQuery}
				>
					<ArticleList
						articles={articles}
						selectedId={effectiveArticleId}
						onSelect={handleSelectArticle}
						onToggleSaved={handleToggleSaved}
						savedActionsDisabled={false}
						onPrefetch={prefetchArticle}
						onVisible={warmVisibleArticles}
						loading={showListLoader}
						hasMore={hasNextPage}
						onLoadMore={handleLoadMore}
						loadingMore={isFetchingNextPage}
						density={density}
						emptyTitle={displayedEmptyState.title}
						emptyDescription={displayedEmptyState.description}
						emptyAction={
							savedOnly ? null : unreadOnly ? (
								<ToolbarButton onClick={handleUnreadOnlyToggle} label="Show all articles">
									<Filter className="h-3.5 w-3.5" />
								</ToolbarButton>
							) : (
								<ToolbarButton
									onClick={handleRefresh}
									label="Refresh articles"
									disabled={isRefreshingCurrentSelection || refreshActionBlocked}
									title={selectedLifecycle?.refreshGuidance ?? undefined}
								>
									<RefreshCw className="h-3.5 w-3.5" />
								</ToolbarButton>
							)
						}
					/>
				</FeedQueryState>
			</div>

			<div className="article-reader-pane min-h-0 flex-1 bg-background/10">
				<ReaderPane
					articleId={effectiveArticleId}
					articles={readingQueue}
					onSelectArticle={handleSelectArticle}
				/>
			</div>

			{markAllDialogOpen ? (
				<MarkAllReadDialog
					feedId={feedId}
					categoryId={categoryId}
					feedTitle={selectedFeed?.title}
					categoryTitle={categoryId ? displayedTitle : undefined}
					unreadCount={unreadBadgeCount}
					onSuccess={resetRetainedReadArticles}
					onClose={() => setMarkAllDialogOpen(false)}
				/>
			) : null}
		</div>
	);
}
