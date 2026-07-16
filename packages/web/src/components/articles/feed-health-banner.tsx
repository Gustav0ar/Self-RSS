import type { FeedHealthIssue } from '@/lib/feed-health';

export function FeedHealthBanner({
	appError,
	sourceIssue,
}: {
	appError: string | null;
	sourceIssue: FeedHealthIssue | null;
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
