import type { SortOrder } from '@self-feed/shared';
import { ArrowDownUp, CheckCheck, Filter, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ArticleList } from '@/components/articles/article-list';
import { ReaderPane } from '@/components/articles/reader-pane';
import {
	useInfiniteArticles,
	useMarkAllRead,
	useMarkRead,
	usePrefetchArticle,
} from '@/hooks/queries';
import { useFeedRefresh } from '@/hooks/use-feed-refresh';
import { useKeyboardNav } from '@/hooks/use-keyboard-nav';
import { cn } from '@/lib/utils';
import { useAppState } from '@/providers/app-state';

interface FeedViewProps {
	feedId?: string;
	categoryId?: string;
	selectedArticleId: string | null;
	onSelectArticle: (id: string) => void;
}

export function FeedView({
	feedId,
	categoryId,
	selectedArticleId,
	onSelectArticle,
}: FeedViewProps) {
	const [unreadOnly, setUnreadOnly] = useState(false);
	const [sort, setSort] = useState<SortOrder>('latest');
	const { feedSyncError } = useAppState();
	const { allFeedsSyncStatus, isRefreshingAllFeeds, isRefreshingFeed, refreshFeed } =
		useFeedRefresh();
	const isSyncingSelectedFeed = isRefreshingFeed(feedId);
	const isRefreshingCurrentSelection = feedId ? isSyncingSelectedFeed : isRefreshingAllFeeds;
	const prefetchArticle = usePrefetchArticle();

	const { data, isFetching, isFetchingNextPage, isLoading, fetchNextPage, hasNextPage } =
		useInfiniteArticles({
			feedId,
			categoryId,
			unreadOnly,
			sort,
			limit: 30,
		});

	const markRead = useMarkRead();
	const markAllRead = useMarkAllRead();

	const articles = useMemo(() => {
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
	const articleIds = useMemo(() => articles.map((a) => a.id), [articles]);
	const unreadCount = articles.reduce((count, article) => count + (article.isRead ? 0 : 1), 0);
	const articleSearchParams = new URLSearchParams(
		feedId ? { feedId } : categoryId ? { categoryId } : undefined,
	).toString();

	useEffect(() => {
		if (!feedId || isLoading || isRefreshingCurrentSelection || feedSyncError) {
			return;
		}

		void refreshFeed(feedId);
	}, [feedId, feedSyncError, isLoading, isRefreshingCurrentSelection, refreshFeed]);

	useEffect(() => {
		if (articleIds.length === 0) {
			return;
		}

		const selectedIndex = selectedArticleId ? articleIds.indexOf(selectedArticleId) : -1;
		const idsToPrefetch =
			selectedIndex >= 0
				? articleIds.slice(selectedIndex, selectedIndex + 3)
				: articleIds.slice(0, 2);
		for (const id of idsToPrefetch) {
			void prefetchArticle(id);
		}
	}, [articleIds, prefetchArticle, selectedArticleId]);

	useKeyboardNav({
		articleIds,
		selectedId: selectedArticleId,
		onSelect: onSelectArticle,
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
	});

	function handleMarkAllRead() {
		markAllRead.mutate({ feedId, categoryId });
	}

	function handleRefresh() {
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

	return (
		<div className="flex h-full min-h-0 flex-col lg:flex-row">
			<div className="flex min-h-0 w-full shrink-0 flex-col border-b border-border/70 lg:w-[26rem] lg:border-b-0 lg:border-r xl:w-[30rem]">
				{feedSyncError ? (
					<div className="mx-4 mt-4 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
						{feedSyncError}
					</div>
				) : null}

				<div className="panel-divider px-4 pb-4 pt-4">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
								Reading queue
							</p>
							<h1 className="mt-2 text-xl font-semibold tracking-tight">Latest articles</h1>
							<p className="mt-1 text-sm text-muted-foreground">
								{unreadCount > 0
									? `${unreadCount} unread in this view`
									: 'Everything in this view has been read'}
							</p>
						</div>
						<div className="surface-muted flex items-center gap-2 rounded-2xl px-3 py-2 text-xs text-muted-foreground">
							<Sparkles className="h-3.5 w-3.5 text-primary" />
							<span>{articles.length} loaded</span>
						</div>
					</div>

					<div className="mt-4 flex flex-wrap items-center gap-2">
						<ToolbarButton
							active={unreadOnly}
							onClick={() => setUnreadOnly(!unreadOnly)}
							label="Unread"
						>
							<Filter className="h-3.5 w-3.5" />
						</ToolbarButton>
						<ToolbarButton
							onClick={() => setSort(sort === 'latest' ? 'oldest' : 'latest')}
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
							className="mt-4 overflow-hidden rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3"
						>
							<div className="flex min-w-0 items-center gap-3">
								<div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
									<span className="absolute h-9 w-9 animate-ping rounded-full bg-primary/20" />
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
						selectedId={selectedArticleId}
						onSelect={onSelectArticle}
						onPrefetch={prefetchArticle}
						loading={showListLoader}
						hasMore={hasNextPage}
						onLoadMore={() => {
							void fetchNextPage();
						}}
						loadingMore={isFetchingNextPage}
					/>
				</div>
			</div>

			<div className="min-h-0 flex-1 bg-background/10">
				<ReaderPane articleId={selectedArticleId} />
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
				'inline-flex h-10 items-center gap-2 rounded-full px-4 text-xs font-medium text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50',
				active && 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary',
				className,
			)}
		>
			{children}
			{label}
		</button>
	);
}
