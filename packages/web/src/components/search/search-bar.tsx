import { formatDistanceToNow } from 'date-fns';
import { CalendarDays, Search as SearchIcon, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSearch } from '@/hooks/queries';

interface SearchBarProps {
	onSelectArticle: (id: string) => void;
}

export function SearchBar({ onSelectArticle }: SearchBarProps) {
	const [query, setQuery] = useState('');
	const [debouncedQuery, setDebouncedQuery] = useState('');
	const [isOpen, setIsOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const { data: results, isLoading } = useSearch(debouncedQuery);

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

	const resultIds = results?.data ?? [];
	const showDropdown = isOpen && debouncedQuery.trim().length >= 2;

	const onInputKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLInputElement>) => {
			if (!showDropdown) return;
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				setActiveIndex((prev) => {
					const next = prev + 1;
					return next >= resultIds.length ? 0 : next;
				});
			} else if (event.key === 'ArrowUp') {
				event.preventDefault();
				setActiveIndex((prev) => {
					if (prev <= 0) return resultIds.length - 1;
					return prev - 1;
				});
			} else if (event.key === 'Enter') {
				const target =
					activeIndex >= 0 && activeIndex < resultIds.length
						? resultIds[activeIndex]
						: resultIds[0];
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
		[activeIndex, onSelectArticle, resultIds, showDropdown],
	);

	// Reset the highlight when the debounced query changes so the user
	// always starts at the top of a fresh result set.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional — runs on every debounced-query change to clear stale highlight state.
	useEffect(() => {
		setActiveIndex(-1);
	}, [debouncedQuery]);

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
					<div className="mb-2 px-3 pt-2 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
						Results
					</div>
					{isLoading ? (
						<div className="px-4 py-4 text-sm text-muted-foreground">Searching...</div>
					) : results?.data.length === 0 ? (
						<div className="px-4 py-4 text-sm text-muted-foreground">No results found</div>
					) : (
						results?.data.map((article, index) => {
							const displayedAt = article.displayedAt ? new Date(article.displayedAt) : null;
							const timeAgo = displayedAt
								? formatDistanceToNow(displayedAt, { addSuffix: true })
								: null;
							const isActive = index === activeIndex;
							return (
								<button
									key={article.id}
									type="button"
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
											className="hidden h-24 w-36 rounded-2xl object-cover md:block"
										/>
									) : null}
								</button>
							);
						})
					)}
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
