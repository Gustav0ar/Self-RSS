export type SearchScope = 'all' | 'category';

export interface ArticleRouteSearch {
	feedId?: string;
	categoryId?: string;
	q?: string;
	searchScope?: SearchScope;
}

export function validateArticleRouteSearch(search: Record<string, unknown>): ArticleRouteSearch {
	const feedId =
		typeof search.feedId === 'string' && search.feedId.trim() ? search.feedId : undefined;
	const categoryId =
		typeof search.categoryId === 'string' && search.categoryId.trim()
			? search.categoryId
			: undefined;
	const q =
		typeof search.q === 'string' && search.q.trim()
			? search.q.slice(0, MAX_SEARCH_QUERY_LENGTH)
			: undefined;
	const searchScope = search.searchScope === 'category' ? 'category' : undefined;

	return buildArticleRouteSearch({ feedId, categoryId, q, searchScope });
}

export function buildArticleRouteSearch(search: ArticleRouteSearch = {}): ArticleRouteSearch {
	const next: ArticleRouteSearch = {};

	if (search.feedId) {
		next.feedId = search.feedId;
	} else if (search.categoryId) {
		next.categoryId = search.categoryId;
	}

	if (search.q?.trim()) {
		next.q = search.q.slice(0, MAX_SEARCH_QUERY_LENGTH);
	}

	if (next.categoryId && search.searchScope === 'category') {
		next.searchScope = 'category';
	}

	return next;
}

const MAX_SEARCH_QUERY_LENGTH = 200;
