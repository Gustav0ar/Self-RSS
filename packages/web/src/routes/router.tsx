import { createRootRoute, createRoute, createRouter, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { FeedView } from '@/components/articles/feed-view';
import { RootLayout } from '@/components/layout/root-layout';
import { StatsPanel } from '@/components/stats/stats-panel';
import { useAppState } from '@/providers/app-state';

interface ArticleSelectionSearch {
	feedId?: string;
	categoryId?: string;
}

function validateArticleSelectionSearch(search: Record<string, unknown>): ArticleSelectionSearch {
	const feedId =
		typeof search.feedId === 'string' && search.feedId.trim() ? search.feedId : undefined;
	const categoryId =
		typeof search.categoryId === 'string' && search.categoryId.trim()
			? search.categoryId
			: undefined;

	if (feedId) {
		return { feedId };
	}

	if (categoryId) {
		return { categoryId };
	}

	return {};
}

function buildSelectionSearch(feedId?: string, categoryId?: string): ArticleSelectionSearch {
	if (feedId) {
		return { feedId };
	}

	if (categoryId) {
		return { categoryId };
	}

	return {};
}

function RoutedFeedView({
	articleId,
	feedId,
	categoryId,
}: {
	articleId: string | null;
	feedId?: string;
	categoryId?: string;
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
			selectedArticleId={articleId}
			onSelectArticle={(nextArticleId) => {
				void router.navigate({
					to: '/articles/$articleId',
					params: { articleId: nextArticleId },
					search: buildSelectionSearch(feedId, categoryId),
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
	validateSearch: validateArticleSelectionSearch,
	component: function Index() {
		const { feedId, categoryId } = indexRoute.useSearch();
		return <RoutedFeedView articleId={null} feedId={feedId} categoryId={categoryId} />;
	},
});

const articleRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/articles/$articleId',
	validateSearch: validateArticleSelectionSearch,
	component: function Article() {
		const { articleId } = articleRoute.useParams();
		const { feedId, categoryId } = articleRoute.useSearch();
		return <RoutedFeedView articleId={articleId} feedId={feedId} categoryId={categoryId} />;
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

const routeTree = rootRoute.addChildren([indexRoute, articleRoute, statsRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router;
	}
}
