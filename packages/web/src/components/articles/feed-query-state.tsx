import type { ReactNode } from 'react';
import { QueryFailure } from '@/components/query-failure';

interface QueryState {
	data?: unknown;
	error: unknown;
	isError: boolean;
	isFetching: boolean;
	refetch: () => unknown;
}

interface FeedQueryStateProps {
	articles: QueryState;
	categories: QueryState;
	preferences: QueryState;
	children: ReactNode;
}

export function FeedQueryState({
	articles,
	categories,
	preferences,
	children,
}: FeedQueryStateProps) {
	const blockingPreferencesFailure = preferences.isError && preferences.data === undefined;
	const blockingArticlesFailure = articles.isError && articles.data === undefined;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{categories.isError ? (
				<QueryFailure
					title="Feed details could not be refreshed"
					error={categories.error}
					description={
						categories.data !== undefined
							? 'Showing the last available feed details.'
							: 'Article metadata may be incomplete until feed details are available.'
					}
					onRetry={() => void categories.refetch()}
					isRetrying={categories.isFetching}
					compact
					className="mx-3 mt-3"
				/>
			) : null}
			{preferences.isError && preferences.data !== undefined ? (
				<QueryFailure
					title="Reading preferences could not be refreshed"
					error={preferences.error}
					description="Showing the last available reading settings."
					onRetry={() => void preferences.refetch()}
					isRetrying={preferences.isFetching}
					compact
					className="mx-3 mt-3"
				/>
			) : null}
			{articles.isError && articles.data !== undefined ? (
				<QueryFailure
					title="Articles could not be refreshed"
					error={articles.error}
					description="Showing the last available articles."
					onRetry={() => void articles.refetch()}
					isRetrying={articles.isFetching}
					compact
					className="mx-3 mt-3"
				/>
			) : null}
			{blockingPreferencesFailure || blockingArticlesFailure ? (
				<div className="flex flex-1 items-center justify-center px-4 py-6">
					<QueryFailure
						title={
							blockingPreferencesFailure
								? 'Could not load reading preferences'
								: 'Could not load articles'
						}
						error={blockingPreferencesFailure ? preferences.error : articles.error}
						onRetry={() =>
							void (blockingPreferencesFailure ? preferences.refetch() : articles.refetch())
						}
						isRetrying={blockingPreferencesFailure ? preferences.isFetching : articles.isFetching}
						className="w-full max-w-sm"
					/>
				</div>
			) : (
				children
			)}
		</div>
	);
}
