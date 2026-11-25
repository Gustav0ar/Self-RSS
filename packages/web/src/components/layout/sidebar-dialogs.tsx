import type { CategoryWithCounts, FeedWithCounts } from '@self-feed/shared';
import { lazy, Suspense } from 'react';
import {
	getCategoryDeleteDescription,
	shouldWarnOnCategoryDelete,
} from '@/components/management/management-utils';
import { Dialog } from '@/components/ui/dialog';

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

export type SidebarDialogState =
	| { kind: 'feed-create'; defaultCategoryId?: string }
	| { kind: 'feed-edit'; feed: FeedWithCounts }
	| { kind: 'category-create'; defaultParentCategoryId?: string }
	| { kind: 'category-edit'; category: CategoryWithCounts }
	| { kind: 'import-opml' }
	| { kind: 'delete-feed'; feed: FeedWithCounts }
	| { kind: 'delete-category'; category: CategoryWithCounts }
	| null;

interface SidebarDialogsProps {
	flatCategories: CategoryWithCounts[];
	dialogState: SidebarDialogState;
	deleteError: string | null;
	deletePending: boolean;
	onConfirmDelete: () => Promise<void>;
	onClose: () => void;
}

function SidebarDialogLoadingFallback({ onClose }: { onClose: () => void }) {
	return (
		<Dialog
			onClose={onClose}
			ariaLabel="Loading dialog"
			className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-6"
			panelClassName="surface-card motion-scale w-full max-w-sm rounded-[1.75rem] p-6 text-sm text-muted-foreground shadow-2xl"
		>
			Loading...
		</Dialog>
	);
}

/** Lazy-loads the single active sidebar management dialog behind a focus-owning fallback. */
export function SidebarDialogs({
	flatCategories,
	dialogState,
	deleteError,
	deletePending,
	onConfirmDelete,
	onClose,
}: SidebarDialogsProps) {
	if (!dialogState) {
		return null;
	}

	return (
		<Suspense fallback={<SidebarDialogLoadingFallback onClose={onClose} />}>
			{dialogState.kind === 'feed-create' ? (
				<LazyFeedDialog
					mode="create"
					categories={flatCategories}
					defaultCategoryId={dialogState.defaultCategoryId}
					onClose={onClose}
				/>
			) : null}

			{dialogState.kind === 'feed-edit' ? (
				<LazyFeedDialog
					mode="edit"
					categories={flatCategories}
					feed={dialogState.feed}
					onClose={onClose}
				/>
			) : null}

			{dialogState.kind === 'category-create' ? (
				<LazyCategoryDialog
					mode="create"
					categories={flatCategories}
					defaultParentCategoryId={dialogState.defaultParentCategoryId}
					onClose={onClose}
				/>
			) : null}

			{dialogState.kind === 'category-edit' ? (
				<LazyCategoryDialog
					mode="edit"
					categories={flatCategories}
					category={dialogState.category}
					onClose={onClose}
				/>
			) : null}

			{dialogState.kind === 'import-opml' ? <LazyOpmlImportDialog onClose={onClose} /> : null}

			{dialogState.kind === 'delete-feed' || dialogState.kind === 'delete-category' ? (
				<LazyConfirmDialog
					title={dialogState.kind === 'delete-feed' ? 'Delete feed' : 'Delete category'}
					description={
						dialogState.kind === 'delete-feed'
							? `Delete the feed "${dialogState.feed.title}"? This cannot be undone.`
							: getCategoryDeleteDescription(
									dialogState.category.name,
									dialogState.category.feedCount,
								)
					}
					confirmLabel={
						dialogState.kind === 'delete-category' &&
						shouldWarnOnCategoryDelete(dialogState.category.feedCount)
							? 'Try delete'
							: 'Delete'
					}
					confirmTone="danger"
					isPending={deletePending}
					error={deleteError}
					onConfirm={onConfirmDelete}
					onClose={onClose}
				/>
			) : null}
		</Suspense>
	);
}
