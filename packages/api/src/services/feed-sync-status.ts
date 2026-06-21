import type Redis from 'ioredis';
import { CacheKeys } from '../db/redis.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger();

const MANUAL_SYNC_DEDUPE_TTL_SECONDS = 60 * 30;
const MANUAL_SYNC_LOCK_TTL_SECONDS = 60 * 30;
const MANUAL_SYNC_STATUS_STALE_MS = 90_000;
const MANUAL_SYNC_HEARTBEAT_INTERVAL_MS = 15_000;

const QUEUE_SYNC_ALL_FEEDS_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then
	return 0
end
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("RPUSH", KEYS[2], ARGV[3])
return 1
`;

type LockStatus = 'missing' | 'active' | 'stale';
type QueuedStatus = 'missing' | 'active' | 'stale';

export interface FeedSyncAllStatus {
	queued: boolean;
	running: boolean;
	active: boolean;
}

export async function queueManualSyncAllFeeds(redis: Redis, userId: string) {
	const didQueue = await redis.eval(
		QUEUE_SYNC_ALL_FEEDS_SCRIPT,
		2,
		CacheKeys.feedSyncAllQueued(userId),
		CacheKeys.feedSyncAllQueue(),
		String(Date.now()),
		String(MANUAL_SYNC_DEDUPE_TTL_SECONDS),
		userId,
	);

	return Number(didQueue) === 1;
}

export async function getManualSyncAllFeedsStatus(
	redis: Redis,
	userId: string,
): Promise<FeedSyncAllStatus> {
	const queuedKey = CacheKeys.feedSyncAllQueued(userId);
	const lockKey = CacheKeys.feedSyncAllLock(userId);
	const [queuedValue, lockValue] = await Promise.all([redis.get(queuedKey), redis.get(lockKey)]);
	const lockStatus = await getManualSyncLockStatus(redis, userId, lockValue);
	const running = lockStatus === 'active';
	const queuedStatus = running
		? 'missing'
		: await getManualSyncQueuedStatus(redis, userId, queuedValue, lockStatus);
	const queued = queuedStatus === 'active';

	return {
		queued,
		running,
		active: queued || running,
	};
}

export async function acquireManualSyncAllFeedsLock(redis: Redis, userId: string) {
	const didLock = await redis.set(
		CacheKeys.feedSyncAllLock(userId),
		String(Date.now()),
		'EX',
		MANUAL_SYNC_LOCK_TTL_SECONDS,
		'NX',
	);
	return didLock === 'OK';
}

export function startManualSyncAllFeedsHeartbeat(redis: Redis, userId: string) {
	const lockKey = CacheKeys.feedSyncAllLock(userId);
	const heartbeat = setInterval(() => {
		void redis
			.set(lockKey, String(Date.now()), 'EX', MANUAL_SYNC_LOCK_TTL_SECONDS)
			.catch((error: unknown) => {
				logger.warn('Failed to update queued bulk feed sync heartbeat', {
					userId,
					error: error instanceof Error ? error.message : String(error),
				});
			});
	}, MANUAL_SYNC_HEARTBEAT_INTERVAL_MS);

	return () => clearInterval(heartbeat);
}

export async function releaseManualSyncAllFeedsState(redis: Redis, userId: string) {
	await redis.del(CacheKeys.feedSyncAllLock(userId), CacheKeys.feedSyncAllQueued(userId));
}

async function getManualSyncLockStatus(
	redis: Redis,
	userId: string,
	lockValue: string | null,
): Promise<LockStatus> {
	if (lockValue == null) {
		return 'missing';
	}

	if (hasFreshStatusTimestamp(lockValue)) {
		return 'active';
	}

	logger.warn('Clearing stale queued bulk feed sync lock', { userId });
	await releaseManualSyncAllFeedsState(redis, userId);
	return 'stale';
}

async function getManualSyncQueuedStatus(
	redis: Redis,
	userId: string,
	queuedValue: string | null,
	lockStatus: LockStatus,
): Promise<QueuedStatus> {
	if (queuedValue == null || lockStatus !== 'missing') {
		return 'missing';
	}

	if (hasFreshStatusTimestamp(queuedValue)) {
		return 'active';
	}

	logger.warn('Clearing stale queued bulk feed sync marker', { userId });
	await redis.del(CacheKeys.feedSyncAllQueued(userId));
	return 'stale';
}

function hasFreshStatusTimestamp(value: string) {
	const timestamp = Number(value);
	return Number.isFinite(timestamp) && Date.now() - timestamp <= MANUAL_SYNC_STATUS_STALE_MS;
}
