import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect } from 'react';

const WORDS_PER_MINUTE = 220;

/** Estimate reading time in whole minutes for articles with at least 20 words. */
export function estimateReadingMinutes(
	contentText: string | null | undefined,
	html: string,
): number | null {
	const text = (contentText?.trim() || html.replace(/<[^>]+>/g, ' ')).trim();
	if (!text) return null;
	const words = text.split(/\s+/).filter(Boolean).length;
	if (words < 20) return null;
	return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** Static, zero-animation skeleton matching the article reader header and body layout. */
export function ReaderSkeleton() {
	return (
		<div className="flex-1 overflow-auto px-4 py-4 sm:px-5 lg:px-6" role="status">
			<span className="sr-only">Loading article...</span>
			<div className="max-w-[82ch] space-y-5" aria-hidden="true">
				<div className="flex items-center gap-2">
					<div className="h-4 w-4 rounded-sm bg-muted" />
					<div className="h-3.5 w-28 rounded bg-muted" />
					<div className="h-3.5 w-20 rounded bg-muted" />
				</div>
				<div className="space-y-2.5">
					<div className="h-7 w-11/12 rounded bg-muted" />
					<div className="h-7 w-3/4 rounded bg-muted" />
				</div>
				<div className="flex gap-2">
					<div className="h-9 w-20 rounded-full bg-muted" />
					<div className="h-9 w-24 rounded-full bg-muted" />
					<div className="h-9 w-20 rounded-full bg-muted" />
				</div>
				<div className="space-y-3 border-t border-border/70 pt-5">
					<div className="h-4 w-full rounded bg-muted" />
					<div className="h-4 w-11/12 rounded bg-muted" />
					<div className="h-4 w-10/12 rounded bg-muted" />
					<div className="h-4 w-full rounded bg-muted" />
					<div className="h-4 w-4/5 rounded bg-muted" />
				</div>
			</div>
		</div>
	);
}

/** Full-screen click-to-zoom lightbox for reader images with Escape and backdrop dismissal. */
export function ReaderImageLightbox({
	image,
	onClose,
}: {
	image: { src: string; alt: string };
	onClose: () => void;
}) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [onClose]);

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label={image.alt || 'Image preview'}
			className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 p-4"
		>
			<button
				type="button"
				onClick={onClose}
				aria-label="Dismiss image preview"
				className="absolute inset-0 cursor-default"
			/>
			<button
				type="button"
				onClick={onClose}
				aria-label="Close image preview"
				className="absolute right-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/70 text-white hover:bg-white/15"
			>
				<X className="h-5 w-5" />
			</button>
			<img
				src={image.src}
				alt={image.alt}
				referrerPolicy="no-referrer"
				className="relative z-10 max-h-[85vh] max-w-[92vw] rounded-lg object-contain"
			/>
			{image.alt ? (
				<p className="relative z-10 mt-3 max-w-2xl text-center text-xs text-white/80">
					{image.alt}
				</p>
			) : null}
		</div>
	);
}

export function MetadataLine({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid gap-1">
			<span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
			<span className="break-words text-foreground">{value}</span>
		</div>
	);
}

export function QueueButton({
	article,
	icon,
	label,
	onSelectArticle,
}: {
	article: { id: string; title: string } | null;
	icon: ReactNode;
	label: string;
	onSelectArticle: (id: string) => void;
}) {
	if (!article) {
		return (
			<span className="flex min-h-14 items-center gap-2 rounded-lg border border-border/70 px-2.5 py-2 text-xs text-muted-foreground/70">
				{icon}
				{label}
			</span>
		);
	}

	return (
		<button
			type="button"
			onClick={() => onSelectArticle(article.id)}
			className="flex min-h-14 items-start gap-2 rounded-lg border border-border/70 px-2.5 py-2 text-left text-xs hover:bg-accent"
		>
			<span className="mt-0.5 text-muted-foreground">{icon}</span>
			<span className="min-w-0">
				<span className="block text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
					{label}
				</span>
				<span className="mt-0.5 line-clamp-2 font-medium leading-5 text-foreground">
					{article.title}
				</span>
			</span>
		</button>
	);
}
