import type { CategoryWithCounts, FeedWithCounts } from '@self-feed/shared';

export function flattenCategories(categories: readonly CategoryWithCounts[]) {
	const flattened: CategoryWithCounts[] = [];
	const visit = (category: CategoryWithCounts) => {
		flattened.push(category);
		for (const child of category.children ?? []) {
			visit(child);
		}
	};

	for (const category of categories) {
		visit(category);
	}

	return flattened;
}

export function flattenCategoryFeeds(categories: readonly CategoryWithCounts[]) {
	const feeds: FeedWithCounts[] = [];
	const seenFeedIds = new Set<string>();

	for (const category of flattenCategories(categories)) {
		for (const feed of category.feeds ?? []) {
			if (seenFeedIds.has(feed.id)) {
				continue;
			}
			seenFeedIds.add(feed.id);
			feeds.push(feed);
		}
	}

	return feeds;
}

export function categoryAncestorIds(categories: readonly CategoryWithCounts[], categoryId: string) {
	const byId = new Map(flattenCategories(categories).map((category) => [category.id, category]));
	const ancestors: string[] = [];
	const seen = new Set<string>();
	let current = byId.get(categoryId);

	while (current) {
		if (seen.has(current.id)) {
			break;
		}
		seen.add(current.id);
		ancestors.push(current.id);
		current = current.parentCategoryId ? byId.get(current.parentCategoryId) : undefined;
	}

	return ancestors;
}

export function categoryPathLabel(categories: readonly CategoryWithCounts[], categoryId: string) {
	const byId = new Map(flattenCategories(categories).map((category) => [category.id, category]));
	const path: string[] = [];
	const seen = new Set<string>();
	let current = byId.get(categoryId);

	while (current) {
		if (seen.has(current.id)) {
			break;
		}
		seen.add(current.id);
		path.push(current.name);
		current = current.parentCategoryId ? byId.get(current.parentCategoryId) : undefined;
	}

	return path.reverse().join(' / ');
}
