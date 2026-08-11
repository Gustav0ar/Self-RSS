import { Bookmark, BookmarkCheck, ExternalLink, Eye, EyeOff } from 'lucide-react';

interface ReaderActionsProps {
	canonicalUrl: string | null;
	isRead: boolean;
	isSaved: boolean;
	saveDisabled: boolean;
	onToggleRead: () => void;
	onToggleSaved: () => void;
}

export function ReaderPrimaryActions({
	canonicalUrl,
	isRead,
	isSaved,
	saveDisabled,
	onToggleRead,
	onToggleSaved,
}: ReaderActionsProps) {
	return (
		<div className="mt-4 flex flex-wrap items-center gap-2">
			<button
				type="button"
				onClick={onToggleSaved}
				disabled={saveDisabled}
				aria-pressed={isSaved}
				className="inline-flex h-9 items-center gap-2 rounded-full border border-border px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
			>
				{isSaved ? (
					<BookmarkCheck className="h-3.5 w-3.5 text-primary" />
				) : (
					<Bookmark className="h-3.5 w-3.5" />
				)}
				{isSaved ? 'Saved' : 'Save'}
			</button>
			<button
				type="button"
				onClick={onToggleRead}
				className="inline-flex h-9 items-center gap-2 rounded-full border border-border px-3 text-xs font-medium hover:bg-accent"
			>
				{isRead ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
				{isRead ? 'Mark unread' : 'Mark read'}
			</button>
			{canonicalUrl ? (
				<a
					href={canonicalUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex h-9 items-center gap-2 rounded-full border border-border px-3 text-xs font-medium hover:bg-accent"
				>
					<ExternalLink className="h-3.5 w-3.5" />
					Original
				</a>
			) : null}
		</div>
	);
}

export function ReaderCompactActions({
	canonicalUrl,
	isRead,
	isSaved,
	saveDisabled,
	onToggleRead,
	onToggleSaved,
}: ReaderActionsProps) {
	return (
		<div className="mt-4 grid grid-cols-3 gap-2">
			<button
				type="button"
				onClick={onToggleSaved}
				disabled={saveDisabled}
				aria-label={isSaved ? 'Remove from saved' : 'Save article'}
				className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border text-xs font-medium hover:bg-accent disabled:opacity-50"
			>
				{isSaved ? (
					<BookmarkCheck className="h-3.5 w-3.5 text-primary" />
				) : (
					<Bookmark className="h-3.5 w-3.5" />
				)}
			</button>
			<button
				type="button"
				onClick={onToggleRead}
				className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border text-xs font-medium hover:bg-accent"
			>
				{isRead ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
				{isRead ? 'Unread' : 'Read'}
			</button>
			{canonicalUrl ? (
				<a
					href={canonicalUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border text-xs font-medium hover:bg-accent"
				>
					<ExternalLink className="h-3.5 w-3.5" />
					Open
				</a>
			) : (
				<span className="inline-flex h-9 items-center justify-center rounded-lg border border-border text-xs text-muted-foreground">
					No link
				</span>
			)}
		</div>
	);
}
