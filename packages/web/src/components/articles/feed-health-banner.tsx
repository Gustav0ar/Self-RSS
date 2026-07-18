import type { FeedWithCounts } from '@self-feed/shared';
import type { FeedHealthIssue } from '@/lib/feed-health';
import { presentFeedLifecycle } from '@/lib/feed-lifecycle';
import { cn } from '@/lib/utils';

export function FeedHealthBanner({
	appError,
	sourceIssue,
	feed,
	onSelectCandidate,
	onCancelReplacement,
	isActionPending = false,
}: {
	appError: string | null;
	sourceIssue: FeedHealthIssue | null;
	feed?: FeedWithCounts | null;
	onSelectCandidate?: (candidateId: string) => void;
	onCancelReplacement?: () => void;
	isActionPending?: boolean;
}) {
	if (appError) {
		return (
			<div
				className="mx-3 mt-3 rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
				role="alert"
			>
				{appError}
			</div>
		);
	}
	const lifecycle = feed?.lifecycleStatus ? presentFeedLifecycle(feed) : null;
	if (lifecycle) {
		const candidates = feed?.discovery?.candidates ?? [];
		return (
			<div
				className={cn(
					'mx-3 mt-3 rounded-xl border px-3 py-2 text-sm',
					lifecycle.tone === 'error'
						? 'border-destructive/25 bg-destructive/10 text-destructive'
						: lifecycle.tone === 'warning'
							? 'border-amber-400/30 bg-amber-400/10 text-amber-100'
							: 'border-primary/25 bg-primary/10 text-foreground',
				)}
				role={lifecycle.tone === 'error' ? 'alert' : 'status'}
				aria-live="polite"
			>
				<p className="font-semibold">{lifecycle.title}</p>
				<p className="mt-0.5 text-xs leading-5 opacity-90">{lifecycle.detail}</p>
				{lifecycle.discoveryRequired ? (
					candidates.length > 0 ? (
						<fieldset className="mt-2 grid gap-1.5">
							<legend className="sr-only">Discovered feeds</legend>
							{candidates.map((candidate) => (
								<button
									key={candidate.id}
									type="button"
									disabled={isActionPending}
									onClick={() => onSelectCandidate?.(candidate.id)}
									className="min-h-10 rounded-lg border border-current/20 bg-background/40 px-2.5 py-1.5 text-left text-xs hover:bg-background/70 disabled:cursor-not-allowed disabled:opacity-50"
								>
									<span className="block font-medium">{candidate.title || candidate.type}</span>
									<span className="block truncate opacity-70">{candidate.url}</span>
								</button>
							))}
						</fieldset>
					) : (
						<p className="mt-2 text-xs">
							Discovery choices expired. Edit the URL to validate it again.
						</p>
					)
				) : null}
				{lifecycle.canCancelReplacement && onCancelReplacement ? (
					<button
						type="button"
						disabled={isActionPending}
						onClick={onCancelReplacement}
						className="mt-2 min-h-9 rounded-lg border border-current/25 px-3 text-xs font-medium hover:bg-background/40 disabled:cursor-not-allowed disabled:opacity-50"
					>
						Cancel replacement
					</button>
				) : null}
			</div>
		);
	}
	if (!sourceIssue) return null;
	return (
		<div
			className="mx-3 mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200"
			role="status"
			aria-label="Feed source issue"
		>
			<p className="font-semibold text-amber-300">{sourceIssue.title}</p>
			<p className="mt-0.5 text-xs leading-5">{sourceIssue.detail}</p>
		</div>
	);
}
