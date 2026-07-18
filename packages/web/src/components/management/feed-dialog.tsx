import type { CategoryWithCounts, FeedWithCounts } from '@self-feed/shared';
import { useEffect, useState } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { createDialogErrorFallback } from '@/components/error-fallbacks';
import { useCreateFeed, useUpdateFeed } from '@/hooks/queries';
import { categoryPathLabel } from '@/lib/categories';
import { feedHealthIssue } from '@/lib/feed-health';
import { ModalShell } from './modal-shell';

interface FeedDialogProps {
	mode: 'create' | 'edit';
	categories: CategoryWithCounts[];
	feed?: FeedWithCounts;
	defaultCategoryId?: string;
	onClose: () => void;
}

function FeedDialogContent({
	mode,
	categories,
	feed,
	defaultCategoryId,
	onClose,
}: FeedDialogProps) {
	const createFeed = useCreateFeed();
	const updateFeed = useUpdateFeed();
	const [feedUrl, setFeedUrl] = useState('');
	const [title, setTitle] = useState('');
	const [categoryId, setCategoryId] = useState(defaultCategoryId ?? categories[0]?.id ?? '');
	const [pollingIntervalMinutes, setPollingIntervalMinutes] = useState('60');
	const [error, setError] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	useEffect(() => {
		if (mode === 'edit' && feed) {
			setFeedUrl(feed.feedUrl);
			setTitle(feed.title);
			setCategoryId(feed.categoryId);
			setPollingIntervalMinutes(String(feed.pollingIntervalMinutes));
		}
	}, [feed, mode]);

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);

		try {
			if (mode === 'create') {
				const response = await createFeed.mutateAsync({
					feedUrl,
					categoryId,
					title: title.trim() || undefined,
				});
				setSuccessMessage(
					response.data.lifecycleStatus === 'pending'
						? 'Feed added. Validation is queued; articles will appear after the first successful fetch.'
						: 'Feed added successfully.',
				);
				return;
			} else if (feed) {
				await updateFeed.mutateAsync({
					id: feed.id,
					feedUrl: feedUrl.trim(),
					categoryId,
					title: title.trim() || undefined,
					pollingIntervalMinutes: Number(pollingIntervalMinutes),
				});
			}
			onClose();
		} catch (submitError) {
			setError(submitError instanceof Error ? submitError.message : 'Unable to save feed');
		}
	}

	const isPending = createFeed.isPending || updateFeed.isPending;
	const healthIssue = mode === 'edit' && feed ? feedHealthIssue(feed) : null;

	return (
		<ModalShell title={mode === 'create' ? 'Add Feed' : 'Edit Feed'} onClose={onClose}>
			{successMessage ? (
				<div className="rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3" role="status">
					<p className="text-sm font-semibold">Feed saved</p>
					<p className="mt-1 text-sm leading-5 text-muted-foreground">{successMessage}</p>
					<button
						type="button"
						onClick={onClose}
						className="mt-3 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
					>
						Done
					</button>
				</div>
			) : (
				<>
					<p className="text-sm leading-6 text-muted-foreground">
						Bring in a new source or refine how an existing feed is organized and refreshed.
					</p>
					{error ? (
						<div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">
							{error}
						</div>
					) : null}
					{healthIssue ? (
						<div
							className="rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3"
							role="status"
							aria-label="Feed refresh issue"
						>
							<p className="text-sm font-semibold text-amber-300">Latest refresh failed</p>
							<p className="mt-1 text-sm leading-5 text-amber-100/85">{healthIssue.detail}</p>
							{healthIssue.failedAt ? (
								<p className="mt-1.5 text-xs text-amber-200/65">
									Last attempt: {healthIssue.failedAt}
								</p>
							) : null}
							<p className="mt-2 text-xs leading-5 text-muted-foreground">
								Review the URL and polling interval, then save any correction.
							</p>
						</div>
					) : null}
					<form onSubmit={handleSubmit} className="space-y-4">
						<div>
							<label htmlFor="feed-url" className="mb-2 block text-sm font-medium">
								Feed URL
							</label>
							<input
								id="feed-url"
								type="url"
								value={feedUrl}
								onChange={(event) => setFeedUrl(event.target.value)}
								required
								placeholder="https://example.com/feed.xml"
								className="input-surface h-12 w-full rounded-2xl px-4 text-sm outline-none"
							/>
						</div>

						<div>
							<label htmlFor="feed-title" className="mb-2 block text-sm font-medium">
								Custom name (optional)
							</label>
							<input
								id="feed-title"
								type="text"
								value={title}
								onChange={(event) => setTitle(event.target.value)}
								placeholder="Leave blank to use the feed title"
								className="input-surface h-12 w-full rounded-2xl px-4 text-sm outline-none"
							/>
						</div>

						<div>
							<label htmlFor="feed-category" className="mb-2 block text-sm font-medium">
								Feed category
							</label>
							<select
								id="feed-category"
								value={categoryId}
								onChange={(event) => setCategoryId(event.target.value)}
								required
								className="input-surface h-12 w-full rounded-2xl px-4 text-sm outline-none"
							>
								{categories.map((category) => (
									<option key={category.id} value={category.id}>
										{categoryPathLabel(categories, category.id) || category.name}
									</option>
								))}
							</select>
						</div>

						{mode === 'edit' ? (
							<div>
								<label htmlFor="feed-polling" className="mb-2 block text-sm font-medium">
									Polling interval (minutes)
								</label>
								<input
									id="feed-polling"
									type="number"
									min={5}
									max={1440}
									value={pollingIntervalMinutes}
									onChange={(event) => setPollingIntervalMinutes(event.target.value)}
									className="input-surface h-12 w-full rounded-2xl px-4 text-sm outline-none"
								/>
							</div>
						) : null}

						<div className="flex items-center justify-end gap-2 pt-2">
							<button
								type="button"
								onClick={onClose}
								className="rounded-2xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-accent"
							>
								Cancel
							</button>
							<button
								type="submit"
								disabled={isPending || categories.length === 0}
								className="rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
							>
								{isPending ? 'Saving...' : mode === 'create' ? 'Add feed' : 'Save changes'}
							</button>
						</div>
					</form>
				</>
			)}
		</ModalShell>
	);
}

export function FeedDialog(props: FeedDialogProps) {
	return (
		<ErrorBoundary fallback={createDialogErrorFallback(props.onClose)}>
			<FeedDialogContent {...props} />
		</ErrorBoundary>
	);
}
