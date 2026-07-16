import { randomUUID } from 'node:crypto';

const RENEW_OWNED_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) ~= ARGV[1] then
	return 0
end
redis.call("EXPIRE", KEYS[1], ARGV[2])
return 1
`;

const RELEASE_OWNED_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) ~= ARGV[1] then
	return 0
end
if tonumber(ARGV[2]) > 0 then
	return redis.call("EXPIRE", KEYS[1], ARGV[2])
end
return redis.call("DEL", KEYS[1])
`;

interface RedisLockClient {
	set?: (...args: unknown[]) => Promise<unknown>;
	eval?: (...args: unknown[]) => Promise<unknown>;
}

interface OwnedRedisLockOptions {
	redis: RedisLockClient;
	key: string;
	ttlSeconds: number;
	releaseCooldownSeconds?: number;
	heartbeatIntervalMs?: number;
	onRenewError?: (error: unknown) => void;
	onReleaseError?: (error: unknown) => void;
}

export async function acquireOwnedRedisLock({
	redis,
	key,
	ttlSeconds,
	releaseCooldownSeconds = 0,
	heartbeatIntervalMs = (ttlSeconds * 1000) / 3,
	onRenewError,
	onReleaseError,
}: OwnedRedisLockOptions): Promise<(() => Promise<void>) | null> {
	if (typeof redis.set !== 'function') return async () => undefined;

	const ownerToken = randomUUID();
	const acquired = await redis.set(key, ownerToken, 'EX', ttlSeconds, 'NX');
	if (acquired !== 'OK') return null;

	const heartbeat =
		typeof redis.eval === 'function'
			? setInterval(() => {
					void Promise.resolve()
						.then(() =>
							redis.eval?.(RENEW_OWNED_LOCK_SCRIPT, 1, key, ownerToken, String(ttlSeconds)),
						)
						.catch((error: unknown) => onRenewError?.(error));
				}, heartbeatIntervalMs)
			: null;
	heartbeat?.unref?.();

	return async () => {
		if (heartbeat) clearInterval(heartbeat);
		if (typeof redis.eval !== 'function') return;
		try {
			await redis.eval(
				RELEASE_OWNED_LOCK_SCRIPT,
				1,
				key,
				ownerToken,
				String(releaseCooldownSeconds),
			);
		} catch (error) {
			onReleaseError?.(error);
		}
	};
}
