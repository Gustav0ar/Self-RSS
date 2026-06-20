export interface Cursor {
	id: string;
	seconds: number;
	direction: 'asc' | 'desc';
	ftsRank?: number;
}

// Maximum reasonable timestamp: year 2100
const MAX_REASONABLE_TIMESTAMP = 4102444800;

export function decodeCursor(encoded: string): Cursor | null {
	const parts = encoded.split(':');
	if (parts.length < 3) return null;

	const [first, second, third, ...rest] = parts;

	// Handle FTS-ranked cursor: ftsRank:seconds:id:direction
	if (!Number.isNaN(Number(first)) && parts.length >= 4) {
		const ftsRank = Number(first);
		const seconds = Number(second);
		const direction = third === 'a' ? 'asc' : 'desc';
		const id = rest.join(':');

		// Validate timestamp bounds
		if (seconds < 0 || seconds > MAX_REASONABLE_TIMESTAMP) {
			return null;
		}

		return { id, seconds, direction, ftsRank };
	}

	// Handle regular cursor: id:seconds:direction
	const id = first;
	const seconds = Number(second);
	const direction = third === 'a' ? 'asc' : 'desc';

	// Validate timestamp bounds
	if (seconds < 0 || seconds > MAX_REASONABLE_TIMESTAMP) {
		return null;
	}

	return { id: id!, seconds, direction };
}

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
