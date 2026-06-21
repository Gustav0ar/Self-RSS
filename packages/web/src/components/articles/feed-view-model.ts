import type { ApiListResponse, ArticleListItem, CategoryWithCounts } from '@self-feed/shared';
import { categoryPathLabel, flattenCategories, flattenCategoryFeeds } from '@/lib/categories';

export interface RetainedReadArticle {
	article: ArticleListItem;
	index: number;
}

export interface FeedViewEmptyState {
	title: string;
	description: string;
}

export interface FeedViewModel {
	viewTitle: string;
	scopeUnreadCount: number;
	emptyState: FeedViewEmptyState;
}

export function dedupeArticlePages(pages: readonly ApiListResponse<ArticleListItem>[] | undefined) {
	const seenArticleIds = new Set<string>();
	const articles: ArticleListItem[] = [];

	for (const page of pages ?? []) {
		for (const article of page.data) {
			if (seenArticleIds.has(article.id)) {
				continue;
			}
			seenArticleIds.add(article.id);
			articles.push(article);
		}
	}

	return articles;
}

export function buildFeedViewModel({
	categoryId,
	categoryTree,
	feedId,
	feedSyncError,
	unreadOnly,
}: {
	categoryId?: string;
	categoryTree: readonly CategoryWithCounts[];
	feedId?: string;
	feedSyncError: string | null;
	unreadOnly: boolean;
}): FeedViewModel {
	const flatCategories = flattenCategories(categoryTree);
	const flatFeeds = flattenCategoryFeeds(categoryTree);
	const selectedFeed = feedId ? flatFeeds.find((feed) => feed.id === feedId) : null;
	const selectedCategory = categoryId
		? flatCategories.find((category) => category.id === categoryId)
		: null;

	const viewTitle = selectedFeed
		? selectedFeed.title
		: categoryId
			? categoryPathLabel(categoryTree, categoryId) || selectedCategory?.name || 'Category'
			: 'Latest articles';
	const scopeUnreadCount = selectedFeed
		? (selectedFeed.unreadCount ?? 0)
		: selectedCategory
			? (selectedCategory.unreadCount ?? 0)
			: flatFeeds.reduce((count, feed) => count + (feed.unreadCount ?? 0), 0);

	return {
		viewTitle,
		scopeUnreadCount,
		emptyState: buildEmptyState({ categoryId, feedId, feedSyncError, unreadOnly }),
	};
}

export function buildEmptyState({
	categoryId,
	feedId,
	feedSyncError,
	unreadOnly,
}: {
	categoryId?: string;
	feedId?: string;
	feedSyncError: string | null;
	unreadOnly: boolean;
}): FeedViewEmptyState {
	if (feedSyncError) {
		return {
			title: 'Unable to refresh articles',
			description: feedSyncError,
		};
	}
	if (unreadOnly) {
		return {
			title: 'No unread articles',
			description: 'Turn off the unread filter to review older stories in this view.',
		};
	}
	if (feedId) {
		return {
			title: 'No articles in this feed',
			description: 'Refresh the feed or check that the source is publishing RSS items.',
		};
	}
	if (categoryId) {
		return {
			title: 'No articles in this category',
			description: 'Add feeds to this category or refresh existing sources.',
		};
	}
	return {
		title: 'No articles yet',
		description: 'Add a feed or import OPML to start building your reading queue.',
	};
}

export function mergeRetainedReadArticles(
	fetchedArticles: readonly ArticleListItem[],
	retainedReadArticles: ReadonlyMap<string, RetainedReadArticle>,
	unreadOnly: boolean,
) {
	if (!unreadOnly || retainedReadArticles.size === 0) {
		return [...fetchedArticles];
	}

	const seenArticleIds = new Set(fetchedArticles.map((article) => article.id));
	const retainedArticles = Array.from(retainedReadArticles.values())
		.filter(({ article }) => !seenArticleIds.has(article.id))
		.sort((a, b) => a.index - b.index);
	if (retainedArticles.length === 0) {
		return [...fetchedArticles];
	}

	const mergedArticles = [...fetchedArticles];
	for (const retained of retainedArticles) {
		mergedArticles.splice(Math.min(retained.index, mergedArticles.length), 0, retained.article);
	}
	return mergedArticles;
}

export function resolveEffectiveArticleId({
	articleIds,
	fromDeepLink,
	selectedArticleId,
}: {
	articleIds: ReadonlySet<string>;
	fromDeepLink: boolean;
	selectedArticleId: string | null;
}) {
	if (!selectedArticleId) {
		return null;
	}
	return articleIds.has(selectedArticleId) || fromDeepLink ? selectedArticleId : null;
}
