import type { FeedWithCounts } from '@self-feed/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SidebarErrorFallback } from '@/components/error-fallbacks';
import { QueryFailure } from '@/components/query-failure';
import {
	useCategories,
	useDeleteCategory,
	useDeleteFeed,
	useExportOpml,
	useReorderCategories,
} from '@/hooks/queries';
import { categoryAncestorIds, flattenCategories, flattenCategoryFeeds } from '@/lib/categories';
import { SidebarBody } from './sidebar-body';
import {
	type SidebarCategoryDialogState,
	type SidebarDeleteState,
	SidebarDialogs,
	type SidebarFeedDialogState,
} from './sidebar-dialogs';
import { computeCategoryReorderUpdates } from './sidebar-reorder';
import { loadExpandedFromStorage, saveExpandedToStorage } from './sidebar-storage';

interface SidebarProps {
	selectedFeedId?: string;
	selectedCategoryId?: string;
	savedOnly?: boolean;
	onSelectAll: () => void;
	onSelectSaved?: () => void;
	onSelectFeed: (feedId: string) => void;
	onSelectCategory: (categoryId: string) => void;
	/** Drawer mode omits the responsive pane shell. */
	variant?: 'pane' | 'drawer';
}

function SidebarContent({
	selectedFeedId,
	selectedCategoryId,
	savedOnly,
	onSelectAll,
	onSelectSaved = () => {},
	onSelectFeed,
	onSelectCategory,
	variant = 'pane',
}: SidebarProps) {
	const {
		data: categories,
		error: categoriesError,
		isError: categoriesFailed,
		isFetching: categoriesFetching,
		isLoading: categoriesLoading,
		refetch: refetchCategories,
	} = useCategories();
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
	const [feedDialogState, setFeedDialogState] = useState<SidebarFeedDialogState>(null);
	const [categoryDialogState, setCategoryDialogState] = useState<SidebarCategoryDialogState>(null);
	const [importDialogOpen, setImportDialogOpen] = useState(false);
	const [deleteState, setDeleteState] = useState<SidebarDeleteState>(null);
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
		if (updates.length === 0) return false;

		try {
			await reorderCategories.mutateAsync({ updates });
			return true;
		} catch {
			// Leave the current cache untouched on failure. The next
			// successful server-backed refresh will repaint from the last
			// committed order.
			return false;
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

	const sidebarBody = (
		<SidebarBody
			totalUnread={totalUnread}
			feeds={feeds}
			hasCategories={hasCategories}
			selectedFeedId={selectedFeedId}
			selectedCategoryId={selectedCategoryId}
			savedOnly={savedOnly}
			categories={categoryTree}
			uncategorizedFeeds={uncategorizedFeeds}
			uncategorizedExpanded={uncategorizedExpanded}
			expandedCategories={expandedCategories}
			categoryFeedMap={categoryFeedMap}
			exportError={exportError}
			onSelectAll={onSelectAll}
			onSelectSaved={onSelectSaved}
			onSelectFeed={onSelectFeed}
			onSelectCategory={onSelectCategory}
			onToggleCategory={toggleCategory}
			onToggleUncategorized={() => setUncategorizedExpanded((prev) => !prev)}
			onReorderCategory={handleCategoryDrop}
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
	const body =
		categoriesLoading && !categories ? (
			<div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
				Loading feeds...
			</div>
		) : categoriesFailed && !categories ? (
			<div className="flex flex-1 items-center justify-center p-4">
				<QueryFailure
					title="Could not load feeds"
					error={categoriesError}
					onRetry={() => void refetchCategories()}
					isRetrying={categoriesFetching}
					className="w-full"
				/>
			</div>
		) : (
			<>
				{categoriesFailed ? (
					<QueryFailure
						title="Feeds could not be refreshed"
						error={categoriesError}
						description="Showing the last available feed list."
						onRetry={() => void refetchCategories()}
						isRetrying={categoriesFetching}
						compact
						className="mx-3 mt-3"
					/>
				) : null}
				{sidebarBody}
			</>
		);

	return (
		<>
			{variant === 'pane' ? (
				<aside className="hidden w-[18rem] shrink-0 lg:block xl:w-[19.5rem]">
					<div className="surface-card surface-quiet motion-enter flex h-full flex-col overflow-hidden rounded-2xl bg-sidebar">
						{body}
					</div>
				</aside>
			) : (
				<div className="flex h-full min-h-0 flex-col bg-card">{body}</div>
			)}

			<SidebarDialogs
				flatCategories={flatCategories}
				feedDialogState={feedDialogState}
				categoryDialogState={categoryDialogState}
				importDialogOpen={importDialogOpen}
				deleteState={deleteState}
				deleteError={deleteError}
				deletePending={deleteFeed.isPending || deleteCategory.isPending}
				onCloseFeedDialog={() => setFeedDialogState(null)}
				onCloseCategoryDialog={() => setCategoryDialogState(null)}
				onCloseImportDialog={() => setImportDialogOpen(false)}
				onConfirmDelete={confirmDelete}
				onCloseDeleteDialog={() => {
					setDeleteError(null);
					setDeleteState(null);
				}}
			/>
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
