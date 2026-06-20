import { useVirtualizer } from '@tanstack/react-virtual';
import { formatDistanceToNow } from 'date-fns';
import { Circle, CircleDot } from 'lucide-react';
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
import type { DisplayDensityPreference } from '@/lib/preferences';
import { cn } from '@/lib/utils';

interface ArticleListItemData {
	id: string;
	feedId: string;
	feedTitle: string;
	feedFaviconUrl: string | null;
	title: string;
	author: string | null;
	excerpt: string | null;
	heroImageUrl: string | null;
	publishedAt: string | null;
	isRead: boolean;
}

interface ArticleListProps {
	articles: ArticleListItemData[];
	selectedId: string | null;
	onSelect: (id: string) => void;
	onPrefetch?: (id: string) => void;
	loading?: boolean;
	hasMore?: boolean;
	onLoadMore?: () => void;
	loadingMore?: boolean;
	density?: DisplayDensityPreference;
	emptyTitle?: string;
	emptyDescription?: string;
	emptyAction?: ReactNode;
}

const ROW_HEIGHT_PX = {
	comfortable: 82,
	compact: 56,
} as const;
const ROW_GAP_PX = 6; // matches `space-y-1.5`
const ROW_OVERSCAN = 6;

export function ArticleList({
	articles,
	selectedId,
	onSelect,
	onPrefetch,
	loading,
	hasMore,
	onLoadMore,
	loadingMore,
	density = 'comfortable',
	emptyTitle = 'No articles found',
	emptyDescription,
	emptyAction,
}: ArticleListProps) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const lastScrolledSelectedIdRef = useRef<string | null>(null);
	const skeletonIds = useMemo(
		() => Array.from({ length: 8 }, (_, i) => `skeleton-${Date.now()}-${i}`),
		[],
	);

	const rowHeight = ROW_HEIGHT_PX[density];
	const rowSize = rowHeight + ROW_GAP_PX;

	const virtualizer = useVirtualizer({
		count: articles.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => rowSize,
		overscan: ROW_OVERSCAN,
	});

	const maybeLoadMore = useCallback(() => {
		if (!hasMore || !onLoadMore || loadingMore) {
			return;
		}
		onLoadMore();
	}, [hasMore, loadingMore, onLoadMore]);

	// Stable callback for `onPrefetch` so the memoized ArticleRow does
	// not see a fresh function on every parent render. The row receives
	// the article's id via `data-article-id` and reads it from the
	// event target, so we don't need a per-row closure.
	const stablePrefetch = useCallback(
		(event: React.FocusEvent<HTMLElement> | React.PointerEvent<HTMLElement>) => {
			if (!onPrefetch) return;
			const id = event.currentTarget.getAttribute('data-article-id');
			if (id) onPrefetch(id);
		},
		[onPrefetch],
	);

	// Trigger `loadMore` when the last virtual item is within ~2 viewports
	// of the visible window. This replaces the IntersectionObserver-based
	// trigger from the non-virtualized version.
	const virtualItems = virtualizer.getVirtualItems();
	const lastVisibleIndex = virtualItems[virtualItems.length - 1]?.index ?? 0;
	useEffect(() => {
		if (!hasMore || loadingMore) return;
		if (articles.length === 0) return;
		const loadMoreIndex = Math.max(0, articles.length - 1 - ROW_OVERSCAN);
		if (lastVisibleIndex >= loadMoreIndex) {
			maybeLoadMore();
		}
	}, [articles.length, hasMore, lastVisibleIndex, loadingMore, maybeLoadMore]);

	// When the list height changes (e.g. search shrinks the list), the
	// last visible item may now expose the bottom sentinel. The virtualizer
	// updates its own size on ResizeObserver, so this is a safety net for
	// environments without ResizeObserver.
	useEffect(() => {
		const root = scrollRef.current;
		if (!root || !hasMore || loadingMore || typeof ResizeObserver === 'undefined') {
			return;
		}

		const check = () => {
			const remaining = root.scrollHeight - root.scrollTop - root.clientHeight;
			if (remaining <= 240) {
				maybeLoadMore();
			}
		};

		check();
		const observer = new ResizeObserver(check);
		observer.observe(root);
		return () => observer.disconnect();
	}, [hasMore, loadingMore, maybeLoadMore]);

	// Scroll the selected row into view (lazy — only when the selection
	// actually changes, not on every article-list update).
	useEffect(() => {
		if (!selectedId) {
			lastScrolledSelectedIdRef.current = null;
			return;
		}

		const selectedIndex = articles.findIndex((article) => article.id === selectedId);
		if (selectedIndex === -1) {
			return;
		}

		if (lastScrolledSelectedIdRef.current !== selectedId) {
			virtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
			lastScrolledSelectedIdRef.current = selectedId;
		}

		if (articles.length - selectedIndex <= 5) {
			maybeLoadMore();
		}
	}, [articles, maybeLoadMore, selectedId, virtualizer]);

	if (loading && articles.length === 0) {
		return (
			<div className="flex h-full flex-col">
				<div
					ref={scrollRef}
					data-testid="article-list-scroll"
					className="flex-1 overflow-auto px-2.5 pb-2.5"
				>
					<div className="space-y-1.5">
						{skeletonIds.map((id) => (
							<div
								key={id}
								className="skeleton-row"
								style={{ height: `${rowHeight}px` }}
								aria-hidden="true"
							/>
						))}
					</div>
				</div>
			</div>
		);
	}

	if (!loading && articles.length === 0) {
		return (
			<div className="flex h-full items-center justify-center px-6">
				<div className="max-w-sm text-center">
					<p className="text-sm font-medium text-foreground">{emptyTitle}</p>
					{emptyDescription ? (
						<p className="mt-1 text-sm leading-6 text-muted-foreground">{emptyDescription}</p>
					) : null}
					{emptyAction ? <div className="mt-4 flex justify-center">{emptyAction}</div> : null}
				</div>
			</div>
		);
	}

	const totalSize = virtualizer.getTotalSize();
	const hasItems = articles.length > 0;

	return (
		<div className="flex h-full flex-col">
			<div
				ref={scrollRef}
				data-testid="article-list-scroll"
				className="flex-1 overflow-auto px-2.5 pb-2.5"
			>
				<div style={{ height: `${totalSize}px`, position: 'relative', width: '100%' }}>
					{virtualItems.map((virtualRow) => {
						const article = articles[virtualRow.index];
						if (!article) return null;
						return (
							<div
								key={virtualRow.key}
								data-index={virtualRow.index}
								style={{
									position: 'absolute',
									top: 0,
									left: 0,
									width: '100%',
									transform: `translateY(${virtualRow.start}px)`,
								}}
							>
								<ArticleRow
									article={article}
									isSelected={article.id === selectedId}
									onSelect={onSelect}
									onPrefetch={onPrefetch ? stablePrefetch : undefined}
									density={density}
									style={{ height: `${rowHeight}px` }}
								/>
							</div>
						);
					})}
				</div>
				{hasMore ? (
					<div className="mx-1 mt-2 rounded-xl border border-border/70 bg-background/40 px-3 py-2 text-center text-xs text-muted-foreground">
						{loadingMore ? 'Loading more articles...' : 'Scroll to load more'}
					</div>
				) : hasItems ? (
					<div className="mx-1 mt-2 rounded-xl border border-border/70 bg-background/40 px-3 py-2 text-center text-xs text-muted-foreground">
						You&apos;ve reached the end
					</div>
				) : null}
			</div>
		</div>
	);
}

function ArticleRowImpl({
	article,
	isSelected,
	onSelect,
	onPrefetch,
	density,
	style,
}: {
	article: ArticleListItemData;
	isSelected: boolean;
	onSelect: (id: string) => void;
	onPrefetch?: (event: React.FocusEvent<HTMLElement> | React.PointerEvent<HTMLElement>) => void;
	density: DisplayDensityPreference;
	style?: React.CSSProperties;
}) {
	const timeAgo = useMemo(
		() =>
			article.publishedAt
				? formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })
				: null,
		[article.publishedAt],
	);

	return (
		<button
			type="button"
			onClick={() => onSelect(article.id)}
			onFocus={onPrefetch}
			onPointerEnter={onPrefetch}
			data-article-id={article.id}
			aria-current={isSelected ? 'true' : undefined}
			style={style}
			className={cn(
				'motion-enter surface-card surface-compact relative flex w-full overflow-hidden rounded-xl border text-left hover:bg-accent/45',
				density === 'compact' ? 'gap-2 px-2.5 py-2' : 'gap-2.5 px-3 py-2.5',
				isSelected && 'border-l-4 !border-primary/60 !border-l-primary !bg-primary/12 shadow-sm',
				!isSelected && !article.isRead && 'border-primary/12 bg-card/95',
			)}
		>
			<div className="mt-1 shrink-0">
				{isSelected ? (
					<CircleDot className="h-3.5 w-3.5 text-primary" />
				) : article.isRead ? (
					<Circle className="h-3 w-3 text-muted-foreground/30" />
				) : (
					<CircleDot className="h-3 w-3 text-primary" />
				)}
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					{article.feedFaviconUrl ? (
						<img
							src={article.feedFaviconUrl}
							alt=""
							className="h-4 w-4 rounded-sm"
							loading="lazy"
							decoding="async"
							referrerPolicy="no-referrer"
						/>
					) : null}
					<span className="truncate">{article.feedTitle}</span>
					{timeAgo ? (
						<>
							<span>·</span>
							<span className="shrink-0">{timeAgo}</span>
						</>
					) : null}
				</div>
				<p
					className={cn(
						'mt-1 text-sm',
						density === 'compact'
							? 'line-clamp-1 break-words leading-5'
							: 'line-clamp-2 break-words leading-5',
						isSelected
							? 'font-semibold text-foreground'
							: !article.isRead
								? 'font-semibold text-foreground'
								: 'font-medium text-foreground/82',
					)}
				>
					{article.title}
				</p>
			</div>
		</button>
	);
}

// Memoize the row so a parent re-render (selection, cache update,
// scroll) doesn't re-render every visible row. The `onSelect` and
// `onPrefetch` callbacks are still expected to be stable from the
// parent — if they aren't, wrap them in `useCallback` at the call site.
const ArticleRow = memo(ArticleRowImpl, (prev, next) => {
	return (
		prev.article === next.article &&
		prev.isSelected === next.isSelected &&
		prev.onSelect === next.onSelect &&
		prev.onPrefetch === next.onPrefetch &&
		prev.density === next.density &&
		prev.style?.height === next.style?.height
	);
});
