import type { CategoryWithCounts, FeedWithCounts } from '@self-feed/shared';
import {
	ChevronDown,
	ChevronRight,
	Download,
	Folder,
	FolderPlus,
	GripVertical,
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
	useReorderCategories,
} from '@/hooks/queries';
import { categoryAncestorIds, flattenCategories, flattenCategoryFeeds } from '@/lib/categories';
import { cn } from '@/lib/utils';

interface SidebarProps {
	selectedFeedId?: string;
	selectedCategoryId?: string;
	onSelectAll: () => void;
	onSelectFeed: (feedId: string) => void;
	onSelectCategory: (categoryId: string) => void;
	/**
	 * When true, the sidebar renders full-bleed without the responsive
	 * `hidden md:block` shell. Used inside the mobile drawer.
	 */
	variant?: 'pane' | 'drawer';
}

const SIDEBAR_STORAGE_KEY = 'rss-sidebar-expanded';

function loadExpandedFromStorage(): { categories: string[]; uncategorized: boolean } | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { categories?: unknown; uncategorized?: unknown };
		if (!parsed || typeof parsed !== 'object') return null;
		const categories = Array.isArray(parsed.categories)
			? parsed.categories.filter((id): id is string => typeof id === 'string')
			: [];
		const uncategorized = Boolean(parsed.uncategorized);
		return { categories, uncategorized };
	} catch {
		return null;
	}
}

function saveExpandedToStorage(categories: Set<string>, uncategorized: boolean) {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(
			SIDEBAR_STORAGE_KEY,
			JSON.stringify({ categories: Array.from(categories), uncategorized }),
		);
	} catch {
		// ignore quota or disabled storage
	}
}

export function Sidebar({
	selectedFeedId,
	selectedCategoryId,
	onSelectAll,
	onSelectFeed,
	onSelectCategory,
	variant = 'pane',
}: SidebarProps) {
	const { data: categories } = useCategories();
	const categoryTree = categories ?? [];
	const flatCategories = useMemo(() => flattenCategories(categoryTree), [categoryTree]);
	const feeds = useMemo(() => flattenCategoryFeeds(categoryTree), [categoryTree]);
	const deleteCategory = useDeleteCategory();
	const deleteFeed = useDeleteFeed();
	const exportOpml = useExportOpml();
	const reorderCategories = useReorderCategories();
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const [dragOverId, setDragOverId] = useState<string | null>(null);
	const hydratedRef = useRef(false);
	const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set());
	const [uncategorizedExpanded, setUncategorizedExpanded] = useState(true);
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

	// Hydrate expanded-state from localStorage on mount, but only once so
	// later prop-driven expansion isn't clobbered.
	useEffect(() => {
		if (hydratedRef.current) return;
		hydratedRef.current = true;
		const stored = loadExpandedFromStorage();
		if (stored) {
			setExpandedCategories(new Set(stored.categories));
			setUncategorizedExpanded(stored.uncategorized);
		}
	}, []);

	// Persist expanded-state. Only write after the first hydrate so we
	// don't immediately overwrite stored values with the initial empty Set.
	useEffect(() => {
		if (!hydratedRef.current) return;
		saveExpandedToStorage(expandedCategories, uncategorizedExpanded);
	}, [expandedCategories, uncategorizedExpanded]);

	const _isAllSelected = !selectedFeedId && !selectedCategoryId;
	const totalUnread = feeds.reduce((sum, feed) => sum + (feed.unreadCount ?? 0), 0);
	const uncategorizedFeeds = feeds.filter((feed) => !feed.categoryId);
	const hasCategories = flatCategories.length > 0;

	const categoryFeedMap = useMemo(() => {
		const map = new Map<string, FeedWithCounts[]>();
		for (const feed of feeds) {
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
		() => feeds.find((feed) => feed.id === selectedFeedId)?.categoryId,
		[feeds, selectedFeedId],
	);
	const activeCategoryId = selectedCategoryId ?? selectedFeedCategoryId ?? undefined;

	useEffect(() => {
		if (!activeCategoryId) {
			return;
		}
		const categoriesToExpand = categoryAncestorIds(categoryTree, activeCategoryId);
		if (categoriesToExpand.length === 0) {
			categoriesToExpand.push(activeCategoryId);
		}

		setExpandedCategories((prev) => {
			if (categoriesToExpand.every((id) => prev.has(id))) {
				return prev;
			}

			const next = new Set(prev);
			for (const id of categoriesToExpand) {
				next.add(id);
			}
			return next;
		});
	}, [activeCategoryId, categoryTree]);

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

	function toggleUncategorized() {
		setUncategorizedExpanded((prev) => !prev);
	}

	async function handleCategoryDrop(sourceId: string, targetId: string | null) {
		if (sourceId === targetId) return;

		const source = flatCategories.find((category) => category.id === sourceId);
		if (!source) return;
		const target = targetId ? flatCategories.find((category) => category.id === targetId) : null;
		const sourceParentId = source.parentCategoryId ?? null;
		const targetParentId = target ? (target.parentCategoryId ?? null) : null;
		if (sourceParentId !== targetParentId) return;

		const originalOrder = flatCategories.filter(
			(category) => (category.parentCategoryId ?? null) === sourceParentId,
		);
		const ordered = [...originalOrder];
		const sourceIndex = ordered.findIndex((c) => c.id === sourceId);
		if (sourceIndex < 0) return;
		const [moved] = ordered.splice(sourceIndex, 1);
		if (!moved) return;

		// `targetId == null` is the "drop at the end" case. Otherwise we
		// insert immediately *after* the target row so the user gets a
		// "move my category below this one" semantic. Inserting before
		// the target would force the user to drag the row a hair higher
		// than the source to land the drop, which is harder to aim at.
		let insertAt: number;
		if (targetId == null) {
			insertAt = ordered.length;
		} else {
			const targetIndex = ordered.findIndex((c) => c.id === targetId);
			insertAt = targetIndex < 0 ? ordered.length : targetIndex + 1;
			// If the source was originally before the target, the splice
			// above shifted targetIndex down by one. The `+ 1` lands the
			// row back in its original visual position when the user
			// drops onto a row they did not move past.
			if (sourceIndex < targetIndex) {
				insertAt = targetIndex;
			}
		}
		ordered.splice(insertAt, 0, moved);

		const updates = ordered
			.map((category, index) => ({ id: category.id, sortOrder: index }))
			.filter((update, index) => {
				const original = originalOrder[index];
				return !original || original.id !== update.id || original.sortOrder !== update.sortOrder;
			});

		if (updates.length === 0) return;

		try {
			await reorderCategories.mutateAsync({ updates });
		} catch {
			// Leave the current cache untouched on failure. The next
			// successful server-backed refresh will repaint from the last
			// committed order.
		}
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
			{variant === 'pane' ? (
				<aside className="hidden w-[18rem] shrink-0 md:block xl:w-[19.5rem]">
					<div className="surface-card surface-quiet motion-enter flex h-full flex-col overflow-hidden rounded-2xl bg-sidebar">
						<SidebarBody
							totalUnread={totalUnread}
							feeds={feeds}
							hasCategories={hasCategories}
							selectedFeedId={selectedFeedId}
							selectedCategoryId={selectedCategoryId}
							categories={categoryTree}
							uncategorizedFeeds={uncategorizedFeeds}
							uncategorizedExpanded={uncategorizedExpanded}
							expandedCategories={expandedCategories}
							categoryFeedMap={categoryFeedMap}
							exportError={exportError}
							onSelectAll={onSelectAll}
							onSelectFeed={onSelectFeed}
							onSelectCategory={onSelectCategory}
							onToggleCategory={toggleCategory}
							onToggleUncategorized={toggleUncategorized}
							onReorderCategory={(sourceId, targetId) => handleCategoryDrop(sourceId, targetId)}
							draggingCategoryId={draggingId}
							dragOverCategoryId={dragOverId}
							onCategoryDragStart={setDraggingId}
							onCategoryDragEnd={() => {
								setDraggingId(null);
								setDragOverId(null);
							}}
							onCategoryDragOver={setDragOverId}
							onCategoryDragLeave={(id) =>
								setDragOverId((current) => (current === id ? null : current))
							}
							onAddFeed={() =>
								setFeedDialogState({ mode: 'create', defaultCategoryId: selectedCategoryId })
							}
							onAddCategory={() =>
								setCategoryDialogState({
									mode: 'create',
									defaultParentCategoryId: selectedCategoryId,
								})
							}
							onImportOpml={() => setImportDialogOpen(true)}
							onExportOpml={() => void handleExportOpml()}
							isExporting={exportOpml.isPending}
							onEditCategory={(category) => setCategoryDialogState({ mode: 'edit', category })}
							onDeleteCategory={(category) => {
								setDeleteError(null);
								setDeleteState({ kind: 'category', category });
							}}
							onEditFeed={(feed) => setFeedDialogState({ mode: 'edit', feed })}
							onDeleteFeed={(feed) => {
								setDeleteError(null);
								setDeleteState({ kind: 'feed', feed });
							}}
						/>
					</div>
				</aside>
			) : (
				<div className="flex h-full min-h-0 flex-col bg-card">
					<SidebarBody
						totalUnread={totalUnread}
						feeds={feeds}
						hasCategories={hasCategories}
						selectedFeedId={selectedFeedId}
						selectedCategoryId={selectedCategoryId}
						categories={categoryTree}
						uncategorizedFeeds={uncategorizedFeeds}
						uncategorizedExpanded={uncategorizedExpanded}
						expandedCategories={expandedCategories}
						categoryFeedMap={categoryFeedMap}
						exportError={exportError}
						onSelectAll={onSelectAll}
						onSelectFeed={onSelectFeed}
						onSelectCategory={onSelectCategory}
						onToggleCategory={toggleCategory}
						onToggleUncategorized={toggleUncategorized}
						onReorderCategory={(sourceId, targetId) => handleCategoryDrop(sourceId, targetId)}
						draggingCategoryId={draggingId}
						dragOverCategoryId={dragOverId}
						onCategoryDragStart={setDraggingId}
						onCategoryDragEnd={() => {
							setDraggingId(null);
							setDragOverId(null);
						}}
						onCategoryDragOver={setDragOverId}
						onCategoryDragLeave={(id) =>
							setDragOverId((current) => (current === id ? null : current))
						}
						onAddFeed={() =>
							setFeedDialogState({ mode: 'create', defaultCategoryId: selectedCategoryId })
						}
						onAddCategory={() =>
							setCategoryDialogState({
								mode: 'create',
								defaultParentCategoryId: selectedCategoryId,
							})
						}
						onImportOpml={() => setImportDialogOpen(true)}
						onExportOpml={() => void handleExportOpml()}
						isExporting={exportOpml.isPending}
						onEditCategory={(category) => setCategoryDialogState({ mode: 'edit', category })}
						onDeleteCategory={(category) => {
							setDeleteError(null);
							setDeleteState({ kind: 'category', category });
						}}
						onEditFeed={(feed) => setFeedDialogState({ mode: 'edit', feed })}
						onDeleteFeed={(feed) => {
							setDeleteError(null);
							setDeleteState({ kind: 'feed', feed });
						}}
					/>
				</div>
			)}

			{feedDialogState ? (
				<FeedDialog
					mode={feedDialogState.mode}
					categories={flatCategories}
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
					categories={flatCategories}
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

interface SidebarBodyProps {
	totalUnread: number;
	feeds: FeedWithCounts[] | undefined;
	hasCategories: boolean;
	selectedFeedId?: string;
	selectedCategoryId?: string;
	categories: CategoryWithCounts[] | undefined;
	uncategorizedFeeds: FeedWithCounts[];
	uncategorizedExpanded: boolean;
	expandedCategories: Set<string>;
	categoryFeedMap: Map<string, FeedWithCounts[]>;
	exportError: string | null;
	onSelectAll: () => void;
	onSelectFeed: (feedId: string) => void;
	onSelectCategory: (categoryId: string) => void;
	onToggleCategory: (id: string) => void;
	onToggleUncategorized: () => void;
	onReorderCategory: (sourceId: string, targetId: string | null) => void;
	draggingCategoryId: string | null;
	dragOverCategoryId: string | null;
	onCategoryDragStart: (id: string) => void;
	onCategoryDragEnd: () => void;
	onCategoryDragOver: (id: string) => void;
	onCategoryDragLeave: (id: string) => void;
	onAddFeed: () => void;
	onAddCategory: () => void;
	onImportOpml: () => void;
	onExportOpml: () => void;
	isExporting: boolean;
	onEditCategory: (category: CategoryWithCounts) => void;
	onDeleteCategory: (category: CategoryWithCounts) => void;
	onEditFeed: (feed: FeedWithCounts) => void;
	onDeleteFeed: (feed: FeedWithCounts) => void;
}

function SidebarBody({
	totalUnread,
	feeds,
	hasCategories,
	selectedFeedId,
	selectedCategoryId,
	categories,
	uncategorizedFeeds,
	uncategorizedExpanded,
	expandedCategories,
	categoryFeedMap,
	exportError,
	onSelectAll,
	onSelectFeed,
	onSelectCategory,
	onToggleCategory,
	onToggleUncategorized,
	onReorderCategory,
	draggingCategoryId,
	dragOverCategoryId,
	onCategoryDragStart,
	onCategoryDragEnd,
	onCategoryDragOver,
	onCategoryDragLeave,
	onAddFeed,
	onAddCategory,
	onImportOpml,
	onExportOpml,
	isExporting,
	onEditCategory,
	onDeleteCategory,
	onEditFeed,
	onDeleteFeed,
}: SidebarBodyProps) {
	return (
		<>
			<div className="panel-divider px-3.5 py-3">
				<div className="flex items-start justify-between gap-3">
					<div>
						<p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
							Workspace
						</p>
						<h2 className="mt-1.5 text-base font-semibold tracking-tight">Your feeds</h2>
						<p className="mt-0.5 text-xs text-muted-foreground">
							{totalUnread > 0 ? `${totalUnread} unread stories` : 'Everything is caught up'}
						</p>
					</div>
					<div className="surface-muted rounded-xl px-2.5 py-1.5 text-right">
						<p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Feeds</p>
						<p className="text-sm font-semibold text-foreground">{feeds?.length ?? 0}</p>
					</div>
				</div>

				<div className="mt-3 grid grid-cols-4 gap-1.5">
					<SidebarAction
						label="Add Feed"
						title="Add Feed"
						onClick={onAddFeed}
						disabled={!hasCategories}
					>
						<Radio className="h-4 w-4" />
					</SidebarAction>
					<SidebarAction label="Add Category" title="Add Category" onClick={onAddCategory}>
						<FolderPlus className="h-4 w-4" />
					</SidebarAction>
					<SidebarAction label="Import OPML" title="Import OPML" onClick={onImportOpml}>
						<Upload className="h-4 w-4" />
					</SidebarAction>
					<SidebarAction
						label="Export OPML"
						title="Export OPML"
						onClick={onExportOpml}
						disabled={isExporting}
					>
						<Download className="h-4 w-4" />
					</SidebarAction>
				</div>

				{exportError ? <p className="mt-3 text-xs text-red-500">{exportError}</p> : null}
			</div>

			<nav className="flex-1 overflow-auto px-2.5 pb-2.5 pt-2.5">
				<div className="space-y-1">
					<button
						type="button"
						onClick={onSelectAll}
						aria-label={totalUnread > 0 ? `All Feeds ${totalUnread}` : 'All Feeds'}
						className={cn(
							'flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium hover:bg-accent/80',
							!selectedFeedId &&
								!selectedCategoryId &&
								'bg-primary/10 text-sidebar-active shadow-sm',
						)}
					>
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
							<Inbox className="h-4 w-4" />
						</div>
						<div className="min-w-0 flex-1">
							<p className="truncate">All Feeds</p>
							<p className="mt-0.5 text-[11px] font-normal text-muted-foreground">
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
						const childCategories = category.children ?? [];
						const categoryUnread = category.unreadCount ?? 0;
						const hasNestedRows = categoryFeeds.length > 0 || childCategories.length > 0;
						const isDragging = draggingCategoryId === category.id;
						const isDropTarget =
							dragOverCategoryId === category.id && draggingCategoryId !== category.id;

						return (
							// biome-ignore lint/a11y/noStaticElementInteractions: HTML5 drag-and-drop has no semantic primitive; the inner grip is a button.
							<div
								key={category.id}
								className={cn(
									'group rounded-xl transition-shadow',
									isDragging && 'opacity-50',
									isDropTarget && 'ring-2 ring-primary/60 ring-offset-2 ring-offset-sidebar',
								)}
								onDragOver={(event) => {
									if (draggingCategoryId == null || draggingCategoryId === category.id) return;
									event.preventDefault();
									event.dataTransfer.dropEffect = 'move';
									onCategoryDragOver(category.id);
								}}
								onDragLeave={(event) => {
									if (event.currentTarget === event.target) {
										onCategoryDragLeave(category.id);
									}
								}}
								onDrop={(event) => {
									event.preventDefault();
									if (draggingCategoryId && draggingCategoryId !== category.id) {
										onReorderCategory(draggingCategoryId, category.id);
									}
									onCategoryDragEnd();
								}}
							>
								<div className="group/category relative">
									<div
										className={cn(
											'flex w-full min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 pr-20 text-left text-sm font-medium hover:bg-accent/80',
											selectedCategoryId === category.id && 'bg-accent text-sidebar-active',
										)}
									>
										<button
											type="button"
											aria-label={`Drag to reorder ${category.name}`}
											title="Drag to reorder"
											draggable
											onDragStart={(event) => {
												event.dataTransfer.effectAllowed = 'move';
												event.dataTransfer.setData('text/plain', category.id);
												onCategoryDragStart(category.id);
											}}
											onDragEnd={onCategoryDragEnd}
											className="-ml-1 inline-flex h-7 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-opacity hover:bg-background/80 hover:text-muted-foreground group-hover/category:opacity-100 group-focus-within/category:opacity-100"
										>
											<GripVertical className="h-3.5 w-3.5" />
										</button>
										<button
											type="button"
											onClick={(event) => {
												event.stopPropagation();
												if (!hasNestedRows) return;
												onToggleCategory(category.id);
											}}
											aria-label={
												isExpanded ? `Collapse ${category.name}` : `Expand ${category.name}`
											}
											aria-expanded={isExpanded}
											disabled={!hasNestedRows}
											className="-ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background/80 disabled:opacity-30"
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
												categoryUnread > 0 ? `${category.name} ${categoryUnread}` : category.name
											}
											className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
										>
											<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background/80 text-primary">
												<Folder className="h-4 w-4" />
											</div>
											<div className="min-w-0 flex-1 overflow-hidden">
												<p className="truncate">{category.name}</p>
												<p className="mt-0.5 truncate text-[11px] font-normal text-muted-foreground">
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
									<div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/category:opacity-100 group-focus-within/category:opacity-100 touch-only">
										<SidebarIconButton
											label={`Edit ${category.name}`}
											onClick={() => onEditCategory(category)}
										>
											<Pencil className="h-3.5 w-3.5" />
										</SidebarIconButton>
										<SidebarIconButton
											label={`Delete ${category.name}`}
											onClick={() => onDeleteCategory(category)}
											className="hover:text-red-500"
										>
											<Trash2 className="h-3.5 w-3.5" />
										</SidebarIconButton>
									</div>
								</div>

								{isExpanded ? (
									<div className="mt-0.5 space-y-0.5 pl-5">
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
														'flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 pr-20 text-left text-sm hover:bg-accent/70',
														selectedFeedId === feed.id && 'bg-accent text-sidebar-active',
													)}
												>
													<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-background/75">
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
												<div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/feed:opacity-100 group-focus-within/feed:opacity-100 touch-only">
													<SidebarIconButton
														label={`Edit ${feed.title}`}
														onClick={() => onEditFeed(feed)}
													>
														<Pencil className="h-3.5 w-3.5" />
													</SidebarIconButton>
													<SidebarIconButton
														label={`Delete ${feed.title}`}
														onClick={() => onDeleteFeed(feed)}
														className="hover:text-red-500"
													>
														<Trash2 className="h-3.5 w-3.5" />
													</SidebarIconButton>
												</div>
											</div>
										))}
										{childCategories.map((childCategory) => (
											<NestedCategoryRow
												key={childCategory.id}
												category={childCategory}
												selectedFeedId={selectedFeedId}
												selectedCategoryId={selectedCategoryId}
												expandedCategories={expandedCategories}
												categoryFeedMap={categoryFeedMap}
												onSelectFeed={onSelectFeed}
												onSelectCategory={onSelectCategory}
												onToggleCategory={onToggleCategory}
												onEditCategory={onEditCategory}
												onDeleteCategory={onDeleteCategory}
												onEditFeed={onEditFeed}
												onDeleteFeed={onDeleteFeed}
											/>
										))}
									</div>
								) : null}
							</div>
						);
					})}

					{uncategorizedFeeds.length > 0 ? (
						<div className="pt-2">
							<div className="group/uncategorized flex w-full items-center gap-1 rounded-xl pl-1.5 pr-2">
								<button
									type="button"
									onClick={onToggleUncategorized}
									aria-label={
										uncategorizedExpanded ? 'Collapse Uncategorized' : 'Expand Uncategorized'
									}
									aria-expanded={uncategorizedExpanded}
									className="-ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background/80"
								>
									{uncategorizedExpanded ? (
										<ChevronDown className="h-3.5 w-3.5" />
									) : (
										<ChevronRight className="h-3.5 w-3.5" />
									)}
								</button>
								<p className="select-none px-1.5 pb-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
									Uncategorized
								</p>
							</div>
							{uncategorizedExpanded ? (
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
													'flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 pr-20 text-left text-sm hover:bg-accent/70',
													selectedFeedId === feed.id && 'bg-accent text-sidebar-active',
												)}
											>
												<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-background/75">
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
											<div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/feed:opacity-100 group-focus-within/feed:opacity-100 touch-only">
												<SidebarIconButton
													label={`Edit ${feed.title}`}
													onClick={() => onEditFeed(feed)}
												>
													<Pencil className="h-3.5 w-3.5" />
												</SidebarIconButton>
												<SidebarIconButton
													label={`Delete ${feed.title}`}
													onClick={() => onDeleteFeed(feed)}
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
					) : null}
				</div>
			</nav>
		</>
	);
}

function NestedCategoryRow({
	category,
	selectedFeedId,
	selectedCategoryId,
	expandedCategories,
	categoryFeedMap,
	onSelectFeed,
	onSelectCategory,
	onToggleCategory,
	onEditCategory,
	onDeleteCategory,
	onEditFeed,
	onDeleteFeed,
}: {
	category: CategoryWithCounts;
	selectedFeedId?: string;
	selectedCategoryId?: string;
	expandedCategories: Set<string>;
	categoryFeedMap: Map<string, FeedWithCounts[]>;
	onSelectFeed: (feedId: string) => void;
	onSelectCategory: (categoryId: string) => void;
	onToggleCategory: (id: string) => void;
	onEditCategory: (category: CategoryWithCounts) => void;
	onDeleteCategory: (category: CategoryWithCounts) => void;
	onEditFeed: (feed: FeedWithCounts) => void;
	onDeleteFeed: (feed: FeedWithCounts) => void;
}) {
	const isExpanded = expandedCategories.has(category.id);
	const categoryFeeds = categoryFeedMap.get(category.id) ?? [];
	const childCategories = category.children ?? [];
	const categoryUnread = category.unreadCount ?? 0;
	const hasNestedRows = categoryFeeds.length > 0 || childCategories.length > 0;

	return (
		<div className="space-y-0.5">
			<div className="group/category relative">
				<div
					className={cn(
						'flex w-full min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 pr-20 text-left text-sm font-medium hover:bg-accent/80',
						selectedCategoryId === category.id && 'bg-accent text-sidebar-active',
					)}
				>
					<span className="h-7 w-3 shrink-0 border-l border-border/60" aria-hidden="true" />
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							if (!hasNestedRows) return;
							onToggleCategory(category.id);
						}}
						aria-label={isExpanded ? `Collapse ${category.name}` : `Expand ${category.name}`}
						aria-expanded={isExpanded}
						disabled={!hasNestedRows}
						className="-ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background/80 disabled:opacity-30"
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
						aria-label={categoryUnread > 0 ? `${category.name} ${categoryUnread}` : category.name}
						className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
					>
						<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-background/80 text-primary">
							<Folder className="h-3.5 w-3.5" />
						</div>
						<div className="min-w-0 flex-1 overflow-hidden">
							<p className="truncate">{category.name}</p>
							<p className="mt-0.5 truncate text-[11px] font-normal text-muted-foreground">
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
				<div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/category:opacity-100 group-focus-within/category:opacity-100 touch-only">
					<SidebarIconButton
						label={`Edit ${category.name}`}
						onClick={() => onEditCategory(category)}
					>
						<Pencil className="h-3.5 w-3.5" />
					</SidebarIconButton>
					<SidebarIconButton
						label={`Delete ${category.name}`}
						onClick={() => onDeleteCategory(category)}
						className="hover:text-red-500"
					>
						<Trash2 className="h-3.5 w-3.5" />
					</SidebarIconButton>
				</div>
			</div>

			{isExpanded ? (
				<div className="space-y-0.5 pl-5">
					{categoryFeeds.map((feed) => (
						<FeedTreeRow
							key={feed.id}
							feed={feed}
							selectedFeedId={selectedFeedId}
							onSelectFeed={onSelectFeed}
							onEditFeed={onEditFeed}
							onDeleteFeed={onDeleteFeed}
						/>
					))}
					{childCategories.map((childCategory) => (
						<NestedCategoryRow
							key={childCategory.id}
							category={childCategory}
							selectedFeedId={selectedFeedId}
							selectedCategoryId={selectedCategoryId}
							expandedCategories={expandedCategories}
							categoryFeedMap={categoryFeedMap}
							onSelectFeed={onSelectFeed}
							onSelectCategory={onSelectCategory}
							onToggleCategory={onToggleCategory}
							onEditCategory={onEditCategory}
							onDeleteCategory={onDeleteCategory}
							onEditFeed={onEditFeed}
							onDeleteFeed={onDeleteFeed}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}

function FeedTreeRow({
	feed,
	selectedFeedId,
	onSelectFeed,
	onEditFeed,
	onDeleteFeed,
}: {
	feed: FeedWithCounts;
	selectedFeedId?: string;
	onSelectFeed: (feedId: string) => void;
	onEditFeed: (feed: FeedWithCounts) => void;
	onDeleteFeed: (feed: FeedWithCounts) => void;
}) {
	return (
		<div className="group/feed relative">
			<button
				type="button"
				onClick={() => onSelectFeed(feed.id)}
				aria-label={(feed.unreadCount ?? 0) > 0 ? `${feed.title} ${feed.unreadCount}` : feed.title}
				className={cn(
					'flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 pr-20 text-left text-sm hover:bg-accent/70',
					selectedFeedId === feed.id && 'bg-accent text-sidebar-active',
				)}
			>
				<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-background/75">
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
			<div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/feed:opacity-100 group-focus-within/feed:opacity-100 touch-only">
				<SidebarIconButton label={`Edit ${feed.title}`} onClick={() => onEditFeed(feed)}>
					<Pencil className="h-3.5 w-3.5" />
				</SidebarIconButton>
				<SidebarIconButton
					label={`Delete ${feed.title}`}
					onClick={() => onDeleteFeed(feed)}
					className="hover:text-red-500"
				>
					<Trash2 className="h-3.5 w-3.5" />
				</SidebarIconButton>
			</div>
		</div>
	);
}

function SidebarOverflowText({ text }: { text: string }) {
	return (
		<p className="truncate" title={text}>
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
			className="surface-muted inline-flex h-10 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
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
				'pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-background hover:text-foreground',
				className,
			)}
			aria-label={label}
		>
			{children}
		</button>
	);
}
