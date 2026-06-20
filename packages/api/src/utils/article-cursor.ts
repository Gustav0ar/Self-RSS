export interface ArticleCursorItem {
	id: string;
	publishedAt: Date | null;
	fetchedAt: Date;
	ftsRank?: number;
}

export function encodeArticleCursor(
	item: ArticleCursorItem | null,
	sort: string | undefined,
): string | null {
	if (!item) return null;
	return encodeArticleCursorFromTimestamp(
		item.id,
		item.publishedAt ?? item.fetchedAt,
		sort,
		item.ftsRank,
	);
}

export function encodeCachedArticleCursor(
	item: { id: string; displayedAt: string } | null,
	sort: string | undefined,
): string | null {
	if (!item) return null;
	const timestamp = new Date(item.displayedAt);
	if (Number.isNaN(timestamp.getTime())) return null;
	return encodeArticleCursorFromTimestamp(item.id, timestamp, sort, undefined);
}

function encodeArticleCursorFromTimestamp(
	id: string,
	timestamp: Date | number,
	sort: string | undefined,
	ftsRank?: number,
) {
	// Handle both Date objects and Unix timestamps (in seconds or milliseconds)
	const seconds =
		typeof timestamp === 'number'
			? timestamp > 1e12
				? Math.floor(timestamp / 1000)
				: timestamp
			: Math.floor(timestamp.getTime() / 1000);
	const direction = sort === 'oldest' ? 'a' : 'd';
	if (ftsRank !== undefined) {
		return `${ftsRank}:${seconds}:${id}:${direction}`;
	}
	return `${id}:${seconds}:${direction}`;
}
