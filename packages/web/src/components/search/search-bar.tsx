import { formatDistanceToNow } from 'date-fns';
import { CalendarDays, Search as SearchIcon, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useSearch } from '@/hooks/queries';

interface SearchBarProps {
	onSelectArticle: (id: string) => void;
}

export function SearchBar({ onSelectArticle }: SearchBarProps) {
	const [query, setQuery] = useState('');
	const [debouncedQuery, setDebouncedQuery] = useState('');
	const [isOpen, setIsOpen] = useState(false);
	const { data: results, isLoading } = useSearch(debouncedQuery);

	useEffect(() => {
		const timeout = window.setTimeout(() => {
			setDebouncedQuery(query);
		}, 300);
		return () => window.clearTimeout(timeout);
	}, [query]);

	return (
		<div className="relative">
			<div className="relative">
				<SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
				<input
					type="text"
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						setIsOpen(true);
					}}
					onFocus={() => setIsOpen(true)}
					placeholder="Search articles..."
					className="input-surface h-9 w-full rounded-full py-2 pl-10 pr-10 text-sm outline-none"
				/>
				{query ? (
					<button
						type="button"
						onClick={() => {
							setQuery('');
							setDebouncedQuery('');
							setIsOpen(false);
						}}
						className="absolute right-3 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
						aria-label="Clear search"
					>
						<X className="h-4 w-4" />
					</button>
				) : null}
			</div>

			{isOpen && debouncedQuery.trim().length >= 2 ? (
				<div className="surface-card motion-enter absolute left-1/2 top-full z-50 mt-3 max-h-[32rem] w-[min(56rem,calc(100vw-1rem))] -translate-x-1/2 overflow-auto rounded-[1.5rem] p-2 shadow-2xl sm:w-[min(56rem,calc(100vw-2rem))] lg:left-0 lg:w-[min(56rem,calc(100vw-20rem))] lg:translate-x-0 xl:w-[56rem]">
					<div className="mb-2 px-3 pt-2 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
						Results
					</div>
					{isLoading ? (
						<div className="px-4 py-4 text-sm text-muted-foreground">Searching...</div>
					) : results?.data.length === 0 ? (
						<div className="px-4 py-4 text-sm text-muted-foreground">No results found</div>
					) : (
						results?.data.map((article) => {
							const displayedAt = article.displayedAt ? new Date(article.displayedAt) : null;
							const timeAgo = displayedAt
								? formatDistanceToNow(displayedAt, { addSuffix: true })
								: null;
							return (
								<button
									key={article.id}
									type="button"
									onClick={() => {
										onSelectArticle(article.id);
										setIsOpen(false);
									}}
									className="grid w-full gap-3 rounded-2xl px-4 py-4 text-left hover:bg-accent sm:px-5 md:grid-cols-[1fr_auto]"
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
				</div>
			) : null}
		</div>
	);
}
