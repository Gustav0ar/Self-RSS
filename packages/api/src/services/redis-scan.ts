import type Redis from 'ioredis';

// A moderate SCAN hint keeps key discovery responsive without blocking Redis.
export const REDIS_SCAN_BATCH = 500;

export async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
	const matched: string[] = [];
	let cursor = '0';
	do {
		const [nextCursor, batch] = await redis.scan(
			cursor,
			'MATCH',
			pattern,
			'COUNT',
			REDIS_SCAN_BATCH,
		);
		if (batch.length > 0) matched.push(...batch);
		cursor = nextCursor;
	} while (cursor !== '0');
	return matched;
}
