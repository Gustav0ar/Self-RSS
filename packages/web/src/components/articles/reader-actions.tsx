import {
	Bookmark,
	BookmarkCheck,
	ExternalLink,
	Eye,
	EyeOff,
	Minus,
	Plus,
	Type,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { FONT_FAMILY_OPTIONS } from '@/lib/preferences';

const MIN_READER_TEXT_SIZE = 12;
const MAX_READER_TEXT_SIZE = 24;

interface ReaderTypographyProps {
	fontFamily: string;
	textSize: number;
	onUpdateTypography: (patch: { fontFamily?: string; textSize?: number }) => void;
}

interface ReaderActionsProps {
	canonicalUrl: string | null;
	isRead: boolean;
	isSaved: boolean;
	saveDisabled: boolean;
	onToggleRead: () => void;
	onToggleSaved: () => void;
	typography?: ReaderTypographyProps;
}

function ReaderTypographyControl({
	fontFamily,
	textSize,
	onUpdateTypography,
}: ReaderTypographyProps) {
	const [open, setOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setOpen(false);
		};
		const onPointerDown = (event: PointerEvent) => {
			if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
				setOpen(false);
			}
		};
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('pointerdown', onPointerDown);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('pointerdown', onPointerDown);
		};
	}, [open]);

	return (
		<div ref={containerRef} className="relative">
			<button
				type="button"
				onClick={() => setOpen((current) => !current)}
				aria-expanded={open}
				aria-haspopup="dialog"
				className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium hover:bg-accent"
			>
				<Type className="h-3.5 w-3.5" aria-hidden="true" />
				<span className="sr-only">Reader typography </span>
				Aa
			</button>
			{open ? (
				<div
					role="dialog"
					aria-label="Typography settings"
					className="absolute left-0 top-11 z-30 w-64 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl"
				>
					<div className="space-y-3">
						<div className="flex items-center justify-between gap-2">
							<span className="text-xs font-medium text-muted-foreground">Text size</span>
							<div className="inline-flex items-center gap-1">
								<button
									type="button"
									aria-label="Decrease text size"
									disabled={textSize <= MIN_READER_TEXT_SIZE}
									onClick={() =>
										onUpdateTypography({
											textSize: Math.max(MIN_READER_TEXT_SIZE, textSize - 1),
										})
									}
									className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-accent disabled:opacity-40"
								>
									<Minus className="h-3.5 w-3.5" />
								</button>
								<span className="w-10 text-center font-mono text-xs">{textSize}px</span>
								<button
									type="button"
									aria-label="Increase text size"
									disabled={textSize >= MAX_READER_TEXT_SIZE}
									onClick={() =>
										onUpdateTypography({
											textSize: Math.min(MAX_READER_TEXT_SIZE, textSize + 1),
										})
									}
									className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-accent disabled:opacity-40"
								>
									<Plus className="h-3.5 w-3.5" />
								</button>
							</div>
						</div>
						<label className="grid gap-1.5">
							<span className="text-xs font-medium text-muted-foreground">Font</span>
							<select
								aria-label="Reader font family"
								value={fontFamily}
								onChange={(event) => onUpdateTypography({ fontFamily: event.target.value })}
								className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
							>
								{FONT_FAMILY_OPTIONS.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</label>
					</div>
				</div>
			) : null}
		</div>
	);
}

export function ReaderPrimaryActions({
	canonicalUrl,
	isRead,
	isSaved,
	saveDisabled,
	onToggleRead,
	onToggleSaved,
	typography,
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
			{typography ? <ReaderTypographyControl {...typography} /> : null}
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
