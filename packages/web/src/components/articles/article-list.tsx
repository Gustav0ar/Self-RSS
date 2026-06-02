import { formatDistanceToNow } from 'date-fns';
import { Circle, CircleDot } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
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
	loading?: boolean;
	hasMore?: boolean;
	onLoadMore?: () => void;
	loadingMore?: boolean;
}

export function ArticleList({
	articles,
	selectedId,
	onSelect,
	loading,
	hasMore,
	onLoadMore,
	loadingMore,
}: ArticleListProps) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const loadMoreRef = useRef<HTMLDivElement | null>(null);

	const maybeLoadMore = useCallback(() => {
		if (!hasMore || !onLoadMore || loadingMore) {
			return;
		}

		onLoadMore();
	}, [hasMore, loadingMore, onLoadMore]);

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

	useEffect(() => {
		const root = scrollRef.current;
		if (!root || !hasMore || loadingMore) {
			return;
		}

		const interval = window.setInterval(() => {
			const remaining = root.scrollHeight - root.scrollTop - root.clientHeight;
			if (remaining <= 240) {
				maybeLoadMore();
			}
		}, 250);

		return () => window.clearInterval(interval);
	}, [hasMore, loadingMore, maybeLoadMore]);

	useEffect(() => {
		if (!selectedId) {
			return;
		}

		const selectedIndex = articles.findIndex((article) => article.id === selectedId);
		if (selectedIndex === -1) {
			return;
		}

		const root = scrollRef.current;
		const selectedRow = root?.querySelector<HTMLElement>(`[data-article-id="${selectedId}"]`);
		selectedRow?.scrollIntoView({ block: 'nearest' });

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
				className="flex-1 overflow-auto px-3 pb-3"
			>
				<div className="space-y-2">
					{articles.map((article, index) => (
						<ArticleRow
							key={article.id}
							article={article}
							isSelected={article.id === selectedId}
							onSelect={() => onSelect(article.id)}
							index={index}
						/>
					))}
				</div>
				{hasMore ? (
					<div
						ref={loadMoreRef}
						className="mx-1 mt-3 rounded-2xl border border-border/70 bg-background/40 px-4 py-3 text-center text-sm text-muted-foreground"
					>
						{loadingMore ? 'Loading more articles...' : 'Scroll to load more'}
					</div>
				) : articles.length > 0 ? (
					<div className="mx-1 mt-3 rounded-2xl border border-border/70 bg-background/40 px-4 py-3 text-center text-xs text-muted-foreground">
						You&apos;ve reached the end
					</div>
				) : null}
			</div>
		</div>
	);
}

function ArticleRow({
	article,
	isSelected,
	onSelect,
	index,
}: {
	article: ArticleListItemData;
	isSelected: boolean;
	onSelect: () => void;
	index: number;
}) {
	const timeAgo = article.publishedAt
		? formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })
		: null;

	return (
		<button
			type="button"
			onClick={onSelect}
			data-article-id={article.id}
			aria-current={isSelected ? 'true' : undefined}
			className={cn(
				'motion-enter surface-card relative flex w-full gap-3 rounded-[1.35rem] border px-4 py-3 text-left hover:-translate-y-0.5 hover:bg-accent/45',
				isSelected &&
					'!border-primary/70 !bg-primary/18 shadow-[0_0_0_1px_rgba(129,140,248,0.4),0_18px_36px_rgba(79,70,229,0.24)]',
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
			{isSelected ? (
				<div className="absolute inset-y-3 left-1.5 w-1 rounded-full bg-primary/80" />
			) : null}
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
				{isSelected ? (
					<div className="mb-2 inline-flex items-center rounded-full bg-primary/18 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
						Now reading
					</div>
				) : null}
				<h3
					className={cn(
						'mt-1 line-clamp-2 text-sm leading-6',
						isSelected
							? 'font-semibold text-foreground'
							: !article.isRead
								? 'font-semibold text-foreground'
								: 'font-medium text-foreground/82',
					)}
				>
					{article.title}
				</h3>
				{article.author ? (
					<p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{article.author}</p>
				) : null}
				{article.excerpt ? (
					<p
						className={cn(
							'mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground',
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
					className="h-16 w-16 shrink-0 rounded-2xl object-cover shadow-sm"
				/>
			) : null}
		</button>
	);
}
