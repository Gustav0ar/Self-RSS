import type { CategoryWithCounts, FeedWithCounts } from '@self-feed/shared';
import {
	ChevronDown,
	ChevronRight,
	Download,
	Folder,
	FolderPlus,
	Inbox,
	Pencil,
	Radio,
	Rss as RssIcon,
	Trash2,
	Upload,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CategoryDialog } from '@/components/management/category-dialog';
import { ConfirmDialog } from '@/components/management/confirm-dialog';
import { FeedDialog } from '@/components/management/feed-dialog';
import {
	getCategoryDeleteDescription,
	shouldWarnOnCategoryDelete,
} from '@/components/management/management-utils';
import { OpmlImportDialog } from '@/components/management/opml-import-dialog';
import {
	useCategories,
	useDeleteCategory,
	useDeleteFeed,
	useExportOpml,
	useFeeds,
} from '@/hooks/queries';
import { cn } from '@/lib/utils';

interface SidebarProps {
	selectedFeedId?: string;
	selectedCategoryId?: string;
	onSelectAll: () => void;
	onSelectFeed: (feedId: string) => void;
	onSelectCategory: (categoryId: string) => void;
}

export function Sidebar({
	selectedFeedId,
	selectedCategoryId,
	onSelectAll,
	onSelectFeed,
	onSelectCategory,
}: SidebarProps) {
	const { data: categories } = useCategories();
	const { data: feeds } = useFeeds();
	const deleteCategory = useDeleteCategory();
	const deleteFeed = useDeleteFeed();
	const exportOpml = useExportOpml();
	const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
	const [feedDialogState, setFeedDialogState] = useState<
		{ mode: 'create'; defaultCategoryId?: string } | { mode: 'edit'; feed: FeedWithCounts } | null
	>(null);
	const [categoryDialogState, setCategoryDialogState] = useState<
		| { mode: 'create'; defaultParentCategoryId?: string }
		| { mode: 'edit'; category: CategoryWithCounts }
		| null
	>(null);
	const [importDialogOpen, setImportDialogOpen] = useState(false);
	const [deleteState, setDeleteState] = useState<
		| { kind: 'feed'; feed: FeedWithCounts }
		| { kind: 'category'; category: CategoryWithCounts }
		| null
	>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);

	const isAllSelected = !selectedFeedId && !selectedCategoryId;
	const totalUnread = feeds?.reduce((sum, feed) => sum + (feed.unreadCount ?? 0), 0) ?? 0;
	const uncategorizedFeeds = feeds?.filter((feed) => !feed.categoryId) ?? [];
	const hasCategories = (categories?.length ?? 0) > 0;

	const categoryFeedMap = useMemo(() => {
		const map = new Map<string, FeedWithCounts[]>();
		for (const feed of feeds ?? []) {
			if (!feed.categoryId) {
				continue;
			}
			const current = map.get(feed.categoryId) ?? [];
			current.push(feed);
			map.set(feed.categoryId, current);
		}
		return map;
	}, [feeds]);
	const selectedFeedCategoryId = useMemo(
		() => feeds?.find((feed) => feed.id === selectedFeedId)?.categoryId,
		[feeds, selectedFeedId],
	);
	const activeCategoryId = selectedCategoryId ?? selectedFeedCategoryId ?? undefined;

	useEffect(() => {
		if (!activeCategoryId) {
			return;
		}

		setExpandedCategories((prev) => {
			if (prev.has(activeCategoryId)) {
				return prev;
			}

			const next = new Set(prev);
			next.add(activeCategoryId);
			return next;
		});
	}, [activeCategoryId]);

	function toggleCategory(id: string) {
		setExpandedCategories((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	}

	async function confirmDelete() {
		if (!deleteState) {
			return;
		}

		setDeleteError(null);
		try {
			if (deleteState.kind === 'feed') {
				await deleteFeed.mutateAsync(deleteState.feed.id);
				if (selectedFeedId === deleteState.feed.id) {
					onSelectAll();
				}
			} else {
				await deleteCategory.mutateAsync(deleteState.category.id);
				if (selectedCategoryId === deleteState.category.id) {
					onSelectAll();
				}
			}
			setDeleteState(null);
		} catch (error) {
			setDeleteError(error instanceof Error ? error.message : 'Delete failed');
		}
	}

	async function handleExportOpml() {
		setExportError(null);

		if (!feeds || feeds.length === 0) {
			setExportError('No feeds to export');
			return;
		}

		try {
			const result = await exportOpml.mutateAsync();
			const fileUrl = URL.createObjectURL(result.blob);
			const link = document.createElement('a');
			link.href = fileUrl;
			link.download = result.filename ?? 'self-feed-feeds.opml';
			document.body.appendChild(link);
			link.click();
			link.remove();
			URL.revokeObjectURL(fileUrl);
		} catch (error) {
			setExportError(error instanceof Error ? error.message : 'Export failed');
		}
	}

	return (
		<>
			<aside className="hidden w-[19rem] shrink-0 md:block xl:w-[21rem]">
				<div className="surface-card motion-enter flex h-full flex-col overflow-hidden rounded-[1.5rem] bg-sidebar">
					<div className="panel-divider px-4 py-4">
						<div className="flex items-start justify-between gap-3">
							<div>
								<p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
									Workspace
								</p>
								<h2 className="mt-2 text-lg font-semibold tracking-tight">Your feeds</h2>
								<p className="mt-1 text-sm text-muted-foreground">
									{totalUnread > 0 ? `${totalUnread} unread stories` : 'Everything is caught up'}
								</p>
							</div>
							<div className="surface-muted rounded-2xl px-3 py-2 text-right">
								<p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
									Feeds
								</p>
								<p className="text-sm font-semibold text-foreground">{feeds?.length ?? 0}</p>
							</div>
						</div>

						<div className="mt-4 grid grid-cols-4 gap-2">
							<SidebarAction
								label="Add Feed"
								title="Add Feed"
								onClick={() =>
									setFeedDialogState({ mode: 'create', defaultCategoryId: selectedCategoryId })
								}
								disabled={!hasCategories}
							>
								<Radio className="h-4 w-4" />
							</SidebarAction>
							<SidebarAction
								label="Add Category"
								title="Add Category"
								onClick={() =>
									setCategoryDialogState({
										mode: 'create',
										defaultParentCategoryId: selectedCategoryId,
									})
								}
							>
								<FolderPlus className="h-4 w-4" />
							</SidebarAction>
							<SidebarAction
								label="Import OPML"
								title="Import OPML"
								onClick={() => setImportDialogOpen(true)}
							>
								<Download className="h-4 w-4" />
							</SidebarAction>
							<SidebarAction
								label="Export OPML"
								title="Export OPML"
								onClick={() => void handleExportOpml()}
								disabled={exportOpml.isPending}
							>
								<Upload className="h-4 w-4" />
							</SidebarAction>
						</div>

						{exportError ? <p className="mt-3 text-xs text-red-500">{exportError}</p> : null}
					</div>

					<nav className="flex-1 overflow-auto px-3 pb-3 pt-3">
						<div className="space-y-1.5">
							<button
								type="button"
								onClick={onSelectAll}
								aria-label={totalUnread > 0 ? `All Feeds ${totalUnread}` : 'All Feeds'}
								className={cn(
									'flex w-full min-w-0 items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium hover:bg-accent/80',
									isAllSelected && 'bg-primary/10 text-sidebar-active shadow-sm',
								)}
							>
								<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
									<Inbox className="h-4 w-4" />
								</div>
								<div className="min-w-0 flex-1">
									<p className="truncate">All Feeds</p>
									<p className="mt-0.5 text-xs font-normal text-muted-foreground">
										Everything in one stream
									</p>
								</div>
								{totalUnread > 0 ? (
									<span className="shrink-0 rounded-full bg-background/90 px-2.5 py-1 text-xs text-muted-foreground">
										{totalUnread}
									</span>
								) : null}
							</button>

							{categories?.map((category) => {
								const isExpanded = expandedCategories.has(category.id);
								const categoryFeeds = categoryFeedMap.get(category.id) ?? [];
								const categoryUnread = categoryFeeds.reduce(
									(sum, feed) => sum + (feed.unreadCount ?? 0),
									0,
								);

								return (
									<div key={category.id} className="group rounded-[1.25rem]">
										<div className="group/category relative">
											<div
												className={cn(
													'flex w-full min-w-0 items-center gap-3 rounded-2xl px-3 py-3 pr-22 text-left text-sm font-medium hover:bg-accent/80',
													selectedCategoryId === category.id && 'bg-accent text-sidebar-active',
												)}
											>
												<button
													type="button"
													onClick={(event) => {
														event.stopPropagation();
														toggleCategory(category.id);
													}}
													aria-label={
														isExpanded ? `Collapse ${category.name}` : `Expand ${category.name}`
													}
													className="-ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background/80"
												>
													{isExpanded ? (
														<ChevronDown className="h-3.5 w-3.5" />
													) : (
														<ChevronRight className="h-3.5 w-3.5" />
													)}
												</button>
												<button
													type="button"
													onClick={() => onSelectCategory(category.id)}
													aria-label={
														categoryUnread > 0
															? `${category.name} ${categoryUnread}`
															: category.name
													}
													className="flex min-w-0 flex-1 items-center gap-3 text-left"
												>
													<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-background/80 text-primary">
														<Folder className="h-4 w-4" />
													</div>
													<div className="min-w-0 flex-1 overflow-hidden">
														<p className="truncate">{category.name}</p>
														<p className="mt-0.5 truncate text-xs font-normal text-muted-foreground">
															{category.feedCount} {category.feedCount === 1 ? 'feed' : 'feeds'}
														</p>
													</div>
													{categoryUnread > 0 ? (
														<span className="shrink-0 rounded-full bg-background/90 px-2.5 py-1 text-xs text-muted-foreground transition-opacity group-hover/category:opacity-0 group-focus-within/category:opacity-0">
															{categoryUnread}
														</span>
													) : null}
												</button>
											</div>
											<div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/category:opacity-100 group-focus-within/category:opacity-100">
												<SidebarIconButton
													label={`Edit ${category.name}`}
													onClick={() => setCategoryDialogState({ mode: 'edit', category })}
												>
													<Pencil className="h-3.5 w-3.5" />
												</SidebarIconButton>
												<SidebarIconButton
													label={`Delete ${category.name}`}
													onClick={() => {
														setDeleteError(null);
														setDeleteState({ kind: 'category', category });
													}}
													className="hover:text-red-500"
												>
													<Trash2 className="h-3.5 w-3.5" />
												</SidebarIconButton>
											</div>
										</div>

										{isExpanded ? (
											<div className="mt-1 space-y-1 pl-6">
												{categoryFeeds.map((feed) => (
													<div key={feed.id} className="group/feed relative">
														<button
															type="button"
															onClick={() => onSelectFeed(feed.id)}
															aria-label={
																(feed.unreadCount ?? 0) > 0
																	? `${feed.title} ${feed.unreadCount}`
																	: feed.title
															}
															className={cn(
																'flex w-full min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5 pr-22 text-left text-sm hover:bg-accent/70',
																selectedFeedId === feed.id && 'bg-accent text-sidebar-active',
															)}
														>
															<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-background/75">
																{feed.faviconUrl ? (
																	<img
																		src={feed.faviconUrl}
																		alt=""
																		className="h-4 w-4 rounded-sm"
																	/>
																) : (
																	<RssIcon className="h-4 w-4 text-muted-foreground" />
																)}
															</div>
															<div className="min-w-0 flex-1 overflow-hidden">
																<SidebarOverflowText text={feed.title} />
															</div>
															{(feed.unreadCount ?? 0) > 0 ? (
																<span className="shrink-0 rounded-full bg-background/90 px-2.5 py-1 text-xs text-muted-foreground transition-opacity group-hover/feed:opacity-0 group-focus-within/feed:opacity-0">
																	{feed.unreadCount}
																</span>
															) : null}
														</button>
														<div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/feed:opacity-100 group-focus-within/feed:opacity-100">
															<SidebarIconButton
																label={`Edit ${feed.title}`}
																onClick={() => setFeedDialogState({ mode: 'edit', feed })}
															>
																<Pencil className="h-3.5 w-3.5" />
															</SidebarIconButton>
															<SidebarIconButton
																label={`Delete ${feed.title}`}
																onClick={() => {
																	setDeleteError(null);
																	setDeleteState({ kind: 'feed', feed });
																}}
																className="hover:text-red-500"
															>
																<Trash2 className="h-3.5 w-3.5" />
															</SidebarIconButton>
														</div>
													</div>
												))}
											</div>
										) : null}
									</div>
								);
							})}

							{uncategorizedFeeds.length > 0 ? (
								<div className="pt-3">
									<p className="px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
										Uncategorized
									</p>
									<div className="space-y-1">
										{uncategorizedFeeds.map((feed) => (
											<div key={feed.id} className="group/feed relative">
												<button
													type="button"
													onClick={() => onSelectFeed(feed.id)}
													aria-label={
														(feed.unreadCount ?? 0) > 0
															? `${feed.title} ${feed.unreadCount}`
															: feed.title
													}
													className={cn(
														'flex w-full min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5 pr-22 text-left text-sm hover:bg-accent/70',
														selectedFeedId === feed.id && 'bg-accent text-sidebar-active',
													)}
												>
													<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-background/75">
														{feed.faviconUrl ? (
															<img src={feed.faviconUrl} alt="" className="h-4 w-4 rounded-sm" />
														) : (
															<RssIcon className="h-4 w-4 text-muted-foreground" />
														)}
													</div>
													<div className="min-w-0 flex-1 overflow-hidden">
														<SidebarOverflowText text={feed.title} />
													</div>
													{(feed.unreadCount ?? 0) > 0 ? (
														<span className="shrink-0 rounded-full bg-background/90 px-2.5 py-1 text-xs text-muted-foreground transition-opacity group-hover/feed:opacity-0 group-focus-within/feed:opacity-0">
															{feed.unreadCount}
														</span>
													) : null}
												</button>
												<div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/feed:opacity-100 group-focus-within/feed:opacity-100">
													<SidebarIconButton
														label={`Edit ${feed.title}`}
														onClick={() => setFeedDialogState({ mode: 'edit', feed })}
													>
														<Pencil className="h-3.5 w-3.5" />
													</SidebarIconButton>
													<SidebarIconButton
														label={`Delete ${feed.title}`}
														onClick={() => {
															setDeleteError(null);
															setDeleteState({ kind: 'feed', feed });
														}}
														className="hover:text-red-500"
													>
														<Trash2 className="h-3.5 w-3.5" />
													</SidebarIconButton>
												</div>
											</div>
										))}
									</div>
								</div>
							) : null}
						</div>
					</nav>
				</div>
			</aside>

			{feedDialogState ? (
				<FeedDialog
					mode={feedDialogState.mode}
					categories={categories ?? []}
					feed={feedDialogState.mode === 'edit' ? feedDialogState.feed : undefined}
					defaultCategoryId={
						feedDialogState.mode === 'create' ? feedDialogState.defaultCategoryId : undefined
					}
					onClose={() => setFeedDialogState(null)}
				/>
			) : null}

			{categoryDialogState ? (
				<CategoryDialog
					mode={categoryDialogState.mode}
					categories={categories ?? []}
					category={categoryDialogState.mode === 'edit' ? categoryDialogState.category : undefined}
					defaultParentCategoryId={
						categoryDialogState.mode === 'create'
							? categoryDialogState.defaultParentCategoryId
							: undefined
					}
					onClose={() => setCategoryDialogState(null)}
				/>
			) : null}

			{importDialogOpen ? <OpmlImportDialog onClose={() => setImportDialogOpen(false)} /> : null}

			{deleteState ? (
				<ConfirmDialog
					title={deleteState.kind === 'feed' ? 'Delete feed' : 'Delete category'}
					description={
						deleteState.kind === 'feed'
							? `Delete the feed "${deleteState.feed.title}"? This cannot be undone.`
							: getCategoryDeleteDescription(
									deleteState.category.name,
									deleteState.category.feedCount,
								)
					}
					confirmLabel={
						deleteState.kind === 'category' &&
						shouldWarnOnCategoryDelete(deleteState.category.feedCount)
							? 'Try delete'
							: 'Delete'
					}
					confirmTone="danger"
					isPending={deleteFeed.isPending || deleteCategory.isPending}
					error={deleteError}
					onConfirm={confirmDelete}
					onClose={() => {
						setDeleteError(null);
						setDeleteState(null);
					}}
				/>
			) : null}
		</>
	);
}

function SidebarOverflowText({ text }: { text: string }) {
	const ref = useRef<HTMLParagraphElement>(null);
	const [showTitle, setShowTitle] = useState(false);

	useEffect(() => {
		const element = ref.current;
		if (!element) {
			return;
		}

		const update = () => {
			setShowTitle(element.scrollWidth > element.clientWidth);
		};

		update();
		window.addEventListener('resize', update);
		return () => window.removeEventListener('resize', update);
	}, []);

	return (
		<p ref={ref} className="truncate" title={showTitle ? text : undefined}>
			{text}
		</p>
	);
}

function SidebarAction({
	label,
	title,
	onClick,
	disabled,
	children,
}: {
	label: string;
	title: string;
	onClick: () => void;
	disabled?: boolean;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-label={label}
			title={title}
			className="surface-muted inline-flex h-11 items-center justify-center rounded-2xl text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
		>
			{children}
		</button>
	);
}

function SidebarIconButton({
	label,
	onClick,
	children,
	className,
}: {
	label: string;
	onClick: () => void;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				'pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground hover:bg-background hover:text-foreground',
				className,
			)}
			aria-label={label}
		>
			{children}
		</button>
	);
}
