import {
	createRootRoute,
	createRoute,
	createRouter,
	Link,
	useRouter,
} from '@tanstack/react-router';
import { lazy, Suspense, useCallback, useEffect } from 'react';
import { FeedView } from '@/components/articles/feed-view';
import { RootLayout } from '@/components/layout/root-layout';
import { useAppState } from '@/providers/app-state';
import { buildArticleRouteSearch, validateArticleRouteSearch } from './article-route-search';

const LazyAdminPanel = lazy(() =>
	import('@/components/admin/admin-panel').then((module) => ({ default: module.AdminPanel })),
);
const LazyStatsPanel = lazy(() =>
	import('@/components/stats/stats-panel').then((module) => ({ default: module.StatsPanel })),
);

function RouteLoadingFallback() {
	return (
		<div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
			Loading...
		</div>
	);
}

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

	const handleSelectArticle = useCallback(
		(nextArticleId: string | null) => {
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
		},
		[router, feedId, categoryId, savedOnly, q, searchScope],
	);

	return (
		<FeedView
			feedId={feedId}
			categoryId={categoryId}
			savedOnly={savedOnly}
			searchQuery={q}
			searchScope={searchScope}
			selectedArticleId={articleId}
			fromDeepLink={articleId != null}
			onSelectArticle={handleSelectArticle}
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

function RouteNotFound() {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
			<h1 className="text-lg font-semibold text-foreground">Page not found</h1>
			<p className="text-sm text-muted-foreground">The page you requested does not exist.</p>
			<Link
				to="/"
				className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
			>
				Back to feeds
			</Link>
		</div>
	);
}

const statsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/stats',
	component: function Stats() {
		return (
			<div className="motion-enter h-full overflow-auto">
				<Suspense fallback={<RouteLoadingFallback />}>
					<LazyStatsPanel />
				</Suspense>
			</div>
		);
	},
});

const adminRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/admin',
	component: function Admin() {
		return (
			<Suspense fallback={<RouteLoadingFallback />}>
				<LazyAdminPanel />
			</Suspense>
		);
	},
});

const routeTree = rootRoute.addChildren([indexRoute, articleRoute, statsRoute, adminRoute]);

export const router = createRouter({
	routeTree,
	defaultPreload: 'intent',
	defaultNotFoundComponent: RouteNotFound,
});

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router;
	}
}
