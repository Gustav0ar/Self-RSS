import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QueryFailureProps {
	title: string;
	error?: unknown;
	description?: string;
	onRetry: () => void;
	isRetrying?: boolean;
	className?: string;
	compact?: boolean;
}

function getFailureDescription(error: unknown, fallback: string) {
	if (error instanceof TypeError) {
		return 'Check your connection and try again.';
	}

	return fallback;
}

export function QueryFailure({
	title,
	error,
	description = 'The latest data could not be loaded. Try again.',
	onRetry,
	isRetrying = false,
	className,
	compact = false,
}: QueryFailureProps) {
	return (
		<div
			role="alert"
			className={cn(
				'rounded-2xl border border-red-500/25 bg-red-500/5 text-center',
				compact ? 'px-3 py-2.5' : 'px-5 py-5',
				className,
			)}
		>
			<p className="text-sm font-medium text-foreground">{title}</p>
			<p className={cn('text-xs leading-5 text-muted-foreground', compact ? 'mt-0.5' : 'mt-1')}>
				{getFailureDescription(error, description)}
			</p>
			<button
				type="button"
				onClick={onRetry}
				disabled={isRetrying}
				className={cn(
					'inline-flex items-center justify-center gap-2 rounded-full border border-border font-medium hover:bg-accent disabled:opacity-60',
					compact ? 'mt-2 px-3 py-1.5 text-xs' : 'mt-4 px-4 py-2 text-sm',
				)}
			>
				<RefreshCw className={cn('h-3.5 w-3.5', isRetrying && 'animate-spin')} aria-hidden="true" />
				{isRetrying ? 'Retrying...' : 'Retry'}
			</button>
		</div>
	);
}
