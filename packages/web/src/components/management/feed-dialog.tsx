import type { CategoryWithCounts, FeedWithCounts } from '@self-feed/shared';
import { useEffect, useRef, useState } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { createDialogErrorFallback } from '@/components/error-fallbacks';
import { QueryFailure } from '@/components/query-failure';
import {
	useCreateCategory,
	useCreateFeed,
	useFeedSyncHistory,
	useSyncFeed,
	useUpdateFeed,
} from '@/hooks/queries';
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
	const createCategory = useCreateCategory();
	const createFeed = useCreateFeed();
	const updateFeed = useUpdateFeed();
	const history = useFeedSyncHistory(mode === 'edit' ? feed?.id : undefined);
	const syncFeed = useSyncFeed();
	const [feedUrl, setFeedUrl] = useState('');
	const [title, setTitle] = useState('');
	const [categoryId, setCategoryId] = useState(defaultCategoryId ?? categories[0]?.id ?? '');
	const [pollingIntervalMinutes, setPollingIntervalMinutes] = useState('60');
	const [error, setError] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);
	const createdDefaultCategoryIdRef = useRef<string | null>(null);
	const needsDefaultCategory = mode === 'create' && categories.length === 0;

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
				let targetCategoryId = categoryId || createdDefaultCategoryIdRef.current;
				if (!targetCategoryId && needsDefaultCategory) {
					const categoryResponse = await createCategory.mutateAsync({ name: 'General' });
					targetCategoryId = categoryResponse.data.id;
					createdDefaultCategoryIdRef.current = targetCategoryId;
					setCategoryId(targetCategoryId);
				}
				if (!targetCategoryId) {
					throw new Error('Choose a category for this feed');
				}

				const response = await createFeed.mutateAsync({
					feedUrl,
					categoryId: targetCategoryId,
					title: title.trim() || undefined,
				});
				setSuccessMessage(
					response.data.lifecycleStatus === 'pending'
						? 'Feed added. Validation is queued; articles will appear after the first successful fetch.'
						: 'Feed added successfully.',
				);
				return;
			} else if (feed) {
				const response = await updateFeed.mutateAsync({
					id: feed.id,
					feedUrl: feedUrl.trim(),
					categoryId,
					title: title.trim() || undefined,
					pollingIntervalMinutes: Number(pollingIntervalMinutes),
				});
				if (response.data.lifecycleStatus === 'replacement_pending') {
					setSuccessMessage(
						'Replacement validation is queued; the current source remains active until validation succeeds.',
					);
					return;
				}
			}
			onClose();
		} catch (submitError) {
			setError(submitError instanceof Error ? submitError.message : 'Unable to save feed');
		}
	}

	const isPending = createCategory.isPending || createFeed.isPending || updateFeed.isPending;
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
					{mode === 'edit' && feed ? (
						<details className="rounded-2xl border border-border/70 bg-background/50 px-4 py-3">
							<summary className="cursor-pointer text-sm font-semibold">Refresh history</summary>
							<div className="mt-3" aria-live="polite">
								{history.isLoading ? (
									<p className="text-xs text-muted-foreground">Loading refresh history...</p>
								) : history.isError && !history.data ? (
									<QueryFailure
										title="Could not load refresh history"
										error={history.error}
										onRetry={() => void history.refetch()}
										isRetrying={history.isFetching}
										compact
									/>
								) : (
									<>
										{history.isError ? (
											<QueryFailure
												title="Refresh history could not be updated"
												description="Showing the last available attempts."
												error={history.error}
												onRetry={() => void history.refetch()}
												isRetrying={history.isFetching}
												compact
												className="mb-3"
											/>
										) : null}
										<FeedRefreshHistory
											runs={history.data?.pages.flatMap((page) => page.runs) ?? []}
											onRetry={() => syncFeed.mutate(feed.id)}
											retryPending={syncFeed.isPending}
										/>
										{history.hasNextPage ? (
											<button
												type="button"
												onClick={() => void history.fetchNextPage()}
												disabled={history.isFetchingNextPage}
												className="mt-3 h-9 w-full rounded-xl border border-border text-xs font-medium hover:bg-accent disabled:opacity-60"
											>
												{history.isFetchingNextPage ? 'Loading...' : 'Load older attempts'}
											</button>
										) : null}
									</>
								)}
							</div>
						</details>
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

						{needsDefaultCategory ? (
							<div
								className="rounded-2xl border border-border/70 bg-background/60 px-4 py-3"
								role="note"
								aria-label="Default feed category"
							>
								<p className="text-sm font-medium">General category</p>
								<p className="mt-1 text-xs leading-5 text-muted-foreground">
									SelfFeed will create General first, then add this feed to it.
								</p>
							</div>
						) : (
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
						)}

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
								disabled={
									isPending ||
									(mode === 'edit' && categories.length === 0) ||
									(mode === 'create' && !needsDefaultCategory && !categoryId)
								}
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

type SyncRun = NonNullable<
	ReturnType<typeof useFeedSyncHistory>['data']
>['pages'][number]['runs'][number];

function FeedRefreshHistory({
	runs,
	onRetry,
	retryPending,
}: {
	runs: SyncRun[];
	onRetry: () => void;
	retryPending: boolean;
}) {
	if (runs.length === 0) {
		return <p className="text-xs text-muted-foreground">No refresh attempts recorded yet.</p>;
	}

	return (
		<ol className="space-y-2" aria-label="Feed refresh attempts">
			{runs.map((run) => {
				const durationMs = run.finishedAt
					? Math.max(0, new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime())
					: null;
				return (
					<li key={run.id} className="rounded-xl border border-border/60 bg-card/60 p-3">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<p className="text-xs font-medium capitalize">{run.status}</p>
							<time className="text-[11px] text-muted-foreground" dateTime={run.startedAt}>
								{new Date(run.startedAt).toLocaleString()}
							</time>
						</div>
						<p className="mt-1 text-[11px] text-muted-foreground">
							{run.httpStatus ? `HTTP ${run.httpStatus} · ` : ''}
							{run.itemCount} items
							{durationMs !== null ? ` · ${Math.round(durationMs / 1000)}s` : ''}
						</p>
						{run.errorMessage ? (
							<p className="mt-1 text-xs leading-5 text-red-500">{run.errorMessage}</p>
						) : null}
						{run.status === 'failed' ? (
							<button
								type="button"
								onClick={onRetry}
								disabled={retryPending}
								className="mt-2 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-60"
							>
								Retry now
							</button>
						) : null}
					</li>
				);
			})}
		</ol>
	);
}

export function FeedDialog(props: FeedDialogProps) {
	return (
		<ErrorBoundary fallback={createDialogErrorFallback(props.onClose)}>
			<FeedDialogContent {...props} />
		</ErrorBoundary>
	);
}
