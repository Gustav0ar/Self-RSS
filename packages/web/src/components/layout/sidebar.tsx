import type { CategoryWithCounts, FeedWithCounts } from '@self-feed/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SidebarErrorFallback } from '@/components/error-fallbacks';
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
import { SidebarBody } from './sidebar-body';
import { computeCategoryReorderUpdates } from './sidebar-reorder';
import { loadExpandedFromStorage, saveExpandedToStorage } from './sidebar-storage';

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

function SidebarContent({
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
	// later prop-driven expansion is not clobbered.
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
	// do not immediately overwrite stored values with the initial empty Set.
	useEffect(() => {
		if (!hydratedRef.current) return;
		saveExpandedToStorage(expandedCategories, uncategorizedExpanded);
	}, [expandedCategories, uncategorizedExpanded]);

	const totalUnread = feeds.reduce((sum, feed) => sum + (feed.unreadCount ?? 0), 0);
	const uncategorizedFeeds = feeds.filter((feed) => !feed.categoryId);
	const hasCategories = flatCategories.length > 0;

	const categoryFeedMap = useMemo(() => {
		const map = new Map<string, FeedWithCounts[]>();
		for (const feed of feeds) {
			if (!feed.categoryId) continue;
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
		if (!activeCategoryId) return;
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

	async function handleCategoryDrop(sourceId: string, targetId: string | null) {
		const updates = computeCategoryReorderUpdates(flatCategories, sourceId, targetId);
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
		if (!deleteState) return;

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

		if (feeds.length === 0) {
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

	const body = (
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
			onToggleUncategorized={() => setUncategorizedExpanded((prev) => !prev)}
			onReorderCategory={(sourceId, targetId) => void handleCategoryDrop(sourceId, targetId)}
			draggingCategoryId={draggingId}
			dragOverCategoryId={dragOverId}
			onCategoryDragStart={setDraggingId}
			onCategoryDragEnd={() => {
				setDraggingId(null);
				setDragOverId(null);
			}}
			onCategoryDragOver={setDragOverId}
			onCategoryDragLeave={(id) => setDragOverId((current) => (current === id ? null : current))}
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
	);

	return (
		<>
			{variant === 'pane' ? (
				<aside className="hidden w-[18rem] shrink-0 md:block xl:w-[19.5rem]">
					<div className="surface-card surface-quiet motion-enter flex h-full flex-col overflow-hidden rounded-2xl bg-sidebar">
						{body}
					</div>
				</aside>
			) : (
				<div className="flex h-full min-h-0 flex-col bg-card">{body}</div>
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

export function Sidebar(props: SidebarProps) {
	return (
		<ErrorBoundary fallback={SidebarErrorFallback}>
			<SidebarContent {...props} />
		</ErrorBoundary>
	);
}
