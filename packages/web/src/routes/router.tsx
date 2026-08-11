import { createRootRoute, createRoute, createRouter, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AdminPanel } from '@/components/admin/admin-panel';
import { FeedView } from '@/components/articles/feed-view';
import { RootLayout } from '@/components/layout/root-layout';
import { StatsPanel } from '@/components/stats/stats-panel';
import { useAppState } from '@/providers/app-state';
import { buildArticleRouteSearch, validateArticleRouteSearch } from './article-route-search';

function RoutedFeedView({
	articleId,
	feedId,
	categoryId,
	savedOnly,
	q,
	searchScope,
}: {
	articleId: string | null;
	feedId?: string;
	categoryId?: string;
	savedOnly?: boolean;
	q?: string;
	searchScope?: 'all' | 'category';
}) {
	const router = useRouter();
	const { applySelection } = useAppState();

	useEffect(() => {
		applySelection({ feedId, categoryId, articleId });
	}, [applySelection, articleId, categoryId, feedId]);

	return (
		<FeedView
			feedId={feedId}
			categoryId={categoryId}
			savedOnly={savedOnly}
			searchQuery={q}
			searchScope={searchScope}
			selectedArticleId={articleId}
			fromDeepLink={articleId != null}
			onSelectArticle={(nextArticleId) => {
				// `null` is the "clear the active article" signal — drop
				// the user back to the list view at the current scope.
				if (nextArticleId == null) {
					void router.navigate({
						to: '/',
						search: buildArticleRouteSearch({ feedId, categoryId, savedOnly, q, searchScope }),
					});
					return;
				}
				void router.navigate({
					to: '/articles/$articleId',
					params: { articleId: nextArticleId },
					search: buildArticleRouteSearch({ feedId, categoryId, savedOnly, q, searchScope }),
				});
			}}
		/>
	);
}

const rootRoute = createRootRoute({
	component: RootLayout,
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/',
	validateSearch: validateArticleRouteSearch,
	component: function Index() {
		const { feedId, categoryId, savedOnly, q, searchScope } = indexRoute.useSearch();
		return (
			<RoutedFeedView
				articleId={null}
				feedId={feedId}
				categoryId={categoryId}
				savedOnly={savedOnly}
				q={q}
				searchScope={searchScope}
			/>
		);
	},
});

const articleRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/articles/$articleId',
	validateSearch: validateArticleRouteSearch,
	component: function Article() {
		const { articleId } = articleRoute.useParams();
		const { feedId, categoryId, savedOnly, q, searchScope } = articleRoute.useSearch();
		return (
			<RoutedFeedView
				articleId={articleId}
				feedId={feedId}
				categoryId={categoryId}
				savedOnly={savedOnly}
				q={q}
				searchScope={searchScope}
			/>
		);
	},
});

const statsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/stats',
	component: function Stats() {
		return (
			<div className="motion-enter h-full overflow-auto p-4 sm:p-6">
				<StatsPanel />
			</div>
		);
	},
});

const adminRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/admin',
	component: AdminPanel,
});

const routeTree = rootRoute.addChildren([indexRoute, articleRoute, statsRoute, adminRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router;
	}
}
