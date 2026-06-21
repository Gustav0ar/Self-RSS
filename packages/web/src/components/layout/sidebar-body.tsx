import type { CategoryWithCounts, FeedWithCounts } from '@self-feed/shared';
import { Download, FolderPlus, Radio, Upload } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SidebarTree } from './sidebar-tree';

interface SidebarBodyProps {
	totalUnread: number;
	feeds: FeedWithCounts[];
	hasCategories: boolean;
	selectedFeedId?: string;
	selectedCategoryId?: string;
	categories: CategoryWithCounts[];
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

export function SidebarBody({
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
						<p className="text-sm font-semibold text-foreground">{feeds.length}</p>
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

			<SidebarTree
				totalUnread={totalUnread}
				selectedFeedId={selectedFeedId}
				selectedCategoryId={selectedCategoryId}
				categories={categories}
				uncategorizedFeeds={uncategorizedFeeds}
				uncategorizedExpanded={uncategorizedExpanded}
				expandedCategories={expandedCategories}
				categoryFeedMap={categoryFeedMap}
				onSelectAll={onSelectAll}
				onSelectFeed={onSelectFeed}
				onSelectCategory={onSelectCategory}
				onToggleCategory={onToggleCategory}
				onToggleUncategorized={onToggleUncategorized}
				onReorderCategory={onReorderCategory}
				draggingCategoryId={draggingCategoryId}
				dragOverCategoryId={dragOverCategoryId}
				onCategoryDragStart={onCategoryDragStart}
				onCategoryDragEnd={onCategoryDragEnd}
				onCategoryDragOver={onCategoryDragOver}
				onCategoryDragLeave={onCategoryDragLeave}
				onEditCategory={onEditCategory}
				onDeleteCategory={onDeleteCategory}
				onEditFeed={onEditFeed}
				onDeleteFeed={onDeleteFeed}
			/>
		</>
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
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-label={label}
			title={title}
			className={cn(
				'surface-muted inline-flex h-10 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50',
			)}
		>
			{children}
		</button>
	);
}
