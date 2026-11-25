import type { CategoryWithCounts, FeedWithCounts } from '@self-feed/shared';
import { lazy, Suspense } from 'react';
import {
	getCategoryDeleteDescription,
	shouldWarnOnCategoryDelete,
} from '@/components/management/management-utils';

const LazyFeedDialog = lazy(() =>
	import('@/components/management/feed-dialog').then((module) => ({
		default: module.FeedDialog,
	})),
);
const LazyCategoryDialog = lazy(() =>
	import('@/components/management/category-dialog').then((module) => ({
		default: module.CategoryDialog,
	})),
);
const LazyOpmlImportDialog = lazy(() =>
	import('@/components/management/opml-import-dialog').then((module) => ({
		default: module.OpmlImportDialog,
	})),
);
const LazyConfirmDialog = lazy(() =>
	import('@/components/management/confirm-dialog').then((module) => ({
		default: module.ConfirmDialog,
	})),
);

export type SidebarFeedDialogState =
	| { mode: 'create'; defaultCategoryId?: string }
	| { mode: 'edit'; feed: FeedWithCounts }
	| null;

export type SidebarCategoryDialogState =
	| { mode: 'create'; defaultParentCategoryId?: string }
	| { mode: 'edit'; category: CategoryWithCounts }
	| null;

export type SidebarDeleteState =
	| { kind: 'feed'; feed: FeedWithCounts }
	| { kind: 'category'; category: CategoryWithCounts }
	| null;

interface SidebarDialogsProps {
	flatCategories: CategoryWithCounts[];
	feedDialogState: SidebarFeedDialogState;
	categoryDialogState: SidebarCategoryDialogState;
	importDialogOpen: boolean;
	deleteState: SidebarDeleteState;
	deleteError: string | null;
	deletePending: boolean;
	onCloseFeedDialog: () => void;
	onCloseCategoryDialog: () => void;
	onCloseImportDialog: () => void;
	onConfirmDelete: () => Promise<void>;
	onCloseDeleteDialog: () => void;
}

/** Lazy-loads sidebar management dialogs so they stay out of the initial web bundle. */
export function SidebarDialogs({
	flatCategories,
	feedDialogState,
	categoryDialogState,
	importDialogOpen,
	deleteState,
	deleteError,
	deletePending,
	onCloseFeedDialog,
	onCloseCategoryDialog,
	onCloseImportDialog,
	onConfirmDelete,
	onCloseDeleteDialog,
}: SidebarDialogsProps) {
	if (!feedDialogState && !categoryDialogState && !importDialogOpen && !deleteState) {
		return null;
	}

	return (
		<Suspense fallback={null}>
			{feedDialogState ? (
				<LazyFeedDialog
					mode={feedDialogState.mode}
					categories={flatCategories}
					feed={feedDialogState.mode === 'edit' ? feedDialogState.feed : undefined}
					defaultCategoryId={
						feedDialogState.mode === 'create' ? feedDialogState.defaultCategoryId : undefined
					}
					onClose={onCloseFeedDialog}
				/>
			) : null}

			{categoryDialogState ? (
				<LazyCategoryDialog
					mode={categoryDialogState.mode}
					categories={flatCategories}
					category={categoryDialogState.mode === 'edit' ? categoryDialogState.category : undefined}
					defaultParentCategoryId={
						categoryDialogState.mode === 'create'
							? categoryDialogState.defaultParentCategoryId
							: undefined
					}
					onClose={onCloseCategoryDialog}
				/>
			) : null}

			{importDialogOpen ? <LazyOpmlImportDialog onClose={onCloseImportDialog} /> : null}

			{deleteState ? (
				<LazyConfirmDialog
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
					isPending={deletePending}
					error={deleteError}
					onConfirm={onConfirmDelete}
					onClose={onCloseDeleteDialog}
				/>
			) : null}
		</Suspense>
	);
}
