import type { SortOrder } from '@self-feed/shared';
import { ArrowDownUp, CheckCheck, Filter, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ArticleList } from '@/components/articles/article-list';
import { ReaderPane } from '@/components/articles/reader-pane';
import { useInfiniteArticles, useMarkAllRead, useMarkRead } from '@/hooks/queries';
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
	const { isRefreshingAllFeeds, isRefreshingFeed, refreshFeed } = useFeedRefresh();
	const isSyncingSelectedFeed = isRefreshingFeed(feedId);
	const isRefreshingCurrentSelection = feedId ? isSyncingSelectedFeed : isRefreshingAllFeeds;
	const autoSyncedViews = useRef(new Set<string>());

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

	const seenArticleIds = new Set<string>();
	const articles =
		data?.pages
			.flatMap((page) => page.data)
			.filter((article) => {
				if (seenArticleIds.has(article.id)) {
					return false;
				}
				seenArticleIds.add(article.id);
				return true;
			}) ?? [];
	const articleIds = articles.map((a) => a.id);
	const unreadCount = articles.reduce((count, article) => count + (article.isRead ? 0 : 1), 0);
	const viewId = feedId ?? categoryId ?? 'all';
	const articleSearchParams = new URLSearchParams(
		feedId ? { feedId } : categoryId ? { categoryId } : undefined,
	).toString();

	useEffect(() => {
		if (isLoading || isRefreshingCurrentSelection || feedSyncError) {
			return;
		}
		if (autoSyncedViews.current.has(viewId)) {
			return;
		}

		autoSyncedViews.current.add(viewId);

		if (feedId) {
			void refreshFeed(feedId, { force: true });
			return;
		}

		void refreshFeed(undefined, { force: true });
	}, [feedId, viewId, feedSyncError, isLoading, isRefreshingCurrentSelection, refreshFeed]);

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
				</div>

				<div className="min-h-0 flex-1">
					<ArticleList
						articles={articles}
						selectedId={selectedArticleId}
						onSelect={onSelectArticle}
						loading={
							isLoading || (isFetching && articles.length === 0) || isRefreshingCurrentSelection
						}
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
