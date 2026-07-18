import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
	feedDiscoveryCandidates,
	feedRefreshRequestItems,
	feedRefreshRequests,
	feeds,
} from '../db/schema.js';
import { normalizeFeedSourceUrl } from '../utils/feed-source-url.js';

export function listDurableDiscoveryCandidates(db: Database, userId: string, requestId: string) {
	return db.query.feedDiscoveryCandidates.findMany({
		where: and(
			eq(feedDiscoveryCandidates.userId, userId),
			eq(feedDiscoveryCandidates.requestId, requestId),
			sql`${feedDiscoveryCandidates.expiresAt} > unixepoch()`,
		),
		orderBy: [feedDiscoveryCandidates.createdAt],
	});
}

export async function persistDurableDiscoveryCandidates(
	db: Database,
	input: {
		jobId: string;
		sourceId: string;
		finalUrl: string;
		candidates: Array<{ url: string; title: string | null; type: string }>;
		now: Date;
	},
) {
	const items = await db
		.select({
			requestId: feedRefreshRequestItems.requestId,
			feedId: feedRefreshRequestItems.feedId,
			userId: feedRefreshRequests.userId,
			categoryId: feeds.categoryId,
		})
		.from(feedRefreshRequestItems)
		.innerJoin(feedRefreshRequests, eq(feedRefreshRequests.id, feedRefreshRequestItems.requestId))
		.leftJoin(feeds, eq(feeds.id, feedRefreshRequestItems.feedId))
		.where(eq(feedRefreshRequestItems.jobId, input.jobId));
	if (items.length === 0) return 0;
	const expiresAt = new Date(input.now.getTime() + 24 * 60 * 60 * 1_000);
	return db.transaction((tx) => {
		for (const item of items) {
			if (!item.feedId) continue;
			for (const candidate of input.candidates) {
				let normalized: string;
				try {
					normalized = normalizeFeedSourceUrl(candidate.url).normalizedUrl;
				} catch {
					continue;
				}
				tx.insert(feedDiscoveryCandidates)
					.values({
						id: crypto.randomUUID(),
						requestId: item.requestId,
						userId: item.userId,
						categoryId: item.categoryId,
						inputUrl: input.finalUrl,
						candidateUrl: candidate.url,
						normalizedCandidateUrl: normalized,
						title: candidate.title,
						type: candidate.type,
						selectionMetadata: { feedId: item.feedId, sourceId: input.sourceId },
						expiresAt,
						createdAt: input.now,
						updatedAt: input.now,
					})
					.onConflictDoNothing()
					.run();
			}
			tx.update(feeds)
				.set({
					syncStatus: 'discovery_required',
					lastSyncErrorCode: 'discovery_required',
					lastSyncError: 'The URL is a website; select one of its advertised feeds',
					lastSyncErrorAt: input.now,
					updatedAt: input.now,
				})
				.where(and(eq(feeds.id, item.feedId), eq(feeds.userId, item.userId)))
				.run();
		}
		return items.length;
	});
}

export function cleanupDurableDiscoveryCandidates(db: Database, now = new Date()) {
	return db
		.delete(feedDiscoveryCandidates)
		.where(sql`${feedDiscoveryCandidates.expiresAt} <= ${Math.floor(now.getTime() / 1_000)}`)
		.returning({ id: feedDiscoveryCandidates.id });
}
