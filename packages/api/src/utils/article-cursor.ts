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
	return encodeArticleCursorFromTimestamp(item.id, item.publishedAt ?? item.fetchedAt, sort, item.ftsRank);
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
	const seconds = typeof timestamp === 'number'
		? (timestamp > 1e12 ? Math.floor(timestamp / 1000) : timestamp)
		: Math.floor(timestamp.getTime() / 1000);
	const direction = sort === 'oldest' ? 'a' : 'd';
	// For search results with bm25 ranking, encode the FTS rank as well.
	// bm25 returns negative values where lower = more relevant.
	// We multiply by 10000 and use a large offset to ensure stable integer encoding,
	// avoiding floating point comparison issues. The offset of 1000000000 ensures
	// negative values become positive for string comparison.
	if (ftsRank !== undefined) {
		// Convert to stable integer representation: offset + round(bm25 * 10000)
		// This handles negative bm25 values correctly for pagination.
		const OFFSET = 1000000000;
		const SCALE = 10000;
		const stableRankInt = OFFSET + Math.round(ftsRank * SCALE);
		return `${stableRankInt}:${seconds}:${id}:${direction}`;
	}
	return `${id}:${seconds}:${direction}`;
}
