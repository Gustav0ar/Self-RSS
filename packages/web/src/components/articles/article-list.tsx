import { formatDistanceToNow } from 'date-fns';
import { Circle, CircleDot } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
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
}

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
}: ArticleListProps) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const loadMoreRef = useRef<HTMLDivElement | null>(null);
	const lastScrolledSelectedIdRef = useRef<string | null>(null);

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

	useEffect(() => {
		if (!hasMore || !onLoadMore || loadingMore) {
			return;
		}

		const root = scrollRef.current;
		const target = loadMoreRef.current;
		if (!root || !target) {
			return;
		}

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					maybeLoadMore();
				}
			},
			{ root, rootMargin: '200px 0px' },
		);

		observer.observe(target);
		return () => observer.disconnect();
	}, [hasMore, loadingMore, maybeLoadMore, onLoadMore]);

	useEffect(() => {
		const root = scrollRef.current;
		if (!root) {
			return;
		}

		const checkScrollPosition = () => {
			const remaining = root.scrollHeight - root.scrollTop - root.clientHeight;
			if (remaining <= 240) {
				maybeLoadMore();
			}
		};

		checkScrollPosition();
		root.addEventListener('scroll', checkScrollPosition, { passive: true });
		return () => root.removeEventListener('scroll', checkScrollPosition);
	}, [maybeLoadMore]);

	// A ResizeObserver covers the case the previous setInterval was
	// guarding against: when the list height changes without a user
	// scroll (e.g. the user types into the search bar and the list
	// shrinks). We only check on resize, not on a 250ms tick.
	useEffect(() => {
		const root = scrollRef.current;
		if (!root || !hasMore || loadingMore || typeof ResizeObserver === 'undefined') {
			return;
		}

		const checkScrollPosition = () => {
			const remaining = root.scrollHeight - root.scrollTop - root.clientHeight;
			if (remaining <= 240) {
				maybeLoadMore();
			}
		};

		const observer = new ResizeObserver(checkScrollPosition);
		observer.observe(root);
		return () => observer.disconnect();
	}, [hasMore, loadingMore, maybeLoadMore]);

	useEffect(() => {
		if (!selectedId) {
			lastScrolledSelectedIdRef.current = null;
			return;
		}

		const selectedIndex = articles.findIndex((article) => article.id === selectedId);
		if (selectedIndex === -1) {
			return;
		}

		const root = scrollRef.current;
		const selectedRow = root?.querySelector<HTMLElement>(`[data-article-id="${selectedId}"]`);
		if (lastScrolledSelectedIdRef.current !== selectedId) {
			selectedRow?.scrollIntoView({ block: 'nearest' });
			lastScrolledSelectedIdRef.current = selectedId;
		}

		if (articles.length - selectedIndex <= 5) {
			maybeLoadMore();
		}
	}, [articles, maybeLoadMore, selectedId]);

	if (loading && articles.length === 0) {
		return (
			<div className="flex h-full items-center justify-center px-6">
				<div className="text-center text-sm text-muted-foreground">Loading articles...</div>
			</div>
		);
	}

	if (!loading && articles.length === 0) {
		return (
			<div className="flex h-full items-center justify-center px-6">
				<div className="text-center text-sm text-muted-foreground">No articles found</div>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
			<div
				ref={scrollRef}
				data-testid="article-list-scroll"
				className="flex-1 overflow-auto px-2.5 pb-2.5"
			>
				<div className="space-y-1.5">
					{articles.map((article, index) => (
						<ArticleRow
							key={article.id}
							article={article}
							isSelected={article.id === selectedId}
							onSelect={onSelect}
							onPrefetch={onPrefetch ? stablePrefetch : undefined}
							index={index}
							density={density}
						/>
					))}
				</div>
				{hasMore ? (
					<div
						ref={loadMoreRef}
						className="mx-1 mt-2 rounded-xl border border-border/70 bg-background/40 px-3 py-2 text-center text-xs text-muted-foreground"
					>
						{loadingMore ? 'Loading more articles...' : 'Scroll to load more'}
					</div>
				) : articles.length > 0 ? (
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
	index,
	density,
}: {
	article: ArticleListItemData;
	isSelected: boolean;
	onSelect: (id: string) => void;
	onPrefetch?: (event: React.FocusEvent<HTMLElement> | React.PointerEvent<HTMLElement>) => void;
	index: number;
	density: DisplayDensityPreference;
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
			className={cn(
				'motion-enter surface-card surface-compact relative flex w-full rounded-xl border text-left hover:bg-accent/45',
				density === 'compact' ? 'gap-2 px-2.5 py-2' : 'gap-2.5 px-3 py-2.5',
				isSelected && 'border-l-4 !border-primary/60 !border-l-primary !bg-primary/12 shadow-sm',
				!isSelected && !article.isRead && 'border-primary/12 bg-card/95',
			)}
			style={{ animationDelay: `${Math.min(index, 10) * 18}ms` }}
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
						<img src={article.feedFaviconUrl} alt="" className="h-4 w-4 rounded-sm" />
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
						density === 'compact' ? 'line-clamp-1 leading-5' : 'line-clamp-2 leading-5',
						isSelected
							? 'font-semibold text-foreground'
							: !article.isRead
								? 'font-semibold text-foreground'
								: 'font-medium text-foreground/82',
					)}
				>
					{article.title}
				</p>
				{article.author ? (
					<p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{article.author}</p>
				) : null}
				{article.excerpt && density !== 'compact' ? (
					<p
						className={cn(
							'mt-1 line-clamp-2 text-xs leading-4 text-muted-foreground',
							isSelected && 'text-foreground/80',
						)}
					>
						{article.excerpt}
					</p>
				) : null}
			</div>
			{article.heroImageUrl ? (
				<img
					src={article.heroImageUrl}
					alt=""
					className={cn(
						'shrink-0 rounded-xl object-cover shadow-sm',
						density === 'compact' ? 'h-10 w-10' : 'h-12 w-12',
					)}
				/>
			) : null}
		</button>
	);
}

// Memoize the row so a parent re-render (selection, cache update,
// scroll) doesn't re-render every visible row. With 50+ rows in the
// viewport this is the single biggest web re-render win on the article
// list. The `onSelect` and `onPrefetch` callbacks are still expected
// to be stable from the parent — if they aren't, wrap them in
// `useCallback` at the call site.
const ArticleRow = memo(ArticleRowImpl, (prev, next) => {
	return (
		prev.article === next.article &&
		prev.isSelected === next.isSelected &&
		prev.onSelect === next.onSelect &&
		prev.onPrefetch === next.onPrefetch &&
		prev.index === next.index &&
		prev.density === next.density
	);
});
