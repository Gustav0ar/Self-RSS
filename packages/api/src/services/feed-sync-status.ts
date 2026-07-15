import type Redis from 'ioredis';
import { CacheKeys } from '../db/redis.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger();

const MANUAL_SYNC_DEDUPE_TTL_SECONDS = 60 * 30;
const MANUAL_SYNC_LOCK_TTL_SECONDS = 60 * 30;
const MANUAL_SYNC_STATUS_STALE_MS = 90_000;
const MANUAL_SYNC_HEARTBEAT_INTERVAL_MS = 15_000;

const TAKE_OVER_STALE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) ~= ARGV[1] then
	return 0
end
redis.call("SET", KEYS[1], ARGV[2], "EX", ARGV[3])
return 1
`;

const RENEW_OWNED_LOCK_SCRIPT = `
local current = redis.call("GET", KEYS[1])
if not current then
	return 0
end
local ok, decoded = pcall(cjson.decode, current)
if not ok or decoded.ownerToken ~= ARGV[1] then
	return 0
end
decoded.heartbeatAt = tonumber(ARGV[2])
redis.call("SET", KEYS[1], cjson.encode(decoded), "EX", ARGV[3])
return 1
`;

const RELEASE_OWNED_SYNC_STATE_SCRIPT = `
local current = redis.call("GET", KEYS[1])
if not current then
	return 0
end
local ok, decoded = pcall(cjson.decode, current)
if not ok or decoded.ownerToken ~= ARGV[1] then
	return 0
end
redis.call("DEL", KEYS[1], KEYS[2], KEYS[3])
return 1
`;

const RELEASE_STALE_SYNC_STATE_SCRIPT = `
if redis.call("GET", KEYS[1]) ~= ARGV[1] then
	return 0
end
redis.call("DEL", KEYS[1], KEYS[2], KEYS[3])
return 1
`;

const QUEUE_SYNC_ALL_FEEDS_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then
	return 0
end
if redis.call("EXISTS", KEYS[3]) == 1 then
	return 0
end
if redis.call("LPOS", KEYS[2], ARGV[3]) ~= false then
	return 0
end
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("SET", KEYS[4], ARGV[4], "EX", ARGV[2])
redis.call("SET", KEYS[5], ARGV[5], "EX", ARGV[2])
redis.call("RPUSH", KEYS[2], ARGV[3])
return 1
`;

type LockStatus = 'missing' | 'active' | 'stale';
type QueuedStatus = 'missing' | 'active' | 'stale';

interface QueuedStatusValue {
	queuedAt: number | null;
}

interface LockStatusValue {
	startedAt: number | null;
	heartbeatAt: number | null;
	ownerToken: string | null;
}

export interface ManualSyncScope {
	feedId?: string;
	categoryId?: string;
}

interface SyncProgressValue {
	totalFeeds: number;
	completedFeeds: number;
	newArticles: number;
}

export interface FeedSyncAllStatus {
	queued: boolean;
	running: boolean;
	active: boolean;
	stale: boolean;
	queuedAt: string | null;
	startedAt: string | null;
	heartbeatAt: string | null;
	totalFeeds: number;
	completedFeeds: number;
	newArticles: number;
	articleRevision: number;
}

export async function queueManualSyncAllFeeds(
	redis: Redis,
	userId: string,
	scope: ManualSyncScope = {},
) {
	const now = Date.now();
	const didQueue = await redis.eval(
		QUEUE_SYNC_ALL_FEEDS_SCRIPT,
		5,
		CacheKeys.feedSyncAllQueued(userId),
		CacheKeys.feedSyncAllQueue(),
		CacheKeys.feedSyncAllLock(userId),
		CacheKeys.feedSyncAllRequest(userId),
		CacheKeys.feedSyncAllProgress(userId),
		encodeQueuedValue(now),
		String(MANUAL_SYNC_DEDUPE_TTL_SECONDS),
		userId,
		JSON.stringify(scope),
		JSON.stringify({ totalFeeds: 0, completedFeeds: 0, newArticles: 0 }),
	);

	return Number(didQueue) === 1;
}

export async function getManualSyncAllFeedsRequest(
	redis: Redis,
	userId: string,
): Promise<ManualSyncScope> {
	const value = await redis.get(CacheKeys.feedSyncAllRequest(userId));
	if (!value) return {};
	try {
		const parsed = JSON.parse(value) as ManualSyncScope;
		return {
			feedId: typeof parsed.feedId === 'string' ? parsed.feedId : undefined,
			categoryId: typeof parsed.categoryId === 'string' ? parsed.categoryId : undefined,
		};
	} catch {
		return {};
	}
}

export async function updateManualSyncAllFeedsProgress(
	redis: Redis,
	userId: string,
	progress: SyncProgressValue,
) {
	await redis.set(
		CacheKeys.feedSyncAllProgress(userId),
		JSON.stringify(progress),
		'EX',
		MANUAL_SYNC_DEDUPE_TTL_SECONDS,
	);
}

export async function getManualSyncAllFeedsStatus(
	redis: Redis,
	userId: string,
): Promise<FeedSyncAllStatus> {
	const queuedKey = CacheKeys.feedSyncAllQueued(userId);
	const lockKey = CacheKeys.feedSyncAllLock(userId);
	const [queuedValue, lockValue, progressValue, revisionValue] = await Promise.all([
		redis.get(queuedKey),
		redis.get(lockKey),
		redis.get(CacheKeys.feedSyncAllProgress(userId)),
		redis.get(CacheKeys.articleCacheGeneration(userId)),
	]);
	const progress = parseProgressValue(progressValue);
	const queuedState = parseQueuedValue(queuedValue);
	const lockState = parseLockValue(lockValue);
	const lockStatus = await getManualSyncLockStatus(redis, userId, lockState, lockValue);
	const running = lockStatus.status === 'active';
	const queuedStatus = running
		? ({ status: 'missing', value: null } as const)
		: await getManualSyncQueuedStatus(redis, userId, queuedState, lockStatus.status);
	const queued = queuedStatus.status === 'active';

	return {
		queued,
		running,
		active: queued || running,
		stale: lockStatus.status === 'stale' || queuedStatus.status === 'stale',
		queuedAt: queued ? timestampToIso(queuedStatus.value?.queuedAt) : null,
		startedAt: running ? timestampToIso(lockStatus.value?.startedAt) : null,
		heartbeatAt: running ? timestampToIso(lockStatus.value?.heartbeatAt) : null,
		totalFeeds: progress.totalFeeds,
		completedFeeds: progress.completedFeeds,
		newArticles: progress.newArticles,
		articleRevision: normalizeCounter(revisionValue),
	};
}

export async function acquireManualSyncAllFeedsLock(redis: Redis, userId: string) {
	const lockKey = CacheKeys.feedSyncAllLock(userId);
	const now = Date.now();
	const ownerToken = crypto.randomUUID();
	const didLock = await redis.set(
		lockKey,
		encodeLockValue(now, now, ownerToken),
		'EX',
		MANUAL_SYNC_LOCK_TTL_SECONDS,
		'NX',
	);
	if (didLock === 'OK') {
		return ownerToken;
	}

	const existingLockValue = await redis.get(lockKey);
	const existingLockState = parseLockValue(existingLockValue);
	if (existingLockState != null && !hasFreshLockHeartbeat(existingLockState)) {
		logger.warn('Taking over stale queued bulk feed sync lock before processing queue', { userId });
		const retryNow = Date.now();
		const retryLock = await redis.eval(
			TAKE_OVER_STALE_LOCK_SCRIPT,
			1,
			lockKey,
			existingLockValue ?? '',
			encodeLockValue(retryNow, retryNow, ownerToken),
			String(MANUAL_SYNC_LOCK_TTL_SECONDS),
		);
		return Number(retryLock) === 1 ? ownerToken : null;
	}

	return null;
}

export function startManualSyncAllFeedsHeartbeat(redis: Redis, userId: string, ownerToken: string) {
	const heartbeat = setInterval(() => {
		void Promise.resolve()
			.then(() => renewManualSyncAllFeedsLock(redis, userId, ownerToken))
			.catch((error: unknown) => {
				logger.warn('Failed to update queued bulk feed sync heartbeat', {
					userId,
					error: error instanceof Error ? error.message : String(error),
				});
			});
	}, MANUAL_SYNC_HEARTBEAT_INTERVAL_MS);

	return () => clearInterval(heartbeat);
}

export async function renewManualSyncAllFeedsLock(
	redis: Redis,
	userId: string,
	ownerToken: string,
) {
	const renewed = await redis.eval(
		RENEW_OWNED_LOCK_SCRIPT,
		1,
		CacheKeys.feedSyncAllLock(userId),
		ownerToken,
		String(Date.now()),
		String(MANUAL_SYNC_LOCK_TTL_SECONDS),
	);
	return Number(renewed) === 1;
}

export async function releaseManualSyncAllFeedsState(
	redis: Redis,
	userId: string,
	ownerToken: string,
) {
	return redis.eval(
		RELEASE_OWNED_SYNC_STATE_SCRIPT,
		3,
		CacheKeys.feedSyncAllLock(userId),
		CacheKeys.feedSyncAllQueued(userId),
		CacheKeys.feedSyncAllRequest(userId),
		ownerToken,
	);
}

function parseProgressValue(value: string | null): SyncProgressValue {
	if (!value) return { totalFeeds: 0, completedFeeds: 0, newArticles: 0 };
	try {
		const parsed = JSON.parse(value) as Partial<SyncProgressValue>;
		return {
			totalFeeds: normalizeCounter(parsed.totalFeeds),
			completedFeeds: normalizeCounter(parsed.completedFeeds),
			newArticles: normalizeCounter(parsed.newArticles),
		};
	} catch {
		return { totalFeeds: 0, completedFeeds: 0, newArticles: 0 };
	}
}

function normalizeCounter(value: unknown) {
	const number = typeof value === 'string' ? Number(value) : value;
	return typeof number === 'number' && Number.isFinite(number) && number >= 0
		? Math.floor(number)
		: 0;
}

async function getManualSyncLockStatus(
	redis: Redis,
	userId: string,
	lockValue: LockStatusValue | null,
	rawLockValue: string | null,
): Promise<{ status: LockStatus; value: LockStatusValue | null }> {
	if (lockValue == null) {
		return { status: 'missing', value: null };
	}

	if (hasFreshLockHeartbeat(lockValue)) {
		return { status: 'active', value: lockValue };
	}

	logger.warn('Clearing stale queued bulk feed sync lock', { userId });
	const didRelease = await redis.eval(
		RELEASE_STALE_SYNC_STATE_SCRIPT,
		3,
		CacheKeys.feedSyncAllLock(userId),
		CacheKeys.feedSyncAllQueued(userId),
		CacheKeys.feedSyncAllRequest(userId),
		rawLockValue ?? '',
	);
	if (Number(didRelease) === 1) return { status: 'stale', value: lockValue };

	const currentRawValue = await redis.get(CacheKeys.feedSyncAllLock(userId));
	const currentValue = parseLockValue(currentRawValue);
	return currentValue != null && hasFreshLockHeartbeat(currentValue)
		? { status: 'active', value: currentValue }
		: { status: 'missing', value: null };
}

async function getManualSyncQueuedStatus(
	redis: Redis,
	userId: string,
	queuedValue: QueuedStatusValue | null,
	lockStatus: LockStatus,
): Promise<{ status: QueuedStatus; value: QueuedStatusValue | null }> {
	if (lockStatus !== 'missing') {
		return { status: 'missing', value: null };
	}

	if (queuedValue != null && hasFreshQueuedMarker(queuedValue)) {
		return { status: 'active', value: queuedValue };
	}

	const isStillQueued = await isManualSyncQueued(redis, userId);
	if (isStillQueued) {
		return { status: 'active', value: queuedValue };
	}

	if (queuedValue == null) {
		return { status: 'missing', value: null };
	}

	logger.warn('Clearing stale queued bulk feed sync marker', { userId });
	await redis.del(CacheKeys.feedSyncAllQueued(userId));
	return { status: 'stale', value: queuedValue };
}

function encodeQueuedValue(queuedAt: number) {
	return JSON.stringify({ queuedAt });
}

function encodeLockValue(startedAt: number, heartbeatAt: number, ownerToken: string) {
	return JSON.stringify({ startedAt, heartbeatAt, ownerToken });
}

function parseQueuedValue(value: string | null): QueuedStatusValue | null {
	if (value == null) {
		return null;
	}

	const legacyTimestamp = Number(value);
	if (isValidTimestamp(legacyTimestamp)) {
		return { queuedAt: legacyTimestamp };
	}

	try {
		const parsed = JSON.parse(value) as Partial<QueuedStatusValue>;
		return {
			queuedAt: normalizeTimestamp(parsed.queuedAt),
		};
	} catch {
		return { queuedAt: null };
	}
}

function parseLockValue(value: string | null): LockStatusValue | null {
	if (value == null) {
		return null;
	}

	const legacyTimestamp = Number(value);
	if (isValidTimestamp(legacyTimestamp)) {
		return { startedAt: legacyTimestamp, heartbeatAt: legacyTimestamp, ownerToken: null };
	}

	try {
		const parsed = JSON.parse(value) as Partial<LockStatusValue>;
		const heartbeatAt = normalizeTimestamp(parsed.heartbeatAt);
		const startedAt = normalizeTimestamp(parsed.startedAt) ?? heartbeatAt;
		return {
			startedAt,
			heartbeatAt,
			ownerToken: typeof parsed.ownerToken === 'string' ? parsed.ownerToken : null,
		};
	} catch {
		return { startedAt: null, heartbeatAt: null, ownerToken: null };
	}
}

function hasFreshQueuedMarker(value: QueuedStatusValue) {
	return hasFreshTimestamp(value.queuedAt);
}

function hasFreshLockHeartbeat(value: LockStatusValue) {
	return hasFreshTimestamp(value.heartbeatAt);
}

function hasFreshTimestamp(timestamp: number | null) {
	return timestamp != null && Date.now() - timestamp <= MANUAL_SYNC_STATUS_STALE_MS;
}

function normalizeTimestamp(timestamp: unknown) {
	if (typeof timestamp !== 'number') {
		return null;
	}
	return isValidTimestamp(timestamp) ? timestamp : null;
}

function isValidTimestamp(timestamp: number) {
	return Number.isFinite(timestamp) && timestamp > 0;
}

function timestampToIso(timestamp?: number | null) {
	return timestamp ? new Date(timestamp).toISOString() : null;
}

async function isManualSyncQueued(redis: Redis, userId: string) {
	const index = await redis.call('LPOS', CacheKeys.feedSyncAllQueue(), userId);
	return index !== null;
}
