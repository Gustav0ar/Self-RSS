import type { ArticleListItem, SortOrder } from '@self-feed/shared';
import { ArrowDownUp, CheckCheck, Filter, RefreshCw, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArticleList } from '@/components/articles/article-list';
import { ReaderPane } from '@/components/articles/reader-pane';
import {
	useCategories,
	useInfiniteArticles,
	useMarkAllRead,
	useMarkRead,
	usePreferences,
	usePrefetchArticle,
	useUpdatePreferences,
	useWarmNextArticles,
} from '@/hooks/queries';
import { useFeedRefresh } from '@/hooks/use-feed-refresh';
import { useKeyboardNav } from '@/hooks/use-keyboard-nav';
import { useSilentArticleRefresh } from '@/hooks/use-silent-article-refresh';
import { categoryPathLabel, flattenCategories, flattenCategoryFeeds } from '@/lib/categories';
import {
	normalizeAutoMarkReadPreference,
	normalizeDensityPreference,
	normalizeSortPreference,
} from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { useAppState } from '@/providers/app-state';

interface FeedViewProps {
	feedId?: string;
	categoryId?: string;
	selectedArticleId: string | null;
	/**
	 * True when the article id came from a deep link (`/articles/:id`),
	 * false when the user is on the list view. Deep links must
	 * always render their article even if the surrounding list is
	 * empty — only clear the active article in the list-view case.
	 */
	fromDeepLink?: boolean;
	onSelectArticle: (id: string | null) => void;
}

interface RetainedReadArticle {
	article: ArticleListItem;
	index: number;
}

export function FeedView({
	feedId,
	categoryId,
	selectedArticleId,
	fromDeepLink = false,
	onSelectArticle,
}: FeedViewProps) {
	const [unreadOnly, setUnreadOnly] = useState(false);
	const [sort, setSort] = useState<SortOrder>('latest');
	const { data: prefs } = usePreferences();
	const updatePrefs = useUpdatePreferences();
	const { feedSyncError } = useAppState();
	const { allFeedsSyncStatus, isRefreshingAllFeeds, isRefreshingFeed, refreshFeed } =
		useFeedRefresh();
	const isSyncingSelectedFeed = isRefreshingFeed(feedId);
	const isRefreshingCurrentSelection = feedId ? isSyncingSelectedFeed : isRefreshingAllFeeds;
	const prefetchArticle = usePrefetchArticle();
	const warmNextArticles = useWarmNextArticles();
	const { data: categories } = useCategories();

	const { data, isFetching, isFetchingNextPage, isLoading, fetchNextPage, hasNextPage } =
		useInfiniteArticles({
			feedId,
			categoryId,
			unreadOnly,
			sort,
			limit: 30,
		});

	useSilentArticleRefresh({ feedId, categoryId, unreadOnly, sort, limit: 30 });

	const markRead = useMarkRead();
	const markAllRead = useMarkAllRead();
	const [retainedReadArticles, setRetainedReadArticles] = useState<
		Map<string, RetainedReadArticle>
	>(() => new Map());
	const retentionScope = `${feedId ?? 'all'}:${categoryId ?? 'all'}:${sort}:${unreadOnly}`;
	const previousRetentionScope = useRef(retentionScope);

	const fetchedArticles = useMemo(() => {
		const seenArticleIds = new Set<string>();
		return (
			data?.pages
				.flatMap((page) => page.data)
				.filter((article) => {
					if (seenArticleIds.has(article.id)) {
						return false;
					}
					seenArticleIds.add(article.id);
					return true;
				}) ?? []
		);
	}, [data?.pages]);
	const categoryTree = categories ?? [];
	const flatCategories = useMemo(() => flattenCategories(categoryTree), [categoryTree]);
	const flatFeeds = useMemo(() => flattenCategoryFeeds(categoryTree), [categoryTree]);
	const selectedFeed = useMemo(
		() => (feedId ? flatFeeds.find((feed) => feed.id === feedId) : null),
		[feedId, flatFeeds],
	);
	const selectedCategory = useMemo(
		() => (categoryId ? flatCategories.find((category) => category.id === categoryId) : null),
		[categoryId, flatCategories],
	);
	const viewTitle = useMemo(() => {
		if (selectedFeed) {
			return selectedFeed.title;
		}
		if (categoryId) {
			return categoryPathLabel(categoryTree, categoryId) || selectedCategory?.name || 'Category';
		}
		return 'Latest articles';
	}, [categoryId, categoryTree, selectedCategory?.name, selectedFeed]);
	const scopeUnreadCount = useMemo(() => {
		if (selectedFeed) {
			return selectedFeed.unreadCount ?? 0;
		}
		if (selectedCategory) {
			return selectedCategory.unreadCount ?? 0;
		}
		return flatFeeds.reduce((count, feed) => count + (feed.unreadCount ?? 0), 0);
	}, [flatFeeds, selectedCategory, selectedFeed]);
	const emptyState = useMemo(() => {
		if (feedSyncError) {
			return {
				title: 'Unable to refresh articles',
				description: feedSyncError,
			};
		}
		if (unreadOnly) {
			return {
				title: 'No unread articles',
				description: 'Turn off the unread filter to review older stories in this view.',
			};
		}
		if (feedId) {
			return {
				title: 'No articles in this feed',
				description: 'Refresh the feed or check that the source is publishing RSS items.',
			};
		}
		if (categoryId) {
			return {
				title: 'No articles in this category',
				description: 'Add feeds to this category or refresh existing sources.',
			};
		}
		return {
			title: 'No articles yet',
			description: 'Add a feed or import OPML to start building your reading queue.',
		};
	}, [categoryId, feedId, feedSyncError, unreadOnly]);
	const articles = useMemo(() => {
		if (!unreadOnly || retainedReadArticles.size === 0) {
			return fetchedArticles;
		}

		const seenArticleIds = new Set(fetchedArticles.map((article) => article.id));
		const retainedArticles = Array.from(retainedReadArticles.values())
			.filter(({ article }) => !seenArticleIds.has(article.id))
			.sort((a, b) => a.index - b.index);
		if (retainedArticles.length === 0) {
			return fetchedArticles;
		}

		const mergedArticles = [...fetchedArticles];
		for (const retained of retainedArticles) {
			mergedArticles.splice(Math.min(retained.index, mergedArticles.length), 0, retained.article);
		}
		return mergedArticles;
	}, [fetchedArticles, retainedReadArticles, unreadOnly]);
	const articleIds = useMemo(() => articles.map((a) => a.id), [articles]);
	// The article URL (`/articles/:articleId`) can be deep-linked or
	// bookmarked. The article list is loaded asynchronously, so an
	// incoming article id may briefly not be in the list while the
	// query resolves. Only "clear" the active article once the list
	// is fully loaded and the id is genuinely missing — never while
	// we're still loading, otherwise deep links would flash the empty
	// state during the first paint.
	const articleIdsSet = useMemo(() => new Set(articleIds), [articleIds]);
	const articleIsInLoadedList = selectedArticleId ? articleIdsSet.has(selectedArticleId) : false;
	// On a deep link (`/articles/:id`) we must keep the article id even
	// when the surrounding list is empty or hasn't loaded it yet. In the
	// list-view case (`/`) the absence from the loaded list is what
	// triggers the effect below to clear the selection.
	const effectiveArticleId =
		selectedArticleId && (articleIsInLoadedList || fromDeepLink) ? selectedArticleId : null;
	const loadedUnreadCount = articles.reduce(
		(count, article) => count + (article.isRead ? 0 : 1),
		0,
	);
	const articleSearchParams = new URLSearchParams(
		feedId ? { feedId } : categoryId ? { categoryId } : undefined,
	).toString();
	const density = normalizeDensityPreference(prefs?.density);
	const keyboardShortcutsEnabled = prefs?.keyboardShortcutsEnabled ?? true;
	const autoMarkReadMode = normalizeAutoMarkReadPreference(prefs?.autoMarkReadMode);
	const handleLoadMore = useCallback(() => {
		void fetchNextPage();
	}, [fetchNextPage]);

	const retainReadArticle = useCallback(
		(article: ArticleListItem, index: number) => {
			if (!unreadOnly) {
				return;
			}

			setRetainedReadArticles((current) => {
				const retainedArticle = { ...article, isRead: true };
				const previous = current.get(article.id);
				if (
					previous?.index === index &&
					previous.article.isRead === retainedArticle.isRead &&
					previous.article.title === retainedArticle.title
				) {
					return current;
				}

				const next = new Map(current);
				next.set(article.id, { article: retainedArticle, index });
				return next;
			});
		},
		[unreadOnly],
	);

	useEffect(() => {
		if (previousRetentionScope.current === retentionScope) {
			return;
		}
		previousRetentionScope.current = retentionScope;
		setRetainedReadArticles(new Map());
	}, [retentionScope]);

	useEffect(() => {
		if (!feedId || isLoading || isRefreshingCurrentSelection || feedSyncError) {
			return;
		}

		void refreshFeed(feedId);
	}, [feedId, feedSyncError, isLoading, isRefreshingCurrentSelection, refreshFeed]);

	// If the user is on the list view (`/`) and a previously selected
	// article is no longer in the loaded list, clear it. We only do
	// this in the list-view case so that deep links to a specific
	// article (`/articles/:id`) still render their target even when
	// the surrounding list is empty (e.g. a deep link to an article
	// that doesn't match the current All Feeds list — common after
	// opening a search result). While the list is still loading, we
	// preserve the URL.
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

	function handleSelectArticle(id: string) {
		if (autoMarkReadMode === 'on_navigate' && selectedArticleId !== id) {
			const nextArticleIndex = articles.findIndex((article) => article.id === id);
			const nextArticle = nextArticleIndex >= 0 ? articles[nextArticleIndex] : null;
			if (nextArticle && !nextArticle.isRead) {
				retainReadArticle(nextArticle, nextArticleIndex);
				markRead.mutate({ articleId: nextArticle.id, read: true });
			}
		}

		onSelectArticle(id);
	}

	useKeyboardNav({
		articleIds,
		selectedId: effectiveArticleId,
		onSelect: handleSelectArticle,
		onToggleRead: (id) => {
			const article = articles.find((a) => a.id === id);
			if (article) {
				markRead.mutate({ articleId: id, read: !article.isRead });
			}
		},
		onOpenExternal: (id) => {
			const article = articles.find((a) => a.id === id);
			if (article) {
				window.open(
					`/articles/${id}${articleSearchParams ? `?${articleSearchParams}` : ''}`,
					'_blank',
					'noopener,noreferrer',
				);
			}
		},
		onRefresh: () => {
			if (!isRefreshingCurrentSelection) {
				handleRefresh();
			}
		},
		enabled: keyboardShortcutsEnabled,
	});

	function handleMarkAllRead() {
		setRetainedReadArticles(new Map());
		markAllRead.mutate({ feedId, categoryId });
	}

	function handleRefresh() {
		setRetainedReadArticles(new Map());
		if (feedId) {
			void refreshFeed(feedId, { force: true });
		} else {
			void refreshFeed(undefined, { force: true });
		}
	}

	const refreshStatusTitle = feedId
		? 'Loading new articles'
		: allFeedsSyncStatus?.queued
			? 'Refresh queued'
			: 'Loading new articles';
	const refreshStatusDetail = feedId
		? 'Checking this feed now'
		: allFeedsSyncStatus?.queued
			? 'Waiting for the background worker'
			: 'Checking feeds and pulling in new stories';
	const showListLoader =
		isLoading ||
		(isFetching && articles.length === 0) ||
		(isRefreshingCurrentSelection && articles.length === 0);
	const unreadBadgeCount = Math.max(scopeUnreadCount, loadedUnreadCount);

	useEffect(() => {
		if (typeof prefs?.hideRead === 'boolean') {
			setUnreadOnly(prefs.hideRead);
		}
	}, [prefs?.hideRead]);

	useEffect(() => {
		setSort(normalizeSortPreference(prefs?.defaultSort));
	}, [prefs?.defaultSort]);

	function handleUnreadOnlyToggle() {
		const nextUnreadOnly = !unreadOnly;
		setRetainedReadArticles(new Map());
		setUnreadOnly(nextUnreadOnly);
		updatePrefs.mutate({ hideRead: nextUnreadOnly });
	}

	return (
		<div className="flex h-full min-h-0 flex-col lg:flex-row">
			<div className="flex min-h-0 w-full shrink-0 flex-col border-b border-border/70 lg:w-[clamp(23rem,28vw,33rem)] lg:border-b-0 lg:border-r">
				{feedSyncError ? (
					<div className="mx-3 mt-3 rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
						{feedSyncError}
					</div>
				) : null}

				<div className="panel-divider sticky top-0 z-20 bg-card/95 px-3 pb-2.5 pt-3 backdrop-blur-xl">
					<div className="flex items-start justify-between gap-3">
						<div className="min-w-0">
							<div className="flex min-w-0 items-center gap-2">
								<p className="truncate text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
									Reading queue
								</p>
								<span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" />
								<span className="shrink-0 text-[11px] text-muted-foreground">
									{articles.length} loaded
								</span>
							</div>
							<h1 className="mt-1 truncate text-lg font-semibold tracking-tight">{viewTitle}</h1>
						</div>
						<div className="surface-muted flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs text-muted-foreground">
							<Sparkles className="h-3.5 w-3.5 text-primary" />
							<span>{unreadBadgeCount > 0 ? `${unreadBadgeCount} unread` : 'Caught up'}</span>
						</div>
					</div>

					<div className="mt-2.5 flex flex-wrap items-center gap-1.5">
						<ToolbarButton active={unreadOnly} onClick={handleUnreadOnlyToggle} label="Unread">
							<Filter className="h-3.5 w-3.5" />
						</ToolbarButton>
						<ToolbarButton
							onClick={() => {
								const nextSort: SortOrder = sort === 'latest' ? 'oldest' : 'latest';
								setSort(nextSort);
								updatePrefs.mutate({ defaultSort: nextSort });
							}}
							label={sort === 'latest' ? 'Newest' : 'Oldest'}
						>
							<ArrowDownUp className="h-3.5 w-3.5" />
						</ToolbarButton>
						<ToolbarButton onClick={handleMarkAllRead} label="Mark all read" className="ml-auto">
							<CheckCheck className="h-3.5 w-3.5" />
						</ToolbarButton>
						<ToolbarButton
							onClick={handleRefresh}
							label="Refresh"
							disabled={isRefreshingCurrentSelection}
						>
							<RefreshCw
								className={cn('h-3.5 w-3.5', isRefreshingCurrentSelection && 'animate-spin')}
							/>
						</ToolbarButton>
					</div>

					{isRefreshingCurrentSelection ? (
						<div
							aria-live="polite"
							className="mt-2.5 overflow-hidden rounded-xl border border-primary/20 bg-primary/10 px-3 py-2"
						>
							<div className="flex min-w-0 items-center gap-3">
								<div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
									<span className="absolute h-8 w-8 animate-ping rounded-full bg-primary/20" />
									<RefreshCw className="relative h-4 w-4 animate-spin" />
								</div>
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium text-foreground">
										{refreshStatusTitle}
									</p>
									<p className="mt-0.5 truncate text-xs text-muted-foreground">
										{refreshStatusDetail}
									</p>
								</div>
							</div>
							<div className="mt-3 h-1 overflow-hidden rounded-full bg-background/60">
								<div className="h-full w-full animate-pulse rounded-full bg-primary/70" />
							</div>
						</div>
					) : null}
				</div>

				<div className="min-h-0 flex-1">
					<ArticleList
						articles={articles}
						selectedId={effectiveArticleId}
						onSelect={handleSelectArticle}
						onPrefetch={prefetchArticle}
						loading={showListLoader}
						hasMore={hasNextPage}
						onLoadMore={handleLoadMore}
						loadingMore={isFetchingNextPage}
						density={density}
						emptyTitle={emptyState.title}
						emptyDescription={emptyState.description}
					/>
				</div>
			</div>

			<div className="min-h-0 flex-1 bg-background/10">
				<ReaderPane
					articleId={effectiveArticleId}
					articles={articles}
					onSelectArticle={handleSelectArticle}
				/>
			</div>
		</div>
	);
}

function ToolbarButton({
	active,
	onClick,
	label,
	children,
	disabled,
	className,
}: {
	active?: boolean;
	onClick: () => void;
	label: string;
	children: React.ReactNode;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={cn(
				'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50',
				active && 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary',
				className,
			)}
		>
			{children}
			{label}
		</button>
	);
}
