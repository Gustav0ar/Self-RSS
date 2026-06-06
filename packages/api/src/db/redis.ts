import Redis, { type RedisOptions } from 'ioredis';

let redisInstance: Redis | null = null;

export function getRedis(redisUrl?: string): Redis {
	if (redisInstance) return redisInstance;
	const url = redisUrl ?? process.env.REDIS_URL;
	if (!url) throw new Error('REDIS_URL is required');
	const parsedUrl = url.replace('localhost', '127.0.0.1');

	const options: RedisOptions = {
		maxRetriesPerRequest: 3,
		lazyConnect: true,
	};
	if (process.env.REDIS_PASSWORD) {
		options.password = process.env.REDIS_PASSWORD;
	}

	redisInstance = new Redis(parsedUrl, options);
	return redisInstance;
}

export async function closeRedis(): Promise<void> {
	if (redisInstance) {
		await redisInstance.quit();
		redisInstance = null;
	}
}

// Cache key helpers
export const CacheKeys = {
	unreadCount: (userId: string) => `unread:${userId}`,
	unreadCountByCategory: (userId: string, categoryId: string) =>
		`unread:${userId}:cat:${categoryId}`,
	unreadCountByFeed: (userId: string, feedId: string) => `unread:${userId}:feed:${feedId}`,
	refreshToken: (tokenId: string) => `refresh:${tokenId}`,
	rateLimit: (key: string) => `rl:${key}`,
	feedEtag: (feedUrl: string) => `feed:etag:${feedUrl}`,
	feedLastModified: (feedUrl: string) => `feed:lastmod:${feedUrl}`,
	feedSyncAllQueue: () => 'feed:sync-all:queue',
	feedSyncAllQueued: (userId: string) => `feed:sync-all:queued:${userId}`,
	feedSyncAllLock: (userId: string) => `feed:sync-all:lock:${userId}`,
} as const;
