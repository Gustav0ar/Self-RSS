export interface ArticleCursor {
	id: string;
	seconds: number;
	direction: 'a' | 'd';
	ftsRank?: number;
}

// Maximum reasonable timestamp: year 2100
const MAX_REASONABLE_TIMESTAMP = 4102444800;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidArticleCursorId(value: string): boolean {
	return UUID_REGEX.test(value);
}

export function decodeArticleCursor(
	cursor: string | undefined,
	sort: string | undefined,
): ArticleCursor | null {
	if (!cursor) return null;
	const parts = cursor.split(':');
	if (parts.length < 3) return null;

	const expectedDirection = sort === 'oldest' ? 'a' : 'd';

	if (parts.length === 4) {
		const [rankRaw, secondsRaw, id, direction] = parts;
		if (!rankRaw || !secondsRaw || !id || !direction) return null;
		if (!isValidArticleCursorId(id)) return null;
		if (direction !== 'a' && direction !== 'd') return null;
		if (direction !== expectedDirection) return null;

		const rawRank = Number(rankRaw);
		if (!Number.isFinite(rawRank)) return null;

		const seconds = parseCursorSeconds(secondsRaw);
		if (seconds == null) return null;
		const ftsRank = normalizeFtsRank(rawRank);
		return { id, seconds, direction, ftsRank };
	}

	if (parts.length !== 3) return null;

	const [id, secondsRaw, direction] = parts;
	if (!id || !secondsRaw || !direction) return null;
	if (!isValidArticleCursorId(id)) return null;
	if (direction !== 'a' && direction !== 'd') return null;
	if (direction !== expectedDirection) return null;

	const seconds = parseCursorSeconds(secondsRaw);
	if (seconds == null) return null;
	return { id, seconds, direction };
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

function normalizeFtsRank(rawRank: number): number {
	const OFFSET = 1000000000;
	const SCALE = 10000;
	return rawRank > OFFSET / 2 ? (rawRank - OFFSET) / SCALE : rawRank;
}

function parseCursorSeconds(value: string): number | null {
	const seconds = Number(value);
	if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_REASONABLE_TIMESTAMP) {
		return null;
	}
	return seconds;
}
