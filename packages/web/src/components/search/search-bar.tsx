import { formatDistanceToNow } from 'date-fns';
import { CalendarDays, Search as SearchIcon, X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { useSearch } from '@/hooks/queries';

interface SearchBarProps {
	onSelectArticle: (id: string) => void;
	categoryId?: string;
}

const MAX_RENDERED_RESULTS = 80;

export function SearchBar({ onSelectArticle, categoryId }: SearchBarProps) {
	const [query, setQuery] = useState('');
	const [debouncedQuery, setDebouncedQuery] = useState('');
	const [isOpen, setIsOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);
	const [scope, setScope] = useState<'all' | 'category'>('all');
	const listboxId = useId();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const activeCategoryId = scope === 'category' ? categoryId : undefined;
	const {
		data: results,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		isLoading,
	} = useSearch(debouncedQuery, activeCategoryId);

	useEffect(() => {
		if (!categoryId && scope === 'category') {
			setScope('all');
		}
	}, [categoryId, scope]);

	useEffect(() => {
		const timeout = window.setTimeout(() => {
			setDebouncedQuery(query);
		}, 300);
		return () => window.clearTimeout(timeout);
	}, [query]);

	// Close the dropdown when clicking outside the search bar.
	useEffect(() => {
		if (!isOpen) return;
		function handlePointer(event: PointerEvent) {
			const container = containerRef.current;
			if (!container) return;
			if (!container.contains(event.target as Node)) {
				setIsOpen(false);
				setActiveIndex(-1);
			}
		}
		document.addEventListener('pointerdown', handlePointer);
		return () => document.removeEventListener('pointerdown', handlePointer);
	}, [isOpen]);

	// Press `/` from anywhere (when not already typing) to focus the search.
	useEffect(() => {
		function handleKey(event: KeyboardEvent) {
			if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
			const target = event.target as HTMLElement | null;
			if (target) {
				const tag = target.tagName;
				if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
					return;
				}
			}
			event.preventDefault();
			inputRef.current?.focus();
			inputRef.current?.select();
		}
		window.addEventListener('keydown', handleKey);
		return () => window.removeEventListener('keydown', handleKey);
	}, []);

	const resultIds = useMemo(() => results?.pages.flatMap((page) => page.data) ?? [], [results]);
	const renderedResults = useMemo(() => resultIds.slice(0, MAX_RENDERED_RESULTS), [resultIds]);
	const reachedRenderLimit = resultIds.length >= MAX_RENDERED_RESULTS;
	const showDropdown = isOpen && debouncedQuery.trim().length >= 2;
	const activeArticle =
		activeIndex >= 0 && activeIndex < renderedResults.length
			? renderedResults[activeIndex]
			: undefined;
	const activeOptionId = activeArticle ? `${listboxId}-option-${activeArticle.id}` : undefined;

	const onInputKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLInputElement>) => {
			if (!showDropdown) return;
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				setActiveIndex((prev) => {
					if (renderedResults.length === 0) return -1;
					const next = prev + 1;
					return next >= renderedResults.length ? 0 : next;
				});
			} else if (event.key === 'ArrowUp') {
				event.preventDefault();
				setActiveIndex((prev) => {
					if (renderedResults.length === 0) return -1;
					if (prev <= 0) return renderedResults.length - 1;
					return prev - 1;
				});
			} else if (event.key === 'Enter') {
				const target =
					activeIndex >= 0 && activeIndex < renderedResults.length
						? renderedResults[activeIndex]
						: renderedResults[0];
				if (target) {
					event.preventDefault();
					onSelectArticle(target.id);
					setIsOpen(false);
					setActiveIndex(-1);
					setQuery('');
					setDebouncedQuery('');
				}
			} else if (event.key === 'Escape') {
				setIsOpen(false);
				setActiveIndex(-1);
			}
		},
		[activeIndex, onSelectArticle, renderedResults, showDropdown],
	);

	// Reset the highlight when the result set changes so keyboard selection
	// always starts from the top of the current query and scope.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional — clears stale highlight state when the query or category scope changes.
	useEffect(() => {
		setActiveIndex(-1);
	}, [debouncedQuery, activeCategoryId]);

	return (
		<div className="relative" ref={containerRef}>
			<div className="relative">
				<SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
				<input
					ref={inputRef}
					type="text"
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						setIsOpen(true);
					}}
					onFocus={() => setIsOpen(true)}
					onKeyDown={onInputKeyDown}
					placeholder="Search articles..."
					aria-label="Search articles"
					aria-autocomplete="list"
					role="combobox"
					aria-expanded={showDropdown}
					aria-controls={showDropdown ? listboxId : undefined}
					aria-activedescendant={activeOptionId}
					className="input-surface h-9 w-full rounded-full py-2 pl-10 pr-10 text-sm outline-none"
				/>
				{query ? (
					<button
						type="button"
						onClick={() => {
							setQuery('');
							setDebouncedQuery('');
							setIsOpen(false);
							setActiveIndex(-1);
						}}
						className="absolute right-3 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
						aria-label="Clear search"
					>
						<X className="h-4 w-4" />
					</button>
				) : null}
			</div>

			{showDropdown ? (
				<div className="surface-card motion-enter absolute left-1/2 top-full z-50 mt-3 max-h-[32rem] w-[min(56rem,calc(100vw-1rem))] -translate-x-1/2 overflow-auto rounded-[1.5rem] p-2 shadow-2xl sm:w-[min(56rem,calc(100vw-2rem))] lg:left-0 lg:w-[min(56rem,calc(100vw-20rem))] lg:translate-x-0 xl:w-[56rem]">
					<div className="mb-2 flex items-center justify-between gap-3 px-3 pt-2">
						<div className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
							Results
						</div>
						{categoryId ? (
							<div className="surface-muted inline-flex rounded-full p-0.5 text-[11px]">
								<button
									type="button"
									onClick={() => setScope('all')}
									aria-pressed={scope === 'all'}
									className={`rounded-full px-2.5 py-1 ${scope === 'all' ? 'bg-background text-foreground' : 'text-muted-foreground'}`}
								>
									All
								</button>
								<button
									type="button"
									onClick={() => setScope('category')}
									aria-pressed={scope === 'category'}
									className={`rounded-full px-2.5 py-1 ${scope === 'category' ? 'bg-background text-foreground' : 'text-muted-foreground'}`}
								>
									Current
								</button>
							</div>
						) : null}
					</div>
					<div id={listboxId} role="listbox" aria-label="Search results">
						{isLoading ? (
							<div className="px-4 py-4 text-sm text-muted-foreground" role="status">
								Searching...
							</div>
						) : renderedResults.length === 0 ? (
							<div className="px-4 py-4 text-sm text-muted-foreground" role="status">
								No results found
							</div>
						) : (
							renderedResults.map((article, index) => {
								const displayedAt = article.displayedAt ? new Date(article.displayedAt) : null;
								const timeAgo = displayedAt
									? formatDistanceToNow(displayedAt, { addSuffix: true })
									: null;
								const isActive = index === activeIndex;
								return (
									<button
										key={article.id}
										id={`${listboxId}-option-${article.id}`}
										type="button"
										role="option"
										aria-selected={isActive}
										onClick={() => {
											onSelectArticle(article.id);
											setIsOpen(false);
											setActiveIndex(-1);
											setQuery('');
											setDebouncedQuery('');
										}}
										onMouseEnter={() => setActiveIndex(index)}
										className={`grid w-full gap-3 rounded-2xl px-4 py-4 text-left hover:bg-accent sm:px-5 md:grid-cols-[1fr_auto] ${
											isActive ? 'bg-accent' : ''
										}`}
									>
										<div className="min-w-0">
											<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
												<span className="font-medium text-foreground/80">{article.feedTitle}</span>
												<span className="hidden text-muted-foreground/70 sm:inline">•</span>
												{timeAgo ? (
													<span className="inline-flex items-center gap-1">
														<CalendarDays className="h-3.5 w-3.5" />
														{timeAgo}
													</span>
												) : null}
											</div>
											<div className="mt-1 line-clamp-2 text-sm font-semibold leading-6 text-foreground sm:text-[0.95rem]">
												{article.title}
											</div>
											{article.excerpt ? (
												<p className="mt-2 line-clamp-4 text-sm leading-6 text-muted-foreground sm:line-clamp-3">
													{article.excerpt}
												</p>
											) : null}
										</div>
										{article.heroImageUrl ? (
											<img
												src={article.heroImageUrl}
												alt=""
												loading="lazy"
												decoding="async"
												referrerPolicy="no-referrer"
												className="hidden h-24 w-36 rounded-2xl object-cover md:block"
											/>
										) : null}
									</button>
								);
							})
						)}
					</div>
					{hasNextPage && !reachedRenderLimit ? (
						<button
							type="button"
							onClick={() => fetchNextPage()}
							disabled={isFetchingNextPage}
							className="mt-1 w-full rounded-2xl px-4 py-3 text-sm font-medium text-primary hover:bg-accent disabled:text-muted-foreground"
						>
							{isFetchingNextPage ? 'Loading more...' : 'Load more results'}
						</button>
					) : null}
					{hasNextPage && reachedRenderLimit ? (
						<div className="mt-1 rounded-2xl px-4 py-3 text-center text-xs text-muted-foreground">
							Showing the first {MAX_RENDERED_RESULTS} results. Refine the search to narrow them.
						</div>
					) : null}
					<div className="mt-1 flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
						<span className="inline-flex items-center gap-1">
							<kbd className="rounded-md border border-border bg-background/70 px-1.5 font-mono text-[10px]">
								↑
							</kbd>
							<kbd className="rounded-md border border-border bg-background/70 px-1.5 font-mono text-[10px]">
								↓
							</kbd>
							navigate
						</span>
						<span className="inline-flex items-center gap-1">
							<kbd className="rounded-md border border-border bg-background/70 px-1.5 font-mono text-[10px]">
								↵
							</kbd>
							open
						</span>
						<span className="inline-flex items-center gap-1">
							<kbd className="rounded-md border border-border bg-background/70 px-1.5 font-mono text-[10px]">
								esc
							</kbd>
							close
						</span>
					</div>
				</div>
			) : null}
		</div>
	);
}
