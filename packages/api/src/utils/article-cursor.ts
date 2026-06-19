export function encodeArticleCursor(
	item: { id: string; publishedAt: Date | null; fetchedAt: Date } | null,
	sort: string | undefined,
): string | null {
	if (!item) return null;
	return encodeArticleCursorFromTimestamp(item.id, item.publishedAt ?? item.fetchedAt, sort);
}

export function encodeCachedArticleCursor(
	item: { id: string; displayedAt: string } | null,
	sort: string | undefined,
): string | null {
	if (!item) return null;
	const timestamp = new Date(item.displayedAt);
	if (Number.isNaN(timestamp.getTime())) return null;
	return encodeArticleCursorFromTimestamp(item.id, timestamp, sort);
}

function encodeArticleCursorFromTimestamp(id: string, timestamp: Date, sort: string | undefined) {
	const seconds = Math.floor(timestamp.getTime() / 1000);
	const direction = sort === 'oldest' ? 'a' : 'd';
	return `${id}:${seconds}:${direction}`;
}
