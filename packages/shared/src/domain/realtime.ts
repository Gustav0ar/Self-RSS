import type { FeedSyncScope, RealtimeEvent } from '../contracts/api.js';
import type { ArticleContentStatus } from './types.js';

const CONTENT_STATUSES = new Set<ArticleContentStatus>([
	'feed_ready',
	'enrichment_pending',
	'full_ready',
	'failed',
]);
const SYNC_PHASES = new Set(['queued', 'running', 'completed', 'failed'] as const);
const HEALTH_SEVERITIES = new Set(['healthy', 'warning', 'error'] as const);
const HEALTH_SYNC_STATUSES = new Set(['idle', 'syncing', 'error'] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function isNullableNonEmptyString(value: unknown): value is string | null {
	return value === null || isNonEmptyString(value);
}

function isNonNegativeInt(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInt(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(isNonEmptyString);
}

function parseScope(value: unknown): FeedSyncScope | null {
	if (!isRecord(value)) return null;
	if (value.feedId !== undefined && !isNonEmptyString(value.feedId)) return null;
	if (value.categoryId !== undefined && !isNonEmptyString(value.categoryId)) return null;
	const scope: FeedSyncScope = {};
	if (value.feedId !== undefined) scope.feedId = value.feedId;
	if (value.categoryId !== undefined) scope.categoryId = value.categoryId;
	return scope;
}

function isMember<T extends string>(set: ReadonlySet<T>, value: unknown): value is T {
	return typeof value === 'string' && set.has(value as T);
}

/**
 * Validate a parsed SSE realtime payload without pulling Zod into browser bundles.
 * Parity with `realtimeEventSchema` is verified in `@self-feed/shared` unit tests.
 */
export function parseRealtimeEvent(value: unknown): RealtimeEvent | null {
	if (!isRecord(value)) return null;
	const { type, eventId, updatedAt } = value;
	if (!isNonEmptyString(type) || !isNonEmptyString(eventId) || !isNonEmptyString(updatedAt)) {
		return null;
	}

	switch (type) {
		case 'article.read_state_changed': {
			if (
				!isNullableNonEmptyString(value.clientId) ||
				!isNonEmptyString(value.articleId) ||
				!isNonEmptyString(value.feedId) ||
				typeof value.isRead !== 'boolean' ||
				!isNonEmptyString(value.source) ||
				(value.revision !== undefined && !isNonNegativeInt(value.revision))
			) {
				return null;
			}
			return {
				type,
				eventId,
				clientId: value.clientId,
				updatedAt,
				articleId: value.articleId,
				feedId: value.feedId,
				isRead: value.isRead,
				source: value.source,
				...(value.revision !== undefined ? { revision: value.revision } : {}),
			};
		}
		case 'article.saved_state_changed': {
			if (
				!isNullableNonEmptyString(value.clientId) ||
				!isNonEmptyString(value.articleId) ||
				!isNonEmptyString(value.feedId) ||
				typeof value.isSaved !== 'boolean' ||
				(value.revision !== undefined && !isNonNegativeInt(value.revision))
			) {
				return null;
			}
			return {
				type,
				eventId,
				clientId: value.clientId,
				updatedAt,
				articleId: value.articleId,
				feedId: value.feedId,
				isSaved: value.isSaved,
				...(value.revision !== undefined ? { revision: value.revision } : {}),
			};
		}
		case 'articles.marked_read': {
			const scope = parseScope(value.scope);
			if (
				!scope ||
				!isNullableNonEmptyString(value.clientId) ||
				!isNonEmptyStringArray(value.feedIds) ||
				!isNonNegativeInt(value.markedCount)
			) {
				return null;
			}
			return {
				type,
				eventId,
				clientId: value.clientId,
				updatedAt,
				feedIds: value.feedIds,
				scope,
				markedCount: value.markedCount,
			};
		}
		case 'articles.new': {
			if (
				!isNonEmptyString(value.feedId) ||
				!isNonEmptyStringArray(value.articleIds) ||
				!isNonNegativeInt(value.count)
			) {
				return null;
			}
			return {
				type,
				eventId,
				updatedAt,
				feedId: value.feedId,
				articleIds: value.articleIds,
				count: value.count,
			};
		}
		case 'article.updated': {
			if (
				!isNonEmptyString(value.articleId) ||
				!isNonEmptyString(value.feedId) ||
				!isMember(CONTENT_STATUSES, value.contentStatus) ||
				!isPositiveInt(value.contentVersion)
			) {
				return null;
			}
			return {
				type,
				eventId,
				updatedAt,
				articleId: value.articleId,
				feedId: value.feedId,
				contentStatus: value.contentStatus,
				contentVersion: value.contentVersion,
			};
		}
		case 'feed.sync.progress': {
			const scope = parseScope(value.scope);
			if (
				!scope ||
				!isNonEmptyString(value.jobId) ||
				!isMember(SYNC_PHASES, value.phase) ||
				!isNonNegativeInt(value.totalFeeds) ||
				!isNonNegativeInt(value.completedFeeds) ||
				!isNonNegativeInt(value.syncedFeeds) ||
				!isNonNegativeInt(value.failedFeeds) ||
				!isNonNegativeInt(value.skippedFeeds) ||
				!isNonNegativeInt(value.newArticles) ||
				!isNullableNonEmptyString(value.queuedAt) ||
				!isNullableNonEmptyString(value.startedAt) ||
				!isNullableNonEmptyString(value.error)
			) {
				return null;
			}
			return {
				type,
				eventId,
				updatedAt,
				jobId: value.jobId,
				phase: value.phase,
				scope,
				totalFeeds: value.totalFeeds,
				completedFeeds: value.completedFeeds,
				syncedFeeds: value.syncedFeeds,
				failedFeeds: value.failedFeeds,
				skippedFeeds: value.skippedFeeds,
				newArticles: value.newArticles,
				queuedAt: value.queuedAt,
				startedAt: value.startedAt,
				error: value.error,
			};
		}
		case 'feed.health.updated': {
			if (
				!isNonEmptyString(value.feedId) ||
				!isMember(HEALTH_SEVERITIES, value.severity) ||
				!isMember(HEALTH_SYNC_STATUSES, value.syncStatus) ||
				!isNullableNonEmptyString(value.lastSyncedAt) ||
				!isNullableNonEmptyString(value.lastSyncError) ||
				!isNullableNonEmptyString(value.lastSyncErrorAt)
			) {
				return null;
			}
			return {
				type,
				eventId,
				updatedAt,
				feedId: value.feedId,
				severity: value.severity,
				syncStatus: value.syncStatus,
				lastSyncedAt: value.lastSyncedAt,
				lastSyncError: value.lastSyncError,
				lastSyncErrorAt: value.lastSyncErrorAt,
			};
		}
		default:
			return null;
	}
}
