import type { CategoryWithCounts, FeedWithCounts } from '@self-feed/shared';
import {
	ChevronDown,
	ChevronRight,
	Folder,
	GripVertical,
	Inbox,
	Pencil,
	Rss as RssIcon,
	Trash2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SidebarTreeProps {
	totalUnread: number;
	selectedFeedId?: string;
	selectedCategoryId?: string;
	categories: CategoryWithCounts[];
	uncategorizedFeeds: FeedWithCounts[];
	uncategorizedExpanded: boolean;
	expandedCategories: Set<string>;
	categoryFeedMap: Map<string, FeedWithCounts[]>;
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
	onEditCategory: (category: CategoryWithCounts) => void;
	onDeleteCategory: (category: CategoryWithCounts) => void;
	onEditFeed: (feed: FeedWithCounts) => void;
	onDeleteFeed: (feed: FeedWithCounts) => void;
}

type CategoryTreeHandlers = Pick<
	SidebarTreeProps,
	| 'selectedFeedId'
	| 'selectedCategoryId'
	| 'expandedCategories'
	| 'categoryFeedMap'
	| 'onSelectFeed'
	| 'onSelectCategory'
	| 'onToggleCategory'
	| 'onReorderCategory'
	| 'draggingCategoryId'
	| 'dragOverCategoryId'
	| 'onCategoryDragStart'
	| 'onCategoryDragEnd'
	| 'onCategoryDragOver'
	| 'onCategoryDragLeave'
	| 'onEditCategory'
	| 'onDeleteCategory'
	| 'onEditFeed'
	| 'onDeleteFeed'
>;

export function SidebarTree({
	totalUnread,
	selectedFeedId,
	selectedCategoryId,
	categories,
	uncategorizedFeeds,
	uncategorizedExpanded,
	expandedCategories,
	categoryFeedMap,
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
	onEditCategory,
	onDeleteCategory,
	onEditFeed,
	onDeleteFeed,
}: SidebarTreeProps) {
	const categoryHandlers: CategoryTreeHandlers = {
		selectedFeedId,
		selectedCategoryId,
		expandedCategories,
		categoryFeedMap,
		onSelectFeed,
		onSelectCategory,
		onToggleCategory,
		onReorderCategory,
		draggingCategoryId,
		dragOverCategoryId,
		onCategoryDragStart,
		onCategoryDragEnd,
		onCategoryDragOver,
		onCategoryDragLeave,
		onEditCategory,
		onDeleteCategory,
		onEditFeed,
		onDeleteFeed,
	};

	return (
		<nav className="flex-1 overflow-auto px-2.5 pb-2.5 pt-2.5">
			<div className="space-y-1">
				<button
					type="button"
					onClick={onSelectAll}
					aria-label={totalUnread > 0 ? `All Feeds ${totalUnread}` : 'All Feeds'}
					className={cn(
						'flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium hover:bg-accent/80',
						!selectedFeedId && !selectedCategoryId && 'bg-primary/10 text-sidebar-active shadow-sm',
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

				{categories.map((category) => (
					<CategoryTreeRow key={category.id} category={category} depth={0} {...categoryHandlers} />
				))}

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
									<FeedTreeRow
										key={feed.id}
										feed={feed}
										selectedFeedId={selectedFeedId}
										onSelectFeed={onSelectFeed}
										onEditFeed={onEditFeed}
										onDeleteFeed={onDeleteFeed}
									/>
								))}
							</div>
						) : null}
					</div>
				) : null}
			</div>
		</nav>
	);
}

function CategoryTreeRow({
	category,
	depth,
	selectedFeedId,
	selectedCategoryId,
	expandedCategories,
	categoryFeedMap,
	onSelectFeed,
	onSelectCategory,
	onToggleCategory,
	onReorderCategory,
	draggingCategoryId,
	dragOverCategoryId,
	onCategoryDragStart,
	onCategoryDragEnd,
	onCategoryDragOver,
	onCategoryDragLeave,
	onEditCategory,
	onDeleteCategory,
	onEditFeed,
	onDeleteFeed,
}: { category: CategoryWithCounts; depth: number } & CategoryTreeHandlers) {
	const isExpanded = expandedCategories.has(category.id);
	const categoryFeeds = categoryFeedMap.get(category.id) ?? [];
	const childCategories = category.children ?? [];
	const categoryUnread = category.unreadCount ?? 0;
	const hasNestedRows = categoryFeeds.length > 0 || childCategories.length > 0;
	const isDragging = draggingCategoryId === category.id;
	const isDropTarget = dragOverCategoryId === category.id && draggingCategoryId !== category.id;
	const isNested = depth > 0;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: HTML5 drag-and-drop has no semantic primitive; the inner grip is a button.
		<div
			className={cn(
				'rounded-xl transition-shadow',
				isNested && 'space-y-0.5',
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
					{isNested ? (
						<span className="h-7 w-3 shrink-0 border-l border-border/60" aria-hidden="true" />
					) : null}
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
						<div
							className={cn(
								'flex shrink-0 items-center justify-center rounded-lg bg-background/80 text-primary',
								isNested ? 'h-7 w-7' : 'h-8 w-8',
							)}
						>
							<Folder className={isNested ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
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
				<div className={cn('space-y-0.5 pl-5', !isNested && 'mt-0.5')}>
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
						<CategoryTreeRow
							key={childCategory.id}
							category={childCategory}
							depth={depth + 1}
							selectedFeedId={selectedFeedId}
							selectedCategoryId={selectedCategoryId}
							expandedCategories={expandedCategories}
							categoryFeedMap={categoryFeedMap}
							onReorderCategory={onReorderCategory}
							draggingCategoryId={draggingCategoryId}
							dragOverCategoryId={dragOverCategoryId}
							onCategoryDragStart={onCategoryDragStart}
							onCategoryDragEnd={onCategoryDragEnd}
							onCategoryDragOver={onCategoryDragOver}
							onCategoryDragLeave={onCategoryDragLeave}
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
						<img
							src={feed.faviconUrl}
							alt=""
							className="h-4 w-4 rounded-sm"
							loading="lazy"
							decoding="async"
							referrerPolicy="no-referrer"
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

function SidebarIconButton({
	label,
	onClick,
	children,
	className,
}: {
	label: string;
	onClick: () => void;
	children: ReactNode;
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
