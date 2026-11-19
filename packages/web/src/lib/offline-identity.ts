import type { User } from '@self-feed/shared';

export const OFFLINE_ACCESS_LEASE_MS = 7 * 24 * 60 * 60 * 1000;
const OFFLINE_CLOCK_SKEW_MS = 5 * 60 * 1000;
export interface PersistedOfflineUser {
	schemaVersion: number;
	namespace: string;
	cachedAt: number;
	offlineAccessUntil: number;
	user: User;
}

export function isUser(value: unknown): value is User {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<User>;
	return (
		typeof candidate.id === 'string' &&
		typeof candidate.email === 'string' &&
		typeof candidate.role === 'string' &&
		typeof candidate.isActive === 'boolean'
	);
}

export function leasedUser(cached: unknown, origin: string, schemaVersion: number): User | null {
	if (!cached || typeof cached !== 'object') return null;
	const candidate = cached as Partial<PersistedOfflineUser>;
	const now = Date.now();
	if (
		candidate.schemaVersion !== schemaVersion ||
		candidate.namespace !== origin ||
		typeof candidate.cachedAt !== 'number' ||
		typeof candidate.offlineAccessUntil !== 'number' ||
		!Number.isFinite(candidate.cachedAt) ||
		!Number.isFinite(candidate.offlineAccessUntil) ||
		candidate.cachedAt > now + OFFLINE_CLOCK_SKEW_MS ||
		now - candidate.cachedAt > OFFLINE_ACCESS_LEASE_MS ||
		candidate.offlineAccessUntil < now ||
		candidate.offlineAccessUntil - candidate.cachedAt >
			OFFLINE_ACCESS_LEASE_MS + OFFLINE_CLOCK_SKEW_MS ||
		!isUser(candidate.user)
	) {
		return null;
	}
	return candidate.user;
}
