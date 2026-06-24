import type { ArticleListItem, SortOrder } from '@self-feed/shared';

export function articleSortTime(article: ArticleListItem) {
	const timestamp = new Date(article.displayedAt || article.publishedAt || 0).getTime();
	return Number.isFinite(timestamp) ? timestamp : 0;
}

export function compareArticlesBySortOrder(
	a: ArticleListItem,
	b: ArticleListItem,
	sort: SortOrder,
) {
	const timeDelta = articleSortTime(a) - articleSortTime(b);
	if (timeDelta !== 0) {
		return sort === 'oldest' ? timeDelta : -timeDelta;
	}

	const idDelta = a.id.localeCompare(b.id);
	return sort === 'oldest' ? idDelta : -idDelta;
}

export function sortArticlesByDisplayOrder(articles: readonly ArticleListItem[], sort: SortOrder) {
	return [...articles].sort((a, b) => compareArticlesBySortOrder(a, b, sort));
}
