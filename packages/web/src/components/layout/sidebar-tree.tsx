import type { CategoryWithCounts, FeedWithCounts } from '@self-feed/shared';
import {
	Bookmark,
	ChevronDown,
	ChevronRight,
	Folder,
	GripVertical,
	Inbox,
	Pencil,
	Rss as RssIcon,
	Trash2,
	TriangleAlert,
	X,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { feedHealthFingerprint, feedHealthIssue } from '@/lib/feed-health';
import { cn } from '@/lib/utils';
import { SidebarCategoryMoveMenu } from './sidebar-category-move-menu';
import { SidebarFeedHealthIndicator } from './sidebar-feed-health-indicator';
import type { CategoryReorderHandler } from './sidebar-reorder';

interface SidebarTreeProps {
	totalUnread: number;
	selectedFeedId?: string;
	selectedCategoryId?: string;
	savedOnly?: boolean;
	categories: CategoryWithCounts[];
	uncategorizedFeeds: FeedWithCounts[];
	uncategorizedExpanded: boolean;
	expandedCategories: Set<string>;
	categoryFeedMap: Map<string, FeedWithCounts[]>;
	onSelectAll: () => void;
	onSelectSaved?: () => void;
	onSelectFeed: (feedId: string) => void;
	onSelectCategory: (categoryId: string) => void;
	onToggleCategory: (id: string) => void;
	onToggleUncategorized: () => void;
	onReorderCategory: CategoryReorderHandler;
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
	savedOnly,
	categories,
	uncategorizedFeeds,
	uncategorizedExpanded,
	expandedCategories,
	categoryFeedMap,
	onSelectAll,
	onSelectSaved = () => {},
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
	const failedFeeds = uniqueFeeds(uncategorizedFeeds, categoryFeedMap).filter(
		(feed) => feedHealthIssue(feed)?.severity === 'error',
	);
	const healthFingerprint = feedHealthFingerprint(failedFeeds);
	const [dismissedHealthFingerprint, setDismissedHealthFingerprint] = useState<string | null>(null);
	const [reorderAnnouncement, setReorderAnnouncement] = useState('');
	useEffect(() => {
		if (healthFingerprint.length === 0) setDismissedHealthFingerprint(null);
	}, [healthFingerprint]);
	const showHealthSummary =
		failedFeeds.length > 0 && dismissedHealthFingerprint !== healthFingerprint;
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
			<p className="sr-only" aria-live="polite" aria-atomic="true">
				{reorderAnnouncement}
			</p>
			<div className="space-y-1">
				<button
					type="button"
					onClick={onSelectAll}
					aria-label={totalUnread > 0 ? `All Feeds ${totalUnread}` : 'All Feeds'}
					className={cn(
						'flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium hover:bg-accent/80',
						!selectedFeedId &&
							!selectedCategoryId &&
							!savedOnly &&
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

				<button
					type="button"
					onClick={onSelectSaved}
					aria-label="Saved articles"
					className={cn(
						'flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium hover:bg-accent/80',
						savedOnly && 'bg-primary/10 text-sidebar-active shadow-sm',
					)}
				>
					<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<Bookmark className="h-4 w-4" />
					</div>
					<div className="min-w-0 flex-1">
						<p className="truncate">Saved</p>
						<p className="mt-0.5 text-[11px] font-normal text-muted-foreground">
							Articles kept for later
						</p>
					</div>
				</button>

				{showHealthSummary ? (
					<div
						className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-amber-300"
						role="status"
						aria-label={
							failedFeeds.length === 1
								? '1 feed is not updating'
								: `${failedFeeds.length} feeds are not updating`
						}
					>
						<div className="flex items-start gap-2.5">
							<TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
							<div className="min-w-0 flex-1">
								<p className="text-xs font-semibold">
									{failedFeeds.length === 1
										? '1 feed is not updating'
										: `${failedFeeds.length} feeds are not updating`}
								</p>
								<p className="mt-0.5 text-[11px] leading-4 text-amber-200/80">
									Open a warning icon for the latest details.
								</p>
							</div>
							<button
								type="button"
								onClick={() => setDismissedHealthFingerprint(healthFingerprint)}
								className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-amber-200/70 hover:bg-amber-300/10 hover:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60"
								aria-label="Dismiss feed health summary"
							>
								<X className="h-3.5 w-3.5" />
							</button>
						</div>
					</div>
				) : null}

				{categories.map((category, index) => (
					<CategoryTreeRow
						key={category.id}
						category={category}
						siblingCategories={categories}
						siblingIndex={index}
						depth={0}
						onAnnounce={setReorderAnnouncement}
						{...categoryHandlers}
					/>
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

function uniqueFeeds(
	uncategorizedFeeds: FeedWithCounts[],
	categoryFeedMap: Map<string, FeedWithCounts[]>,
) {
	const byId = new Map(uncategorizedFeeds.map((feed) => [feed.id, feed]));
	for (const feeds of categoryFeedMap.values()) {
		for (const feed of feeds) byId.set(feed.id, feed);
	}
	return [...byId.values()];
}

function CategoryTreeRow({
	category,
	siblingCategories,
	siblingIndex,
	depth,
	onAnnounce,
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
}: {
	category: CategoryWithCounts;
	siblingCategories: CategoryWithCounts[];
	siblingIndex: number;
	depth: number;
	onAnnounce: (message: string) => void;
} & CategoryTreeHandlers) {
	const isExpanded = expandedCategories.has(category.id);
	const categoryFeeds = categoryFeedMap.get(category.id) ?? [];
	const childCategories = category.children ?? [];
	const categoryUnread = category.unreadCount ?? 0;
	const hasNestedRows = categoryFeeds.length > 0 || childCategories.length > 0;
	const isDragging = draggingCategoryId === category.id;
	const isDropTarget = dragOverCategoryId === category.id && draggingCategoryId !== category.id;
	const isNested = depth > 0;

	async function handleDrop() {
		const sourceId = draggingCategoryId;
		onCategoryDragEnd();
		if (!sourceId || sourceId === category.id) return;

		const source = siblingCategories.find((sibling) => sibling.id === sourceId);
		if (!source) return;
		const sourceIndex = siblingCategories.findIndex((sibling) => sibling.id === sourceId);
		const result = await onReorderCategory(sourceId, category.id);
		if (result === false) return;
		const nextIndex = sourceIndex < siblingIndex ? siblingIndex : siblingIndex + 1;
		onAnnounce(`${source.name} moved to position ${nextIndex + 1} of ${siblingCategories.length}.`);
	}

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
				void handleDrop();
			}}
		>
			<div className="group/category relative">
				<div
					className={cn(
						'flex w-full min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 pr-28 text-left text-sm font-medium hover:bg-accent/80',
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
						tabIndex={-1}
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
					<SidebarCategoryMoveMenu
						category={category}
						siblingCategories={siblingCategories}
						siblingIndex={siblingIndex}
						onReorderCategory={onReorderCategory}
						onAnnounce={onAnnounce}
					/>
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
					{childCategories.map((childCategory, index) => (
						<CategoryTreeRow
							key={childCategory.id}
							category={childCategory}
							siblingCategories={childCategories}
							siblingIndex={index}
							depth={depth + 1}
							onAnnounce={onAnnounce}
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
	const healthIssue = feedHealthIssue(feed);
	const healthDescriptionId = `feed-health-${feed.id}`;

	return (
		<div className="group/feed relative">
			<div
				className={cn(
					'flex min-h-11 w-full min-w-0 items-center rounded-xl px-2.5 pr-20 text-sm hover:bg-accent/70',
					selectedFeedId === feed.id && 'bg-accent text-sidebar-active',
				)}
			>
				<button
					type="button"
					onClick={() => onSelectFeed(feed.id)}
					aria-label={
						(feed.unreadCount ?? 0) > 0 ? `${feed.title} ${feed.unreadCount}` : feed.title
					}
					aria-describedby={healthIssue ? healthDescriptionId : undefined}
					className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 text-left"
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
				{healthIssue ? (
					<SidebarFeedHealthIndicator
						descriptionId={healthDescriptionId}
						feedTitle={feed.title}
						severity={healthIssue.severity}
						warning={healthIssue.warning}
					/>
				) : null}
			</div>
			{healthIssue ? (
				<span id={healthDescriptionId} className="sr-only">
					{healthIssue.warning}
				</span>
			) : null}
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
		<p className="min-w-0 flex-1 truncate" title={text}>
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
