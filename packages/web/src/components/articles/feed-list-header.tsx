import { Sparkles } from 'lucide-react';

interface FeedListHeaderProps {
	title: string;
	loadedCount: number;
	unreadCount: number;
}

export function FeedListHeader({ title, loadedCount, unreadCount }: FeedListHeaderProps) {
	return (
		<div className="flex items-start justify-between gap-3">
			<div className="min-w-0">
				<div className="flex min-w-0 items-center gap-2">
					<p className="truncate text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
						Reading queue
					</p>
					<span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" />
					<span className="shrink-0 text-[11px] text-muted-foreground">{loadedCount} loaded</span>
				</div>
				<h1 className="mt-1 truncate text-lg font-semibold tracking-tight">{title}</h1>
			</div>
			<div className="surface-muted flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs text-muted-foreground">
				<Sparkles className="h-3.5 w-3.5 text-primary" />
				<span>{unreadCount > 0 ? `${unreadCount} unread` : 'Caught up'}</span>
			</div>
		</div>
	);
}
