export function shouldWarnOnCategoryDelete(feedCount: number) {
	return feedCount > 0;
}

export function getCategoryDeleteDescription(name: string, feedCount: number) {
	if (feedCount > 0) {
		return `"${name}" still has ${feedCount} linked ${feedCount === 1 ? 'feed' : 'feeds'}. The server will block deletion until they are moved or removed. Continue anyway?`;
	}

	return `Delete the category "${name}"? This cannot be undone.`;
}
