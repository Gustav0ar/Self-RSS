import type { SortOrder } from '@self-feed/shared';
import { ArrowDownUp, CheckCheck, Filter, RefreshCw } from 'lucide-react';
import { FeedToolbarButton as ToolbarButton } from './feed-toolbar-button';

interface FeedListToolbarProps {
	unreadOnly: boolean;
	savedOnly: boolean;
	sort: SortOrder;
	refreshBlocked: boolean;
	refreshing: boolean;
	refreshActionBlocked: boolean;
	markAllReadBlocked: boolean;
	refreshGuidance?: string;
	onUnreadToggle: () => void;
	onSortToggle: () => void;
	onMarkAllRead: () => void;
	onRefresh: () => void;
}

export function FeedListToolbar({
	unreadOnly,
	savedOnly,
	sort,
	refreshBlocked,
	refreshing,
	refreshActionBlocked,
	markAllReadBlocked,
	refreshGuidance,
	onUnreadToggle,
	onSortToggle,
	onMarkAllRead,
	onRefresh,
}: FeedListToolbarProps) {
	return (
		<div className="mt-2.5 flex flex-wrap items-center gap-1.5">
			<ToolbarButton active={unreadOnly} onClick={onUnreadToggle} label="Unread">
				<Filter className="h-3.5 w-3.5" />
			</ToolbarButton>
			<ToolbarButton onClick={onSortToggle} label={sort === 'latest' ? 'Newest' : 'Oldest'}>
				<ArrowDownUp className="h-3.5 w-3.5" />
			</ToolbarButton>
			{savedOnly ? (
				<span className="ml-auto" />
			) : (
				<ToolbarButton
					onClick={onMarkAllRead}
					label="Mark all read"
					className="ml-auto"
					disabled={markAllReadBlocked}
					title={markAllReadBlocked ? 'Reconnect to mark all articles as read' : undefined}
				>
					<CheckCheck className="h-3.5 w-3.5" />
				</ToolbarButton>
			)}
			<ToolbarButton
				onClick={onRefresh}
				label={refreshBlocked ? 'Refresh unavailable' : 'Refresh'}
				disabled={refreshing || refreshActionBlocked}
				title={refreshGuidance}
			>
				<RefreshCw className="h-3.5 w-3.5" />
			</ToolbarButton>
		</div>
	);
}
